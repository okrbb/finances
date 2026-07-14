import { collection, addDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showToast } from '../notifications.js';
import { activeYear } from '../app.js';
import { formatCurrencySK } from '../utils.js';

let pendingSalaryData = [];

function buildTxSignature(tx) {
    const amount = Number.parseFloat(tx.amount || 0).toFixed(2);
    return [
        tx.uid || '',
        tx.date || '',
        tx.type || '',
        tx.category || '',
        amount,
        tx.note || ''
    ].join('|');
}

export function setupSalaryImport(db, user, refreshCallback) {
    const fileInput = document.getElementById('salaryImportInput');
    const modal = document.getElementById('importPreviewModal');
    const previewList = document.getElementById('importPreviewList');

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showToast("Analyzujem PDF pásku...", "warning");

        const reader = new FileReader();
        reader.onload = async function() {
            try {
                if (!window.pdfjsLib) {
                    showToast("PDF knižnica nie je načítaná. Skúste obnoviť stránku.", "danger");
                    return;
                }

                const typedarray = new Uint8Array(this.result);
                const pdf = await window.pdfjsLib.getDocument(typedarray).promise;
                const page = await pdf.getPage(1);
                const textContent = await page.getTextContent();
                if (!textContent?.items?.length) {
                    showToast("PDF neobsahuje čitateľný text (pravdepodobne sken).", "warning");
                }
                const fullText = textContent.items.map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('');

                // HLAVNÁ ZMENA: Volanie novej robustnej funkcie
                const extracted = parseSalaryText(fullText);

                // Kontrola duplicít voči existujúcim transakciám používateľa
                const existingQuery = query(
                    collection(db, "transactions"),
                    where("uid", "==", user.uid)
                );
                const existingSnapshot = await getDocs(existingQuery);
                const existingSignatures = new Set();
                existingSnapshot.forEach((docSnap) => {
                    existingSignatures.add(buildTxSignature({ uid: user.uid, ...docSnap.data() }));
                });

                extracted.forEach((tx) => {
                    tx.isDuplicate = existingSignatures.has(buildTxSignature({ uid: user.uid, ...tx }));
                });

                if (extracted.length === 0) {
                    showToast("Na páske sa nenašli sumy na import.", "warning");
                }
                preparePreview(extracted, previewList, modal);
            } catch (err) {
                showToast("Chyba pri spracovaní PDF: " + err.message, "danger");
            }
        };
        reader.readAsArrayBuffer(file);
    });

    document.getElementById('btnConfirmFinalImport').addEventListener('click', async () => {
        if (pendingSalaryData.length === 0) return;

        let count = 0;
        let skippedDuplicates = 0;
        const checkboxes = document.querySelectorAll('.import-check');
        
        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i] && checkboxes[i].checked) {
                const tx = pendingSalaryData[i];
                if (tx?.isDuplicate) {
                    skippedDuplicates++;
                    continue;
                }
                const txYear = Number.parseInt(String(tx.date || '').slice(0, 4), 10);
                await addDoc(collection(db, "transactions"), {
                    ...tx,
                    account: 'banka',
                    uid: user.uid,
                    year: Number.isNaN(txYear) ? activeYear : txYear,
                    archived: false,
                    createdAt: new Date()
                });
                count++;
            }
        }

        modal.style.display = "none";
        pendingSalaryData = [];
        if (skippedDuplicates > 0) {
            showToast(`Uložených ${count} záznamov, preskočených duplicít: ${skippedDuplicates}`, "warning");
        } else {
            showToast(`Úspešne uložených ${count} záznamov z pásky`, "success");
        }
        refreshCallback();
        fileInput.value = ""; 
    });
}

