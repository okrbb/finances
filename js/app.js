// js/app.js

import { auth, db } from './config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, orderBy, getDocs, doc, getDoc, limit } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Import modulov
import { setupImportEvents } from './views/import.js';
import { renderDashboard } from './views/dashboard.js';
import { setupBudgetEvents, loadBudget } from './views/budget.js';
import { setupTransactionEvents, renderTransactions } from './views/transactions.js';
import { setupReportEvents } from './views/reports.js';
import { initSettings, loadUserProfile, setupBackup } from './views/settings.js';
import { setupSalaryImport } from './views/salaryImport.js';
import { initYearClosure, updateYearLabels } from './views/yearClosure.js';

// Import utils
import { showLoading, hideLoading } from './utils.js';

// NOVÉ: Import year managementu
import { 
    migrateToYearSystem, 
    getUserActiveYear,
    getArchivedYears,
    checkYearClosureNeeded,
    switchToYear
} from './yearManager.js';

let currentUser = null;
let transactions = []; 
let allTransactionsLoaded = false; // Indikátor či sú načítané všetky transakcie
let transactionLimit = 100; // Počiatočný limit pre načítanie transakcií
let currentYear = 2025; // Aktívne zobrazený rok
let activeYear = 2025;  // Skutočný aktívny rok používateľa
let isViewingArchive = false; // Či sa pozeráme na archív
let refreshDataTimeout = null; // Pre debouncing
let currentRefreshId = 0; // Pre sledovanie requestov

// --- 1. SETUP GLOBAL LISTENERS ---
setupBudgetEvents(db, () => currentUser);
setupTransactionEvents(db, () => currentUser, () => activeYear, refreshData);
setupReportEvents(db, () => transactions);
initSettings(db, () => currentUser);
setupBackup(db, () => currentUser);
initYearClosure(db, () => currentUser, () => activeYear);

