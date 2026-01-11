// js/views/yearClosure.js
// UI a logika pre uzavretie roka

import { 
    validateYearClosure, 
    closeYear, 
    exportYearReport 
} from '../yearManager.js';
import { showToast } from '../notifications.js';
import { calculateTaxStats } from '../utils.js';

let validationResults = null;

/**
 * Inicializácia Year Closure view
 */
export function initYearClosure(db, getUserCallback, getActiveYearCallback) {
    const btnValidate = document.getElementById('btnValidateYear');
    const btnExportReport = document.getElementById('btnExportYearReport');
    const btnExportBackup = document.getElementById('btnExportYearBackup');
    const btnCloseYear = document.getElementById('btnCloseYear');
    
    // NOVÉ: Nastaviť rok v labeloch
    updateYearLabels(getActiveYearCallback());
    
    // Validácia
    if (btnValidate) {
        btnValidate.addEventListener('click', async () => {
            const user = getUserCallback();
            const year = getActiveYearCallback();
            
            if (!user) return;
            
            btnValidate.disabled = true;
            btnValidate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Kontrolujem...';
            
            try {
                validationResults = await validateYearClosure(year, user, db);
                renderValidationResults(validationResults);
                
                // Povoliť/zakázať uzavretie podľa výsledkov
                if (validationResults.valid) {
                    btnCloseYear.disabled = false;
                } else {
                    btnCloseYear.disabled = true;
                }
                
                showToast("Kontrola dokončená", "success");
            } catch (error) {
                showToast("Chyba pri kontrole: " + error.message, "danger");
            } finally {
                btnValidate.disabled = false;
                btnValidate.innerHTML = '<i class="fa-solid fa-check-circle"></i> Spustiť kontrolu';
            }
        });
    }
    
    // Export reportu
    if (btnExportReport) {
        btnExportReport.addEventListener('click', async () => {
            const user = getUserCallback();
            const year = getActiveYearCallback();
            
            if (!user) return;
            
            try {
                showToast("Pripravujem report...", "warning");
                
                const reportData = await exportYearReport(year, user, db);
                
                // Stiahnuť ako PDF (používame pdfMake)
                await generatePdfReport(reportData);
                
                showToast("Report úspešne exportovaný", "success");
            } catch (error) {
                showToast("Chyba pri exporte: " + error.message, "danger");
            }
        });
    }
    
    // Export zálohy
    if (btnExportBackup) {
        btnExportBackup.addEventListener('click', async () => {
            const user = getUserCallback();
            const year = getActiveYearCallback();
            
            if (!user) return;
            
            try {
                showToast("Pripravujem zálohu...", "warning");
                
                const exportData = await exportYearReport(year, user, db);
                
                // Stiahnuť ako JSON
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
                    type: 'application/json' 
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Zaloha_${year}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showToast("Záloha úspešne stiahnutá", "success");
            } catch (error) {
                showToast("Chyba pri zálohovaní: " + error.message, "danger");
            }
        });
    }
    
    // Uzavretie roka
    if (btnCloseYear) {
        btnCloseYear.addEventListener('click', async () => {
            const user = getUserCallback();
            const year = getActiveYearCallback();
            
            if (!user) return;
            
            // Potvrdenie
            const confirmed = await showConfirmDialog(year);
            if (!confirmed) return;
            
            btnCloseYear.disabled = true;
            btnCloseYear.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uzatváranie...';
            
            try {
                const result = await closeYear(year, user, db);
                
                if (result.success) {
                    await showSuccessDialog(year, result.newActiveYear);
                    
                    // Reload aplikácie pre nový rok
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                }
            } catch (error) {
                showToast("Chyba pri uzatváraní: " + error.message, "danger");
                btnCloseYear.disabled = false;
                btnCloseYear.innerHTML = '<i class="fa-solid fa-lock"></i> Uzavrieť rok ' + year;
            }
        });
    }
}

/**
 * Vykresliť výsledky validácie
 */