function parseSalaryText(text) {
    // Odstráni tisíce (bodky), medzery a nahradí desatinnú čiarku bodkou
    const cleanNum = (val) => {
        if (!val) return 0;
        let cleaned = val.replace(/[.\s\u00A0]/g, '').replace(',', '.');
        return parseFloat(cleaned) || 0;
    };

    const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const floor2 = (value) => Math.floor((Number(value) || 0) * 100) / 100;

    const lines = String(text || '')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const extractNumbers = (line) => (String(line || '').match(/[\d][\d\s,.]*/g) || [])
        .map((value) => cleanNum(value))
        .filter((value) => Number.isFinite(value) && value > 0);

    const extractLineAmount = (line, labelPattern) => {
        const normalizedLine = String(line || '').replace(/\s+/g, ' ').trim();
        const match = normalizedLine.match(labelPattern);
        if (!match) return 0;

        let tail = normalizedLine.slice((match.index || 0) + match[0].length);
        tail = tail.replace(/\(VZ:[^)]+\)/i, ' ');
        const numbers = extractNumbers(tail);
        return numbers[0] || 0;
    };

    const parseMonthYearFromText = (rawText) => {
        const monthAliases = {
            januar: '01', jan: '01',
            februar: '02', febr: '02', feb: '02',
            marec: '03', mar: '03',
            april: '04', apr: '04',
            maj: '05',
            jun: '06',
            jul: '07',
            august: '08', aug: '08',
            september: '09', sept: '09', sep: '09',
            oktober: '10', okt: '10',
            november: '11', nov: '11',
            december: '12', dec: '12'
        };

        const normalized = String(rawText || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        const aliasTokens = Object.keys(monthAliases).sort((a, b) => b.length - a.length).join('|');
        const monthYearRegex = new RegExp(`\\b(${aliasTokens})\\.?\\s*(20\\d{2})\\b`, 'i');
        const yearMonthRegex = new RegExp(`\\b(20\\d{2})\\s*[-./]?\\s*(${aliasTokens})\\.?\\b`, 'i');

        const monthYearMatch = normalized.match(monthYearRegex);
        if (monthYearMatch) {
            const month = monthAliases[monthYearMatch[1].toLowerCase()];
            if (month) {
                return `${monthYearMatch[2]}-${month}-01`;
            }
        }

        const yearMonthMatch = normalized.match(yearMonthRegex);
        if (yearMonthMatch) {
            const month = monthAliases[yearMonthMatch[2].toLowerCase()];
            if (month) {
                return `${yearMonthMatch[1]}-${month}-01`;
            }
        }

        return null;
    };
    
    // 1. Identifikácia dátumu (mesiaca)
    const parsedDate = parseMonthYearFromText(text);
    let dateStr = parsedDate || new Date().toISOString().split('T')[0];

    const results = [];
    let grossAmount = 0;

    // 2. Hrubý príjem (Robustné zachytenie tisícok)
    const grossMatch = text.match(/HRUB[ÝY]\s+PR[ÍI]JEM\s+([\d\s,.]+)/i);
    if (grossMatch) {
        grossAmount = cleanNum(grossMatch[1]);
        results.push({ date: dateStr, type: 'Príjem', category: 'PD - MV SR', amount: grossAmount, note: 'hrubá mzda' });
    }

    // 3. Jednotlivé poistné položky a preddavok na daň z pásky
    const detailedContributions = [
        { label: /Zdrav\.p\.?/i, category: 'VD - Zdrav.p.', note: 'Zdrav.p.' },
        { label: /Nemoc\.p\.?/i, category: 'VD - Nemoc.p.', note: 'Nemoc.p.' },
        { label: /Staro\.p\.?/i, category: 'VD - Staro.p.', note: 'Staro.p.' },
        { label: /Fon\.zam\.?/i, category: 'VD - Fon.zam.', note: 'Fon.zam.' },
        { label: /Invali\.p\.?/i, category: 'VD - Invali.p.', note: 'Invali.p.' }
    ];

    let detailedContributionCount = 0;
    const detailedLineIndexes = new Set();

    lines.forEach((line, index) => {
        detailedContributions.forEach(({ label, category, note }) => {
            if (label.test(line)) {
                const amount = extractLineAmount(line, label);
                if (amount > 0) {
                    detailedContributionCount += 1;
                    detailedLineIndexes.add(index);
                    results.push({ date: dateStr, type: 'Výdaj', category, amount, note });
                }
            }
        });
    });

    let taxAdvance = 0;
    const taxLabelIndex = lines.findIndex((line) => /Daň\s*pre\.?/i.test(line));
    if (taxLabelIndex >= 0) {
        for (let index = taxLabelIndex + 1; index < Math.min(lines.length, taxLabelIndex + 4); index += 1) {
            const numbers = extractNumbers(lines[index]);
            if (numbers.length >= 2) {
                taxAdvance = numbers[1];
                break;
            }
            if (numbers.length === 1 && taxAdvance === 0) {
                taxAdvance = numbers[0];
            }
        }
    }

    if (taxAdvance > 0) {
        results.push({ date: dateStr, type: 'Výdaj', category: 'VD - preddavok na daň', amount: taxAdvance, note: 'preddavok na daň' });
    }

    // 4. DDS ZC (príspevok zamestnanca)
    const ddsZcMatch = text.match(/DDS\s+ZC\s+([\d\s,.]+)/i);
    if (ddsZcMatch) {
        const ddsAmount = cleanNum(ddsZcMatch[1]);
        if (ddsAmount > 0) {
            results.push({ date: dateStr, type: 'Výdaj', category: 'VD - DDS', amount: ddsAmount, note: 'príspevok DDS' });
        }
    }

    if (detailedContributionCount === 0 || taxAdvance === 0) {
        const insuranceMatch = text.match(/POISTN[ÉE][^\d]*([\d\s,.]+)/i);
        if (insuranceMatch) {
            const insuranceVal = cleanNum(insuranceMatch[1]);
            if (insuranceVal > 0 && grossAmount > 0) {
                const health = floor2(grossAmount * 0.05);
                const nemocenske = floor2(grossAmount * 0.014);
                const starobne = floor2(grossAmount * 0.04);
                const fondZam = floor2(grossAmount * 0.01);
                const invalidne = floor2(grossAmount * 0.03);
                const social = nemocenske + starobne + fondZam + invalidne;
                results.push({ date: dateStr, type: 'Výdaj', category: 'VD - Zdrav.p.', amount: health, note: 'Zdrav.p.' });
                results.push({ date: dateStr, type: 'Výdaj', category: 'VD - Nemoc.p.', amount: nemocenske, note: 'Nemoc.p.' });
                results.push({ date: dateStr, type: 'Výdaj', category: 'VD - Staro.p.', amount: starobne, note: 'Staro.p.' });
                results.push({ date: dateStr, type: 'Výdaj', category: 'VD - Fon.zam.', amount: fondZam, note: 'Fon.zam.' });
                results.push({ date: dateStr, type: 'Výdaj', category: 'VD - Invali.p.', amount: invalidne, note: 'Invali.p.' });
                results.push({ date: dateStr, type: 'Výdaj', category: 'VD - preddavok na daň', amount: round2((grossAmount - social - health) * 0.19), note: 'preddavok na daň' });
            }
        }
    }

    return results;
}

