/* js/views/reports.js */
import { formatDate, calculateTaxStats, formatCurrencySK } from '../utils.js';
import { currentYear } from '../app.js';
import { showToast } from '../notifications.js';

let chartInstance = null;
let pieChartInstance = null;

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

// Mapovanie systémových kategórií na čitateľné názvy pre reporty
const categoryMap = {
    "VD - Telekom": "VD - internet",
    "VD - 4ka": "VD - TV",
    "PD - mzda": "Mzda",
    "PD - MV SR": "Mzda",
    "PD - príspevek na dopravu": "Príspevek na dopravu",
    "PD - príspevok na dopravu": "Príspevok na dopravu",
    "PD - prenájom": "Prenájom",
    "PN - výsluhový dôchodok": "Dôchodok",
    "VD - bytové družstvo": "Nájomné (BD)",
    "VD - MsÚ Trnava": "Daň z nehnuteľnosti",
    "VD - ZSE": "Elektrina",
    "VD - poistenie": "Odvody",
    "VD - preddavok na daň": "Preddavok na daň",
    "VD - DDS": "DDS",
    "VD - iné": "Iné výdavky"
};

export function setupReportEvents(db, getTransactionsCallback) {
    // Generovanie a filtre
    document.getElementById('generateReportBtn').addEventListener('click', () => {
        renderReportSkeleton();
        refreshAll(getTransactionsCallback);
    });

    document.querySelectorAll('.report-cat-filter').forEach(cb => {
        cb.addEventListener('change', () => {
            renderReportSkeleton();
            refreshAll(getTransactionsCallback);
        });
    });

    // Prepínanie zobrazenia grafov
    document.getElementById('showChartBtn').addEventListener('click', (e) => {
        const container = document.getElementById('chartContainer');
        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            e.target.textContent = 'Skryť Grafy';
            renderCharts(getTransactionsCallback());
        } else {
            container.classList.add('hidden');
            e.target.textContent = 'Zobraziť Grafy';
        }
    });

    // Export Excel
    document.getElementById('exportExcelBtn').addEventListener('click', () => {
        const transactions = getTransactionsCallback();
        const filtered = filterTransactions(transactions);
        if (filtered.length === 0) {
            showToast("Žiadne dáta na export", "warning");
            return;
        }
        
        showToast("Pripravujem Excel export...", "info");

        const dataForExcel = filtered.map(tx => ({
            Dátum: tx.date ? tx.date.split('-').reverse().join('.') : '',
            Druh: tx.type,
            Kategória: categoryMap[tx.category] || tx.category,
            Poznámka: tx.note || '',
            Suma: parseFloat(tx.amount)
        }));

        const ws = XLSX.utils.json_to_sheet(dataForExcel);
        ws['!cols'] = [{ wch: 13 }, { wch: 9 }, { wch: 27 }, { wch: 27 }, { wch: 9 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Report");
        XLSX.writeFile(wb, `Report_${getFilters().dateFrom}.xlsx`);
        
        showToast("Excel export dokončený", "success");
    });

    // Export Štandardné PDF
    document.getElementById('exportPdfBtn').addEventListener('click', () => {
        const allTransactions = getTransactionsCallback();
        const filteredTx = filterTransactions(allTransactions);
        if (filteredTx.length === 0) {
            showToast("Žiadne dáta na export", "warning");
            return;
        }
        
        showToast("Pripravujem PDF report...", "info");
        exportMonthlyPdfReport(filteredTx);
        showToast("PDF report dokončený", "success");
    });

    // Export PDF pre prenájom
    document.getElementById('exportTaxDraftBtn')?.addEventListener('click', () => {
        const transactions = getTransactionsCallback();
        showToast("Pripravujem PDF prenájom...", "info");
        exportRentPdfReport(transactions);
        showToast("PDF prenájom dokončený", "success");
    });
}

function refreshAll(getTransactionsCallback) {
    const txs = getTransactionsCallback();
    updateReportUI(txs);
    if (!document.getElementById('chartContainer').classList.contains('hidden')) {
        renderCharts(txs);
    }
}

function getFilters() {
    const dateFrom = document.getElementById('reportDateFrom').value;
    const dateTo = document.getElementById('reportDateTo').value;
    const typeFilter = document.getElementById('reportTypeFilter').value;
    const selectedCategories = Array.from(document.querySelectorAll('.report-cat-filter:checked')).map(cb => cb.value);
    return { dateFrom, dateTo, typeFilter, selectedCategories };
}

function filterTransactions(transactions) {
    const { dateFrom, dateTo, typeFilter, selectedCategories } = getFilters();
    return transactions.filter(tx => {
        // Porovnávanie dátumov ako stringy (YYYY-MM-DD formát)
        if (dateFrom && tx.date < dateFrom) return false;
        if (dateTo && tx.date > dateTo) return false;
        
        if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
        if (selectedCategories.length === 0) return false;

        const cat = normalizeText(tx.category);
        let match = false;
        if (selectedCategories.includes('mzda') && (cat.includes('mzda') || cat.includes('mv sr') || cat.includes('prispevok na dopravu') || cat.includes('prispevek na dopravu') || cat.includes('dochodok'))) match = true;
        if (selectedCategories.includes('prenajom') && cat.includes('prenajom')) match = true;
        if (selectedCategories.includes('dane') && (cat.includes('poistenie') || cat.includes('preddavok') || cat.includes('dds'))) match = true;
        if (selectedCategories.includes('byvanie') && (cat.includes('bytove') || cat.includes('msu'))) match = true;
        if (selectedCategories.includes('energie') && (cat.includes('zse') || cat.includes('elektrina'))) match = true;
        if (selectedCategories.includes('tv') && (cat.includes('4ka') || cat.includes('telekom') || cat.includes('internet'))) match = true;
        if (selectedCategories.includes('ine') && cat.includes('ine')) match = true;
        return match;
    }).sort((a, b) => a.date.localeCompare(b.date));
}

function updateReportUI(allTransactions) {
    const filtered = filterTransactions(allTransactions);
    let totalIncome = 0, totalExpense = 0;
    filtered.forEach(tx => tx.type === 'Príjem' ? totalIncome += tx.amount : totalExpense += tx.amount);
    const balance = totalIncome - totalExpense;
    const periodLabel = getReportPeriodLabel();

    let html = `
        <section class="report-summary">
            <header class="report-summary-head">
                <h3>Finančný súhrn</h3>
                <span class="report-summary-period">${periodLabel}</span>
            </header>
            <div class="report-summary-grid">
                <article class="report-kpi income">
                    <span>Príjmy</span>
                    <strong class="report-amount-strong">${formatCurrencySK(totalIncome)}</strong>
                </article>
                <article class="report-kpi expense">
                    <span>Výdavky</span>
                    <strong class="report-amount-strong">${formatCurrencySK(totalExpense)}</strong>
                </article>
                <article class="report-kpi balance ${balance >= 0 ? 'positive' : 'negative'}">
                    <span>Bilancia</span>
                    <strong class="report-amount-strong">${formatCurrencySK(balance)}</strong>
                </article>
            </div>
        </section>`;

    if (filtered.length === 0) {
        html += `
        <div class="table-empty-state report-empty-state">
            <i class="fa-regular fa-chart-bar"></i>
            <h4>V tomto filtri nie sú žiadne dáta</h4>
            <p>Skús upraviť dátum alebo zapnúť ďalšie kategórie.</p>
        </div>`;
        document.getElementById('reportContent').innerHTML = html;
        return;
    }

    html += `<div class="report-table-wrap">
        <table class="report-table">
            <thead>
                <tr><th>Dátum</th><th>Kategória</th><th>Popis</th><th class="text-right">Typ</th><th class="text-right">Suma</th></tr>
            </thead>
            <tbody>`;

    filtered.forEach(tx => {
        const typeClass = tx.type === 'Príjem' ? 'income' : 'expense';
        html += `<tr>
            <td>${formatDate(tx.date)}</td>
            <td><span class="report-category-pill">${categoryMap[tx.category] || tx.category}</span></td>
            <td class="report-note-cell">${tx.note || '-'}</td>
            <td class="text-right"><span class="report-type-pill ${typeClass}">${tx.type}</span></td>
            <td class="text-right report-amount-strong ${typeClass}">${formatCurrencySK(tx.amount)}</td>
        </tr>`;
    });
    document.getElementById('reportContent').innerHTML = html + '</tbody></table></div>';
}

function getReportPeriodLabel() {
    const { dateFrom, dateTo } = getFilters();
    if (dateFrom && dateTo) {
        return `${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
    }
    if (dateFrom && !dateTo) {
        return `Od ${formatDate(dateFrom)}`;
    }
    if (!dateFrom && dateTo) {
        return `Do ${formatDate(dateTo)}`;
    }
    return `Celé obdobie ${currentYear}`;
}

// NOVÉ: Grafy s Drill-down funkcionalitou
function renderCharts(allTransactions) {
    const filtered = filterTransactions(allTransactions);
    const monthlyData = {};
    const darkMode = document.body.classList.contains('dark');
    const axisColor = darkMode ? '#cbd5e1' : '#475569';
    const gridColor = darkMode ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.2)';

    filtered.forEach(tx => {
        const d = new Date(tx.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[key]) monthlyData[key] = { income: 0, expense: 0 };
        tx.type === 'Príjem' ? monthlyData[key].income += tx.amount : monthlyData[key].expense += tx.amount;
    });

    const sortedKeys = Object.keys(monthlyData).sort();
    const labels = sortedKeys.map(k => k.split('-').reverse().join('/'));

    if (chartInstance) chartInstance.destroy();
    const ctx = document.getElementById('reportChart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Príjmy',
                    data: sortedKeys.map(k => monthlyData[k].income),
                    backgroundColor: '#0f766e',
                    borderRadius: 7,
                    maxBarThickness: 26
                },
                {
                    label: 'Výdavky',
                    data: sortedKeys.map(k => monthlyData[k].expense),
                    backgroundColor: '#c2410c',
                    borderRadius: 7,
                    maxBarThickness: 26
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            resizeDelay: 180,
            interaction: {
                mode: 'index',
                intersect: false
            },
            animation: {
                duration: 220
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 14,
                        boxHeight: 14,
                        color: axisColor,
                        usePointStyle: true,
                        pointStyle: 'rectRounded'
                    }
                },
                tooltip: {
                    backgroundColor: darkMode ? 'rgba(15, 23, 42, 0.94)' : 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${formatCurrencySK(context.raw)}`
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: axisColor
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    ticks: {
                        color: axisColor,
                        callback: (value) => formatCurrencySK(value, '').trim()
                    },
                    grid: {
                        color: gridColor
                    }
                }
            },
            onClick: (e, activeEls) => {
                if (activeEls.length > 0) {
                    const index = activeEls[0].index;
                    const [m, y] = labels[index].split('/');
                    document.getElementById('reportDateFrom').value = `${y}-${m}-01`;
                    document.getElementById('reportDateTo').value = new Date(y, m, 0).toISOString().split('T')[0];
                    refreshAll(() => allTransactions);
                }
            }
        }
    });

    renderPieChart(filtered);
}

