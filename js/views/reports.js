/* js/views/reports.js */
import { formatDate, calculateTaxStats } from '../utils.js';

let chartInstance = null;
let pieChartInstance = null;

// Mapovanie systémových kategórií na čitateľné názvy pre reporty
const categoryMap = {
    "VD - Telekom": "VD - internet",
    "VD - 4ka": "VD - TV",
    "PD - mzda": "Mzda",
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
        refreshAll(getTransactionsCallback);
    });

    document.querySelectorAll('.report-cat-filter').forEach(cb => {
        cb.addEventListener('change', () => {
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
        if (filtered.length === 0) return alert("Žiadne dáta na export.");

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
    });

    // Export Štandardné PDF
    document.getElementById('exportPdfBtn').addEventListener('click', () => {
        const allTransactions = getTransactionsCallback();
        const filteredTx = filterTransactions(allTransactions);
        if (filteredTx.length === 0) return alert("Žiadne dáta.");

        const tableBody = [[
            { text: 'Dátum', style: 'tableHeader' },
            { text: 'Druh', style: 'tableHeader' },
            { text: 'Kategória', style: 'tableHeader' },
            { text: 'Popis', style: 'tableHeader' },
            { text: 'Suma', style: 'tableHeader', alignment: 'right' }
        ]];

        filteredTx.forEach(tx => {
            tableBody.push([
                { text: formatDate(tx.date), fontSize: 10 },
                { text: tx.type, fontSize: 10 },
                { text: categoryMap[tx.category] || tx.category || '-', fontSize: 10 },
                { text: tx.note || '-', fontSize: 10 },
                { text: tx.amount.toFixed(2) + ' €', alignment: 'right', fontSize: 10, bold: true }
            ]);
        });

        const docDef = {
            content: [{ text: 'FINANČNÝ REPORT', style: 'headerTitle' }, { table: { body: tableBody } }],
            styles: { headerTitle: { fontSize: 14, bold: true }, tableHeader: { bold: true, fillColor: '#f1f5f9' } }
        };
        pdfMake.createPdf(docDef).download('Report.pdf');
    });

    // NOVÉ: Export Daňového draftu
    document.getElementById('exportTaxDraftBtn')?.addEventListener('click', () => {
        const transactions = getTransactionsCallback();
        const stats = calculateTaxStats(transactions);
        exportTaxDraftPdf(stats);
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
        const txDate = new Date(tx.date);
        const from = dateFrom ? new Date(dateFrom) : new Date('1900-01-01');
        const to = dateTo ? new Date(dateTo) : new Date('2100-01-01');
        if (txDate < from || txDate > to) return false;
        if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
        if (selectedCategories.length === 0) return false;

        const cat = (tx.category || '').toLowerCase();
        let match = false;
        if (selectedCategories.includes('mzda') && (cat.includes('mzda') || cat.includes('dôchodok'))) match = true;
        if (selectedCategories.includes('prenajom') && cat.includes('prenájom')) match = true;
        if (selectedCategories.includes('dane') && (cat.includes('poistenie') || cat.includes('preddavok') || cat.includes('dds'))) match = true;
        if (selectedCategories.includes('byvanie') && (cat.includes('bytové') || cat.includes('msú'))) match = true;
        if (selectedCategories.includes('energie') && (cat.includes('zse') || cat.includes('elektrina'))) match = true;
        if (selectedCategories.includes('tv') && (cat.includes('4ka') || cat.includes('telekom') || cat.includes('internet'))) match = true;
        if (selectedCategories.includes('ine') && cat.includes('iné')) match = true;
        return match;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function updateReportUI(allTransactions) {
    const filtered = filterTransactions(allTransactions);
    let totalIncome = 0, totalExpense = 0;
    filtered.forEach(tx => tx.type === 'Príjem' ? totalIncome += tx.amount : totalExpense += tx.amount);

    let html = `
        <div class="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <h3 class="font-bold text-slate-700 mb-2">Súhrn</h3>
            <div class="flex gap-6 flex-wrap">
                <div class="text-green-600 font-bold">Príjmy: ${totalIncome.toFixed(2)} €</div>
                <div class="text-red-500 font-bold">Výdavky: ${totalExpense.toFixed(2)} €</div>
                <div class="text-slate-800 font-bold">Bilancia: ${(totalIncome - totalExpense).toFixed(2)} €</div>
            </div>
        </div>
        <table class="w-full text-sm text-left mt-4">
            <thead><tr class="bg-slate-100"><th>Dátum</th><th>Kategória</th><th>Popis</th><th class="text-right">Suma</th></tr></thead>
            <tbody>`;

    if (filtered.length === 0) html += '<tr><td colspan="4" class="text-center py-4">Žiadne dáta</td></tr>';
    else {
        filtered.forEach(tx => {
            html += `<tr>
                <td class="py-2">${formatDate(tx.date)}</td>
                <td>${categoryMap[tx.category] || tx.category}</td>
                <td>${tx.note || '-'}</td>
                <td class="text-right font-bold ${tx.type === 'Príjem' ? 'text-green-600' : 'text-red-500'}">${tx.amount.toFixed(2)} €</td>
            </tr>`;
        });
    }
    document.getElementById('reportContent').innerHTML = html + '</tbody></table>';
}

// NOVÉ: Grafy s Drill-down funkcionalitou
function renderCharts(allTransactions) {
    const filtered = filterTransactions(allTransactions);
    const monthlyData = {};

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
                { label: 'Príjmy', data: sortedKeys.map(k => monthlyData[k].income), backgroundColor: '#10b981' },
                { label: 'Výdavky', data: sortedKeys.map(k => monthlyData[k].expense), backgroundColor: '#ef4444' }
            ]
        },
        options: {
            responsive: true,
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
    expenses.forEach(tx => {
        const cat = categoryMap[tx.category] || tx.category || 'Iné';
        catData[cat] = (catData[cat] || 0) + tx.amount;
    });

    if (pieChartInstance) pieChartInstance.destroy();
    const ctx = document.getElementById('categoryPieChart').getContext('2d');
    pieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(catData),
            datasets: [{
                data: Object.values(catData),
                backgroundColor: ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#64748b']
            }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
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