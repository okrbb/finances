// js/app.js

import { auth, db } from './config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Import modulov
import { setupImportEvents } from './views/import.js';
import { renderDashboard } from './views/dashboard.js';
import { setupBudgetEvents, loadBudget } from './views/budget.js';
import { setupTransactionEvents, renderTransactions } from './views/transactions.js';
import { setupReportEvents } from './views/reports.js';
import { initSettings, loadUserProfile, setupBackup } from './views/settings.js';
import { setupSalaryImport } from './views/salaryImport.js';

let currentUser = null;
let transactions = []; 

// --- 1. SETUP GLOBAL LISTENERS ---
// Tieto listenery sa nastavia raz pri štarte aplikácie
setupBudgetEvents(db, () => currentUser);
setupTransactionEvents(db, () => currentUser, refreshData);
setupReportEvents(db, () => transactions);
initSettings(db, () => currentUser);

// NOVÉ: Nastavenie listenera pre export zálohy (JSON)
setupBackup(db, () => currentUser);

// --- AUTH LOGIC ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        setupImportEvents(db, currentUser, refreshData);
        setupSalaryImport(db, currentUser, refreshData);
        refreshData();
    } else {
        currentUser = null;
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

// Login / Logout Eventy
const loginForm = document.getElementById('loginForm');
if(loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
        } catch (error) { alert('Chyba prihlásenia: ' + error.message); }
    });
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth); 
    // Po odhlásení preistotu reloadneme stránku pre vyčistenie stavu
    location.reload();
});

// --- DATA LOGIC ---
async function refreshData() {
    if (!currentUser) {
        console.log("Dáta sa neobnovia: Chýba používateľ.");
        return;
    }
    
    console.log("Sťahujem dáta z Firestore pre:", currentUser.uid);

    try {
        // 1. Načítať User Profile a daňové konštanty
        // Najprv zavoláme vizuálne načítanie do inputov v nastaveniach
        await loadUserProfile(currentUser, db);

        // Získame dáta profilu aj pre potreby výpočtov v dashboarde
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        let config = { rentExemption: 500, taxRate: 0.19 }; // Default hodnoty
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.rentExemption !== undefined) config.rentExemption = userData.rentExemption;
            if (userData.taxRate !== undefined) config.taxRate = userData.taxRate;
        }

        // 2. Načítať Rozpočet (pre aktuálne vybraný mesiac)
        loadBudget(currentUser, db);

        // 3. Načítať Transakcie z Firestore
        const q = query(
            collection(db, "transactions"), 
            where("uid", "==", currentUser.uid), 
            orderBy("date", "desc")
        );
        
        const querySnapshot = await getDocs(q);
        transactions = [];
        querySnapshot.forEach((doc) => {
            transactions.push({ id: doc.id, ...doc.data() });
        });
        
        // Aktualizácia Dashboardu s dynamickými konštantami
        renderDashboard(transactions, config);
        
        // Vykreslenie tabuľky transakcií
        renderTransactions(transactions, db, refreshData); 
        
    } catch (error) { 
        console.error("Chyba pri osviežovaní dát:", error); 
    }
}

// --- TAB SWITCHING LOGIC ---
const allNavButtons = document.querySelectorAll('[data-view]');

allNavButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const viewName = btn.dataset.view;

        // Deaktivovať všetky navigačné tlačidlá
        allNavButtons.forEach(b => b.classList.remove('active'));

        // Aktivovať tlačidlá pre vybraný view (sidebar aj mobilné menu)
        document.querySelectorAll(`[data-view="${viewName}"]`).forEach(b => b.classList.add('active'));

        // Skryť všetky pohľady (views)
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

        // Zobraziť vybraný pohľad
        const targetView = document.getElementById(`${viewName}View`);
        if (targetView) {
            targetView.classList.add('active');
        }
    });
});