function renderPieChart(filteredTransactions) {
    const expenses = filteredTransactions.filter(tx => tx.type === 'Výdaj');
    const catData = {};
    const darkMode = document.body.classList.contains('dark');
    const axisColor = darkMode ? '#cbd5e1' : '#475569';

    expenses.forEach(tx => {
        const cat = categoryMap[tx.category] || tx.category || 'Iné';
        catData[cat] = (catData[cat] || 0) + tx.amount;
    });

    if (Object.keys(catData).length === 0) {
        catData['Bez výdavkov'] = 1;
    }

    if (pieChartInstance) pieChartInstance.destroy();
    const ctx = document.getElementById('categoryPieChart').getContext('2d');
    pieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(catData),
            datasets: [{
                data: Object.values(catData),
                borderWidth: 0,
                backgroundColor: ['#0f766e', '#c2410c', '#0891b2', '#84cc16', '#f59e0b', '#64748b', '#14b8a6']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.7,
            resizeDelay: 180,
            cutout: '62%',
            animation: {
                duration: 220
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: axisColor,
                        boxWidth: 12,
                        boxHeight: 12,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: darkMode ? 'rgba(15, 23, 42, 0.94)' : 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: (context) => `${context.label}: ${formatCurrencySK(context.raw)}`
                    }
                }
            }
        }
    });
}

