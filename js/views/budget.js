import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// --- 1. Event Setup (Volané raz z app.js) ---
export function setupBudgetEvents(db, getUserCallback) {
    const monthInput = document.getElementById('budgetMonthSelect');
    const budgetContainer = document.getElementById('budgetView'); // Zmena selektoru na ID view
    const saveBtn = document.getElementById('btnSaveBudget');
    const copyBtn = document.getElementById('btnCopyBudget');

    // Nastavenie aktuálneho mesiaca defaultne
    if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Zmena mesiaca -> Načítať nové dáta
    if (monthInput) {
        monthInput.addEventListener('change', (e) => {
            const user = getUserCallback();
            if(user) loadBudgetForMonth(user, db, e.target.value);
        });
    }

    // 1. Tlačidlo Uložiť
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const user = getUserCallback();
            if (user) saveAllBudget(user, db, monthInput.value);
            else alert('Chyba: Nie ste prihlásený');
        });
    }

    // 2. Tlačidlo Kopírovať
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const user = getUserCallback();
            if (user) openCopyModal(monthInput.value, user, db);
        });
    }

    // 3. Logika vnútri kontajnera (Inputs a Clear tlačidlá)
    if (budgetContainer) {
        // Auto-prepočet pri písaní
        budgetContainer.addEventListener('input', (e) => {
            // Kontrola či ide o input v rozpočtovej tabuľke
            if (e.target.tagName === 'INPUT' && e.target.closest('.budget-table')) {
                calculateBudgetTotals();
            }
        });

        // Kliknutia na tlačidlá "Vymazať sekciu"
        budgetContainer.addEventListener('click', (e) => {
            if (e.target.closest('.btn-clear-section')) {
                e.preventDefault();
                const targetId = e.target.closest('.btn-clear-section').dataset.target;
                const container = document.getElementById(targetId);
                if (container && confirm('Vymazať túto sekciu?')) {
                    container.querySelectorAll('input').forEach(input => input.value = '');
                    calculateBudgetTotals();
                }
            }
        });
    }
}

// --- 2. Data Loading (Volané z refreshData) ---
export function loadBudget(user, db) {
    const monthInput = document.getElementById('budgetMonthSelect');
    if (monthInput) {
        loadBudgetForMonth(user, db, monthInput.value);
    }
}

// --- Pomocné funkcie ---

function calculateBudgetTotals() {
    // Nová logika selektorov podľa HTML tried
    const sumInputs = (sel) => {
        let s = 0; 
        document.querySelectorAll(sel).forEach(i => s += (parseFloat(i.value) || 0)); 
        return s;
    };

    // Selektujeme priamo inputy s triedami income, housing, other
    const inc = sumInputs('input.income');
    const hou = sumInputs('input.housing');
    const oth = sumInputs('input.other');
    
    const updateText = (id, val, colorClass = '') => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = val.toFixed(2) + ' €';
            // Reset farieb a pridanie novej ak je definovaná
            if (colorClass) {
                 // Zachováme base classes, zmeníme len farbu (zjednodušené pre vanilla CSS)
                 el.className = colorClass; 
                 el.style.fontWeight = 'bold';
                 el.style.fontSize = '1.1rem';
            }
        }
    };

    updateText('totalBudgetIncome', inc, 'text-success');
    updateText('totalHousing', hou, 'text-primary'); // Primary blue
    updateText('totalOther', oth, 'text-warning');
    
    const totalExpenses = hou + oth;
    const expensesEl = document.getElementById('totalBudgetExpenses');
    if(expensesEl) expensesEl.textContent = totalExpenses.toFixed(2) + ' €';

    const balance = inc - totalExpenses;
    const balanceEl = document.getElementById('totalBudgetBalance');
    if (balanceEl) {
        balanceEl.textContent = balance.toFixed(2) + ' €';
        // Vanilla CSS manipulácia tried
        balanceEl.classList.remove('text-danger', 'text-success');
        if (balance < 0) balanceEl.classList.add('text-danger');
        else balanceEl.classList.add('text-success'); // Voliteľne zelená pre plus
    }
}

async function loadBudgetForMonth(user, db, yearMonth) {
    // 1. Reset inputov - hľadáme všetky inputy v tabuľkách
    const allInputs = document.querySelectorAll('.budget-table input');
    allInputs.forEach(input => input.value = '');
    
    const statusElem = document.getElementById('budgetStatus');
    if(statusElem) statusElem.textContent = '';

    // Vytvorenie ID dokumentu
    const docRef = doc(db, 'budgets', `${user.uid}_${yearMonth}`);
    
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            // Naplnenie inputov
            allInputs.forEach(input => {
                const field = input.dataset.field;
                if (field && data[field] !== undefined) {
                    input.value = data[field];
                }
            });
        }
        calculateBudgetTotals();
    } catch (error) {
        console.error("Chyba load budget:", error);
    }
}

