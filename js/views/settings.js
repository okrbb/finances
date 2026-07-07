// js/views/settings.js

import { showToast } from '../notifications.js';
import { 
    addDoc,
    collection, 
    query, 
    where, 
    getDocs, 
    doc, 
    getDoc, 
    setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { validateDIC, validateIBAN, validateAmount, confirmAction } from '../utils.js';

export function initSettings(db, getUserCallback) {
    const settingsForm = document.getElementById('settingsForm');
    const dicInput = document.getElementById('settingsDIC');
    const ibanInput = document.getElementById('settingsIBAN');
    const taxRateInput = document.getElementById('configTaxRate');
    const rentExInput = document.getElementById('configRentExemption');

    dicInput?.addEventListener('blur', () => {
        const result = validateDIC(dicInput.value);
        dicInput.classList.toggle('is-invalid', !result.valid);
    });

    ibanInput?.addEventListener('blur', () => {
        const result = validateIBAN(ibanInput.value);
        ibanInput.classList.toggle('is-invalid', !result.valid);
    });

    taxRateInput?.addEventListener('blur', () => {
        const rate = Number.parseFloat(taxRateInput.value);
        taxRateInput.classList.toggle('is-invalid', Number.isNaN(rate) || rate < 0 || rate > 1);
    });

    rentExInput?.addEventListener('blur', () => {
        const result = validateAmount(rentExInput.value);
        rentExInput.classList.toggle('is-invalid', !result.valid);
    });

    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const user = getUserCallback();
            if (!user) {
                showToast("Chyba: Nie ste prihlásený.", "danger");
                return;
            }

            const dicValue = document.getElementById('settingsDIC').value;
            const ibanValue = document.getElementById('settingsIBAN').value;
            const rentExValue = document.getElementById('configRentExemption').value;
            const taxRateValue = document.getElementById('configTaxRate').value;
            
            // Validácia DIČ
            const dicValidation = validateDIC(dicValue);
            if (!dicValidation.valid) {
                showToast(dicValidation.error, "warning");
                return;
            }
            
            // Validácia IBAN
            const ibanValidation = validateIBAN(ibanValue);
            if (!ibanValidation.valid) {
                showToast(ibanValidation.error, "warning");
                return;
            }
            
            // Validácia oslobodenia prenájmu
            const rentExValidation = validateAmount(rentExValue);
            if (!rentExValidation.valid) {
                showToast("Oslobodenie prenájmu: " + rentExValidation.error, "warning");
                return;
            }
            
            // Validácia daňovej sadzby
            const taxRate = parseFloat(taxRateValue);
            if (isNaN(taxRate) || taxRate < 0 || taxRate > 1) {
                showToast("Daňová sadzba musí byť medzi 0 a 1 (napr. 0.19 pre 19%)", "warning");
                return;
            }

            const userData = {
                name: document.getElementById('settingsName').value,
                dic: dicValidation.value || dicValue,
                address: document.getElementById('settingsAddress').value,
                iban: ibanValidation.value || ibanValue,
                year: document.getElementById('settingsYear').value,
                rentExemption: rentExValidation.value,
                taxRate: taxRate
            };
            
            try {
                await setDoc(doc(db, "users", user.uid), userData);
                showToast("Nastavenia úspešne uložené", "success");
                loadUserProfile(user, db); 
            } catch (err) {
                console.error("Chyba ukladania nastavení:", err);
                showToast("Chyba pri ukladaní: " + err.message, "danger");
            }
        });
    }
}

