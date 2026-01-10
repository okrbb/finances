// js/views/budget.js

import { showToast } from '../notifications.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const MONTH_NAMES = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];

// --- 1. Inicializácia Eventov (Volané raz z app.js) ---
export function setupBudgetEvents(db, getUserCallback) {
    const monthInput = document.getElementById('budgetMonthSelect');
    const budgetContainer = document.getElementById('budgetView');
    const saveBtn = document.getElementById('btnSaveBudget');
    const copyBtn = document.getElementById('btnCopyBudget');

    // Nastavenie aktuálneho mesiaca pri štarte
    if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Načítanie dát pri zmene mesiaca
    monthInput?.addEventListener('change', (e) => {
        const user = getUserCallback();
        if (user) loadBudgetForMonth(user, db, e.target.value);
    });

    // Tlačidlo Uložiť
    saveBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const user = getUserCallback();
        if (user) saveAllBudget(user, db, monthInput.value);
    });

    // Tlačidlo Kopírovať - otvára univerzálny výberový modál
    copyBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const user = getUserCallback();
        if (user) openSelectionModal(monthInput.value, user, db, "copy");
    });

    if (budgetContainer) {
        // Automatický prepočet pri písaní do inputov
        budgetContainer.addEventListener('input', (e) => {
            if (e.target.tagName === 'INPUT' && e.target.closest('.budget-table')) {
                calculateBudgetTotals();
            }
        });

        // Kliknutia na tlačidlá "Vymazať sekciu"
        budgetContainer.addEventListener('click', (e) => {
            const clearBtn = e.target.closest('.btn-clear-section');
            if (clearBtn) {
                e.preventDefault();
                const targetId = clearBtn.dataset.target;
                const container = document.getElementById(targetId);
                if (container && confirm('Vymazať celú túto sekciu?')) {
                    container.querySelectorAll('input').forEach(input => input.value = '');
                    calculateBudgetTotals();
                }
            }
        });
    }

    // Aktivácia exportných tlačidiel (PDF / Excel)
    setupBudgetExportEvents(db, getUserCallback);
}

// --- 2. Logika Výpočtov a Načítania dát ---

export function loadBudget(user, db) {
    const monthInput = document.getElementById('budgetMonthSelect');
    if (monthInput) loadBudgetForMonth(user, db, monthInput.value);
}

function calculateBudgetTotals() {
    const sumInputs = (sel) => {
        let s = 0; 
        document.querySelectorAll(sel).forEach(i => s += (parseFloat(i.value) || 0)); 
        return s;
    };

    const inc = sumInputs('input.income');
    const hou = sumInputs('input.housing');
    const oth = sumInputs('input.other');
    
    const updateText = (id, val, colorClass = '') => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = val.toFixed(2) + ' €';
            if (colorClass) el.className = colorClass;
        }
    };

    updateText('totalBudgetIncome', inc, 'text-success');
    updateText('totalHousing', hou, 'text-primary');
    updateText('totalOther', oth, 'text-warning');
    
    const totalExpenses = hou + oth;
    updateText('totalBudgetExpenses', totalExpenses);

    const balance = inc - totalExpenses;
    const balanceEl = document.getElementById('totalBudgetBalance');
    if (balanceEl) {
        balanceEl.textContent = balance.toFixed(2) + ' €';
        balanceEl.classList.toggle('text-danger', balance < 0);
        balanceEl.classList.toggle('text-success', balance >= 0);
    }
}

async function loadBudgetForMonth(user, db, yearMonth) {
    const allInputs = document.querySelectorAll('.budget-table input');
    allInputs.forEach(input => input.value = '');
    document.getElementById('budgetStatus').textContent = '';

    try {
        const docSnap = await getDoc(doc(db, 'budgets', `${user.uid}_${yearMonth}`));
        if (docSnap.exists()) {
            const data = docSnap.data();
            allInputs.forEach(input => {
                const field = input.dataset.field;
                if (field && data[field] !== undefined) input.value = data[field];
            });
        }
        calculateBudgetTotals();
    } catch (error) {
        console.error("Chyba načítania rozpočtu:", error);
    }
}

async function saveAllBudget(user, db, yearMonth) {
    const statusElem = document.getElementById('budgetStatus');
    statusElem.textContent = 'Ukladám...';
    statusElem.className = 'text-warning';

    const budgetData = { uid: user.uid, updatedAt: new Date() };
    document.querySelectorAll('.budget-table input').forEach(input => {
        const field = input.dataset.field;
        if (field) budgetData[field] = input.value === '' ? 0 : parseFloat(input.value);
    });

    try {
        await setDoc(doc(db, 'budgets', `${user.uid}_${yearMonth}`), budgetData, { merge: true });
        statusElem.textContent = 'Uložené ✓';
        statusElem.className = 'text-success';
        setTimeout(() => { if(statusElem.textContent.includes('Uložené')) statusElem.textContent=''; }, 3000);
    } catch (error) {
        statusElem.textContent = 'Chyba!';
        statusElem.className = 'text-danger';
    }
}

