import { collection, addDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showToast } from '../notifications.js';

let pendingSalaryData = [];

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
                const typedarray = new Uint8Array(this.result);
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                const page = await pdf.getPage(1);
                const textContent = await page.getTextContent();
                const fullText = textContent.items.map(item => item.str).join(' ');

                // HLAVNÁ ZMENA: Volanie novej robustnej funkcie
                const extracted = parseSalaryText(fullText);
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
        const checkboxes = document.querySelectorAll('.import-check');
        
        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i] && checkboxes[i].checked) {
                const tx = pendingSalaryData[i];
                await addDoc(collection(db, "transactions"), {
                    ...tx,
                    uid: user.uid,
                    createdAt: new Date()
                });
                count++;
            }
        }

        modal.style.display = "none";
        pendingSalaryData = [];
        showToast(`Úspešne uložených ${count} záznamov z pásky`, "success");
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
    
    // 1. Identifikácia dátumu (mesiaca)
    const dateMatch = text.match(/(Január|Február|Marec|Apríl|Máj|Jún|Júl|August|September|Október|November|December)\s+(\d{4})/i);
    let dateStr = new Date().toISOString().split('T')[0];
    if (dateMatch) {
        const months = { 'január':'01', 'február':'02', 'marec':'03', 'apríl':'04', 'máj':'05', 'jún':'06', 'júl':'07', 'august':'08', 'september':'09', 'október':'10', 'november':'11', 'december':'12' };
        dateStr = `${dateMatch[2]}-${months[dateMatch[1].toLowerCase()]}-01`;
    }

    const results = [];

    // 2. Hrubý príjem (Robustné zachytenie tisícok)
    const grossMatch = text.match(/HRUBÝ PRÍJEM\s+([\d\s,.]+)/i);
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
        tr.innerHTML = `
            <td style="padding: 10px;"><input type="checkbox" class="import-check" checked></td>
            <td>${tx.date.split('-').reverse().join('.')}</td>
            <td><div style="font-weight: 600;">${tx.note}</div></td>
            <td style="text-align: right; font-weight: bold; color: ${tx.type === 'Príjem' ? 'var(--success)' : 'var(--danger)'};">
                ${tx.amount.toFixed(2)} €
            </td>
            <td><span style="font-size: 0.7rem; background: #eee; padding: 2px 5px; border-radius: 4px;">${tx.category}</span></td>
        `;
        container.appendChild(tr);
    });

    modal.style.display = "flex";
}