export async function loadUserProfile(user, db) {
    if (!user) return;

    try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            const userNameEl = document.getElementById('userName');
            const userDicEl = document.getElementById('userDIC');
            const userDicMirrorEl = document.getElementById('userDICMirror');
            if (userNameEl) userNameEl.textContent = data.name || user.email;
            if (userDicEl) userDicEl.textContent = data.dic ? `DIČ: ${data.dic}` : 'DIČ: -';
            if (userDicMirrorEl) userDicMirrorEl.textContent = data.dic ? `DIČ: ${data.dic}` : 'DIČ: -';
            
            const userAddrEl = document.getElementById('userAddress');
            const userAccEl = document.getElementById('userAccount');
            if (userAddrEl) userAddrEl.textContent = data.address || '-';
            if (userAccEl) userAccEl.textContent = data.iban || '-';
            
            const setName = document.getElementById('settingsName');
            const setDic = document.getElementById('settingsDIC');
            const setAddr = document.getElementById('settingsAddress');
            const setIban = document.getElementById('settingsIBAN');
            const setYear = document.getElementById('settingsYear');

            if (setName) setName.value = data.name || '';
            if (setDic) setDic.value = data.dic || '';
            if (setAddr) setAddr.value = data.address || '';
            if (setIban) setIban.value = data.iban || '';
            if (setYear) setYear.value = data.year || '2025';

            const setRentEx = document.getElementById('configRentExemption');
            const setTaxRate = document.getElementById('configTaxRate');
            if (setRentEx) setRentEx.value = data.rentExemption || 500;
            if (setTaxRate) setTaxRate.value = data.taxRate || 0.19;
        }
    } catch (e) {
        console.error("Chyba pri načítaní profilu:", e);
    }
}

export function setupBackup(db, getUserCallback, onRestoreComplete) {
    const exportBtn = document.getElementById('btnExportBackup');
    const importBtn = document.getElementById('btnImportBackup');
    const importInput = document.getElementById('backupImportInput');

    if (!exportBtn) return;

    exportBtn.addEventListener('click', async () => {
        const user = getUserCallback();
        if (!user) return;

        try {
            showToast("Pripravujem zálohu...", "warning");
            
            // 1. Načítanie všetkých transakcií
            const txSnap = await getDocs(query(collection(db, "transactions"), where("uid", "==", user.uid)));
            const transactions = txSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 2. Načítanie všetkých rozpočtov
            const budgetSnap = await getDocs(query(collection(db, "budgets"), where("uid", "==", user.uid)));
            const budgets = budgetSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 3. Vytvorenie finálneho objektu
            const backupData = {
                exportedAt: new Date().toISOString(),
                userEmail: user.email,
                transactions,
                budgets
            };

            // 4. Stiahnutie súboru
            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Zaloha_DE_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast("Záloha úspešne stiahnutá", "success");
        } catch (err) {
            showToast("Chyba zálohovania: " + err.message, "danger");
        }
    });

    if (!importBtn || !importInput) return;

    importBtn.addEventListener('click', () => {
        importInput.click();
    });

    importInput.addEventListener('change', async (event) => {
        const user = getUserCallback();
        if (!user) {
            importInput.value = '';
            return;
        }

        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setBackupWizardStep(1);
            showBackupWizard(true);
            showToast('Načítavam zálohu...', 'warning');
            const text = await file.text();
            const parsed = JSON.parse(text);

            setBackupWizardStep(2);
            const validation = validateBackupPayload(parsed);

            if (!validation.valid) {
                showToast(validation.error, 'danger');
                showBackupWizard(false);
                return;
            }

            setBackupWizardStep(3);
            const shouldRestore = await confirmAction(
                `Obnova pridá len chýbajúce dáta a duplicity preskočí. Pokračovať? (Transakcie: ${parsed.transactions.length}, Rozpočty: ${parsed.budgets.length})`,
                'Obnova zo zálohy'
            );

            if (!shouldRestore) {
                showToast('Obnova zo zálohy zrušená', 'info');
                showBackupWizard(false);
                return;
            }

            setBackupWizardStep(4);
            await restoreBackupData(db, user.uid, parsed, ({ processed, total }) => {
                if (processed > 0 && processed % 30 === 0) {
                    showToast(`Obnova: spracované ${processed}/${total}`, 'info', { durationMs: 1200 });
                }
            });
            showToast('Obnova (merge) zo zálohy bola úspešne dokončená', 'success');
            if (typeof onRestoreComplete === 'function') {
                await onRestoreComplete();
            }
        } catch (err) {
            console.error('Chyba obnovy zálohy:', err);
            showToast('Chyba obnovy: ' + err.message, 'danger');
        } finally {
            showBackupWizard(false);
            importInput.value = '';
        }
    });
}

