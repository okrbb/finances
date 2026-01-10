// js/views/dashboard.js
import { updateElement, calculateTaxStats } from '../utils.js';

export function renderDashboard(transactions, config) {
    const stats = calculateTaxStats(transactions, config);
    
    updateElement('summaryIncome', stats.income);
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
    
    // Nové elementy pre detail prenájmu izby
    updateElement('rentBruttoIncome', stats.rentIncome);
    updateElement('rentExemption', stats.rentExemptionAmount);
    updateElement('rentTaxableIncome', stats.taxableRentIncome);
    updateElement('rentDeductibleExpenses', stats.deductibleRentExpenses);
    updateElement('rentNetIncome', stats.taxBaseRent);
    
    // Daň z prenájmu s podmienečným zobrazením farby
    const rentTaxElem = document.getElementById('rentTax');
    if (rentTaxElem) {
        rentTaxElem.textContent = stats.rentTax.toFixed(2) + ' €';
        // Červená pre nedoplatok (pozitívna hodnota), zelená pre preplatok (negatívna)
        if (stats.rentTax > 0) {
            rentTaxElem.style.color = '#ef4444'; // danger red
            rentTaxElem.style.fontWeight = '700';
        } else {
            rentTaxElem.style.color = '#10b981'; // success green
            rentTaxElem.style.fontWeight = '700';
        }
    }
    
    const taxLabel = document.getElementById('taxLabel');
    const taxValueElem = document.getElementById('taxToPay');
    
    if (taxLabel && taxValueElem) {
        const taxRow = taxLabel.parentElement;
        if (stats.taxToPay < 0) {
            taxLabel.textContent = "DAŇOVÝ PREPLATOK:";
            taxValueElem.textContent = Math.abs(stats.taxToPay).toFixed(2) + ' €';
            taxRow.classList.add('preplatok');
            taxValueElem.classList.remove('danger', 'positive'); 
        } else {
            taxLabel.textContent = "DAŇ NA ÚHRADU:";
            taxValueElem.textContent = stats.taxToPay.toFixed(2) + ' €';
            taxRow.classList.remove('preplatok');
            taxValueElem.classList.add('danger');
        }
    }
}