// --- 3. Univerzálne výberové okno (Kopírovanie / Export) ---

function openSelectionModal(currentDateValue, user, db, mode = "copy") {
    const modal = document.getElementById('copyModal');
    const grid = document.getElementById('monthsGrid');
    const title = modal.querySelector('h3');
    const [sourceYear] = currentDateValue.split('-');
    let selectedTargetYear = parseInt(sourceYear);

    title.textContent = mode === "copy" ? "Kopírovať údaje" : "Export vybraných mesiacov";

    const renderMonths = (year) => {
        grid.innerHTML = '';
        MONTH_NAMES.forEach((name, index) => {
            const monthNum = String(index + 1).padStart(2, '0');
            const fullDate = `${year}-${monthNum}`;
            const isCurrentSource = fullDate === currentDateValue;

            const div = document.createElement('div');
            div.className = 'month-copy-item';
            div.style.cssText = `display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem; border: 1px solid var(--border); border-radius: 0.5rem; cursor: pointer;`;
            
            // Pri kopírovaní zakážeme výber aktuálneho mesiaca
            if (isCurrentSource && mode === "copy") {
                div.style.opacity = '0.4'; div.style.pointerEvents = 'none'; div.style.background = '#f1f5f9';
            }

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = fullDate;
            checkbox.className = 'month-copy-checkbox';
            if (isCurrentSource && mode === "copy") checkbox.disabled = true;

            const label = document.createElement('span');
            label.textContent = name;
            div.append(checkbox, label);
            grid.appendChild(div);

            div.addEventListener('click', (e) => { if (e.target !== checkbox) checkbox.checked = !checkbox.checked; });
        });
    };

    const existingYearSelector = modal.querySelector('.year-selector-container');
    if (existingYearSelector) existingYearSelector.remove();

    const yearSelectorWrap = document.createElement('div');
    yearSelectorWrap.className = 'year-selector-container';
    yearSelectorWrap.style.margin = '1rem 0';
    yearSelectorWrap.innerHTML = `
        <label style="font-size: 0.75rem; font-weight: bold; color: var(--text-muted); display: block; margin-bottom: 5px;">VYBRAŤ ROK</label>
        <select id="copyYearSelect" class="no-icon" style="width: 100%; padding: 8px; font-weight: bold; border: 1px solid var(--primary);">
            <option value="${selectedTargetYear}">${selectedTargetYear}</option>
            <option value="${selectedTargetYear + 1}">${selectedTargetYear + 1}</option>
            <option value="${selectedTargetYear - 1}">${selectedTargetYear - 1}</option>
        </select>`;
    grid.before(yearSelectorWrap);

    document.getElementById('copyYearSelect').addEventListener('change', (e) => {
        selectedTargetYear = parseInt(e.target.value);
        renderMonths(selectedTargetYear);
    });

    renderMonths(selectedTargetYear);
    modal.style.display = 'flex';

    const confirmBtn = document.getElementById('btnConfirmCopy');
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    
    newConfirm.addEventListener('click', () => {
        if (mode === "copy") {
            performCopy(user, db);
        } else {
            const checkboxes = document.querySelectorAll('.month-copy-checkbox:checked');
            const targetMonths = Array.from(checkboxes).map(cb => cb.value);
            if (targetMonths.length === 0) return showToast("Vyberte aspoň jeden mesiac", "warning");
            
            exportSpecificMonthsExcel(user, db, targetMonths);
            modal.style.display = 'none';
        }
    });
    
    document.getElementById('btnCloseModal').onclick = () => { modal.style.display = 'none'; yearSelectorWrap.remove(); };
}

async function performCopy(user, db) {
    const checkboxes = document.querySelectorAll('.month-copy-checkbox:checked');
    const targetMonths = Array.from(checkboxes).map(cb => cb.value);
    if (targetMonths.length === 0) return showToast("Vyberte aspoň jeden mesiac", "warning");

    const dataToCopy = { uid: user.uid, updatedAt: new Date() };
    let hasData = false;
    document.querySelectorAll('.budget-table input').forEach(input => {
        const field = input.dataset.field;
        if (field && input.value !== '') { dataToCopy[field] = parseFloat(input.value); hasData = true; }
    });

    if (!hasData) return showToast("Aktuálny mesiac je prázdny", "danger");

    try {
        const promises = targetMonths.map(targetDate => setDoc(doc(db, 'budgets', `${user.uid}_${targetDate}`), dataToCopy, { merge: true }));
        await Promise.all(promises);
        showToast(`Úspešne skopírované do ${targetMonths.length} mesiacov`, "success");
        document.getElementById('copyModal').style.display = 'none';
    } catch (error) {
        showToast("Chyba pri kopírovaní", "danger");
    }
}

// --- 4. Logika Exportov (PDF / Excel) ---