function validateBackupPayload(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Súbor zálohy nemá platný formát JSON objektu' };
    }

    if (!Array.isArray(data.transactions) || !Array.isArray(data.budgets)) {
        return { valid: false, error: 'Záloha musí obsahovať polia transactions a budgets' };
    }

    const invalidTx = data.transactions.find((tx) => {
        if (!tx || typeof tx !== 'object') return true;
        if (!tx.date || typeof tx.date !== 'string') return true;
        if (!tx.type || (tx.type !== 'Príjem' && tx.type !== 'Výdaj')) return true;
        if (tx.amount === undefined || tx.amount === null || Number.isNaN(Number(tx.amount))) return true;
        return false;
    });
    if (invalidTx) {
        return { valid: false, error: 'Záloha obsahuje neplatnú transakciu (chýba dátum/typ/suma)' };
    }

    const invalidBudget = data.budgets.find((budget) => !budget || typeof budget !== 'object');
    if (invalidBudget) {
        return { valid: false, error: 'Záloha obsahuje neplatný záznam rozpočtu' };
    }

    return { valid: true };
}

async function restoreBackupData(db, uid, backupData, onProgress) {
    // Merge režim: nič nemažeme, len dopĺňame chýbajúce záznamy.
    const txSnapshot = await getDocs(query(collection(db, 'transactions'), where('uid', '==', uid)));
    const budgetSnapshot = await getDocs(query(collection(db, 'budgets'), where('uid', '==', uid)));

    const existingTxSignatures = new Set();
    txSnapshot.forEach((docSnap) => {
        existingTxSignatures.add(buildTxSignature(uid, docSnap.data() || {}));
    });

    const existingBudgetIds = new Set(budgetSnapshot.docs.map((d) => d.id));

    let addedTransactions = 0;
    let skippedTransactions = 0;
    let addedBudgets = 0;
    let skippedBudgets = 0;
    let processed = 0;
    const total = backupData.transactions.length + backupData.budgets.length;

    // 1) Obnoviť transakcie (len chýbajúce)
    for (const tx of backupData.transactions) {
        const { id, ...rest } = tx;

        const signature = buildTxSignature(uid, rest);
        if (existingTxSignatures.has(signature)) {
            skippedTransactions++;
            processed++;
            onProgress?.({ processed, total });
            continue;
        }

        await addDoc(collection(db, 'transactions'), {
            ...rest,
            uid,
            amount: Number(rest.amount) || 0,
            archived: Boolean(rest.archived)
        });
        existingTxSignatures.add(signature);
        addedTransactions++;
        processed++;
        onProgress?.({ processed, total });
    }

    // 2) Obnoviť rozpočty (len chýbajúce dokumenty)
    for (const budget of backupData.budgets) {
        const { id, ...rest } = budget;

        if (id && existingBudgetIds.has(id)) {
            skippedBudgets++;
            processed++;
            onProgress?.({ processed, total });
            continue;
        }

        if (id) {
            await setDoc(doc(db, 'budgets', id), {
                ...rest,
                uid
            }, { merge: true });
            existingBudgetIds.add(id);
            addedBudgets++;
            processed++;
            onProgress?.({ processed, total });
            continue;
        }

        await addDoc(collection(db, 'budgets'), {
            ...rest,
            uid
        });
        addedBudgets++;
        processed++;
        onProgress?.({ processed, total });
    }

    showToast(
        `Merge hotový: +${addedTransactions} transakcií, +${addedBudgets} rozpočtov, preskočené duplicity: ${skippedTransactions + skippedBudgets}`,
        'info'
    );
}

function buildTxSignature(uid, tx) {
    const amount = Number.parseFloat(tx.amount || 0).toFixed(2);
    return [
        uid || '',
        tx.date || '',
        tx.type || '',
        tx.category || '',
        tx.account || '',
        amount,
        tx.note || ''
    ].join('|');
}

function showBackupWizard(visible) {
    const wizard = document.getElementById('backupWizardSteps');
    if (wizard) {
        wizard.style.display = visible ? 'flex' : 'none';
    }
}

function setBackupWizardStep(step) {
    const steps = document.querySelectorAll('#backupWizardSteps .wizard-step');
    if (!steps.length) return;

    steps.forEach((el, index) => {
        const position = index + 1;
        el.classList.toggle('active', position === step);
        el.classList.toggle('done', position < step);
    });
}