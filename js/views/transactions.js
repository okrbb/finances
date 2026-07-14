// js/views/transactions.js

import { showToast } from '../notifications.js';
import { collection, addDoc, deleteDoc, updateDoc, doc, getDocs, query, where, writeBatch } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { validateDate, validateAmount, confirmAction, promptDDSAmount, formatCurrencySK } from '../utils.js';
import { logAuditEvent } from '../audit.js';

let editingTransactionId = null;
const selectedTransactionIds = new Set();
let lastRenderedTransactions = [];
let lastRenderDb = null;
let lastRenderRefreshCallback = null;
let lastRenderIsReadOnly = false;
const transactionFilterState = {
    type: 'all',
    account: 'all',
    period: 'all',
    search: ''
};
const transactionSortState = {
    key: 'date',
    direction: 'desc'
};
const RECENT_ROW_MS = 20000;
const TX_DRAFT_KEY = 'finances_tx_draft';
const TX_OFFLINE_QUEUE_KEY = 'finances_tx_offline_queue';
const BATCH_CHUNK_SIZE = 450;

async function runBatched(db, refs, operation) {
    for (let i = 0; i < refs.length; i += BATCH_CHUNK_SIZE) {
        const chunk = refs.slice(i, i + BATCH_CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach((item) => operation(batch, item));
        await batch.commit();
    }
}

// --- 1. Setup Events (Volané raz) ---
export function setupTransactionEvents(db, getUserCallback, getActiveYearCallback, refreshDataCallback) {
    const form = document.getElementById('transactionForm');
    const dateInput = document.getElementById('txDate');
    const amountInput = document.getElementById('txAmount');
    const categorySelect = document.getElementById('txCategory');
    const noteInput = document.getElementById('txNote');
    const tagsInput = document.getElementById('txTags');
    const internalNoteInput = document.getElementById('txInternalNote');
    const cancelBtn = document.getElementById('cancelEditBtn');
    const requiredInputs = ['txDate', 'txAmount', 'txCategory'];
    const draftFieldIds = ['txDate', 'txNumber', 'txType', 'txAccount', 'txCategory', 'txNote', 'txTags', 'txInternalNote', 'txAmount'];
    const batchCategorySelect = document.getElementById('batchCategorySelect');
    const batchAccountSelect = document.getElementById('batchAccountSelect');
    const batchToolbar = document.getElementById('transactionBatchToolbar');
    const batchCount = document.getElementById('transactionBatchCount');
    const detailModal = document.getElementById('transactionDetailModal');

    const SK_MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];

    if (batchCategorySelect && categorySelect) {
        batchCategorySelect.innerHTML = '<option value="">Kategória</option>' + categorySelect.innerHTML;
    }

    restoreTransactionDraft();
    syncTransactionFormActionsLayout(false);
    updateBatchToolbarVisibility(batchToolbar, batchCount, getActiveYearCallback, false);
    
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
                        persistTransactionDraft();
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
                    persistTransactionDraft();
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
            clearTransactionDraft();
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

    draftFieldIds.forEach((fieldId) => {
        const input = document.getElementById(fieldId);
        if (!input) return;
        input.addEventListener('input', () => {
            if (!editingTransactionId) {
                persistTransactionDraft();
            }
        });
    });

    if (amountInput) {
        amountInput.addEventListener('blur', () => {
            const result = validateAmount(amountInput.value);
            if (result.valid) {
                amountInput.value = Number(result.value).toFixed(2);
                persistTransactionDraft();
            }
        });
    }

    document.getElementById('btnBatchClear')?.addEventListener('click', () => {
        selectedTransactionIds.clear();
        syncBatchCheckboxes();
        updateBatchToolbarVisibility(batchToolbar, batchCount, getActiveYearCallback, false);
    });

    document.getElementById('btnResetTransactionFilters')?.addEventListener('click', () => {
        transactionFilterState.type = 'all';
        transactionFilterState.account = 'all';
        transactionFilterState.period = 'all';
        transactionFilterState.search = '';
        const search = document.getElementById('searchTransactionInput');
        if (search) search.value = '';
        syncQuickFilterUI();
        applyTransactionFilters();
    });

    document.getElementById('btnJumpToImport')?.addEventListener('click', () => {
        document.querySelector('[data-view="import"]')?.click();
    });

    document.getElementById('btnCloseTransactionDetail')?.addEventListener('click', () => {
        if (detailModal) detailModal.style.display = 'none';
    });

    document.querySelectorAll('.data-table th[data-sort]').forEach((header) => {
        header.tabIndex = 0;
        const activateSort = () => {
            const key = header.dataset.sort;
            if (!key) return;
            if (transactionSortState.key === key) {
                transactionSortState.direction = transactionSortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                transactionSortState.key = key;
                transactionSortState.direction = key === 'date' || key === 'amount' ? 'desc' : 'asc';
            }
            rerenderTransactions();
        };
        header.addEventListener('click', activateSort);
        header.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activateSort();
            }
        });
    });

    document.getElementById('btnBatchApplyCategory')?.addEventListener('click', async () => {
        const user = getUserCallback();
        const value = batchCategorySelect?.value;
        if (!user || !value || selectedTransactionIds.size === 0) return;

        const previousValues = [];
        const refsToUpdate = [];
        for (const id of selectedTransactionIds) {
            const original = lastRenderedTransactions.find((tx) => tx.id === id);
            if (original) previousValues.push({ id, category: original.category });
            refsToUpdate.push({ ref: doc(db, 'transactions', id), category: value });
        }
        await runBatched(db, refsToUpdate, (batch, item) => {
            batch.update(item.ref, { category: item.category });
        });
        await logAuditEvent(db, {
            uid: user.uid,
            actor: user.email,
            action: 'transaction-batch-category',
            entityType: 'transaction',
            year: getActiveYearCallback(),
            message: `Hromadná zmena kategórie na ${value} (${selectedTransactionIds.size} položiek)`
        });
        selectedTransactionIds.clear();
        showToast(`Kategória zmenená pre ${previousValues.length} položiek`, 'success', {
            action: {
                label: 'Späť',
                onClick: async () => {
                    const rollbackRefs = previousValues.map((item) => ({
                        ref: doc(db, 'transactions', item.id),
                        category: item.category
                    }));
                    await runBatched(db, rollbackRefs, (batch, item) => {
                        batch.update(item.ref, { category: item.category });
                    });
                    await refreshDataCallback();
                }
            }
        });
        await refreshDataCallback();
    });

    document.getElementById('btnBatchApplyAccount')?.addEventListener('click', async () => {
        const user = getUserCallback();
        const value = batchAccountSelect?.value;
        if (!user || !value || selectedTransactionIds.size === 0) return;

        const previousValues = [];
        const refsToUpdate = [];
        for (const id of selectedTransactionIds) {
            const original = lastRenderedTransactions.find((tx) => tx.id === id);
            if (original) previousValues.push({ id, account: original.account });
            refsToUpdate.push({ ref: doc(db, 'transactions', id), account: value });
        }
        await runBatched(db, refsToUpdate, (batch, item) => {
            batch.update(item.ref, { account: item.account });
        });
        await logAuditEvent(db, {
            uid: user.uid,
            actor: user.email,
            action: 'transaction-batch-account',
            entityType: 'transaction',
            year: getActiveYearCallback(),
            message: `Hromadná zmena účtu na ${value} (${selectedTransactionIds.size} položiek)`
        });
        selectedTransactionIds.clear();
        showToast(`Účet zmenený pre ${previousValues.length} položiek`, 'success', {
            action: {
                label: 'Späť',
                onClick: async () => {
                    const rollbackRefs = previousValues.map((item) => ({
                        ref: doc(db, 'transactions', item.id),
                        account: item.account
                    }));
                    await runBatched(db, rollbackRefs, (batch, item) => {
                        batch.update(item.ref, { account: item.account });
                    });
                    await refreshDataCallback();
                }
            }
        });
        await refreshDataCallback();
    });

    document.getElementById('btnBatchDelete')?.addEventListener('click', async () => {
        const user = getUserCallback();
        if (!user || selectedTransactionIds.size === 0) return;

        const shouldDelete = await confirmAction(
            `Naozaj chcete zmazať ${selectedTransactionIds.size} označených transakcií?`,
            'Hromadné zmazanie'
        );
        if (!shouldDelete) return;

        const deletedTransactions = Array.from(selectedTransactionIds)
            .map((id) => lastRenderedTransactions.find((tx) => tx.id === id))
            .filter(Boolean);

        const refsToDelete = Array.from(selectedTransactionIds).map((id) => doc(db, 'transactions', id));
        await runBatched(db, refsToDelete, (batch, ref) => {
            batch.delete(ref);
        });
        await logAuditEvent(db, {
            uid: user.uid,
            actor: user.email,
            action: 'transaction-batch-delete',
            entityType: 'transaction',
            year: getActiveYearCallback(),
            message: `Hromadne zmazané transakcie (${selectedTransactionIds.size} položiek)`
        });
        selectedTransactionIds.clear();
        showToast(`Zmazaných ${deletedTransactions.length} transakcií`, 'warning', {
            durationMs: 9000,
            action: {
                label: 'Späť',
                onClick: async () => {
                    for (const tx of deletedTransactions) {
                        await addDoc(collection(db, 'transactions'), buildTxForRestore(tx));
                    }
                    await refreshDataCallback();
                }
            }
        });
        await refreshDataCallback();
    });

    window.addEventListener('online', async () => {
        const user = getUserCallback();
        if (user) {
            await flushOfflineTransactionQueue(db, user, refreshDataCallback);
        }
    });

    const currentUser = getUserCallback();
    if (currentUser) {
        flushOfflineTransactionQueue(db, currentUser, refreshDataCallback);
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
        tags: parseTags(document.getElementById('txTags')?.value),
        internalNote: document.getElementById('txInternalNote')?.value || '',
        amount: amountValidation.value,
        source: navigator.onLine ? 'manual' : 'offline',
        year: activeYear,
        archived: false
    };

    const duplicateCandidate = await findPotentialDuplicate(db, user.uid, activeYear, txData, editingTransactionId);
    if (duplicateCandidate) {
        const continueSave = await confirmAction(
            `Našiel som podobnú transakciu ${formatCurrencySK(duplicateCandidate.amount)} z ${duplicateCandidate.date}. Chcete ju aj napriek tomu uložiť?`,
            'Možná duplicita'
        );
        if (!continueSave) {
            return;
        }
    }

    if (!navigator.onLine) {
        if (editingTransactionId) {
            showToast('Offline úprava existujúcej transakcie zatiaľ nie je podporovaná.', 'warning');
            return;
        }

        enqueueOfflineTransaction({ ...txData, createdAt: new Date().toISOString() });
        clearTransactionDraft();
        e.target.reset();
        showToast('Transakcia bola uložená do offline fronty.', 'info');
        return;
    }

    try {
        if (editingTransactionId) {
            const existingTx = lastRenderedTransactions.find((tx) => tx.id === editingTransactionId);
            if (existingTx?.source) {
                txData.source = existingTx.source;
            }
            // Režim úpravy existujúcej transakcie
            await updateDoc(doc(db, "transactions", editingTransactionId), txData);
            await logAuditEvent(db, {
                uid: user.uid,
                actor: user.email,
                action: 'transaction-update',
                entityType: 'transaction',
                entityId: editingTransactionId,
                year: activeYear,
                message: `Úprava transakcie ${txData.category} ${formatCurrencySK(txData.amount)}`
            });
            
            showToast("Transakcia bola úspešne aktualizovaná", "success");
            
            editingTransactionId = null;
            resetSubmitButton();
        } else {
            // Režim pridania novej transakcie
            txData.createdAt = new Date();
            const createdDoc = await addDoc(collection(db, "transactions"), txData);
            await logAuditEvent(db, {
                uid: user.uid,
                actor: user.email,
                action: 'transaction-create',
                entityType: 'transaction',
                entityId: createdDoc.id,
                year: activeYear,
                message: `Nová transakcia ${txData.category} ${formatCurrencySK(txData.amount)}`
            });
            
            showToast("Nová transakcia bola pridaná", "success");
            
            // Špeciálna logika pre automatické odvody pri mzde
            if (txData.category === 'PD - mzda' && txData.type === 'Príjem') {
                const shouldGenerate = await confirmAction(
                    'Chcete vygenerovať poistné položky a preddavok na daň k mzde?',
                    "Automatické odvody"
                );
                if (shouldGenerate) {
                    const ddsAmount = await promptDDSAmount();
                    await generateAutoTaxes(txData, user, db, activeYear, ddsAmount);
                    showToast("Automatické odvody boli vygenerované", "success");
                }
            }
        }

        // Reset formulára a refresh dát v UI
        e.target.reset();
        clearTransactionDraft();
        await refreshCallback();

    } catch (error) {
        console.error("Firestore error:", error);
        showToast("Chyba pri ukladaní: " + error.message, "danger");
    }
}

