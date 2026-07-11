// js/app.js

import { auth, db } from './config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, orderBy, getDocs, doc, getDoc, limit, writeBatch, startAfter } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Import modulov
import { setupImportEvents } from './views/import.js';
import { renderDashboard } from './views/dashboard.js';
import { setupBudgetEvents, loadBudget } from './views/budget.js';
import { setupTransactionEvents, renderTransactions } from './views/transactions.js';
import { setupReportEvents } from './views/reports.js';
import { initSettings, loadUserProfile, setupBackup } from './views/settings.js';
import { setupSalaryImport } from './views/salaryImport.js';
import { initYearClosure, updateYearLabels } from './views/yearClosure.js';
import { showToast } from './notifications.js';

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
let transactions = []; // Kompletné dáta pre dashboard/reporty
let tableTransactions = []; // Dáta pre tabuľku transakcií (stránkované)
let allTransactionsLoaded = false;
const TRANSACTION_QUERY_PAGE_SIZE = 150;
let transactionCursor = null;
let analyticsLoadingPromise = null;
let currentYear = 2025; // Aktívne zobrazený rok
let activeYear = 2025;  // Skutočný aktívny rok používateľa
let isViewingArchive = false; // Či sa pozeráme na archív
let refreshDataTimeout = null; // Pre debouncing
let currentRefreshId = 0; // Pre sledovanie requestov
let latestDashboardConfig = { rentExemption: 500, taxRate: 0.19 };

// --- LAYOUT HELPERS ---
function closeMobileNav() {
    document.body.classList.remove('nav-open');
    const toggle = document.getElementById('mobileNavToggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function openMobileNav() {
    document.body.classList.add('nav-open');
    const toggle = document.getElementById('mobileNavToggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
}

function initLayoutShell() {
    const toggle = document.getElementById('mobileNavToggle');
    const backdrop = document.getElementById('mobileNavBackdrop');

    toggle?.addEventListener('click', () => {
        const isOpen = document.body.classList.contains('nav-open');
        if (isOpen) {
            closeMobileNav();
        } else {
            openMobileNav();
        }
    });

    backdrop?.addEventListener('click', () => {
        closeMobileNav();
    });

    // Zrkadlenie mena používateľa do topbaru
    const userNameNode = document.getElementById('userName');
    const mirrorNode = document.getElementById('userNameMirror');
    if (userNameNode && mirrorNode) {
        mirrorNode.textContent = userNameNode.textContent || 'Používateľ';
        const observer = new MutationObserver(() => {
            mirrorNode.textContent = userNameNode.textContent || 'Používateľ';
        });
        observer.observe(userNameNode, { childList: true, subtree: true, characterData: true });
    }
}

initLayoutShell();
initOfflineStatusBanner();
registerServiceWorker();

function initOfflineStatusBanner() {
    const banner = document.getElementById('offlineStatusBanner');
    const label = document.getElementById('offlineStatusText');
    if (!banner || !label) return;

    const render = () => {
        const isOnline = navigator.onLine;
        banner.style.display = isOnline ? 'none' : 'block';
        label.textContent = isOnline
            ? 'Pripojenie obnovené.'
            : 'Offline režim: nové ručné transakcie sa dočasne uložia lokálne.';
    };

    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    render();
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    let isRefreshing = false;
    let updatePromptShown = false;

    const promptForServiceWorkerUpdate = (worker) => {
        if (!worker || updatePromptShown) return;
        updatePromptShown = true;

        showToast('Je dostupna nova verzia aplikacie.', 'info');
        const confirmed = window.confirm('Je dostupna nova verzia aplikacie. Chcete ju teraz nainstalovat?');

        if (confirmed) {
            worker.postMessage({ type: 'SKIP_WAITING' });
        } else {
            updatePromptShown = false;
        }
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isRefreshing) return;
        isRefreshing = true;
        window.location.reload();
    });

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('./sw.js');

            if (registration.waiting) {
                promptForServiceWorkerUpdate(registration.waiting);
            }

            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;

                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        promptForServiceWorkerUpdate(newWorker);
                    }
                });
            });
        } catch (error) {
            console.error('Registrácia Service Workera zlyhala:', error);
        }
    });
}

// --- 1. SETUP GLOBAL LISTENERS ---
setupBudgetEvents(db, () => currentUser);
setupTransactionEvents(db, () => currentUser, () => activeYear, refreshData);
setupReportEvents(db, () => transactions);
initSettings(db, () => currentUser);
setupBackup(db, () => currentUser, refreshData);
initYearClosure(db, () => currentUser, () => activeYear);

