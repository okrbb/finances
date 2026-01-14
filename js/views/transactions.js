// js/views/transactions.js

import { showToast } from '../notifications.js';
import { collection, addDoc, deleteDoc, updateDoc, doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { validateDate, validateAmount, confirmAction } from '../utils.js';

let editingTransactionId = null;

// --- 1. Setup Events (Volané raz) ---
export function setupTransactionEvents(db, getUserCallback, getActiveYearCallback, refreshDataCallback) {
    const form = document.getElementById('transactionForm');
    const dateInput = document.getElementById('txDate');
    const categorySelect = document.getElementById('txCategory');
    const noteInput = document.getElementById('txNote');
    const cancelBtn = document.getElementById('cancelEditBtn');

    const SK_MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];
    
    // 1. Zmena Dátumu -> Nastaví len mesiac (napr. "november")
    if (dateInput) {
        dateInput.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                const m = parseInt(val.split('-')[1]) - 1;
                if (m >= 0 && m < 12) {
                    noteInput.value = SK_MONTHS[m];
                    
                    if (categorySelect.value && categorySelect.value.includes(' - ')) {
                        const suffix = categorySelect.value.split(' - ')[1]; 
                        noteInput.value = `${SK_MONTHS[m]} ${suffix}`;
                    }
                }
            }
        });
    }

    // 2. Zmena Kategórie -> Auto-prepínanie Príjem/Výdaj + Úprava Poznámky
    if (categorySelect) {
        categorySelect.addEventListener('change', (e) => {
            const opt = e.target.options[e.target.selectedIndex];
            const typeSelect = document.getElementById('txType');
            const val = e.target.value; 

            // A) Prepnutie typu Príjem/Výdaj
            if (opt.parentElement.label === 'Príjmy') typeSelect.value = 'Príjem';
            if (opt.parentElement.label === 'Výdavky') typeSelect.value = 'Výdaj';

            // B) Úprava poznámky (Mesiac + Suffix)
            const dateVal = dateInput.value;
            if (dateVal && val.includes(' - ')) {
                const m = parseInt(dateVal.split('-')[1]) - 1;
                if (m >= 0 && m < 12) {
                    const currentMonth = SK_MONTHS[m];
                    const suffix = val.split(' - ')[1];
                    noteInput.value = `${currentMonth} ${suffix}`;
                }
            }
        });
    }

    // Submit
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const user = getUserCallback();
            if (user) await handleFormSubmit(e, user, db, getActiveYearCallback, refreshDataCallback);
        });
    }
    
    // Cancel Edit Button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            editingTransactionId = null;
            resetSubmitButton();
            form.reset();
            showToast("Úprava zrušená", "info");
        });
    }

    // Search Filter
    document.getElementById('searchTransactionInput')?.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        const rows = document.querySelectorAll('#transactionsList tr');
        rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(val) ? '' : 'none';
        });
    });
}