function exportTaxDraftPdf(stats) {
    const userName = document.getElementById('settingsName').value;
    const year = document.getElementById('settingsYear').value;

    const docDefinition = {
        content: [
            { text: `DRAFT PODKLADOV K DAŇOVÉMU PRIZNANIU (${year})`, style: 'header' },
            { text: `Daňovník: ${userName}`, margin: [0, 0, 0, 20] },
            { text: 'TABUĽKA Č. 1: PRÍJMY Z PRENÁJMU (§ 6 ods. 3)', style: 'subheader' },
            {
                table: {
                    widths: ['*', 'auto'],
                    body: [
                        ['Brutto príjmy z prenájmu', `${stats.rentIncome.toFixed(2)} €`],
                        ['Oslobodenie (§ 9 ods. 1 písm. g)', '- 500.00 €'],
                        [{ text: 'Zdaniteľný príjem z prenájmu', bold: true }, { text: `${stats.taxBaseRent.toFixed(2)} €`, bold: true }]
                    ]
                }
            },
            { text: '\nSÚHRN PRE TYP B', style: 'subheader' },
            {
                table: {
                    widths: ['*', 'auto'],
                    body: [
                        ['Základ dane (Mzda + Prenájom)', `${stats.taxBase.toFixed(2)} €`],
                        [{ text: 'PREDPOKLADANÁ DAŇ (19%)', bold: true }, { text: `${(stats.taxBase * 0.19).toFixed(2)} €`, bold: true }]
                    ]
                }
            }
        ],
        styles: { header: { fontSize: 16, bold: true }, subheader: { fontSize: 12, bold: true, color: '#2563eb' } }
    };
    pdfMake.createPdf(docDefinition).download(`Danovy_Draft_${year}.pdf`);
}