// --- AUTH LOGIC ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        
        // NOVÉ: Migrácia a načítanie year systému
        await initializeYearSystem();
        
        setupImportEvents(db, currentUser, refreshData);
        setupSalaryImport(db, currentUser, refreshData);
        refreshData();
    } else {
        currentUser = null;
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

// NOVÉ: Inicializácia year systému
async function initializeYearSystem() {
    try {
        // 1. Spustiť migráciu (ak je potrebná)
        activeYear = await migrateToYearSystem(currentUser, db);
        currentYear = activeYear;
        
        // 2. Načítať zoznam archívnych rokov
        const archivedYears = await getArchivedYears(currentUser, db);
        
        // 3. Aktualizovať UI s year selector
        updateYearSelector(activeYear, archivedYears);
        
        // 3b. Aktualizovať rok v Year Closure view
        updateYearLabels(activeYear);
        
        // 4. Skontrolovať či je potrebné uzavrieť rok
        // OPRAVA: Nekontrolovať ak je predchádzajúci rok už uzavretý
        const currentDate = new Date();
        const currentRealYear = currentDate.getFullYear();
        const previousYear = currentRealYear - 1;
        
        // Banner sa zobrazí len ak:
        // - Je január aktuálneho roka
        // - Predchádzajúci rok NIE JE uzavretý
        // - Predchádzajúci rok je aktívny rok
        if (currentDate.getMonth() === 0 && // Je január
            activeYear === previousYear && // Aktívny rok je minulý rok
            !archivedYears.includes(previousYear)) { // A nie je uzavretý
            
            const closureCheck = checkYearClosureNeeded(activeYear);
            if (closureCheck.needed) {
                showYearClosureBanner(activeYear);
            }
        }
        
        console.log(`✅ Year system inicializovaný: aktívny rok ${activeYear}`);
        
    } catch (error) {
        console.error("Chyba pri inicializácii year systému:", error);
    }
}

// NOVÉ: Aktualizácia year selectora v UI
function updateYearSelector(active, archived) {
    const yearDisplay = document.getElementById('currentYearDisplay');
    const yearDropdown = document.getElementById('yearDropdown');
    
    if (!yearDisplay || !yearDropdown) {
        console.warn("Year selector elementy nenájdené v HTML");
        return;
    }
    
    // Nastaviť aktuálny rok
    yearDisplay.textContent = currentYear;
    
    // Vyčistiť dropdown
    yearDropdown.innerHTML = '';
    
    // Pridať aktívny rok
    const activeItem = document.createElement('div');
    activeItem.className = 'year-dropdown-item';
    activeItem.innerHTML = `
        <span class="year-number">${active}</span>
        <span class="year-badge active">Aktívny</span>
    `;
    activeItem.addEventListener('click', () => {
        selectYear(active);
    });
    yearDropdown.appendChild(activeItem);
    
    // Pridať archívne roky (zoradené zostupne)
    archived.sort((a, b) => b - a).forEach(year => {
        const item = document.createElement('div');
        item.className = 'year-dropdown-item';
        item.innerHTML = `
            <span class="year-number">${year}</span>
            <span class="year-badge archived">Uzavretý</span>
        `;
        item.addEventListener('click', () => {
            selectYear(year);
        });
        yearDropdown.appendChild(item);
    });
    
    // Pridať link na archív (ak existujú archívne roky)
    if (archived.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'year-dropdown-divider';
        yearDropdown.appendChild(divider);
        
        const archiveLink = document.createElement('div');
        archiveLink.className = 'year-dropdown-item archive-link';
        archiveLink.innerHTML = '<i class="fa-solid fa-archive"></i> Archív rokov';
        archiveLink.addEventListener('click', () => {
            showArchiveView();
        });
        yearDropdown.appendChild(archiveLink);
    }
}

// NOVÉ: Výber roka
async function selectYear(year) {
    // Debouncing - zrušiť predchádzajúci timeout
    if (refreshDataTimeout) {
        clearTimeout(refreshDataTimeout);
    }
    
    try {
        const result = await switchToYear(year, currentUser, db);
        
        if (result) {
            currentYear = result.year;
            isViewingArchive = result.isArchived;
            
            // Resetovať limit a indikátor pri prepnutí roka
            transactionLimit = 100;
            allTransactionsLoaded = false;
            
            // Zavrieť dropdown
            document.getElementById('yearDropdown').classList.remove('show');
            
            // Aktualizovať display
            document.getElementById('currentYearDisplay').textContent = year;
            
            // Aktualizovať rok v Year Closure view
            updateYearLabels(year);
            
            // Zobraziť/skryť archive banner
            if (isViewingArchive) {
                showArchiveBanner(year);
            } else {
                hideArchiveBanner();
            }
            
            // Obnoviť dáta s debouncing (300ms)
            refreshDataTimeout = setTimeout(() => {
                refreshData();
            }, 300);
        }
    } catch (error) {
        console.error("Chyba pri výbere roka:", error);
        showToast("Chyba pri prepnutí roka", "danger");
    }
}

// NOVÉ: Banner pre archívny režim
function showArchiveBanner(year) {
    let banner = document.getElementById('archiveBanner');
    
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'archiveBanner';
        banner.className = 'archive-banner';
        
        const mainApp = document.getElementById('mainApp');
        mainApp.insertBefore(banner, mainApp.firstChild);
    }
    
    banner.innerHTML = `
        <div class="archive-banner-content">
            <i class="fa-solid fa-archive"></i>
            <span>ARCHÍVNY REŽIM - ROK ${year}</span>
            <span class="archive-banner-note">Tento rok je uzavretý a iba na čítanie</span>
            <button id="btnBackToActive" class="btn-back-to-active">
                <i class="fa-solid fa-arrow-left"></i> Späť na ${activeYear}
            </button>
        </div>
    `;
    
    banner.style.display = 'flex';
    
    // Event listener pre návrat
    document.getElementById('btnBackToActive').addEventListener('click', () => {
        selectYear(activeYear);
    });
}

