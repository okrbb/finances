// js/views/transactions.js

import { showToast } from '../notifications.js';
import { collection, addDoc, deleteDoc, updateDoc, doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { validateDate, validateAmount, confirmAction, formatCurrencySK } from '../utils.js';

let editingTransactionId = null;
const transactionFilterState = {
    type: 'all',
    account: 'all',
    period: 'all',
    search: ''
};
const RECENT_ROW_MS = 20000;

// --- 1. Setup Events (Volané raz) ---
export function setupTransactionEvents(db, getUserCallback, getActiveYearCallback, refreshDataCallback) {
    const form = document.getElementById('transactionForm');
    const dateInput = document.getElementById('txDate');
    const amountInput = document.getElementById('txAmount');
    const categorySelect = document.getElementById('txCategory');
    const noteInput = document.getElementById('txNote');
    const cancelBtn = document.getElementById('cancelEditBtn');
    const requiredInputs = ['txDate', 'txAmount', 'txCategory'];

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

        form.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && editingTransactionId && cancelBtn) {
                event.preventDefault();
                cancelBtn.click();
            }

            if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
                event.preventDefault();
                form.requestSubmit();
            }
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
        transactionFilterState.search = String(e.target.value || '').trim().toLowerCase();
        applyTransactionFilters();
    });

    document.querySelectorAll('#transactionsQuickFilters .quick-filter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const group = chip.dataset.filterGroup;
            const value = chip.dataset.filterValue;
            if (!group || !value) return;

            const current = transactionFilterState[group] || 'all';
            transactionFilterState[group] = current === value ? 'all' : value;
            syncQuickFilterUI();
            applyTransactionFilters();
        });
    });

    requiredInputs.forEach((fieldId) => {
        const input = document.getElementById(fieldId);
        if (!input) return;

        input.addEventListener('input', () => {
            validateField(input, getActiveYearCallback());
        });

        input.addEventListener('blur', () => {
            validateField(input, getActiveYearCallback());
        });
    });

    if (amountInput) {
        amountInput.addEventListener('blur', () => {
            const result = validateAmount(amountInput.value);
            if (result.valid) {
                amountInput.value = Number(result.value).toFixed(2);
            }
        });
    }
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
            
            // Špeciálna logika pre automatické odvody (na mzdu a príspevok na dopravu)
            if ((txData.category === 'PD - mzda' || txData.category === 'PD - príspevok na dopravu') && txData.type === 'Príjem') {
                const incomeType = txData.category === 'PD - mzda' ? 'mzde' : 'príspevku na dopravu';
                const shouldGenerate = await confirmAction(
                    `Chcete vygenerovať automatické odvody a daň k ${incomeType}?`,
                    "Automatické odvody"
                );
                if (shouldGenerate) {
                    await generateAutoTaxes(txData, user, db, activeYear);
                    showToast("Automatické odvody boli vygenerované", "success");
                }
            }
        }

        // Reset formulára a refresh dát v UI
        e.target.reset();
        await refreshCallback();

    } catch (error) {
        console.error("Firestore error:", error);
        showToast("Chyba pri ukladaní: " + error.message, "danger");
    }
}

async function generateAutoTaxes(sourceTx, user, db, activeYear) {
    const insurance = sourceTx.amount * 0.134;
    const isWage = sourceTx.category === 'PD - mzda';
    
    // DDS len pre mzdu
    const dds = isWage ? 15.00 : 0;
    
    // Daň sa počíta bez DDS (z hrubej sumy mínus poistenie)
    const tax = (sourceTx.amount - insurance) * 0.19;
    
    console.log(`📊 Automatické odvody pre ${isWage ? 'mzdu' : 'príspevok na dopravu'}:`);
    console.log(`  Hrubá suma: ${sourceTx.amount.toFixed(2)} €`);
    console.log(`  Poistenie (13.4%): ${insurance.toFixed(2)} €`);
    if (isWage) console.log(`  DDS: ${dds.toFixed(2)} €`);
    console.log(`  Daň (19% z ${(sourceTx.amount - insurance).toFixed(2)}): ${tax.toFixed(2)} €`);
    
    const base = { 
        uid: user.uid, 
        date: sourceTx.date, 
        type: 'Výdaj', 
        account: 'banka', 
        year: activeYear,
        archived: false,
        createdAt: new Date() 
    };
    
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - poistenie', note: 'Automatické odvody (13,4%)', amount: parseFloat(insurance.toFixed(2)) });
    if (isWage) {
        await addDoc(collection(db, "transactions"), { ...base, category: 'VD - DDS', note: 'Automatický príspevok DDS', amount: dds });
    }
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - preddavok na daň', note: 'Automatická daň', amount: parseFloat(tax.toFixed(2)) });
    
    console.log("✅ Automatické odvody vytvorené a uložené do databázy");
}

