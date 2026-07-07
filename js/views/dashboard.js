// js/views/dashboard.js
import { updateElement, calculateTaxStats, formatCurrencySK, formatNumberSK } from '../utils.js';

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
}