// --- AUTH LOGIC ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        
        // NOVÉ: Migrácia a načítanie year systému
        await initializeYearSystem();

        // Oprava historických importov: doplniť chýbajúci účet
        await migrateMissingTransactionAccounts(user);
        
        setupImportEvents(db, currentUser, refreshData);
        setupSalaryImport(db, currentUser, refreshData);
        window.dispatchEvent(new Event('online'));
        refreshData();
    } else {
        currentUser = null;
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

async function migrateMissingTransactionAccounts(user) {
    if (!user?.uid) return;

    try {
        const q = query(
            collection(db, 'transactions'),
            where('uid', '==', user.uid)
        );
        const snapshot = await getDocs(q);

        const docsToUpdate = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const account = String(data.account || '').trim().toLowerCase();
            if (!account || account === 'undefined') {
                docsToUpdate.push(docSnap.ref);
            }
        });

        if (docsToUpdate.length === 0) return;

        const chunkSize = 450;
        for (let i = 0; i < docsToUpdate.length; i += chunkSize) {
            const chunk = docsToUpdate.slice(i, i + chunkSize);
            const batch = writeBatch(db);
            chunk.forEach((ref) => {
                batch.update(ref, { account: 'banka' });
            });
            await batch.commit();
        }

        showToast(`Doplnený účet 'banka' v ${docsToUpdate.length} historických transakciách`, 'info');
    } catch (error) {
        console.error('Chyba migrácie účtu transakcií:', error);
    }
}

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
    const topbarYear = document.getElementById('topbarYear');
    if (topbarYear) {
        topbarYear.textContent = currentYear;
    }
    
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
            
            // Resetovať stránkovanie transakcií pri prepnutí roka
            transactionCursor = null;
            tableTransactions = [];
            transactions = [];
            analyticsLoadingPromise = null;
            allTransactionsLoaded = false;
            
            // Zavrieť dropdown
            document.getElementById('yearDropdown').classList.remove('show');
            
            // Aktualizovať display
            document.getElementById('currentYearDisplay').textContent = year;
            const topbarYear = document.getElementById('topbarYear');
            if (topbarYear) {
                topbarYear.textContent = year;
            }
            
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

// Fallback archívu: prepnutie na Reporty s toast info
function showArchiveView() {
    document.querySelector('[data-view="reports"]')?.click();
    showToast('Archívny prehľad nájdete v reportoch po prepnutí roka', 'info');
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
            const code = error?.code || '';
            let hint = '';

            if (code === 'auth/unauthorized-domain') {
                hint = '\nPovolená doména vo Firebase chýba. Pridaj localhost do Firebase Auth > Settings > Authorized domains.';
            } else if (code === 'auth/network-request-failed') {
                hint = '\nSkontroluj internetové pripojenie a firewall/proxy.';
            }

            alert('Chyba prihlásenia: ' + (error?.message || 'Neznáma chyba') + '\nKód: ' + (code || 'n/a') + hint); 
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
    renderTransactionsSkeleton();
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

        latestDashboardConfig = config;

        transactionCursor = null;
        tableTransactions = [];
        allTransactionsLoaded = false;
        analyticsLoadingPromise = null;

        // 3. Načítať prvú stránku transakcií pre rýchly render tabuľky
        await loadNextTransactionsPage({ reset: true, requestId });
        
        // Kontrola či nie je request zastaraný
        if (requestId !== currentRefreshId) {
            console.log(`Request #${requestId} je zastaraný, ignorujem.`);
            hideLoading();
            return;
        }
        
        console.log(`Načítaných ${tableTransactions.length} transakcií (1. stránka)`);

        // Rýchly render dashboardu z prvej stránky, potom presný prepočet z full analytics.
        renderDashboard(tableTransactions, config);
        renderTransactions(tableTransactions, db, refreshData, isViewingArchive);

        // Asynchrónne načítanie plných dát pre presné výpočty dashboardu/reportov.
        analyticsLoadingPromise = loadAnalyticsTransactions(requestId, config);
        
        // Zobraziť tlačidlo "Načítať viac" ak existujú ďalšie transakcie
        updateLoadMoreButton(); 
        
    } catch (error) { 
        console.error("Chyba pri osvieživovaní dát:", error); 
    } finally {
        // Skrytie loading stavu
        hideLoading();
    }
}

