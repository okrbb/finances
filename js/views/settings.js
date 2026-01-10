// js/views/settings.js

import { showToast } from '../notifications.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    doc, 
    getDoc, 
    setDoc 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function initSettings(db, getUserCallback) {
    const settingsForm = document.getElementById('settingsForm');

    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const user = getUserCallback();
            if (!user) {
                alert("Chyba: Nie ste prihlásený.");
                return;
            }

            const userData = {
                name: document.getElementById('settingsName').value,
                dic: document.getElementById('settingsDIC').value,
                address: document.getElementById('settingsAddress').value,
                iban: document.getElementById('settingsIBAN').value,
                year: document.getElementById('settingsYear').value,
                rentExemption: parseFloat(document.getElementById('configRentExemption').value) || 500,
                taxRate: parseFloat(document.getElementById('configTaxRate').value) || 0.19
            };
            
            try {
                // setDoc a doc už budú fungovať
                await setDoc(doc(db, "users", user.uid), userData);
                showToast("Nastavenia úspešne uložené", "success");
                loadUserProfile(user, db); 
            } catch (err) {
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
            if (userNameEl) userNameEl.textContent = data.name || user.email;
            if (userDicEl) userDicEl.textContent = data.dic ? `DIČ: ${data.dic}` : 'DIČ: -';
            
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

export function setupBackup(db, getUserCallback) {
    const btn = document.getElementById('btnExportBackup');
    if (!btn) return;

    btn.addEventListener('click', async () => {
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
}