import { auth, db } from './config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Import modulov
import { setupImportEvents } from './views/import.js';
import { renderDashboard } from './views/dashboard.js';
import { setupBudgetEvents, loadBudget } from './views/budget.js';
import { setupTransactionEvents, renderTransactions } from './views/transactions.js';
import { setupReportEvents } from './views/reports.js';
import { initSettings, loadUserProfile } from './views/settings.js';

let currentUser = null;
let transactions = []; 

// --- 1. SETUP GLOBAL LISTENERS (Spustí sa iba raz pri štarte appky) ---
setupBudgetEvents(db, () => currentUser);
setupTransactionEvents(db, () => currentUser, refreshData);
setupReportEvents(db, () => transactions);
initSettings(db, () => currentUser);

// --- AUTH LOGIC ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        setupImportEvents(db, currentUser, refreshData);
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
    location.reload();
});

// --- DATA LOGIC ---
async function refreshData() {
    if (!currentUser) return;
    
    console.log("Refreshing data for user:", currentUser.uid);

    // 1. Načítať User Profile
    loadUserProfile(currentUser, db);

    // 2. Načítať Rozpočet
    loadBudget(currentUser, db);

    // 3. Načítať Transakcie
    const q = query(collection(db, "transactions"), where("uid", "==", currentUser.uid), orderBy("date", "desc"));
    try {
        const querySnapshot = await getDocs(q);
        transactions = [];
        querySnapshot.forEach((doc) => transactions.push({ id: doc.id, ...doc.data() }));
        
        renderDashboard(transactions);
        renderTransactions(transactions, db, refreshData); 
        
    } catch (error) { console.error("Chyba načítania transakcií:", error); }
}

// --- TAB SWITCHING (OPRAVENÉ PRE VANILLA CSS) ---
// Vyberieme všetky elementy, ktoré majú atribút data-view (v sidebare aj v mobilnom menu)
const allNavButtons = document.querySelectorAll('[data-view]');

allNavButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const viewName = btn.dataset.view;

        // 1. Deaktivovať všetky navigačné tlačidlá (odstrániť triedu active)
        allNavButtons.forEach(b => b.classList.remove('active'));

        // 2. Aktivovať tlačidlá pre vybraný view (aj v sidebare, aj v mobilnom menu naraz)
        document.querySelectorAll(`[data-view="${viewName}"]`).forEach(b => b.classList.add('active'));

        // 3. Skryť všetky pohľady (views)
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

        // 4. Zobraziť vybraný pohľad
        const targetView = document.getElementById(`${viewName}View`);
        if (targetView) {
            targetView.classList.add('active');
        }
    });
});