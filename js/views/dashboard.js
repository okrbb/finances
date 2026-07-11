// js/views/dashboard.js
import { updateElement, calculateTaxStats, formatCurrencySK, formatNumberSK } from '../utils.js';

const RECURRING_PANEL_STORAGE_KEY = 'finances_recurring_panel_collapsed';

export function renderDashboard(transactions, config) {
    const stats = calculateTaxStats(transactions, config);
    
    // DEBUG: Zobraziť príjmy z prenájmu
    console.log("🏠 Príjmy z prenájmu:", stats.rentIncome);
    const rentTransactions = transactions.filter(tx => 
        tx.type === 'Príjem' && (tx.category || '').toLowerCase().includes('prenájom')
    );
    console.log("📋 Transakcie z prenájmu:", rentTransactions);
    
    updateElement('summaryIncome', stats.income + stats.transportAllowance);
    updateElement('summaryRent', stats.rentIncome);
    updateElement('summaryExpenses', stats.rentExpenses);
    updateElement('summaryPension', stats.pension);
    updateElement('summaryInsurance', stats.insurance);
    updateElement('summaryTaxAdvance', stats.taxAdvance);
    updateElement('summaryDDS', stats.dds);
    updateElement('taxBaseRent', stats.taxBaseRent);
    updateElement('taxBaseIncome', stats.taxBaseIncome);
    updateElement('taxBase', stats.taxBase);
    updateElement('profitBeforeTax', stats.profitBeforeTax);
    updateElement('employmentTax', stats.employmentTax);
    updateElement('monthlyTaxReserve', stats.monthlyTaxReserve);
    
    // Nové elementy pre detail prenájmu izby
    updateElement('rentBruttoIncome', stats.rentIncome);
    updateElement('rentExemption', stats.rentExemptionAmount);
    updateElement('rentTaxableIncome', stats.taxableRentIncome);
    updateElement('rentDeductibleExpenses', stats.deductibleRentExpenses);
    updateElement('rentNetIncome', stats.taxBaseRent);
    
    // Daň z prenájmu s podmienečným zobrazením farby
    const rentTaxElem = document.getElementById('rentTax');
    if (rentTaxElem) {
        rentTaxElem.textContent = formatCurrencySK(stats.rentTax);
        // Červená pre nedoplatok (pozitívna hodnota), zelená pre preplatok (negatívna)
        if (stats.rentTax > 0) {
            rentTaxElem.style.color = '#ef4444'; // danger red
            rentTaxElem.style.fontWeight = '700';
        } else {
            rentTaxElem.style.color = '#10b981'; // success green
            rentTaxElem.style.fontWeight = '700';
        }
    }

    const effectiveTaxRateElem = document.getElementById('effectiveTaxRate');
    if (effectiveTaxRateElem) {
        effectiveTaxRateElem.textContent = formatNumberSK(stats.effectiveTaxRate) + ' %';
    }
    
    const taxLabel = document.getElementById('taxLabel');
    const taxValueElem = document.getElementById('taxToPay');
    
    if (taxLabel && taxValueElem) {
        const taxRow = taxLabel.parentElement;
        const taxMirrorElem = document.getElementById('taxToPayMirror');
        if (stats.taxToPay < 0) {
            taxLabel.textContent = "DAŇOVÝ PREPLATOK:";
            taxValueElem.textContent = formatCurrencySK(Math.abs(stats.taxToPay));
            if (taxMirrorElem) taxMirrorElem.textContent = formatCurrencySK(Math.abs(stats.taxToPay));
            taxRow.classList.add('preplatok');
            taxValueElem.classList.remove('danger', 'positive'); 
        } else {
            taxLabel.textContent = "DAŇ NA ÚHRADU:";
            taxValueElem.textContent = formatCurrencySK(stats.taxToPay);
            if (taxMirrorElem) taxMirrorElem.textContent = formatCurrencySK(stats.taxToPay);
            taxRow.classList.remove('preplatok');
            taxValueElem.classList.add('danger');
        }
    }

    renderRecurringPaymentsCard(transactions);
    setupRecurringPaymentsToggle();
}

