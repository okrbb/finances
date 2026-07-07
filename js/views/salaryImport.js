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
                const fullText = textContent.items.map(item => item.str).join(' ');

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

    // 2. Hrubý príjem (Robustné zachytenie tisícok)
    const grossMatch = text.match(/HRUB[ÝY]\s+PR[ÍI]JEM\s+([\d\s,.]+)/i);
    if (grossMatch) {
        results.push({ date: dateStr, type: 'Príjem', category: 'PD - MV SR', amount: cleanNum(grossMatch[1]), note: 'hrubá mzda' });
    }

    // 3. Poistné a Daň (Univerzálny regex pre riadok s hodnotami)
    // Na páske je riadok v tvare: | 423,07 | | 519,52 | |
    // Tento regex hľadá presne túto štruktúru bez ohľadu na konkrétne sumy
    const tableRowMatch = text.match(/\|\s*([\d\s,.]+)\s*\|\s*\|\s*([\d\s,.]+)\s*\|\s*\|/);
    
    if (tableRowMatch) {
        const insuranceVal = cleanNum(tableRowMatch[1]);
        const taxVal = cleanNum(tableRowMatch[2]);

        if (insuranceVal > 0) {
            results.push({ date: dateStr, type: 'Výdaj', category: 'VD - poistenie', amount: insuranceVal, note: 'odvody' });
        }
        if (taxVal > 0) {
            results.push({ date: dateStr, type: 'Výdaj', category: 'VD - preddavok na daň', amount: taxVal, note: 'preddavok na daň' });
        }
    } else {
        // Fallback pre pásky, ktoré nemajú tabuľku s oddeľovačmi "|"
        const insuranceMatch = text.match(/POISTN[ÉE][^\d]*([\d\s,.]+)/i);
        const taxMatch = text.match(/PREDDAVOK\s+NA\s+DA[NŇ][^\d]*([\d\s,.]+)/i);

        if (insuranceMatch) {
            const insuranceVal = cleanNum(insuranceMatch[1]);
            if (insuranceVal > 0) {
                results.push({ date: dateStr, type: 'Výdaj', category: 'VD - poistenie', amount: insuranceVal, note: 'odvody' });
            }
        }

        if (taxMatch) {
            const taxVal = cleanNum(taxMatch[1]);
            if (taxVal > 0) {
                results.push({ date: dateStr, type: 'Výdaj', category: 'VD - preddavok na daň', amount: taxVal, note: 'preddavok na daň' });
            }
        }
    }

    // 4. DDS ZC
    const ddsMatch = text.match(/DDS ZC\s+([\d\s,.]+)/i);
    if (ddsMatch) {
        results.push({ date: dateStr, type: 'Výdaj', category: 'VD - DDS', amount: cleanNum(ddsMatch[1]), note: 'príspevok DDS' });
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