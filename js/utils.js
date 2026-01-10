// js/utils.js

export function updateElement(elementId, value, currency = '€') {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = (value || 0).toFixed(2) + ' ' + currency;
    }
}

export function formatDate(dateString) {
    if (!dateString) return '';
    const d = new Date(dateString);
    return d.toLocaleDateString('sk-SK');
}

// Tu je vaša funkcia calculateTaxStats (extrahovaná)
export function calculateTaxStats(transactions, config = { rentExemption: 500, taxRate: 0.19 }) {
    let income = 0; 
    let rentIncome = 0; 
    let expenses = 0; 
    let rentExpenses = 0; 
    let pension = 0;
    let insurance = 0;
    let taxAdvance = 0;
    let dds = 0;

    transactions.forEach(tx => {
        const amount = tx.amount || 0;
        const category = (tx.category || '').toLowerCase();
        
        if (tx.type === 'Príjem') {
            if (category.includes('prenájom')) {
                rentIncome += amount;
            } else if (category.includes('dôchodok')) {
                pension += amount;
            } else {
                income += amount;
            }
        } else {
            if (category.includes('bytové družstvo') || category.includes('telekom') || category.includes('4ka') || category.includes('zse') || category.includes('msú trnava') || category.includes('vd - iné')) {
                rentExpenses += amount;
            }
            if (category.includes('poistenie')) insurance += amount;
            if (category.includes('preddavok')) taxAdvance += amount;
            if (category.includes('dds')) dds += amount;
            expenses += amount;
        }
    });

    const RENT_EXEMPTION = config.rentExemption;
    let taxableRentIncome = 0;    
    let deductibleRentExpenses = 0;

    if (rentIncome <= RENT_EXEMPTION) {
        taxableRentIncome = 0;
        deductibleRentExpenses = 0;
    } else {
        taxableRentIncome = rentIncome - RENT_EXEMPTION;
        const ratio = rentIncome > 0 ? (taxableRentIncome / rentIncome) : 0;
        deductibleRentExpenses = rentExpenses * ratio;
    }

    const taxBaseRent = taxableRentIncome - deductibleRentExpenses;
    const taxBaseIncome = income; 
    let taxBase = taxBaseRent + taxBaseIncome - dds;
    if (taxBase < 0) taxBase = 0;

    const partialTaxBaseWage = income - insurance; 
    const finalTaxBase = partialTaxBaseWage + taxBaseRent - dds; 
    const taxToPay = (finalTaxBase * config.taxRate) - taxAdvance;

    // Výpočet dane špecificky z prenájmu
    const rentTax = taxBaseRent * config.taxRate;

    const totalRealIncome = rentIncome + income + pension;
    const profitBeforeTax = totalRealIncome - expenses;

    return {
        income, rentIncome, expenses, rentExpenses, pension, insurance, taxAdvance, dds,
        taxBaseRent, taxBaseIncome: partialTaxBaseWage, taxBase: finalTaxBase,
        profitBeforeTax, taxToPay,
        // Nové údaje pre detail prenájmu izby
        rentExemptionAmount: RENT_EXEMPTION,
        taxableRentIncome,
        deductibleRentExpenses,
        rentTax
    };
}