// Nová funkcia: Export mesačného prehľadu do PDF
function exportMonthlyPdfReport(transactions) {
    // Zoskupiť transakcie podľa mesiacov
    const monthlyData = {};
    const MONTH_NAMES = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];
    
    transactions.forEach(tx => {
        const date = new Date(tx.date);
        const year = date.getFullYear();
        const month = date.getMonth();
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        
        if (!monthlyData[key]) {
            monthlyData[key] = {
                year: year,
                month: month,
                income: [],
                expense: [],
                totalIncome: 0,
                totalExpense: 0
            };
        }
        
        if (tx.type === 'Príjem') {
            monthlyData[key].income.push(tx);
            monthlyData[key].totalIncome += tx.amount;
        } else {
            monthlyData[key].expense.push(tx);
            monthlyData[key].totalExpense += tx.amount;
        }
    });
    
    // Vytvorenie PDF obsahu
    const content = [
        { text: 'MESAČNÝ FINANČNÝ PREHĽAD', style: 'mainHeader', alignment: 'center', margin: [0, 0, 0, 20] }
    ];
    
    // Zoradiť mesiace chronologicky
    const sortedKeys = Object.keys(monthlyData).sort();
    
    sortedKeys.forEach((key, index) => {
        const data = monthlyData[key];
        const monthName = MONTH_NAMES[data.month];
        
        // Hlavička mesiaca
        content.push({
            text: `${monthName} ${data.year}`,
            style: 'monthHeader',
            margin: index > 0 ? [0, 15, 0, 10] : [0, 0, 0, 10]
        });
        
        // Tabuľka príjmov
        if (data.income.length > 0) {
            content.push({ text: 'PRÍJMY', style: 'sectionHeader', margin: [0, 5, 0, 5] });
            
            const incomeTableBody = [
                [
                    { text: 'Dátum', style: 'tableHeader' },
                    { text: 'Kategória', style: 'tableHeader' },
                    { text: 'Popis', style: 'tableHeader' },
                    { text: 'Suma', style: 'tableHeader', alignment: 'right' }
                ]
            ];
            
            data.income.forEach(tx => {
                incomeTableBody.push([
                    { text: formatDate(tx.date), fontSize: 9 },
                    { text: categoryMap[tx.category] || tx.category || '-', fontSize: 9 },
                    { text: tx.note || '-', fontSize: 9 },
                    { text: tx.amount.toFixed(2) + ' €', alignment: 'right', fontSize: 9 }
                ]);
            });
            
            content.push({
                table: {
                    widths: ['auto', '*', '*', 'auto'],
                    body: incomeTableBody
                },
                layout: {
                    fillColor: function (rowIndex) {
                        return rowIndex === 0 ? '#d1fae5' : null;
                    }
                }
            });
        }
        
        // Tabuľka výdavkov
        if (data.expense.length > 0) {
            content.push({ text: 'VÝDAVKY', style: 'sectionHeader', margin: [0, 10, 0, 5] });
            
            const expenseTableBody = [
                [
                    { text: 'Dátum', style: 'tableHeader' },
                    { text: 'Kategória', style: 'tableHeader' },
                    { text: 'Popis', style: 'tableHeader' },
                    { text: 'Suma', style: 'tableHeader', alignment: 'right' }
                ]
            ];
            
            data.expense.forEach(tx => {
                expenseTableBody.push([
                    { text: formatDate(tx.date), fontSize: 9 },
                    { text: categoryMap[tx.category] || tx.category || '-', fontSize: 9 },
                    { text: tx.note || '-', fontSize: 9 },
                    { text: tx.amount.toFixed(2) + ' €', alignment: 'right', fontSize: 9 }
                ]);
            });
            
            content.push({
                table: {
                    widths: ['auto', '*', '*', 'auto'],
                    body: expenseTableBody
                },
                layout: {
                    fillColor: function (rowIndex) {
                        return rowIndex === 0 ? '#fee2e2' : null;
                    }
                }
            });
        }
        
        // Mesačný sumár
        const balance = data.totalIncome - data.totalExpense;
        content.push({
            style: 'summary',
            margin: [0, 10, 0, 0],
            table: {
                widths: ['*', 'auto'],
                body: [
                    [
                        { text: 'Celkové príjmy:', bold: true, fontSize: 10 },
                        { text: data.totalIncome.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 10, color: '#059669' }
                    ],
                    [
                        { text: 'Celkové výdavky:', bold: true, fontSize: 10 },
                        { text: data.totalExpense.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 10, color: '#dc2626' }
                    ],
                    [
                        { text: 'Bilancia:', bold: true, fontSize: 11 },
                        { text: balance.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 11, color: balance >= 0 ? '#059669' : '#dc2626' }
                    ]
                ]
            },
            layout: {
                fillColor: function (rowIndex) {
                    return rowIndex === 2 ? '#f1f5f9' : null;
                },
                hLineWidth: function (i, node) {
                    return i === 2 || i === node.table.body.length ? 2 : 1;
                }
            }
        });
    });
    
    // Celkový sumár na konci
    const totalIncome = sortedKeys.reduce((sum, key) => sum + monthlyData[key].totalIncome, 0);
    const totalExpense = sortedKeys.reduce((sum, key) => sum + monthlyData[key].totalExpense, 0);
    const totalBalance = totalIncome - totalExpense;
    
    content.push({ text: '', pageBreak: 'before' });
    content.push({ text: 'CELKOVÝ SUMÁR', style: 'mainHeader', alignment: 'center', margin: [0, 0, 0, 20] });
    content.push({
        table: {
            widths: ['*', 'auto'],
            body: [
                [
                    { text: 'Celkové príjmy za obdobie:', bold: true, fontSize: 12 },
                    { text: totalIncome.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 12, color: '#059669' }
                ],
                [
                    { text: 'Celkové výdavky za obdobie:', bold: true, fontSize: 12 },
                    { text: totalExpense.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 12, color: '#dc2626' }
                ],
                [
                    { text: 'CELKOVÁ BILANCIA:', bold: true, fontSize: 14 },
                    { text: totalBalance.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 14, color: totalBalance >= 0 ? '#059669' : '#dc2626' }
                ]
            ]
        },
        layout: {
            fillColor: function (rowIndex) {
                return rowIndex === 2 ? '#e0e7ff' : '#f1f5f9';
            },
            hLineWidth: function () {
                return 2;
            }
        }
    });
    
    const docDefinition = {
        content: content,
        styles: {
            mainHeader: {
                fontSize: 18,
                bold: true,
                color: '#1e40af'
            },
            monthHeader: {
                fontSize: 14,
                bold: true,
                color: '#2563eb'
            },
            sectionHeader: {
                fontSize: 11,
                bold: true,
                color: '#64748b'
            },
            tableHeader: {
                bold: true,
                fontSize: 10,
                color: '#334155'
            },
            summary: {
                fontSize: 10
            }
        },
        pageMargins: [40, 40, 40, 40]
    };
    
    const filters = getFilters();
    const year = sortedKeys.length > 0 ? sortedKeys[0].split('-')[0] : currentYear;
    const fileName = `Mesacny_Report_${year}.pdf`;
    pdfMake.createPdf(docDefinition).download(fileName);
}

