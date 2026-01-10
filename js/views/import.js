import { collection, addDoc, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showToast } from '../notifications.js';
import { activeYear } from '../app.js';

let pendingTransactions = []; // Dočasné úložisko pre vybrané transakcie

export function setupImportEvents(db, user, refreshCallback) {
    const fileInput = document.getElementById('bankImportInput');
    const modal = document.getElementById('importPreviewModal');
    const previewList = document.getElementById('importPreviewList');

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const xmlText = event.target.result;
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const entries = xmlDoc.getElementsByTagName("Ntry");

            // Načítanie existujúcich ref kódov kvôli duplicitám
            const existingRefs = new Set();
            const q = query(collection(db, "transactions"), where("uid", "==", user.uid));
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach(doc => { if (doc.data().bankRef) existingRefs.add(doc.data().bankRef); });

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
                const isDuplicate = existingRefs.has(bankRef);

                // Mapping Engine (rovnaký ako predtým)
                let category = indicator === "CRDT" ? "PD - iné" : "VD - iné";
                const fullNote = (counterParty + " " + narrative).toLowerCase();
                if (fullNote.includes("ministerstvo vnútra")) category = "PD - mzda";
                if (fullNote.includes("radost") || fullNote.includes("telekom")) category = "VD - Telekom";
                if (fullNote.includes("swan") || fullNote.includes("4ka")) category = "VD - 4ka";

                const tx = {
                    bankRef, date, amount, category, 
                    type: indicator === "CRDT" ? "Príjem" : "Výdaj",
                    note: `${counterParty} - ${narrative}`.trim(),
                    isDuplicate
                };

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
                        ${amount.toFixed(2)} €
                    </td>
                    <td><span style="font-size: 0.7rem; background: #eee; padding: 2px 5px; border-radius: 4px;">${category}</span></td>
                `;
                previewList.appendChild(tr);
            }

            modal.style.display = "flex";
        };
        reader.readAsText(file);
    });

    // Tlačidlo: Potvrdiť import vybraných
    document.getElementById('btnConfirmFinalImport').addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('.import-check');
        let count = 0;

        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                const data = pendingTransactions[i];
                await addDoc(collection(db, "transactions"), {
                    uid: user.uid,
                    date: data.date,
                    type: data.type,
                    amount: data.amount,
                    category: data.category,
                    note: data.note,
                    account: "banka",
                    bankRef: data.bankRef,
                    year: activeYear,
                    archived: false,
                    createdAt: new Date()
                });
                count++;
            }
        }

        modal.style.display = "none";
        showToast(`Úspešne pridaných ${count} transakcií`, "success");
        refreshCallback();
        document.getElementById('bankImportInput').value = ""; // Reset
    });

    // Tlačidlo: Zrušiť
    document.getElementById('btnCancelImport').addEventListener('click', () => {
        modal.style.display = "none";
        document.getElementById('bankImportInput').value = "";
    });

    // Logika pre "Select All"
    document.getElementById('selectAllImport').addEventListener('change', (e) => {
        document.querySelectorAll('.import-check').forEach(cb => cb.checked = e.target.checked);
    });
}