async function loadNextTransactionsPage({ reset = false, requestId } = {}) {
    if (!currentUser) return;
    if (!reset && allTransactionsLoaded) return;

    const constraints = [
        where("uid", "==", currentUser.uid),
        where("year", "==", currentYear),
        orderBy("date", "desc"),
        limit(TRANSACTION_QUERY_PAGE_SIZE)
    ];

    if (!reset && transactionCursor) {
        constraints.push(startAfter(transactionCursor));
    }

    const q = query(collection(db, "transactions"), ...constraints);
    const querySnapshot = await getDocs(q);

    if (typeof requestId === 'number' && requestId !== currentRefreshId) {
        return;
    }

    const pageItems = [];
    querySnapshot.forEach((docSnap) => {
        pageItems.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (reset) {
        tableTransactions = pageItems;
    } else {
        tableTransactions = tableTransactions.concat(pageItems);
    }

    if (!querySnapshot.empty) {
        transactionCursor = querySnapshot.docs[querySnapshot.docs.length - 1];
    }

    allTransactionsLoaded = pageItems.length < TRANSACTION_QUERY_PAGE_SIZE;
}

async function loadAnalyticsTransactions(requestId, config) {
    try {
        const q = query(
            collection(db, "transactions"),
            where("uid", "==", currentUser.uid),
            where("year", "==", currentYear),
            orderBy("date", "desc")
        );

        const querySnapshot = await getDocs(q);

        if (requestId !== currentRefreshId) {
            return;
        }

        const analyticsItems = [];
        querySnapshot.forEach((docSnap) => {
            analyticsItems.push({ id: docSnap.id, ...docSnap.data() });
        });

        transactions = analyticsItems;
        renderDashboard(transactions, config);
    } catch (error) {
        console.error("Chyba pri načítaní analytických dát:", error);
    }
}

function renderTransactionsSkeleton() {
    const tbody = document.getElementById('transactionsList');
    const emptyState = document.getElementById('transactionsEmptyState');
    if (!tbody) return;

    if (emptyState) emptyState.style.display = 'none';

    const skeletonRows = Array.from({ length: 6 }).map(() => (
        `<tr>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
            <td><div class="skeleton-block" style="height: 14px;"></div></td>
        </tr>`
    )).join('');

    tbody.innerHTML = skeletonRows;
}

// Funkcia na aktualizáciu viditeľnosti tlačidla "Načítať viac"
function updateLoadMoreButton() {
    const loadMoreBtn = document.getElementById('loadMoreTransactionsBtn');
    if (!loadMoreBtn) return;
    
    if (tableTransactions.length === 0 || allTransactionsLoaded) {
        loadMoreBtn.style.display = 'none';
    } else {
        loadMoreBtn.style.display = 'block';
        loadMoreBtn.querySelector('span').textContent = `Načítať viac transakcií (zobrazených ${tableTransactions.length}+)`;
    }
}

// Funkcia na načítanie ďalšej stránky transakcií do tabuľky
async function loadAllTransactions() {
    if (!currentUser || allTransactionsLoaded) return;
    
    const loadMoreBtn = document.getElementById('loadMoreTransactionsBtn');
    if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Načítavam...';
    }
    
    try {
        await loadNextTransactionsPage();
        renderTransactions(tableTransactions, db, refreshData, isViewingArchive);
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

        const pageTitle = document.getElementById('pageTitle');
        if (pageTitle) {
            pageTitle.textContent = btn.textContent.trim();
        }

        closeMobileNav();
    });
});

// NOVÉ: Toggle year dropdown
document.getElementById('yearSelectorBtn')?.addEventListener('click', () => {
    const dropdown = document.getElementById('yearDropdown');
    dropdown.classList.toggle('show');
    document.getElementById('yearSelectorBtn')?.setAttribute('aria-expanded', dropdown.classList.contains('show') ? 'true' : 'false');
});

// Zavrieť dropdown pri kliknutí mimo
document.addEventListener('click', (e) => {
    if (!e.target.closest('.year-selector')) {
        document.getElementById('yearDropdown')?.classList.remove('show');
        document.getElementById('yearSelectorBtn')?.setAttribute('aria-expanded', 'false');
    }
});

// NOVÉ: Načítať viac transakcií
document.getElementById('loadMoreTransactionsBtn')?.addEventListener('click', () => {
    loadAllTransactions();
});

document.querySelector('[data-view="dashboard"]')?.addEventListener('click', async () => {
    if (transactions.length > 0 || analyticsLoadingPromise) return;
    analyticsLoadingPromise = loadAnalyticsTransactions(currentRefreshId, latestDashboardConfig);
    await analyticsLoadingPromise;
});

document.querySelector('[data-view="reports"]')?.addEventListener('click', async () => {
    if (transactions.length > 0 || analyticsLoadingPromise) return;
    analyticsLoadingPromise = loadAnalyticsTransactions(currentRefreshId, latestDashboardConfig);
    await analyticsLoadingPromise;
});

// Export pre použitie v iných moduloch
export { currentYear, activeYear, isViewingArchive };