async function generateAutoTaxes(sourceTx, user, db, activeYear, ddsAmount = 0) {
    const floor2 = (value) => Math.floor((Number(value) || 0) * 100) / 100;
    const gross = Number(sourceTx.amount) || 0;
    const dds = Number(ddsAmount) || 0;
    const healthContrib = floor2(gross * 0.05);
    const nemocenske = floor2(gross * 0.014);
    const starobne = floor2(gross * 0.04);
    const fondZam = floor2(gross * 0.01);
    const invalidne = floor2(gross * 0.03);
    const totalInsurance = healthContrib + nemocenske + starobne + fondZam + invalidne;
    const tax = (gross - totalInsurance) * 0.19;
    
    console.log('📊 Automatické odvody pre mzdu:');
    console.log(`  Hrubá suma: ${gross.toFixed(2)} €`);
    console.log(`  Zdrav.p. (5.0%): ${healthContrib.toFixed(2)} €`);
    console.log(`  Nemoc.p. (1.4%): ${nemocenske.toFixed(2)} €`);
    console.log(`  Staro.p. (4.0%): ${starobne.toFixed(2)} €`);
    console.log(`  Fon.zam. (1.0%): ${fondZam.toFixed(2)} €`);
    console.log(`  Invali.p. (3.0%): ${invalidne.toFixed(2)} €`);
    console.log(`  DDS (príspevok): ${dds.toFixed(2)} €`);
    console.log(`  Daň (19% z ${(gross - totalInsurance).toFixed(2)}): ${tax.toFixed(2)} €`);
    
    const base = { 
        uid: user.uid, 
        date: sourceTx.date, 
        type: 'Výdaj', 
        account: 'banka', 
        source: 'auto',
        year: activeYear,
        archived: false,
        createdAt: new Date() 
    };
    
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - Zdrav.p.', note: 'Zdrav.p.', amount: parseFloat(healthContrib.toFixed(2)) });
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - Nemoc.p.', note: 'Nemoc.p.', amount: parseFloat(nemocenske.toFixed(2)) });
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - Staro.p.', note: 'Staro.p.', amount: parseFloat(starobne.toFixed(2)) });
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - Fon.zam.', note: 'Fon.zam.', amount: parseFloat(fondZam.toFixed(2)) });
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - Invali.p.', note: 'Invali.p.', amount: parseFloat(invalidne.toFixed(2)) });
    await addDoc(collection(db, "transactions"), { ...base, category: 'VD - preddavok na daň', note: 'Automatická daň (bez DDS)', amount: parseFloat(tax.toFixed(2)) });
    
    if (dds > 0) {
        await addDoc(collection(db, "transactions"), { ...base, category: 'VD - DDS', note: 'Automatický príspevok DDS', amount: parseFloat(dds.toFixed(2)) });
    }
    
    console.log("✅ Automatické odvody vytvorené a uložené do databázy");
}