async function handleFormSubmit(e, user, db, getActiveYearCallback, refreshCallback) {
    const activeYear = getActiveYearCallback();
    
    // Zhromaženie dát z formulára
    const dateValue = document.getElementById('txDate').value;
    const amountValue = document.getElementById('txAmount').value;
    
    // Validácia dátumu
    const dateValidation = validateDate(dateValue, activeYear, false);
    if (!dateValidation.valid) {
        showToast(dateValidation.error, "warning");
        return;
    }
    
    // Validácia sumy
    const amountValidation = validateAmount(amountValue);
    if (!amountValidation.valid) {
        showToast(amountValidation.error, "warning");
        return;
    }
    
    const txData = {
        uid: user.uid,
        date: dateValue,
        number: document.getElementById('txNumber').value,
        type: document.getElementById('txType').value,
        account: document.getElementById('txAccount').value,
        category: document.getElementById('txCategory').value, 
        note: document.getElementById('txNote').value,
        amount: amountValidation.value,
        year: activeYear,
        archived: false
    };

    try {
        if (editingTransactionId) {
            // Režim úpravy existujúcej transakcie
            await updateDoc(doc(db, "transactions", editingTransactionId), txData);
            
            showToast("Transakcia bola úspešne aktualizovaná", "success");
            
            editingTransactionId = null;
            resetSubmitButton();
        } else {
            // Režim pridania novej transakcie
            txData.createdAt = new Date();
            await addDoc(collection(db, "transactions"), txData);
            
            showToast("Nová transakcia bola pridaná", "success");
            
            // Špeciálna logika pre automatické odvody
            if (txData.category === 'PD - mzda' && txData.type === 'Príjem') {
                const shouldGenerate = await confirmAction(
                    "Chcete vygenerovať automatické odvody a daň k tejto mzde?",
                    "Automatické odvody"
                );
                if (shouldGenerate) {
                    await generateAutoTaxes(txData, user, db);
                    showToast("Automatické odvody boli vygenerované", "success");
                }
            }
        }

        // Reset formulára a refresh dát v UI
        e.target.reset();
        
        // Malá pauza aby sa Firebase stihol zapísať
        setTimeout(() => {
            refreshCallback();
        }, 500);

    } catch (error) {
        console.error("Firestore error:", error);
        showToast("Chyba pri ukladaní: " + error.message, "danger");
    }
}

async function generateAutoTaxes(sourceTx, user, db) {
    const insurance = sourceTx.amount * 0.134;
    const dds = 15.00;
    const tax = (sourceTx.amount - insurance) * 0.19;
    
    console.log("📊 Automatické odvody pre mzdu:");
    console.log(`  Hrubá mzda: ${sourceTx.amount.toFixed(2)} €`);
    console.log(`  Poistenie (13.4%): ${insurance.toFixed(2)} €`);
    console.log(`  DDS: ${dds.toFixed(2)} €`);
    console.log(`  Daň (19% z ${(sourceTx.amount - insurance).toFixed(2)}): ${tax.toFixed(2)} €`);
    
    const base = { 
        uid: user.uid, 
        date: sourceTx.date, 
        type: 'Výdaj', 
        account: 'banka', 
        year: activeYear,      // PRIDANÉ
        archived: false,       // PRIDANÉ
        createdAt: new Date() 
    };
    
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - poistenie', note: 'Auto odvody', amount: parseFloat(insurance.toFixed(2)) });
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - DDS', note: 'Auto DDS', amount: dds });
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - preddavok na daň', note: 'Auto daň', amount: parseFloat(tax.toFixed(2)) });
    
    console.log("✅ Automatické odvody vytvorené a uložené do databázy");
}

