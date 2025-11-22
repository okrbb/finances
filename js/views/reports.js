/* js/views/reports.js */
import { formatDate } from '../utils.js';

let chartInstance = null;

// Definícia mapovania názvov kategórií pre zobrazenie
const categoryMap = {
    "VD - Telekom": "VD - internet",
    "VD - 4ka": "VD - TV"
};

export function setupReportEvents(db, getTransactionsCallback) {
    // 1. Generovať tlačidlo (manuálny refresh)
    document.getElementById('generateReportBtn').addEventListener('click', () => {
        refreshAll(getTransactionsCallback);
    });

    // 2. Checkbox filtre - OKAMŽITÁ REAKCIA
    document.querySelectorAll('.report-cat-filter').forEach(cb => {
        cb.addEventListener('change', () => {
            refreshAll(getTransactionsCallback);
        });
    });

    // 3. Prepínanie Grafu
    document.getElementById('showChartBtn').addEventListener('click', (e) => {
        const container = document.getElementById('chartContainer');
        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            e.target.textContent = 'Skryť Graf';
            renderChart(getTransactionsCallback());
        } else {
            container.classList.add('hidden');
            e.target.textContent = 'Zobraziť Graf';
        }
    });
    
    // 4. Export Excel (XLSX)
    document.getElementById('exportExcelBtn').addEventListener('click', () => {
        const transactions = getTransactionsCallback();
        const filtered = filterTransactions(transactions);
        
        if (filtered.length === 0) {
            alert("Žiadne dáta na export.");
            return;
        }

        // Príprava dát pre Excel
        const dataForExcel = filtered.map(tx => {
            let formattedDate = '';
            if (tx.date) {
                formattedDate = tx.date.split('-').reverse().join('.');
            }

            // Použitie mapy pre krajší názov kategórie
            const displayCategory = categoryMap[tx.category] || tx.category;

            return {
                Dátum: formattedDate,
                Druh: tx.type,
                Kategória: displayCategory,
                Poznámka: tx.note || '',
                Suma: parseFloat(tx.amount)
            };
        });

        const ws = XLSX.utils.json_to_sheet(dataForExcel);

        // Nastavenie šírky stĺpcov
        ws['!cols'] = [
            { wch: 13 }, // Dátum
            { wch: 9 },  // Druh
            { wch: 27 }, // Kategória
            { wch: 27 }, // Poznámka
            { wch: 9 }   // Suma
        ];

        // Zapnutie Filtrov a formátovanie meny
        if (ws['!ref']) {
            ws['!autofilter'] = { ref: ws['!ref'] };
            
            const range = XLSX.utils.decode_range(ws['!ref']);
            for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                const address = XLSX.utils.encode_cell({ r: R, c: 4 }); // Stĺpec Suma
                if (ws[address]) {
                    ws[address].z = '#,##0.00 "€"';
                }
            }
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Report");
        const { dateFrom, dateTo } = getFilters();
        XLSX.writeFile(wb, `Report_${dateFrom}_${dateTo}.xlsx`);
    });

    // 5. Export PDF - PROFESIONÁLNA VERZIA (pdfMake)
    document.getElementById('exportPdfBtn').addEventListener('click', () => {
        // 1. Zber údajov o používateľovi
        const userName = document.getElementById('settingsName').value || 'Meno Priezvisko';
        const userDic = document.getElementById('settingsDIC').value || '-';
        const userAddress = document.getElementById('settingsAddress').value || '-';
        const userIBAN = document.getElementById('settingsIBAN').value || '-';
        const dateFrom = formatDate(document.getElementById('reportDateFrom').value);
        const dateTo = formatDate(document.getElementById('reportDateTo').value);

        // 2. Získanie a filtrovanie transakcií
        const allTransactions = getTransactionsCallback();
        const filteredTx = filterTransactions(allTransactions);

        if (filteredTx.length === 0) {
            alert("Žiadne dáta na export.");
            return;
        }

        // 3. Príprava tela tabuľky pre PDF
        const tableBody = [
            [
                { text: 'Dátum', style: 'tableHeader' },
                { text: 'Druh', style: 'tableHeader' },
                { text: 'Kategória', style: 'tableHeader' },
                { text: 'Popis', style: 'tableHeader' },
                { text: 'Suma', style: 'tableHeader', alignment: 'right' }
            ]
        ];

        // Naplnenie dátami
        let totalSum = 0;
        filteredTx.forEach(tx => {
            const isIncome = tx.type === 'Príjem';
            const amount = parseFloat(tx.amount);
            if (isIncome) totalSum += amount; else totalSum -= amount;

            // Použitie mapy pre krajší názov kategórie v PDF
            const displayCategory = categoryMap[tx.category] || tx.category || '-';

            tableBody.push([
                { text: formatDate(tx.date), fontSize: 10 },
                { text: tx.type, fontSize: 10 },
                { text: displayCategory, fontSize: 10 },
                { text: tx.note || '-', fontSize: 10 },
                { 
                    text: amount.toFixed(2) + ' €', 
                    alignment: 'right', 
                    fontSize: 10,
                    color: isIncome ? '#059669' : '#dc2626',
                    bold: true
                }
            ]);
        });

        // 4. Definícia dokumentu (JSON štruktúra)
        const docDefinition = {
            info: {
                title: 'Finančný Report',
                author: userName,
            },
            content: [
                // Hlavička dokumentu
                {
                    columns: [
                        {
                            width: '*',
                            text: [
                                { text: userName + '\n', style: 'headerName' },
                                { text: userAddress + '\n', style: 'small' },
                                { text: 'DIČ: ' + userDic + '\n', style: 'small' },
                                { text: 'IBAN: ' + userIBAN, style: 'small' }
                            ]
                        },
                        {
                            width: 'auto',
                            text: [
                                { text: 'FINANČNÝ REPORT\n', style: 'headerTitle', alignment: 'right' },
                                { text: `Obdobie: ${dateFrom} - ${dateTo}\n`, style: 'small', alignment: 'right' },
                                { text: `Generované: ${new Date().toLocaleDateString('sk-SK')}`, style: 'small', alignment: 'right' }
                            ]
                        }
                    ]
                },
                { text: '', margin: [0, 10, 0, 10] }, // Medzera
                
                // Čiara
                { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1, lineColor: '#e2e8f0' }] },
                
                { text: '', margin: [0, 10, 0, 10] }, // Medzera

                // Súhrn (Bilancia)
                {
                    style: 'summaryBox',
                    table: {
                        widths: ['*'],
                        body: [
                            [{ 
                                text: `VÝSLEDNÁ BILANCIA: ${totalSum.toFixed(2)} €`, 
                                alignment: 'center', 
                                fontSize: 14, 
                                bold: true, 
                                color: totalSum >= 0 ? '#059669' : '#dc2626',
                                fillColor: '#f8fafc'
                            }]
                        ]
                    },
                    layout: 'noBorders'
                },

                { text: 'Detailný výpis transakcií', style: 'subheader', margin: [0, 20, 0, 10] },

                // Hlavná tabuľka
                {
                    table: {
                        headerRows: 1, // Opakovanie hlavičky na novej strane
                        widths: ['auto', 'auto', '*', '*', 'auto'], // Šírky stĺpcov
                        body: tableBody
                    },
                    layout: {
                        hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 2 : 1; },
                        vLineWidth: function (i, node) { return 0; }, // Bez vertikálnych čiar
                        hLineColor: function (i, node) { return (i === 0 || i === node.table.body.length) ? '#334155' : '#e2e8f0'; },
                        paddingLeft: function(i, node) { return 8; },
                        paddingRight: function(i, node) { return 8; },
                        paddingTop: function(i, node) { return 6; },
                        paddingBottom: function(i, node) { return 6; }
                    }
                }
            ],
            styles: {
                headerName: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
                headerTitle: { fontSize: 14, bold: true, color: '#334155' },
                subheader: { fontSize: 12, bold: true, margin: [0, 10, 0, 5] },
                small: { fontSize: 9, color: '#64748b' },
                tableHeader: { bold: true, fontSize: 10, color: 'black', fillColor: '#f1f5f9' },
                summaryBox: { margin: [0, 10, 0, 10] }
            },
            defaultStyle: {
                font: 'Roboto'
            }
        };

        pdfMake.createPdf(docDefinition).download(`Report_${document.getElementById('reportDateFrom').value}.pdf`);
    });
}