function hideArchiveBanner() {
    const banner = document.getElementById('archiveBanner');
    if (banner) {
        banner.style.display = 'none';
    }
}

// NOVÉ: Banner pre uzavretie roka
function showYearClosureBanner(year) {
    let banner = document.getElementById('closureBanner');
    
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'closureBanner';
        banner.className = 'closure-banner';
        
        const mainApp = document.getElementById('mainApp');
        mainApp.insertBefore(banner, mainApp.firstChild);
    }
    
    banner.innerHTML = `
        <div class="closure-banner-content">
            <i class="fa-solid fa-calendar-check"></i>
            <span>BLÍŽI SA KONIEC ROKA ${year}!</span>
            <span class="closure-banner-note">Nezabudnite uzavrieť rok a pripraviť daňové priznanie</span>
            <button id="btnGoToClosure" class="btn-go-to-closure">
                <i class="fa-solid fa-lock"></i> Prejsť na uzavretie roka
            </button>
            <button id="btnDismissClosure" class="btn-dismiss">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
    `;
    
    banner.style.display = 'flex';
    
    // Event listenery
    document.getElementById('btnGoToClosure').addEventListener('click', () => {
        // Prepnúť na nový tab "Uzavretie roka"
        document.querySelector('[data-view="yearClosure"]')?.click();
    });
    
    document.getElementById('btnDismissClosure').addEventListener('click', () => {
        banner.style.display = 'none';
        localStorage.setItem('dismissedClosureBanner_' + year, 'true');
    });
    
    // Skontrolovať či už bol banner dismissed
    if (localStorage.getItem('dismissedClosureBanner_' + year) === 'true') {
        banner.style.display = 'none';
    }
}

// Login / Logout Eventy
const loginForm = document.getElementById('loginForm');
if(loginForm) {
    // Načítať uložený email pri načítaní stránky
    const savedEmail = localStorage.getItem('rememberedEmail');
    const rememberCheckbox = document.getElementById('rememberMe');
    
    if (savedEmail) {
        document.getElementById('loginEmail').value = savedEmail;
        if (rememberCheckbox) rememberCheckbox.checked = true;
    }
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const remember = document.getElementById('rememberMe').checked;
        
        try {
            await signInWithEmailAndPassword(auth, email, password);
            
            // Uložiť alebo vymazať email podľa checkboxu
            if (remember) {
                localStorage.setItem('rememberedEmail', email);
            } else {
                localStorage.removeItem('rememberedEmail');
            }
            // Vymazať uložené heslo (ak tam náhodou bolo z predošlej verzie)
            localStorage.removeItem('rememberedPassword');
        } catch (error) { 
            alert('Chyba prihlásenia: ' + error.message); 
        }
    });
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth); 
    location.reload();
});

// --- DATA LOGIC ---
async function refreshData() {
    if (!currentUser) {
        console.log("Dáta sa neobnovia: Chýba používateľ.");
        return;
    }
    
    // Vytvorenie unique ID pre tento request
    const requestId = ++currentRefreshId;
    
    console.log(`Sťahujem dáta z Firestore pre rok ${currentYear}... (Request #${requestId})`);

    // Zobrazenie loading stavu
    showLoading();

    try {
        // 1. Načítať User Profile
        await loadUserProfile(currentUser, db);

        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        let config = { rentExemption: 500, taxRate: 0.19 };
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.rentExemption !== undefined) config.rentExemption = userData.rentExemption;
            if (userData.taxRate !== undefined) config.taxRate = userData.taxRate;
        }

        // 2. Načítať Rozpočet (pre aktuálny rok)
        loadBudget(currentUser, db, currentYear);

        // 3. Načítať Transakcie pre zobrazený rok s limitom (OPTIMALIZOVANÉ)
        const q = query(
            collection(db, "transactions"), 
            where("uid", "==", currentUser.uid),
            where("year", "==", currentYear),
            orderBy("date", "desc"),
            limit(transactionLimit) // Limitovať počet načítaných transakcií
        );
        
        const querySnapshot = await getDocs(q);
        
        // Kontrola či nie je request zastaraný
        if (requestId !== currentRefreshId) {
            console.log(`Request #${requestId} je zastaraný, ignorujem.`);
            hideLoading();
            return;
        }
        
        transactions = [];
        querySnapshot.forEach((doc) => {
            transactions.push({ id: doc.id, ...doc.data() });
        });
        
        // Indikátor či sú načítané všetky transakcie
        allTransactionsLoaded = querySnapshot.size < transactionLimit;
        
        console.log(`Načítaných ${transactions.length} transakcií (limit: ${transactionLimit})`);
        
        // Aktualizácia UI
        renderDashboard(transactions, config);
        renderTransactions(transactions, db, refreshData, isViewingArchive);
        
        // Zobraziť tlačidlo "Načítať viac" ak existujú ďalšie transakcie
        updateLoadMoreButton(); 
        
    } catch (error) { 
        console.error("Chyba pri osvieživovaní dát:", error); 
    } finally {
        // Skrytie loading stavu
        hideLoading();
    }
}

