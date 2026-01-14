// js/utils.js

// === LOADING STATES ===

/**
 * Zobrazí loading overlay
 */
export function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

/**
 * Skryje loading overlay
 */
export function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// === CONFIRMATION DIALOG ===

/**
 * Zobrazí potvrdzovacie okno (async)
 * @param {string} message - Správa na zobrazenie
 * @param {string} title - Titulok okna (voliteľný)
 * @returns {Promise<boolean>} - true ak používateľ potvrdí, false ak zruší
 */
export function confirmAction(message, title = "Potvrdenie") {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        
        if (!modal) {
            // Fallback na natívny confirm ak modal neexistuje
            resolve(confirm(message));
            return;
        }
        
        // Nastaviť text
        titleEl.textContent = title;
        messageEl.textContent = message;
        
        // Zobraziť modal
        modal.style.display = 'flex';
        
        // Handler pre OK
        const handleOk = () => {
            cleanup();
            resolve(true);
        };
        
        // Handler pre Cancel
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };
        
        // Cleanup funkcia
        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };
        
        // Pridať event listenery
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

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

// === VALIDATION FUNCTIONS ===

/**
 * Validácia dátumu
 */
export function validateDate(dateString, activeYear, allowFuture = false) {
    if (!dateString) {
        return { valid: false, error: "Dátum je povinný" };
    }
    
    const date = new Date(dateString);
    const now = new Date();
    
    // Kontrola validity dátumu
    if (isNaN(date.getTime())) {
        return { valid: false, error: "Neplatný dátum" };
    }
    
    // Kontrola rozumnosti (nie staršie ako rok 2000)
    if (date.getFullYear() < 2000) {
        return { valid: false, error: "Dátum je príliš starý" };
    }
    
    // Kontrola budúcnosti
    if (!allowFuture && date > now) {
        return { valid: false, error: "Dátum nemôže byť v budúcnosti" };
    }
    
    // Kontrola roka - dátum musí patriť do aktívneho roka
    if (activeYear && date.getFullYear() !== activeYear) {
        return { valid: false, error: `Dátum musí byť z roka ${activeYear}` };
    }
    
    return { valid: true };
}

/**
 * Validácia sumy
 */
export function validateAmount(amount) {
    if (amount === null || amount === undefined || amount === '') {
        return { valid: false, error: "Suma je povinná" };
    }
    
    const num = parseFloat(amount);
    
    if (isNaN(num)) {
        return { valid: false, error: "Suma musí byť číslo" };
    }
    
    if (num <= 0) {
        return { valid: false, error: "Suma musí byť väčšia ako 0" };
    }
    
    if (num > 1000000) {
        return { valid: false, error: "Suma je príliš vysoká" };
    }
    
    return { valid: true, value: num };
}

/**
 * Validácia DIČ (Slovensko)
 */
export function validateDIC(dic) {
    if (!dic) {
        return { valid: true }; // DIČ je voliteľné
    }
    
    // SK + 10 číslic
    const dicPattern = /^SK\d{10}$/;
    
    if (!dicPattern.test(dic)) {
        return { valid: false, error: "DIČ musí byť vo formáte SK + 10 číslic (napr. SK1234567890)" };
    }
    
    return { valid: true };
}

/**
 * Validácia IBAN (Slovensko)
 */
export function validateIBAN(iban) {
    if (!iban) {
        return { valid: true }; // IBAN je voliteľný
    }
    
    // Odstránenie medzier
    const cleanIBAN = iban.replace(/\s/g, '');
    
    // SK + 2 kontrolné číslice + 20 znakov
    const ibanPattern = /^SK\d{22}$/;
    
    if (!ibanPattern.test(cleanIBAN)) {
        return { valid: false, error: "IBAN musí byť vo formáte SK + 22 číslic" };
    }
    
    return { valid: true, value: cleanIBAN };
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
    let transportAllowance = 0; // Príspevok na dopravu (nezdaniteľný)

    transactions.forEach(tx => {
        const amount = tx.amount || 0;
        const category = (tx.category || '').toLowerCase();
        
        if (tx.type === 'Príjem') {
            if (category.includes('prenájom')) {
                rentIncome += amount;
            } else if (category.includes('dôchodok')) {
                pension += amount;
            } else if (category.includes('príspevok na dopravu')) {
                transportAllowance += amount; // Nezdaniteľný príjem
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

    const totalRealIncome = rentIncome + income + pension + transportAllowance;
    const profitBeforeTax = totalRealIncome - expenses;

    return {
        income, rentIncome, expenses, rentExpenses, pension, insurance, taxAdvance, dds,
        transportAllowance, // Nový údaj pre zobrazenie
        taxBaseRent, taxBaseIncome: partialTaxBaseWage, taxBase: finalTaxBase,
        profitBeforeTax, taxToPay,
        // Nové údaje pre detail prenájmu izby
        rentExemptionAmount: RENT_EXEMPTION,
        taxableRentIncome,
        deductibleRentExpenses,
        rentTax
    };
}