// UPRAVENÉ: Pridaný parameter isReadOnly
export function renderTransactions(transactions, db, refreshCallback, isReadOnly = false) {
    lastRenderedTransactions = Array.isArray(transactions) ? [...transactions] : [];
    lastRenderDb = db;
    lastRenderRefreshCallback = refreshCallback;
    lastRenderIsReadOnly = isReadOnly;
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
        updateBatchToolbarVisibility(document.getElementById('transactionBatchToolbar'), document.getElementById('transactionBatchCount'), () => null, isReadOnly);
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const sortedTransactions = sortTransactions(lastRenderedTransactions);

    sortedTransactions.forEach((tx) => {
        const formattedDate = tx.date ? tx.date.split('-').reverse().join('.') : '';
        const displayCategory = categoryMap[tx.category] || tx.category;
        const categoryTone = getCategoryTone(tx.category, tx.type);
        const sourceBadge = getSourceBadge(tx);
        const reviewBadge = getReviewBadge(tx);
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
        row.dataset.id = tx.id || '';
        row.dataset.search = `${formattedDate} ${tx.number || ''} ${tx.type || ''} ${tx.account || ''} ${displayCategory || ''} ${tx.note || ''} ${(tx.tags || []).join(' ')} ${tx.internalNote || ''}`.toLowerCase();
        const tagsMarkup = Array.isArray(tx.tags) && tx.tags.length > 0
            ? `<div class="tx-tag-row">${tx.tags.map((tag) => `<span class="tx-tag-pill">${tag}</span>`).join('')}</div>`
            : '';
        const internalNoteMarkup = tx.internalNote
            ? `<div class="tx-internal-note">Interné: ${tx.internalNote}</div>`
            : '';
        const noteDetailButton = (String(tx.note || '').length > 42 || tx.internalNote)
            ? '<button class="tx-note-detail-btn" type="button">Detail</button>'
            : '';
        const accountCell = `<span class="tx-hierarchy-account">${tx.account}</span>`;
        const categoryCell = `<span class="tx-category-pill ${categoryTone}">${displayCategory}</span>`;
        const noteCell = `<div class="tx-note-stack"><div class="tx-primary-line"><span class="tx-note-content">${tx.note || ''}</span>${noteDetailButton}</div><div class="tx-note-meta">${sourceBadge}${reviewBadge}</div>${tagsMarkup}${internalNoteMarkup}</div>`;
        const actionsCell = isReadOnly
            ? '<span class="tx-action-lock"><i class="fa-solid fa-lock"></i></span>'
            : `<div class="tx-action-group">
                    <button class="edit-btn tx-action-btn tx-action-btn-edit" type="button" aria-label="Upraviť vo formulári" title="Upraviť vo formulári">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="delete-btn tx-action-btn tx-action-btn-delete" type="button" aria-label="Zmazať transakciu" title="Zmazať">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>`;
        
        // UPRAVENÉ: Podmienené zobrazenie tlačidiel edit/delete
        row.innerHTML = `
          <td class="px-4 py-3 text-center"><input type="checkbox" class="tx-batch-check" ${isReadOnly ? 'disabled' : ''} ${selectedTransactionIds.has(tx.id) ? 'checked' : ''}></td>
          <td class="px-4 py-3 tx-hierarchy-date">${formattedDate}</td> 
          <td class="px-4 py-3"><span class="tx-type-label ${tx.type === 'Príjem' ? 'tx-type-income' : 'tx-type-expense'}">${tx.type}</span></td>
          <td class="px-4 py-3 text-xs">${accountCell}</td>
          <td class="px-4 py-3 font-medium text-slate-700">${categoryCell}</td> 
                    <td class="px-4 py-3 text-slate-500 text-xs tx-note-cell" title="${tx.note || ''}">
                        <div class="tx-note-wrap">
                                ${noteCell}
                                <button class="tx-note-copy" type="button" aria-label="Kopírovať poznámku" title="Kopírovať poznámku">
                                        <i class="fa-regular fa-copy"></i>
                                </button>
                        </div>
                    </td>
          <td class="px-4 py-3 text-right row-income tx-amount-cell">${tx.type === 'Príjem' ? formatCurrencySK(tx.amount) : ''}</td>
          <td class="px-4 py-3 text-right row-expense tx-amount-cell">${tx.type === 'Výdaj' ? formatCurrencySK(tx.amount) : ''}</td>
                    <td class="px-4 py-3 text-center tx-actions-cell">
            ${actionsCell}
          </td>
        `;

            row.querySelector('.tx-batch-check')?.addEventListener('change', (event) => {
                if (event.target.checked) {
                    selectedTransactionIds.add(tx.id);
                } else {
                    selectedTransactionIds.delete(tx.id);
                }
                updateBatchToolbarVisibility(document.getElementById('transactionBatchToolbar'), document.getElementById('transactionBatchCount'), () => null, isReadOnly);
            });

                row.querySelector('.tx-note-detail-btn')?.addEventListener('click', () => {
                        openTransactionDetail(tx);
                });

                row.querySelector('.tx-note-copy')?.addEventListener('click', async () => {
                        const text = tx.note || '';
                        if (!text) {
                                showToast('Táto transakcia nemá poznámku', 'info');
                                return;
                        }
                        try {
                                await navigator.clipboard.writeText(text);
                                showToast('Poznámka bola skopírovaná', 'success');
                        } catch (error) {
                                showToast('Nepodarilo sa skopírovať poznámku', 'warning');
                        }
                });
        
        // NOVÉ: Event listenery len ak nie je readonly
        if (!isReadOnly) {
            row.querySelector('.edit-btn').addEventListener('click', () => loadIntoForm(tx));
            row.querySelector('.delete-btn').addEventListener('click', async () => {
                const shouldDelete = await confirmAction(
                    `Naozaj chcete zmazať transakciu "${tx.note}" (${formatCurrencySK(tx.amount)})?`,
                    "Zmazať transakciu"
                );
                if (shouldDelete) {
                    await logAuditEvent(db, {
                        uid: tx.uid,
                        actor: '',
                        action: 'transaction-delete',
                        entityType: 'transaction',
                        entityId: tx.id,
                        year: tx.year,
                        message: `Zmazaná transakcia ${tx.category} ${formatCurrencySK(tx.amount)}`
                    });
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

    updateBatchToolbarVisibility(document.getElementById('transactionBatchToolbar'), document.getElementById('transactionBatchCount'), () => null, isReadOnly);
    updateSortIndicators();
    applyTransactionFilters();
}

function loadIntoForm(tx) {
    document.getElementById('txDate').value = tx.date;
    document.getElementById('txNumber').value = tx.number || '';
    document.getElementById('txType').value = tx.type;
    document.getElementById('txAccount').value = tx.account;
    document.getElementById('txCategory').value = tx.category; 
    document.getElementById('txNote').value = tx.note || '';
    const tagsInput = document.getElementById('txTags');
    if (tagsInput) tagsInput.value = Array.isArray(tx.tags) ? tx.tags.join(', ') : '';
    const internalNoteInput = document.getElementById('txInternalNote');
    if (internalNoteInput) internalNoteInput.value = tx.internalNote || '';
    document.getElementById('txAmount').value = tx.amount;

    editingTransactionId = tx.id;
    
    const submitBtn = document.querySelector('#transactionForm button[type="submit"]');
    
    submitBtn.textContent = "Uložiť zmeny";
    submitBtn.classList.replace('bg-blue-600', 'bg-orange-500');
    syncTransactionFormActionsLayout(true);
    
    document.getElementById('transactionsView').scrollIntoView({ behavior: 'smooth' });
}

function resetSubmitButton() {
    const submitBtn = document.querySelector('#transactionForm button[type="submit"]');
    
    submitBtn.textContent = "Uložiť";
    submitBtn.classList.replace('bg-orange-500', 'bg-blue-600');
    syncTransactionFormActionsLayout(false);
}

function syncTransactionFormActionsLayout(isEditing) {
    const form = document.getElementById('transactionForm');
    if (!form) return;

    form.classList.toggle('is-editing', isEditing);
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
        tags: Array.isArray(tx.tags) ? tx.tags : [],
        internalNote: tx.internalNote || '',
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
    const emptyMessage = document.getElementById('transactionsEmptyMessage');
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
    if (emptyMessage) {
        if (visibleCount > 0) {
            emptyMessage.textContent = 'Skús zmeniť filtre alebo pridaj novú transakciu.';
        } else if (transactionFilterState.search) {
            emptyMessage.textContent = `Pre výraz "${transactionFilterState.search}" sa nič nenašlo.`;
        } else if (transactionFilterState.type !== 'all') {
            emptyMessage.textContent = 'Pre vybraný typ momentálne nič nie je. Skús Všetko.';
        } else {
            emptyMessage.textContent = 'Tento výber je prázdny. Skús import XML alebo pridaj prvú transakciu.';
        }
    }
}

function isRecentlyCreated(tx) {
    const dateValue = toDateValue(tx.createdAt);
    if (!dateValue) return false;
    return Date.now() - dateValue.getTime() <= RECENT_ROW_MS;
}

function parseTags(value) {
    return String(value || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
}

async function findPotentialDuplicate(db, uid, year, txData, excludeId = null) {
    const snapshot = await getDocs(query(
        collection(db, 'transactions'),
        where('uid', '==', uid),
        where('year', '==', year)
    ));

    const normalizedNote = String(txData.note || '').trim().toLowerCase();
    const amount = Number(txData.amount) || 0;

    const match = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .find((tx) => {
            if (excludeId && tx.id === excludeId) return false;
            if (tx.date !== txData.date) return false;
            if ((tx.type || '') !== txData.type) return false;
            const txAmount = Number(tx.amount) || 0;
            if (Math.abs(txAmount - amount) > 0.001) return false;
            return String(tx.note || '').trim().toLowerCase() === normalizedNote;
        });

    return match || null;
}

function persistTransactionDraft() {
    const draft = {
        txDate: document.getElementById('txDate')?.value || '',
        txNumber: document.getElementById('txNumber')?.value || '',
        txType: document.getElementById('txType')?.value || 'Príjem',
        txAccount: document.getElementById('txAccount')?.value || 'banka',
        txCategory: document.getElementById('txCategory')?.value || '',
        txNote: document.getElementById('txNote')?.value || '',
        txTags: document.getElementById('txTags')?.value || '',
        txInternalNote: document.getElementById('txInternalNote')?.value || '',
        txAmount: document.getElementById('txAmount')?.value || ''
    };
    localStorage.setItem(TX_DRAFT_KEY, JSON.stringify(draft));
}

function restoreTransactionDraft() {
    if (editingTransactionId) return;
    try {
        const draft = JSON.parse(localStorage.getItem(TX_DRAFT_KEY) || 'null');
        if (!draft) return;
        Object.entries(draft).forEach(([fieldId, value]) => {
            const input = document.getElementById(fieldId);
            if (input && !input.value) {
                input.value = value;
            }
        });
    } catch (error) {
        console.warn('Nepodarilo sa obnoviť draft transakcie', error);
    }
}

function clearTransactionDraft() {
    localStorage.removeItem(TX_DRAFT_KEY);
}

function enqueueOfflineTransaction(txData) {
    const queue = JSON.parse(localStorage.getItem(TX_OFFLINE_QUEUE_KEY) || '[]');
    queue.push(txData);
    localStorage.setItem(TX_OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

async function flushOfflineTransactionQueue(db, user, refreshCallback) {
    if (!navigator.onLine) return;

    const queue = JSON.parse(localStorage.getItem(TX_OFFLINE_QUEUE_KEY) || '[]');
    if (!Array.isArray(queue) || queue.length === 0) return;

    let flushed = 0;
    const remaining = [];

    for (const item of queue) {
        if (item.uid !== user.uid) {
            remaining.push(item);
            continue;
        }

        try {
            await addDoc(collection(db, 'transactions'), {
                ...item,
                createdAt: new Date(item.createdAt || new Date().toISOString())
            });
            await logAuditEvent(db, {
                uid: user.uid,
                actor: user.email,
                action: 'transaction-offline-sync',
                entityType: 'transaction',
                year: item.year,
                message: `Synchronizovaná offline transakcia ${item.category} ${formatCurrencySK(item.amount)}`
            });
            flushed += 1;
        } catch (error) {
            remaining.push(item);
        }
    }

    localStorage.setItem(TX_OFFLINE_QUEUE_KEY, JSON.stringify(remaining));

    if (flushed > 0) {
        showToast(`Synchronizovaných ${flushed} offline transakcií.`, 'success');
        await refreshCallback();
    }
}

function syncBatchCheckboxes() {
    document.querySelectorAll('#transactionsList tr').forEach((row) => {
        const checkbox = row.querySelector('.tx-batch-check');
        const id = row.dataset.id;
        if (checkbox && id) {
            checkbox.checked = selectedTransactionIds.has(id);
        }
    });
}

function updateBatchToolbarVisibility(toolbar, counter, getActiveYearCallback, isReadOnly) {
    if (!toolbar || !counter) return;
    const count = selectedTransactionIds.size;
    toolbar.style.display = !isReadOnly && count > 0 ? 'grid' : 'none';
    counter.textContent = `${count} označených`;
}

function updateSortIndicators() {
    document.querySelectorAll('.data-table th[data-sort]').forEach((header) => {
        const isActive = header.dataset.sort === transactionSortState.key;
        header.classList.toggle('sort-active', isActive);
        header.setAttribute('data-sort-indicator', isActive ? (transactionSortState.direction === 'asc' ? '▲' : '▼') : '');
    });
}

function sortTransactions(items) {
    const list = [...items];
    list.sort((left, right) => compareTransactions(left, right, transactionSortState.key, transactionSortState.direction));
    return list;
}

function compareTransactions(left, right, key, direction) {
    const multiplier = direction === 'asc' ? 1 : -1;
    let a = '';
    let b = '';
    if (key === 'amount') {
        a = Number(left.amount) || 0;
        b = Number(right.amount) || 0;
        return (a - b) * multiplier;
    }
    a = String(left[key] || '').toLowerCase();
    b = String(right[key] || '').toLowerCase();
    return a.localeCompare(b, 'sk') * multiplier;
}

function getCategoryTone(category, type) {
    const normalized = String(category || '').toLowerCase();
    if (type === 'Príjem') return 'category-income';
    if (normalized.includes('bytové') || normalized.includes('msú')) return 'category-housing';
    if (normalized.includes('zse')) return 'category-energy';
    if (normalized.includes('internet') || normalized.includes('4ka') || normalized.includes('telekom')) return 'category-connectivity';
    if (normalized.includes('poistenie') || normalized.includes('preddavok') || normalized.includes('dds')) return 'category-tax';
    return 'category-other';
}

function getSourceBadge(tx) {
    const source = tx.source || (tx.importBatchId ? 'import' : 'manual');
    const labels = {
        import: 'Import',
        manual: 'Ručne',
        auto: 'Auto',
        offline: 'Offline'
    };
    return `<span class="tx-source-badge source-${source}">${labels[source] || 'Ručne'}</span>`;
}

function getReviewBadge(tx) {
    if ((tx.importConfidence || '') === 'low') {
        return '<span class="tx-review-badge review-danger">Skontrolovať</span>';
    }
    if (!String(tx.note || '').trim()) {
        return '<span class="tx-review-badge review-warning">Bez poznámky</span>';
    }
    return '<span class="tx-review-badge review-ok">OK</span>';
}

function openTransactionDetail(tx) {
    const modal = document.getElementById('transactionDetailModal');
    const body = document.getElementById('transactionDetailBody');
    if (!modal || !body) return;
    body.innerHTML = `
        <div><strong>Kategória:</strong> ${tx.category || '-'}</div>
        <div><strong>Účet:</strong> ${tx.account || '-'}</div>
        <div><strong>Poznámka:</strong></div>
        <pre>${escapeHtml(tx.note || 'Bez poznámky')}</pre>
        ${tx.internalNote ? `<div><strong>Interná poznámka:</strong></div><pre>${escapeHtml(tx.internalNote)}</pre>` : ''}
    `;
    modal.style.display = 'flex';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function rerenderTransactions() {
    if (!lastRenderDb || !lastRenderRefreshCallback) return;
    renderTransactions(lastRenderedTransactions, lastRenderDb, lastRenderRefreshCallback, lastRenderIsReadOnly);
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