// UPRAVENÉ: Pridaný parameter isReadOnly
export function renderTransactions(transactions, db, refreshCallback, isReadOnly = false) {
    const tbody = document.getElementById('transactionsList');
    tbody.innerHTML = '';

    // Vytvoríme mapu kategórií z HTML Selectu
    const categorySelect = document.getElementById('txCategory');
    const categoryMap = {};
    if (categorySelect) {
        Array.from(categorySelect.options).forEach(opt => {
            if (opt.value) categoryMap[opt.value] = opt.text;
        });
    }
    
    // NOVÉ: Ak je readonly režim, skryť formulár a zobraziť upozornenie
    const formCard = document.querySelector('#transactionsView .card');
    if (formCard) {
        formCard.style.display = isReadOnly ? 'none' : 'block';
    }
    
    // Pridať/skryť read-only banner
    let readonlyBanner = document.getElementById('transactionsReadonlyBanner');
    if (isReadOnly) {
        if (!readonlyBanner) {
            readonlyBanner = document.createElement('div');
            readonlyBanner.id = 'transactionsReadonlyBanner';
            readonlyBanner.className = 'readonly-notice';
            readonlyBanner.innerHTML = `
                <i class="fa-solid fa-lock"></i>
                <span>Tento rok je uzavretý - transakcie sú iba na čítanie</span>
            `;
            const transactionsView = document.getElementById('transactionsView');
            transactionsView.insertBefore(readonlyBanner, transactionsView.firstChild);
        }
        readonlyBanner.style.display = 'flex';
    } else if (readonlyBanner) {
        readonlyBanner.style.display = 'none';
    }

    if (transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-slate-400">Žiadne transakcie</td></tr>`;
        return;
    }

    transactions.forEach((tx) => {
        const formattedDate = tx.date ? tx.date.split('-').reverse().join('.') : '';
        const displayCategory = categoryMap[tx.category] || tx.category;

        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50 transition-colors border-b border-slate-100";
        
        // UPRAVENÉ: Podmienené zobrazenie tlačidiel edit/delete
        row.innerHTML = `
          <td class="px-4 py-3 font-mono text-xs">${formattedDate}</td> 
          <td class="px-4 py-3 text-xs">${tx.number ?? ''}</td>
          <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs font-bold ${tx.type === 'Príjem' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${tx.type}</span></td>
          <td class="px-4 py-3 text-xs">${tx.account}</td>
          <td class="px-4 py-3 font-medium text-slate-700">${displayCategory}</td> 
          <td class="px-4 py-3 text-slate-500 text-xs">${tx.note || ''}</td>
          <td class="px-4 py-3 text-right text-green-600 font-bold">${tx.type === 'Príjem' ? tx.amount.toFixed(2) + ' €' : ''}</td>
          <td class="px-4 py-3 text-right text-red-500 font-bold">${tx.type === 'Výdaj' ? tx.amount.toFixed(2) + ' €' : ''}</td>
          <td class="px-4 py-3 text-center">
            ${isReadOnly ? 
                '<span class="text-slate-400"><i class="fa-solid fa-lock"></i></span>' : 
                `<button class="edit-btn text-blue-500 hover:text-blue-700 mx-1"><i class="fa-solid fa-pen"></i></button>
                 <button class="delete-btn text-red-400 hover:text-red-600 mx-1"><i class="fa-solid fa-trash"></i></button>`
            }
          </td>
        `;
        
        // NOVÉ: Event listenery len ak nie je readonly
        if (!isReadOnly) {
            row.querySelector('.edit-btn').addEventListener('click', () => loadIntoForm(tx));
            row.querySelector('.delete-btn').addEventListener('click', async () => {
                const shouldDelete = await confirmAction(
                    `Naozaj chcete zmazať transakciu "${tx.note}" (${tx.amount.toFixed(2)} €)?`,
                    "Zmazať transakciu"
                );
                if (shouldDelete) {
                    await deleteDoc(doc(db, "transactions", tx.id));
                    showToast("Transakcia bola zmazaná", "info");
                    refreshCallback();
                }
            });
        }

        tbody.appendChild(row);
    });
}

function loadIntoForm(tx) {
    document.getElementById('txDate').value = tx.date;
    document.getElementById('txNumber').value = tx.number || '';
    document.getElementById('txType').value = tx.type;
    document.getElementById('txAccount').value = tx.account;
    document.getElementById('txCategory').value = tx.category; 
    document.getElementById('txNote').value = tx.note || '';
    document.getElementById('txAmount').value = tx.amount;

    editingTransactionId = tx.id;
    
    const submitBtn = document.querySelector('#transactionForm button[type="submit"]');
    const cancelBtn = document.getElementById('cancelEditBtn');
    
    submitBtn.textContent = "Uložiť zmeny";
    submitBtn.classList.replace('bg-blue-600', 'bg-orange-500');
    
    // Zobraziť cancel tlačidlo
    if (cancelBtn) {
        cancelBtn.style.display = 'block';
    }
    
    document.getElementById('transactionsView').scrollIntoView({ behavior: 'smooth' });
}

function resetSubmitButton() {
    const submitBtn = document.querySelector('#transactionForm button[type="submit"]');
    const cancelBtn = document.getElementById('cancelEditBtn');
    
    submitBtn.textContent = "Pridať transakciu";
    submitBtn.classList.replace('bg-orange-500', 'bg-blue-600');
    
    // Skryť cancel tlačidlo
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }
}