// Nová funkcia: Export mesačného prehľadu pre prenájom
function exportRentPdfReport(allTransactions) {
    // Filtrovať iba transakcie súvisiace s prenájmom
    const rentTransactions = allTransactions.filter(tx => {
        const cat = (tx.category || '').toLowerCase();
        
        // Príjmy z prenájmu
        if (tx.type === 'Príjem' && cat.includes('prenájom')) {
            return true;
        }
        
        // Výdavky súvisiace s prenájmom (rovnaká logika ako v utils.js)
        if (tx.type === 'Výdaj' && (
            cat.includes('bytové družstvo') || 
            cat.includes('telekom') || 
            cat.includes('4ka') || 
            cat.includes('zse') || 
            cat.includes('msú trnava') || 
            cat.includes('vd - iné')
        )) {
            return true;
        }
        
        return false;
    });
    
    if (rentTransactions.length === 0) {
        alert("Žiadne transakcie súvisiace s prenájmom.");
        return;
    }
    
    // Zoskupiť transakcie podľa mesiacov
    const monthlyData = {};
    const MONTH_NAMES = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];
    
    rentTransactions.forEach(tx => {
        const date = new Date(tx.date);
        const year = date.getFullYear();
        const month = date.getMonth();
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        
        if (!monthlyData[key]) {
            monthlyData[key] = {
                year: year,
                month: month,
                income: [],
                expense: [],
                totalIncome: 0,
                totalExpense: 0
            };
        }
        
        if (tx.type === 'Príjem') {
            monthlyData[key].income.push(tx);
            monthlyData[key].totalIncome += tx.amount;
        } else {
            monthlyData[key].expense.push(tx);
            monthlyData[key].totalExpense += tx.amount;
        }
    });
    
    // Vytvorenie PDF obsahu
    const content = [
        { text: 'PREHĽAD PRENÁJMU', style: 'mainHeader', alignment: 'center', margin: [0, 0, 0, 10] },
        { text: 'Príjmy a výdavky súvisiace s prenájmom nehnuteľnosti', style: 'subtitle', alignment: 'center', margin: [0, 0, 0, 20] }
    ];
    
    // Zoradiť mesiace chronologicky
    const sortedKeys = Object.keys(monthlyData).sort();
    
    sortedKeys.forEach((key, index) => {
        const data = monthlyData[key];
        const monthName = MONTH_NAMES[data.month];
        
        // Hlavička mesiaca
        content.push({
            text: `${monthName} ${data.year}`,
            style: 'monthHeader',
            margin: index > 0 ? [0, 15, 0, 10] : [0, 0, 0, 10]
        });
        
        // Tabuľka príjmov
        if (data.income.length > 0) {
            content.push({ text: 'PRÍJMY Z PRENÁJMU', style: 'sectionHeader', margin: [0, 5, 0, 5] });
            
            const incomeTableBody = [
                [
                    { text: 'Dátum', style: 'tableHeader' },
                    { text: 'Kategória', style: 'tableHeader' },
                    { text: 'Popis', style: 'tableHeader' },
                    { text: 'Suma', style: 'tableHeader', alignment: 'right' }
                ]
            ];
            
            data.income.forEach(tx => {
                incomeTableBody.push([
                    { text: formatDate(tx.date), fontSize: 9 },
                    { text: categoryMap[tx.category] || tx.category || '-', fontSize: 9 },
                    { text: tx.note || '-', fontSize: 9 },
                    { text: tx.amount.toFixed(2) + ' €', alignment: 'right', fontSize: 9 }
                ]);
            });
            
            content.push({
                table: {
                    widths: ['auto', '*', '*', 'auto'],
                    body: incomeTableBody
                },
                layout: {
                    fillColor: function (rowIndex) {
                        return rowIndex === 0 ? '#d1fae5' : null;
                    }
                }
            });
        }
        
        // Tabuľka výdavkov
        if (data.expense.length > 0) {
            content.push({ text: 'VÝDAVKY SÚVISIACE S PRENÁJMOM', style: 'sectionHeader', margin: [0, 10, 0, 5] });
            
            const expenseTableBody = [
                [
                    { text: 'Dátum', style: 'tableHeader' },
                    { text: 'Kategória', style: 'tableHeader' },
                    { text: 'Popis', style: 'tableHeader' },
                    { text: 'Suma', style: 'tableHeader', alignment: 'right' }
                ]
            ];
            
            data.expense.forEach(tx => {
                expenseTableBody.push([
                    { text: formatDate(tx.date), fontSize: 9 },
                    { text: categoryMap[tx.category] || tx.category || '-', fontSize: 9 },
                    { text: tx.note || '-', fontSize: 9 },
                    { text: tx.amount.toFixed(2) + ' €', alignment: 'right', fontSize: 9 }
                ]);
            });
            
            content.push({
                table: {
                    widths: ['auto', '*', '*', 'auto'],
                    body: expenseTableBody
                },
                layout: {
                    fillColor: function (rowIndex) {
                        return rowIndex === 0 ? '#fee2e2' : null;
                    }
                }
            });
        }
        
        // Mesačný sumár
        const balance = data.totalIncome - data.totalExpense;
        content.push({
            style: 'summary',
            margin: [0, 10, 0, 0],
            table: {
                widths: ['*', 'auto'],
                body: [
                    [
                        { text: 'Príjmy z prenájmu:', bold: true, fontSize: 10 },
                        { text: data.totalIncome.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 10, color: '#059669' }
                    ],
                    [
                        { text: 'Výdavky na prenájom:', bold: true, fontSize: 10 },
                        { text: data.totalExpense.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 10, color: '#dc2626' }
                    ],
                    [
                        { text: 'Čistý príjem:', bold: true, fontSize: 11 },
                        { text: balance.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 11, color: balance >= 0 ? '#059669' : '#dc2626' }
                    ]
                ]
            },
            layout: {
                fillColor: function (rowIndex) {
                    return rowIndex === 2 ? '#f1f5f9' : null;
                },
                hLineWidth: function (i, node) {
                    return i === 2 || i === node.table.body.length ? 2 : 1;
                }
            }
        });
    });
    
    // Celkový sumár na konci
    const totalIncome = sortedKeys.reduce((sum, key) => sum + monthlyData[key].totalIncome, 0);
    const totalExpense = sortedKeys.reduce((sum, key) => sum + monthlyData[key].totalExpense, 0);
    const totalBalance = totalIncome - totalExpense;
    
    content.push({ text: '', pageBreak: 'before' });
    content.push({ text: 'CELKOVÝ SUMÁR PRENÁJMU', style: 'mainHeader', alignment: 'center', margin: [0, 0, 0, 20] });
    
    // Pridať informáciu o oslobodení
    const exemptAmount = 500;
    const taxableIncome = Math.max(0, totalIncome - exemptAmount);
    
    content.push({
        table: {
            widths: ['*', 'auto'],
            body: [
                [
                    { text: 'Celkové príjmy z prenájmu:', bold: true, fontSize: 12 },
                    { text: totalIncome.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 12, color: '#059669' }
                ],
                [
                    { text: 'Celkové výdavky na prenájom:', bold: true, fontSize: 12 },
                    { text: totalExpense.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 12, color: '#dc2626' }
                ],
                [
                    { text: 'ČISTÝ PRÍJEM Z PRENÁJMU:', bold: true, fontSize: 14 },
                    { text: totalBalance.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 14, color: totalBalance >= 0 ? '#059669' : '#dc2626' }
                ]
            ]
        },
        layout: {
            fillColor: function (rowIndex) {
                return rowIndex === 2 ? '#e0e7ff' : '#f1f5f9';
            },
            hLineWidth: function () {
                return 2;
            }
        }
    });
    
    // Daňové informácie
    content.push({ text: '\nDAŇOVÉ INFORMÁCIE', style: 'monthHeader', margin: [0, 20, 0, 10] });
    content.push({
        table: {
            widths: ['*', 'auto'],
            body: [
                [
                    { text: 'Hrubý príjem z prenájmu', fontSize: 11 },
                    { text: totalIncome.toFixed(2) + ' €', alignment: 'right', fontSize: 11 }
                ],
                [
                    { text: 'Oslobodenie (§ 9 ods. 1 písm. g)', fontSize: 11, color: '#64748b' },
                    { text: '- ' + exemptAmount.toFixed(2) + ' €', alignment: 'right', fontSize: 11, color: '#64748b' }
                ],
                [
                    { text: 'Zdaniteľný príjem z prenájmu', bold: true, fontSize: 12 },
                    { text: taxableIncome.toFixed(2) + ' €', alignment: 'right', bold: true, fontSize: 12, color: '#2563eb' }
                ]
            ]
        },
        layout: {
            fillColor: function (rowIndex) {
                return rowIndex === 2 ? '#dbeafe' : null;
            }
        }
    });
    
    const docDefinition = {
        content: content,
        styles: {
            mainHeader: {
                fontSize: 18,
                bold: true,
                color: '#1e40af'
            },
            subtitle: {
                fontSize: 11,
                color: '#64748b',
                italics: true
            },
            monthHeader: {
                fontSize: 14,
                bold: true,
                color: '#2563eb'
            },
            sectionHeader: {
                fontSize: 11,
                bold: true,
                color: '#64748b'
            },
            tableHeader: {
                bold: true,
                fontSize: 10,
                color: '#334155'
            },
            summary: {
                fontSize: 10
            }
        },
        pageMargins: [40, 40, 40, 40]
    };
    
    const year = sortedKeys.length > 0 ? sortedKeys[0].split('-')[0] : currentYear;
    const fileName = `Prenajom_${year}.pdf`;
    pdfMake.createPdf(docDefinition).download(fileName);
}

function renderReportSkeleton() {
    const host = document.getElementById('reportContent');
    if (!host) return;

    host.innerHTML = `
        <div class="skeleton-block" style="height: 92px;"></div>
        <div class="skeleton-block skeleton-line"></div>
        <div class="skeleton-block skeleton-line"></div>
        <div class="skeleton-block skeleton-line"></div>
    `;
}