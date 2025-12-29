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