async function saveAllBudget(user, db, yearMonth) {
    const statusElem = document.getElementById('budgetStatus');
    if(statusElem) {
        statusElem.textContent = 'Ukladám...';
        statusElem.className = 'text-warning'; // Orange
    }

    const budgetData = { uid: user.uid, updatedAt: new Date() };
    
    // Zozbieranie dát - opäť používame selektor pre tabuľky
    document.querySelectorAll('.budget-table input').forEach(input => {
        const field = input.dataset.field;
        if (field) {
            const val = input.value === '' ? 0 : parseFloat(input.value);
            budgetData[field] = val;
        }
    });

    try {
        await setDoc(doc(db, 'budgets', `${user.uid}_${yearMonth}`), budgetData, { merge: true });
        
        if(statusElem) {
            statusElem.textContent = 'Uložené ✓';
            statusElem.className = 'text-success'; // Green
            setTimeout(() => { 
                if(statusElem.textContent.includes('Uložené')) statusElem.textContent=''; 
            }, 3000);
        }
    } catch (error) {
        console.error(error);
        if(statusElem) {
            statusElem.textContent = 'Chyba!';
            statusElem.className = 'text-danger';
        }
    }
}

// Modals copy logic
const MONTH_NAMES = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];

function openCopyModal(currentDateValue, user, db) {
    const modal = document.getElementById('copyModal');
    const grid = document.getElementById('monthsGrid');
    grid.innerHTML = ''; 
    
    const [year, currentMonth] = currentDateValue.split('-');
    const currentMonthIndex = parseInt(currentMonth) - 1;

    MONTH_NAMES.forEach((name, index) => {
        const monthNum = String(index + 1).padStart(2, '0');
        const fullDate = `${year}-${monthNum}`;
        const isCurrent = index === currentMonthIndex;

        const div = document.createElement('div');
        // Upravené štýly pre Vanilla CSS (inline alebo triedy)
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '0.5rem';
        div.style.padding = '0.5rem';
        div.style.border = '1px solid #e2e8f0';
        div.style.borderRadius = '0.5rem';
        div.style.cursor = 'pointer';
        
        if (isCurrent) {
            div.style.opacity = '0.5';
            div.style.pointerEvents = 'none';
            div.style.background = '#f1f5f9';
        } else {
             div.onmouseover = () => div.style.background = '#f8fafc';
             div.onmouseout = () => div.style.background = 'transparent';
        }

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = fullDate;
        checkbox.className = 'month-copy-checkbox';
        if (isCurrent) checkbox.disabled = true;

        const label = document.createElement('span');
        label.textContent = name;
        label.style.fontSize = '0.9rem';

        div.append(checkbox, label);
        grid.appendChild(div);

        if (!isCurrent) {
            div.addEventListener('click', (e) => { 
                if (e.target !== checkbox) checkbox.checked = !checkbox.checked; 
            });
        }
    });

    modal.style.display = 'flex';
    const confirmBtn = document.getElementById('btnConfirmCopy');
    
    // Odstránenie starých listenerov (cloneNode trik)
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    
    newConfirm.addEventListener('click', () => performCopy(user, db));
    
    const closeBtn = document.getElementById('btnCloseModal');
    // Clone aj pre close button pre istotu
    const newClose = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newClose, closeBtn);
    newClose.addEventListener('click', () => modal.style.display = 'none');
}

async function performCopy(user, db) {
    const checkboxes = document.querySelectorAll('.month-copy-checkbox:checked');
    const targetMonths = Array.from(checkboxes).map(cb => cb.value);
    
    if (targetMonths.length === 0) return alert("Vyberte aspoň jeden mesiac.");

    const dataToCopy = { uid: user.uid, updatedAt: new Date() };
    let hasData = false;
    
    // Zber dát z aktuálneho mesiaca (používame nový selektor)
    document.querySelectorAll('.budget-table input').forEach(input => {
        const field = input.dataset.field;
        if (field && input.value !== '') {
            dataToCopy[field] = parseFloat(input.value);
            hasData = true;
        }
    });

    if (!hasData) return alert("Aktuálny mesiac je prázdny.");

    try {
        const promises = targetMonths.map(targetDate => 
            setDoc(doc(db, 'budgets', `${user.uid}_${targetDate}`), dataToCopy, { merge: true })
        );
        await Promise.all(promises);
        alert(`Úspešne skopírované.`);
        document.getElementById('copyModal').style.display = 'none';
    } catch (error) {
        console.error(error);
        alert("Chyba pri kopírovaní.");
    }
}