// Pomocná funkcia na refresh všetkého naraz
function refreshAll(getTransactionsCallback) {
    const txs = getTransactionsCallback();
    updateReportUI(txs);
    
    if (!document.getElementById('chartContainer').classList.contains('hidden')) {
        renderChart(txs);
    }
}

function getFilters() {
    const dateFrom = document.getElementById('reportDateFrom').value;
    const dateTo = document.getElementById('reportDateTo').value;
    const typeFilter = document.getElementById('reportTypeFilter').value;
    
    const checkboxes = document.querySelectorAll('.report-cat-filter:checked');
    const selectedCategories = Array.from(checkboxes).map(cb => cb.value);
    
    return { dateFrom, dateTo, typeFilter, selectedCategories };
}

function filterTransactions(transactions) {
    const { dateFrom, dateTo, typeFilter, selectedCategories } = getFilters();
    
    return transactions.filter(tx => {
        const txDate = new Date(tx.date);
        const from = dateFrom ? new Date(dateFrom) : new Date('1900-01-01');
        const to = dateTo ? new Date(dateTo) : new Date('2100-01-01');
        
        // 1. Filter Dátumu
        if (txDate < from || txDate > to) return false;
        
        // 2. Filter Druhu (Príjem/Výdaj)
        if (typeFilter && typeFilter !== 'all' && tx.type !== typeFilter) return false;

        // 3. Filter Kategórií (Checkbox)
        if (selectedCategories.length === 0) return false;

        const cat = (tx.category || '').toLowerCase();
        let match = false;

        // Logika pre jednotlivé checkboxy
        if (selectedCategories.includes('mzda') && (cat.includes('mzda') || cat.includes('dôchodok'))) match = true;
        if (selectedCategories.includes('prenajom') && cat.includes('prenájom')) match = true;
        if (selectedCategories.includes('dane') && (cat.includes('poistenie') || cat.includes('preddavok') || cat.includes('dds'))) match = true;
        if (selectedCategories.includes('byvanie') && (cat.includes('bytové') || cat.includes('msú'))) match = true;
        if (selectedCategories.includes('energie') && (cat.includes('zse') || cat.includes('elektrina'))) match = true;
        
        // OPRAVA PRE TV / INTERNET
        if (selectedCategories.includes('tv') && (cat.includes('4ka') || cat.includes('telekom') || cat.includes('internet'))) match = true;
        
        if (selectedCategories.includes('ine') && cat.includes('iné')) match = true;
        
        return match;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function updateReportUI(allTransactions) {
    const filtered = filterTransactions(allTransactions);
    const { dateFrom, dateTo } = getFilters();
    
    let totalIncome = 0, totalExpense = 0;
    filtered.forEach(tx => tx.type === 'Príjem' ? totalIncome += tx.amount : totalExpense += tx.amount);
    
    let html = `
        <div class="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <h3 class="font-bold text-slate-700 mb-2">Súhrn (${formatDate(dateFrom)} - ${formatDate(dateTo)})</h3>
            <div class="flex gap-6 flex-wrap">
                <div class="text-green-600 font-bold">Príjmy: ${totalIncome.toFixed(2)} €</div>
                <div class="text-red-500 font-bold">Výdavky: ${totalExpense.toFixed(2)} €</div>
                <div class="text-slate-800 font-bold">Bilancia: ${(totalIncome - totalExpense).toFixed(2)} €</div>
            </div>
        </div>
        <table class="w-full text-sm text-left mt-4">
            <thead class="bg-slate-100 text-slate-700 uppercase text-xs">
                <tr><th>Dátum</th><th>Druh</th><th>Kategória</th><th>Popis</th><th class="text-right">Suma</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-100">`;

    if (filtered.length === 0) html += '<tr><td colspan="5" class="text-center py-4">Žiadne dáta</td></tr>';
    else {
        filtered.forEach(tx => {
            const colorClass = tx.type === 'Príjem' ? 'text-green-600' : 'text-red-500';
            
            // Použitie mapy pre krajší názov v HTML tabuľke
            const displayCategory = categoryMap[tx.category] || tx.category;

            html += `
            <tr>
                <td class="py-2">${formatDate(tx.date)}</td>
                <td>${tx.type}</td>
                <td>${displayCategory}</td>
                <td>${tx.note || '-'}</td>
                <td class="text-right font-bold ${colorClass}">${tx.amount.toFixed(2)} €</td>
            </tr>`;
        });
    }
    html += '</tbody></table>';
    
    document.getElementById('reportContent').innerHTML = html;
}

function renderChart(allTransactions) {
    const filtered = filterTransactions(allTransactions);
    const monthlyData = {};

    filtered.forEach(tx => {
        const d = new Date(tx.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[key]) monthlyData[key] = { income: 0, expense: 0 };
        
        if (tx.type === 'Príjem') monthlyData[key].income += tx.amount;
        else monthlyData[key].expense += tx.amount;
    });

    const sortedKeys = Object.keys(monthlyData).sort();
    const labels = sortedKeys.map(k => k.split('-').reverse().join('/')); 
    const incomeData = sortedKeys.map(k => monthlyData[k].income);
    const expenseData = sortedKeys.map(k => monthlyData[k].expense);
    const balanceData = sortedKeys.map(k => monthlyData[k].income - monthlyData[k].expense);

    if (chartInstance) chartInstance.destroy();
    
    const ctx = document.getElementById('reportChart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Bilancia', data: balanceData, type: 'line', borderColor: '#1e293b', borderWidth: 3, tension: 0.3, order: 0 },
                { label: 'Príjmy', data: incomeData, backgroundColor: 'rgba(16, 185, 129, 0.7)', order: 1 },
                { label: 'Výdavky', data: expenseData, backgroundColor: 'rgba(239, 68, 68, 0.7)', order: 2 }
            ]
        },
        options: { responsive: true }
    });
}