function setupBudgetExportEvents(db, getUserCallback) {
    // PDF Export
    document.getElementById('btnExportBudgetPdf')?.addEventListener('click', () => {
        const month = document.getElementById('budgetMonthSelect').value;
        const income = gatherSectionData('.income');
        const housing = gatherSectionData('.housing');
        const other = gatherSectionData('.other');

        const docDefinition = {
            content: [
                { text: `MESAČNÝ ROZPOČET: ${month}`, style: 'header' },
                { text: '\n' },
                renderPdfTable('PRÍJMY', income, '#ecfdf5'),
                { text: '\n' },
                renderPdfTable('BÝVANIE', housing, '#eff6ff'),
                { text: '\n' },
                renderPdfTable('OSTATNÉ', other, '#fff7ed'),
                { text: `\nCELKOVÝ ZOSTATOK: ${document.getElementById('totalBudgetBalance').textContent}`, style: 'summary' }
            ],
            styles: {
                header: { fontSize: 18, bold: true, color: '#2563eb' },
                sectionHeader: { fontSize: 12, bold: true, margin: [0, 5, 0, 5] },
                summary: { fontSize: 14, bold: true, alignment: 'right', margin: [0, 20, 0, 0] }
            }
        };
        pdfMake.createPdf(docDefinition).download(`Rozpocet_${month}.pdf`);
    });

    // Excel Export
    document.getElementById('btnExportBudgetExcel')?.addEventListener('click', () => {
        const user = getUserCallback();
        if (!user) return;
        const monthInput = document.getElementById('budgetMonthSelect').value;
        openSelectionModal(monthInput, user, db, "export");
    });
}

async function exportSpecificMonthsExcel(user, db, selectedMonths) {
    try {
        showToast("Pripravujem export...", "warning");
        const categories = [
            { field: 'inc_salary', label: 'Príjem: Zamestnanie' },
            { field: 'inc_pension', label: 'Príjem: Dôchodok' },
            { field: 'inc_rent', label: 'Príjem: Prenájom' },
            { field: 'exp_flat', label: 'Bývanie: Byt' },
            { field: 'exp_fund', label: 'Bývanie: Fond opráv' },
            { field: 'exp_electric', label: 'Bývanie: Elektrina' },
            { field: 'exp_rtvs', label: 'Bývanie: RTVS/4ka' },
            { field: 'exp_internet', label: 'Bývanie: Internet' },
            { field: 'exp_mobile', label: 'Bývanie: Radosť/Tel.' },
            { field: 'exp_youtube', label: 'Bývanie: YT Stream' },
            { field: 'exp_mortgage', label: 'Bývanie: Hypotéka' },
            { field: 'exp_bank', label: 'Bývanie: Banka' },
            { field: 'oth_school', label: 'Ostatné: Emmka škola' },
            { field: 'oth_alimony', label: 'Ostatné: Výživné' },
            { field: 'oth_pocket', label: 'Ostatné: Vreckové' },
            { field: 'oth_horses', label: 'Ostatné: Kone' },
            { field: 'oth_rent', label: 'Ostatné: Podnájom' },
            { field: 'oth_invest', label: 'Ostatné: Investície' },
            { field: 'oth_insurance', label: 'Ostatné: Poistenie' },
            { field: 'oth_misc', label: 'Ostatné: Iné' }
        ];

        const budgetDocs = {};
        for (const monthId of selectedMonths) {
            const snap = await getDoc(doc(db, 'budgets', `${user.uid}_${monthId}`));
            if (snap.exists()) budgetDocs[monthId] = snap.data();
        }

        // Tvorba riadkov tabuľky
        const rows = categories.map(cat => {
            const row = { "Kategória": cat.label };
            selectedMonths.forEach(monthId => {
                // Získanie názvu mesiaca namiesto ID (napr. "Január")
                const monthIndex = parseInt(monthId.split('-')[1]) - 1;
                const year = monthId.split('-')[0];
                const headerName = `${MONTH_NAMES[monthIndex]} ${year}`;
                row[headerName] = budgetDocs[monthId]?.[cat.field] || 0;
            });
            return row;
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Výber mesiacov");

        // Nastavenie šírky stĺpcov (Prvý stĺpec 19, ostatné 12)
        ws['!cols'] = [
            { wch: 19 },
            ...selectedMonths.map(() => ({ wch: 14 }))
        ];

        XLSX.writeFile(wb, `Export_Rozpocet.xlsx`);
        showToast("Export dokončený", "success");
    } catch (error) {
        console.error(error);
        showToast("Chyba exportu", "danger");
    }
}

function gatherSectionData(inputClass) {
    const rows = [];
    document.querySelectorAll(inputClass).forEach(input => {
        const val = parseFloat(input.value) || 0;
        if (val !== 0) rows.push([input.closest('tr').cells[0].textContent.trim(), val.toFixed(2) + ' €']);
    });
    return rows;
}

function renderPdfTable(title, data, bgColor) {
    return [
        { text: title, style: 'sectionHeader' },
        {
            table: { widths: ['*', 'auto'], body: data.length > 0 ? data : [['Žiadne záznamy', '0.00 €']] },
            layout: { fillColor: (rowIndex) => (rowIndex === null) ? bgColor : null, hLineColor: () => '#eeeeee', vLineColor: () => '#eeeeee' }
        }
    ];
}