function renderValidationResults(results) {
    const container = document.getElementById('validationResults');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Celkový stav
    const statusCard = document.createElement('div');
    statusCard.className = `validation-status ${results.valid ? 'valid' : 'invalid'}`;
    statusCard.innerHTML = `
        <i class="fa-solid fa-${results.valid ? 'check-circle' : 'exclamation-triangle'}"></i>
        <h3>${results.valid ? 'Rok je pripravený na uzavretie' : 'Nájdené problémy'}</h3>
    `;
    container.appendChild(statusCard);
    
    // Chyby
    if (results.errors.length > 0) {
        const errorsCard = document.createElement('div');
        errorsCard.className = 'validation-card errors';
        errorsCard.innerHTML = `
            <h4><i class="fa-solid fa-times-circle"></i> Chyby (${results.errors.length})</h4>
            <ul>
                ${results.errors.map(err => `<li>${err}</li>`).join('')}
            </ul>
        `;
        container.appendChild(errorsCard);
    }
    
    // Upozornenia
    if (results.warnings.length > 0) {
        const warningsCard = document.createElement('div');
        warningsCard.className = 'validation-card warnings';
        warningsCard.innerHTML = `
            <h4><i class="fa-solid fa-exclamation-triangle"></i> Upozornenia (${results.warnings.length})</h4>
            <ul>
                ${results.warnings.map(warn => `<li>${warn}</li>`).join('')}
            </ul>
        `;
        container.appendChild(warningsCard);
    }
    
    // Štatistiky
    if (results.stats) {
        const statsCard = document.createElement('div');
        statsCard.className = 'validation-card stats';
        statsCard.innerHTML = `
            <h4><i class="fa-solid fa-chart-bar"></i> Štatistiky</h4>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Transakcie:</span>
                    <span class="stat-value">${results.stats.totalTransactions || 0}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Pokryté mesiace:</span>
                    <span class="stat-value">${results.stats.coveredMonths || 0}/12</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Príjmy:</span>
                    <span class="stat-value positive">${(results.stats.totalIncome || 0).toFixed(2)} €</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Výdavky:</span>
                    <span class="stat-value negative">${(results.stats.totalExpenses || 0).toFixed(2)} €</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Bilancia:</span>
                    <span class="stat-value ${results.stats.balance > 0 ? 'positive' : 'negative'}">
                        ${(results.stats.balance || 0).toFixed(2)} €
                    </span>
                </div>
            </div>
        `;
        container.appendChild(statsCard);
    }
}

/**
 * Dialóg potvrdenia uzavretia
 */
function showConfirmDialog(year) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content confirm-dialog">
                <div class="modal-header">
                    <h2><i class="fa-solid fa-exclamation-triangle"></i> Potvrdenie uzavretia roka</h2>
                </div>
                <div class="modal-body">
                    <p>Naozaj chcete uzavrieť rok <strong>${year}</strong>?</p>
                    
                    <div class="confirm-points">
                        <div class="confirm-point">
                            <i class="fa-solid fa-check-circle"></i>
                            <span>Všetky transakcie za rok ${year} budú označené ako archívne</span>
                        </div>
                        <div class="confirm-point">
                            <i class="fa-solid fa-check-circle"></i>
                            <span>Vytvorí sa nový prázdny rok ${year + 1}</span>
                        </div>
                        <div class="confirm-point">
                            <i class="fa-solid fa-check-circle"></i>
                            <span>Nastavenia sa prekopírujú</span>
                        </div>
                        <div class="confirm-point warning">
                            <i class="fa-solid fa-times-circle"></i>
                            <span>Túto akciu NEMOŽNO vrátiť späť</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="btnCancelClose" class="btn btn-secondary">
                        <i class="fa-solid fa-times"></i> Zrušiť
                    </button>
                    <button id="btnConfirmClose" class="btn btn-danger">
                        <i class="fa-solid fa-lock"></i> Áno, uzavrieť rok
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('btnCancelClose').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(false);
        });
        
        document.getElementById('btnConfirmClose').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(true);
        });
    });
}

/**
 * Dialóg úspechu
 */
