import { collection, addDoc, query, where, getDocs, deleteDoc, doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showToast } from '../notifications.js';
import { activeYear } from '../app.js';
import { formatCurrencySK } from '../utils.js';

let pendingTransactions = []; // Dočasné úložisko pre vybrané transakcie
let lastImportedDocIds = [];

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

export function setupImportEvents(db, user, refreshCallback) {
    const fileInput = document.getElementById('bankImportInput');
    const modal = document.getElementById('importPreviewModal');
    const previewList = document.getElementById('importPreviewList');

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setImportWizardStep(1);
        showToast('Import krok 1/4: súbor načítaný', 'info', { durationMs: 1400 });

        const reader = new FileReader();
        reader.onload = async (event) => {
            setImportWizardStep(2);
            showToast('Import krok 2/4: validujem a párujem duplicity', 'warning', { durationMs: 1400 });
            const xmlText = event.target.result;
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const entries = xmlDoc.getElementsByTagName("Ntry");

            // Načítanie existujúcich transakcií kvôli duplicitám
            const existingRefs = new Set();
            const existingSignatures = new Set();
            const q = query(collection(db, "transactions"), where("uid", "==", user.uid));
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data() || {};
                if (data.bankRef) existingRefs.add(data.bankRef);
                existingSignatures.add(buildTxSignature({ uid: user.uid, ...data }));
            });

            pendingTransactions = [];
            previewList.innerHTML = "";

            for (let ntry of entries) {
                const bankRef = ntry.getElementsByTagName("NtryRef")[0]?.textContent;
                const amount = parseFloat(ntry.getElementsByTagName("Amt")[0].textContent);
                const indicator = ntry.getElementsByTagName("CdtDbtInd")[0].textContent; // CRDT/DBIT
                const date = ntry.getElementsByTagName("BookgDt")[0].getElementsByTagName("Dt")[0].textContent;
                const counterParty = ntry.getElementsByTagName("Nm")[0]?.textContent || "Neznámy";
                const narrative = ntry.getElementsByTagName("Nrtv")[0]?.textContent || "";
                const unstructured = ntry.getElementsByTagName("Ustrd")[0]?.textContent || "";

                // Mapping Engine (rovnaký ako predtým)
                let category = indicator === "CRDT" ? "PD - iné" : "VD - iné";
                const fullNote = (counterParty + " " + narrative).toLowerCase();
                if (fullNote.includes("ministerstvo vnútra")) category = "PD - mzda";
                if (fullNote.includes("radost") || fullNote.includes("telekom")) category = "VD - Telekom";
                if (fullNote.includes("swan") || fullNote.includes("4ka")) category = "VD - 4ka";

                const signature = buildTxSignature({
                    uid: user.uid,
                    date,
                    type: indicator === "CRDT" ? "Príjem" : "Výdaj",
                    category,
                    amount,
                    note: `${counterParty} - ${narrative}`.trim()
                });
                const isDuplicate = existingRefs.has(bankRef) || existingSignatures.has(signature);

                const tx = {
                    bankRef, date, amount, category, 
                    type: indicator === "CRDT" ? "Príjem" : "Výdaj",
                    note: `${counterParty} - ${narrative}`.trim(),
                    isDuplicate
                };

                if (!isDuplicate) {
                    existingSignatures.add(signature);
                }

                pendingTransactions.push(tx);

                // Vykreslenie riadku do tabuľky
                const tr = document.createElement('tr');
                tr.style.opacity = isDuplicate ? '0.5' : '1';
                tr.innerHTML = `
                    <td style="padding: 10px;"><input type="checkbox" class="import-check" ${isDuplicate ? '' : 'checked'}></td>
                    <td style="white-space: nowrap;">${date.split('-').reverse().join('.')}</td>
                    
                    <td style="word-break: break-word; min-width: 200px; padding-right: 15px;">
                        <div style="font-weight: 600; color: var(--text-dark);">${counterParty}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${narrative || unstructured}</div>
                    </td>
                    
                    <td style="text-align: right; font-weight: bold; color: ${tx.type === 'Príjem' ? 'var(--success)' : 'var(--danger)'}; white-space: nowrap;">
                        ${formatCurrencySK(amount)}
                    </td>
                    <td><span style="font-size: 0.7rem; background: #eee; padding: 2px 5px; border-radius: 4px;">${category}</span></td>
                `;
                previewList.appendChild(tr);
            }

            setImportWizardStep(3);
            modal.style.display = "flex";
        };
        reader.readAsText(file);
    });

    // Tlačidlo: Potvrdiť import vybraných
    document.getElementById('btnConfirmFinalImport').addEventListener('click', async () => {
        setImportWizardStep(4);
        showToast('Import krok 4/4: zapisujem transakcie', 'warning', { durationMs: 1400 });
        const checkboxes = document.querySelectorAll('.import-check');
        let count = 0;
        let skippedDuplicates = 0;
        let processed = 0;
        const selectedTotal = Array.from(checkboxes).filter((cb) => cb.checked).length;
        const importedDocIds = [];

        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                const data = pendingTransactions[i];
                if (data?.isDuplicate) {
                    skippedDuplicates++;
                    processed++;
                    continue;
                }
                const txYear = Number.parseInt(String(data.date || '').slice(0, 4), 10);
                const docRef = await addDoc(collection(db, "transactions"), {
                    uid: user.uid,
                    date: data.date,
                    type: data.type,
                    amount: data.amount,
                    category: data.category,
                    note: data.note,
                    account: "banka",
                    bankRef: data.bankRef,
                    year: Number.isNaN(txYear) ? activeYear : txYear,
                    archived: false,
                    createdAt: new Date()
                });
                importedDocIds.push(docRef.id);
                count++;
                processed++;

                if (selectedTotal > 0 && processed % 25 === 0) {
                    showToast(`Spracované ${processed}/${selectedTotal} položiek`, 'info', { durationMs: 1200 });
                }
            }
        }

        modal.style.display = "none";
        lastImportedDocIds = importedDocIds;
        if (skippedDuplicates > 0) {
            showToast(`Pridaných ${count} transakcií, preskočené duplicity: ${skippedDuplicates}`, "warning");
        } else {
            showToast(`Úspešne pridaných ${count} transakcií`, "success");
        }
        if (count > 0) {
            showToast('Posledný import môžeš vrátiť', 'info', {
                durationMs: 9000,
                action: {
                    label: 'Storno importu',
                    onClick: async () => {
                        await undoLastImport(db);
                        await refreshCallback();
                    }
                }
            });
        }
        refreshCallback();
        document.getElementById('bankImportInput').value = ""; // Reset
    });

    // Tlačidlo: Zrušiť
    document.getElementById('btnCancelImport').addEventListener('click', () => {
        modal.style.display = "none";
        setImportWizardStep(2);
        document.getElementById('bankImportInput').value = "";
    });

    // Logika pre "Select All"
    document.getElementById('selectAllImport').addEventListener('change', (e) => {
        document.querySelectorAll('.import-check').forEach(cb => cb.checked = e.target.checked);
    });
}

async function undoLastImport(db) {
    if (!Array.isArray(lastImportedDocIds) || lastImportedDocIds.length === 0) {
        showToast('Nie je čo stornovať', 'warning');
        return;
    }

    const ids = [...lastImportedDocIds];
    for (const id of ids) {
        await deleteDoc(doc(db, 'transactions', id));
    }

    lastImportedDocIds = [];
    showToast(`Import bol vrátený (${ids.length} transakcií)`, 'success');
}

function setImportWizardStep(step) {
    const steps = document.querySelectorAll('#importWizardSteps .wizard-step');
    if (!steps.length) return;

    steps.forEach((el, index) => {
        const position = index + 1;
        el.classList.toggle('active', position === step);
        el.classList.toggle('done', position < step);
    });
}