function preparePreview(data, container, modal) {
    pendingSalaryData = data;
    container.innerHTML = "";
    
    if (data.length === 0) {
        container.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:20px;'>Nepodarilo sa identifikovať žiadne sumy.</td></tr>";
    }

    data.forEach((tx) => {
        const tr = document.createElement('tr');
        tr.style.opacity = tx.isDuplicate ? '0.5' : '1';
        tr.innerHTML = `
            <td style="padding: 10px;"><input type="checkbox" class="import-check" ${tx.isDuplicate ? '' : 'checked'}></td>
            <td>${tx.date.split('-').reverse().join('.')}</td>
            <td><div style="font-weight: 600;">${tx.note}</div></td>
            <td style="text-align: right; font-weight: bold; color: ${tx.type === 'Príjem' ? 'var(--success)' : 'var(--danger)'};">
                ${formatCurrencySK(tx.amount)}
            </td>
            <td><span style="font-size: 0.7rem; background: ${tx.isDuplicate ? '#fee2e2' : '#eee'}; color: ${tx.isDuplicate ? '#991b1b' : 'inherit'}; padding: 2px 5px; border-radius: 4px;">${tx.isDuplicate ? 'DUPLICITA' : tx.category}</span></td>
        `;
        container.appendChild(tr);
    });

    modal.style.display = "flex";
}