// UPRAVENÉ: Pridaný parameter isReadOnly
export function renderTransactions(transactions, db, refreshCallback, isReadOnly = false) {
    const tbody = document.getElementById('transactionsList');
    const emptyState = document.getElementById('transactionsEmptyState');
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
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    transactions.forEach((tx) => {
        const formattedDate = tx.date ? tx.date.split('-').reverse().join('.') : '';
        const displayCategory = categoryMap[tx.category] || tx.category;

        // Určenie farby sumy podľa typu a kategórie
        let amountColor = 'text-red-500'; // Výdaje - červená
        if (tx.type === 'Príjem') {
            if (tx.category === 'PD - príspevok na dopravu') {
                amountColor = 'text-warning'; // Príspevok na dopravu - oranžová
            } else {
                amountColor = 'text-green-600'; // Bežné príjmy - zelená
            }
        }

        const row = document.createElement('tr');
        row.className = `hover:bg-slate-50 transition-colors border-b border-slate-100 ${isRecentlyCreated(tx) ? 'row-new' : ''}`;
        row.dataset.type = tx.type || '';
        row.dataset.account = tx.account || '';
        row.dataset.date = tx.date || '';
        row.dataset.search = `${formattedDate} ${tx.number || ''} ${tx.type || ''} ${tx.account || ''} ${displayCategory || ''} ${tx.note || ''}`.toLowerCase();
        
        // UPRAVENÉ: Podmienené zobrazenie tlačidiel edit/delete
        row.innerHTML = `
          <td class="px-4 py-3 font-mono text-xs">${formattedDate}</td> 
          <td class="px-4 py-3 text-xs">${tx.number ?? ''}</td>
          <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs font-bold ${tx.type === 'Príjem' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${tx.type}</span></td>
          <td class="px-4 py-3 text-xs">${tx.account}</td>
          <td class="px-4 py-3 font-medium text-slate-700">${displayCategory}</td> 
          <td class="px-4 py-3 text-slate-500 text-xs">${tx.note || ''}</td>
          <td class="px-4 py-3 text-right row-income">${tx.type === 'Príjem' ? formatCurrencySK(tx.amount) : ''}</td>
          <td class="px-4 py-3 text-right row-expense">${tx.type === 'Výdaj' ? formatCurrencySK(tx.amount) : ''}</td>
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
                    `Naozaj chcete zmazať transakciu "${tx.note}" (${formatCurrencySK(tx.amount)})?`,
                    "Zmazať transakciu"
                );
                if (shouldDelete) {
                    await deleteDoc(doc(db, "transactions", tx.id));
                    showToast("Transakcia bola zmazaná", "info", {
                        durationMs: 8000,
                        action: {
                            label: 'Obnoviť',
                            onClick: async () => {
                                await addDoc(collection(db, 'transactions'), buildTxForRestore(tx));
                                await refreshCallback();
                                showToast('Transakcia bola obnovená', 'success');
                            }
                        }
                    });
                    await refreshCallback();
                }
            });
        }

        tbody.appendChild(row);
    });

    applyTransactionFilters();
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
    
    submitBtn.textContent = "Uložiť";
    submitBtn.classList.replace('bg-orange-500', 'bg-blue-600');
    
    // Skryť cancel tlačidlo
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }
}

function buildTxForRestore(tx) {
    return {
        uid: tx.uid,
        date: tx.date,
        number: tx.number || '',
        type: tx.type,
        account: tx.account || 'banka',
        category: tx.category,
        note: tx.note || '',
        amount: Number(tx.amount) || 0,
        year: tx.year || Number.parseInt(String(tx.date || '').slice(0, 4), 10),
        archived: Boolean(tx.archived),
        createdAt: new Date()
    };
}

function validateField(input, activeYear) {
    if (!input) return;
    const id = input.id;
    let result = { valid: true };

    if (id === 'txDate') result = validateDate(input.value, activeYear, false);
    if (id === 'txAmount') result = validateAmount(input.value);
    if (id === 'txCategory') result = { valid: Boolean(input.value) };

    input.classList.toggle('is-invalid', !result.valid);
}

function syncQuickFilterUI() {
    document.querySelectorAll('#transactionsQuickFilters .quick-filter-chip').forEach((chip) => {
        const group = chip.dataset.filterGroup;
        const value = chip.dataset.filterValue;
        if (!group || !value) return;
        chip.classList.toggle('active', (transactionFilterState[group] || 'all') === value);
    });
}

function applyTransactionFilters() {
    const rows = Array.from(document.querySelectorAll('#transactionsList tr'));
    const emptyState = document.getElementById('transactionsEmptyState');
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let visibleCount = 0;

    rows.forEach((row) => {
        const text = row.dataset.search || '';
        const type = row.dataset.type || '';
        const account = row.dataset.account || '';
        const date = row.dataset.date || '';

        const matchSearch = !transactionFilterState.search || text.includes(transactionFilterState.search);
        const matchType = transactionFilterState.type === 'all' || type === transactionFilterState.type;
        const matchAccount = transactionFilterState.account === 'all' || account === transactionFilterState.account;
        const matchMonth = transactionFilterState.period === 'all' || date.startsWith(thisMonth);

        const visible = matchSearch && matchType && matchAccount && matchMonth;
        row.style.display = visible ? '' : 'none';
        if (visible) visibleCount += 1;
    });

    if (emptyState) emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
}

function isRecentlyCreated(tx) {
    const dateValue = toDateValue(tx.createdAt);
    if (!dateValue) return false;
    return Date.now() - dateValue.getTime() <= RECENT_ROW_MS;
}

function toDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}