function showSuccessDialog(oldYear, newYear) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content success-dialog">
                <div class="modal-header success">
                    <h2><i class="fa-solid fa-check-circle"></i> Rok ${oldYear} úspešne uzavretý</h2>
                </div>
                <div class="modal-body">
                    <div class="success-message">
                        <i class="fa-solid fa-party-horn"></i>
                        <h3>Vitajte v roku ${newYear}!</h3>
                    </div>
                    
                    <div class="success-points">
                        <div class="success-point">
                            <i class="fa-solid fa-check"></i>
                            <span>Rok ${oldYear} je teraz v archíve</span>
                        </div>
                        <div class="success-point">
                            <i class="fa-solid fa-check"></i>
                            <span>Začínate s čistým rokom ${newYear}</span>
                        </div>
                        <div class="success-point">
                            <i class="fa-solid fa-check"></i>
                            <span>Finálny report bol vytvorený</span>
                        </div>
                    </div>
                    
                    <p class="note">
                        <i class="fa-solid fa-info-circle"></i>
                        Archívne dáta z roku ${oldYear} si môžete pozrieť kedykoľvek
                    </p>
                    
                    <p class="reload-note">Aplikácia sa o chvíľu obnoví...</p>
                </div>
                <div class="modal-footer">
                    <button id="btnCloseSuccess" class="btn btn-primary">
                        <i class="fa-solid fa-check"></i> OK
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('btnCloseSuccess').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(true);
        });
    });
}

/**
 * Generovať PDF report
 */
async function generatePdfReport(data) {
    if (typeof pdfMake === 'undefined') {
        throw new Error("pdfMake nie je dostupný");
    }
    
    const docDefinition = {
        content: [
            {
                text: `FINÁLNY REPORT ZA ROK ${data.year}`,
                style: 'header',
                margin: [0, 0, 0, 20]
            },
            {
                text: `Daňovník: ${data.userName || data.userEmail}`,
                margin: [0, 0, 0, 10]
            },
            {
                text: `Exportované: ${new Date(data.exportedAt).toLocaleString('sk-SK')}`,
                style: 'subheader',
                margin: [0, 0, 0, 20]
            },
            {
                text: 'SÚHRN',
                style: 'sectionHeader'
            },
            {
                table: {
                    widths: ['*', 'auto'],
                    body: [
                        ['Celkový počet transakcií', data.summary.totalTransactions],
                        ['Príjmy', `${data.summary.totalIncome.toFixed(2)} €`],
                        ['Výdavky', `${data.summary.totalExpenses.toFixed(2)} €`],
                        [
                            { text: 'Bilancia', bold: true }, 
                            { 
                                text: `${(data.summary.totalIncome - data.summary.totalExpenses).toFixed(2)} €`, 
                                bold: true 
                            }
                        ]
                    ]
                },
                margin: [0, 10, 0, 20]
            }
        ],
        styles: {
            header: {
                fontSize: 18,
                bold: true,
                alignment: 'center'
            },
            subheader: {
                fontSize: 12,
                color: '#666'
            },
            sectionHeader: {
                fontSize: 14,
                bold: true,
                margin: [0, 10, 0, 5]
            }
        }
    };
    
    pdfMake.createPdf(docDefinition).download(`Finalny_Report_${data.year}.pdf`);
}

/**
 * Aktualizovať rok v labeloch Year Closure view
 */
/**
 * Aktualizovať labely s rokom
 */
function updateYearLabels(year) {
    const closureYearLabel = document.getElementById('closureYearLabel');
    const yearToClose = document.getElementById('yearToClose');
    const nextYear = document.getElementById('nextYear');
    const yearToCloseBtn = document.getElementById('yearToCloseBtn');
    
    if (closureYearLabel) closureYearLabel.textContent = year;
    if (yearToClose) yearToClose.textContent = year;
    if (nextYear) nextYear.textContent = year + 1;
    if (yearToCloseBtn) yearToCloseBtn.textContent = year;
}

// Export funkcie pre použitie v app.js
export { updateYearLabels };