// Funkcia na aktualizáciu viditeľnosti tlačidla "Načítať viac"
function updateLoadMoreButton() {
    const loadMoreBtn = document.getElementById('loadMoreTransactionsBtn');
    if (!loadMoreBtn) return;
    
    if (allTransactionsLoaded || transactions.length === 0) {
        loadMoreBtn.style.display = 'none';
    } else {
        loadMoreBtn.style.display = 'block';
        loadMoreBtn.querySelector('span').textContent = `Načítať viac transakcií (zobrazených ${transactions.length})`;
    }
}

// Funkcia na načítanie všetkých transakcií
async function loadAllTransactions() {
    if (!currentUser || allTransactionsLoaded) return;
    
    const loadMoreBtn = document.getElementById('loadMoreTransactionsBtn');
    if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Načítavam...';
    }
    
    try {
        // Načítať všetky transakcie bez limitu
        const q = query(
            collection(db, "transactions"), 
            where("uid", "==", currentUser.uid),
            where("year", "==", currentYear),
            orderBy("date", "desc")
        );
        
        const querySnapshot = await getDocs(q);
        
        transactions = [];
        querySnapshot.forEach((doc) => {
            transactions.push({ id: doc.id, ...doc.data() });
        });
        
        allTransactionsLoaded = true;
        
        console.log(`Načítaných všetkých ${transactions.length} transakcií`);
        
        // Aktualizácia UI
        renderTransactions(transactions, db, refreshData, isViewingArchive);
        updateLoadMoreButton();
        
    } catch (error) {
        console.error("Chyba pri načítavaní všetkých transakcií:", error);
    } finally {
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i> <span>Načítať viac</span>';
        }
    }
}

// --- TAB SWITCHING LOGIC ---
const allNavButtons = document.querySelectorAll('[data-view]');

allNavButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const viewName = btn.dataset.view;

        allNavButtons.forEach(b => b.classList.remove('active'));
        document.querySelectorAll(`[data-view="${viewName}"]`).forEach(b => b.classList.add('active'));

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

        const targetView = document.getElementById(`${viewName}View`);
        if (targetView) {
            targetView.classList.add('active');
        }
    });
});

// NOVÉ: Toggle year dropdown
document.getElementById('yearSelectorBtn')?.addEventListener('click', () => {
    const dropdown = document.getElementById('yearDropdown');
    dropdown.classList.toggle('show');
});

// Zavrieť dropdown pri kliknutí mimo
document.addEventListener('click', (e) => {
    if (!e.target.closest('.year-selector')) {
        document.getElementById('yearDropdown')?.classList.remove('show');
    }
});

// NOVÉ: Načítať viac transakcií
document.getElementById('loadMoreTransactionsBtn')?.addEventListener('click', () => {
    loadAllTransactions();
});

// Export pre použitie v iných moduloch
export { currentYear, activeYear, isViewingArchive };