function setupRecurringPaymentsToggle() {
    const panel = document.getElementById('recurringPaymentsPanel');
    const content = document.getElementById('recurringPaymentsSummary');
    const button = document.getElementById('toggleRecurringPaymentsBtn');
    if (!panel || !content || !button) return;

    const applyState = (collapsed) => {
        panel.classList.toggle('is-collapsed', collapsed);
        content.classList.toggle('hidden', collapsed);
        button.setAttribute('aria-expanded', String(!collapsed));
        const label = button.querySelector('span');
        const icon = button.querySelector('i');
        if (label) label.textContent = collapsed ? 'Rozbaliť' : 'Zbaliť';
        if (icon) {
            icon.classList.toggle('fa-chevron-up', !collapsed);
            icon.classList.toggle('fa-chevron-down', collapsed);
        }
    };

    applyState(localStorage.getItem(RECURRING_PANEL_STORAGE_KEY) === '1');

    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
        const collapsed = !panel.classList.contains('is-collapsed');
        localStorage.setItem(RECURRING_PANEL_STORAGE_KEY, collapsed ? '1' : '0');
        applyState(collapsed);
    });
}

function renderRecurringPaymentsCard(transactions) {
    const container = document.getElementById('recurringPaymentsSummary');
    if (!container) return;

    const recurring = detectRecurringTransactions(transactions);
    if (recurring.length === 0) {
        container.innerHTML = '<div class="recurring-payments-empty">Zatiaľ nie sú vyhodnotené pravidelné platby.</div>';
        return;
    }

    container.innerHTML = recurring.map((item) => `
        <article class="recurring-payment-item ${item.missing ? 'missing' : ''}">
            <div class="recurring-payment-head">
                <strong>${item.label}</strong>
                ${item.missing ? '<span class="recurring-payment-status">Chýba</span>' : ''}
            </div>
            <div class="recurring-payment-meta">${item.type} • priemer ${formatCurrencySK(item.average)} • výskyty ${item.occurrences}</div>
            <div class="recurring-payment-meta">Naposledy ${item.lastMonth}${item.currentAmount ? ` • tento mesiac ${formatCurrencySK(item.currentAmount)}` : ''}</div>
        </article>
    `).join('');
}

function detectRecurringTransactions(transactions) {
    const grouped = new Map();
    const latestMonth = transactions
        .map((tx) => String(tx.date || '').slice(0, 7))
        .filter(Boolean)
        .sort()
        .pop();

    if (!latestMonth) return [];

    transactions.forEach((tx) => {
        if (!tx?.date || !tx.category || !tx.amount) return;
        const month = String(tx.date).slice(0, 7);
        const noteKey = normalizeRecurringKey(tx.note || tx.category || '');
        const key = `${tx.type}|${tx.category}|${noteKey}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                type: tx.type,
                category: tx.category,
                note: tx.note || tx.category,
                months: new Map(),
                lastMonth: month
            });
        }
        const entry = grouped.get(key);
        entry.lastMonth = month > entry.lastMonth ? month : entry.lastMonth;
        entry.months.set(month, (entry.months.get(month) || 0) + (Number(tx.amount) || 0));
    });

    return Array.from(grouped.values())
        .filter((entry) => entry.months.size >= 3)
        .map((entry) => {
            const values = Array.from(entry.months.values());
            const average = values.reduce((sum, value) => sum + value, 0) / values.length;
            const currentAmount = entry.months.get(latestMonth) || 0;
            const previousMonthKey = shiftMonth(latestMonth, -1);
            const missing = !entry.months.has(latestMonth) && entry.months.has(previousMonthKey);
            return {
                label: `${entry.category} • ${truncateText(entry.note, 28)}`,
                type: entry.type,
                occurrences: entry.months.size,
                average,
                currentAmount,
                missing,
                lastMonth: entry.lastMonth.split('-').reverse().join('/'),
                latestMonth
            };
        })
        .sort((left, right) => {
            if (left.missing !== right.missing) return left.missing ? -1 : 1;
            return right.average - left.average;
        })
        .slice(0, 6);
}

function normalizeRecurringKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\b(januar|január|februar|február|marec|april|apríl|maj|máj|jun|jún|jul|júl|august|september|oktober|október|november|december)\b/g, '')
        .replace(/\d+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30);
}

function shiftMonth(monthKey, offset) {
    const [year, month] = monthKey.split('-').map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function truncateText(value, maxLength) {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}…`;
}