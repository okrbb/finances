import { collection, addDoc, query, where, getDocs, deleteDoc, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showToast } from '../notifications.js';
import { activeYear } from '../app.js';
import { formatCurrencySK } from '../utils.js';
import { logAuditEvent } from '../audit.js';
import { matchImportRule, parseImportRulesText } from '../importRules.js';

let pendingTransactions = []; // Dočasné úložisko pre vybrané transakcie
let lastImportedDocIds = [];

const MERGED_HOUSING_AMOUNT = 40.73;

function buildRelevantYears(entries) {
    const years = new Set();
    entries.forEach((ntry) => {
        const date = ntry.getElementsByTagName("BookgDt")[0]?.getElementsByTagName("Dt")[0]?.textContent;
        const year = Number.parseInt(String(date || '').slice(0, 4), 10);
        if (Number.isFinite(year)) {
            years.add(year);
            years.add(year - 1);
            years.add(year + 1);
        }
    });
    return Array.from(years).filter((year) => Number.isFinite(year)).sort((a, b) => a - b);
}

function classifyImportedTransaction(indicator, counterParty, narrative, unstructured, amount, customRules = []) {
    let category = indicator === "CRDT" ? "PD - iné" : "VD - iné";
    if (indicator !== "DBIT") return category;

    const fullNote = `${counterParty || ''} ${narrative || ''} ${unstructured || ''}`.toLowerCase();

    const customCategory = matchImportRule(fullNote, customRules);
    if (customCategory) {
        return customCategory;
    }

    if (fullNote.includes("ministerstvo vnútra")) return "PD - mzda";
    if (fullNote.includes("energetika slovensko") || fullNote.includes("zse")) return "VD - ZSE";
    if (fullNote.includes("radost") || fullNote.includes("telekom")) {
        return "VD - internet";
    }
    if (fullNote.includes("swan") || fullNote.includes("4ka")) {
        return "VD - 4ka";
    }

    const normalizedAmount = Number.parseFloat(amount || 0);
    const isRentLike = fullNote.includes("najom") || fullNote.includes("nájom");
    if (isRentLike || Math.abs(normalizedAmount - MERGED_HOUSING_AMOUNT) < 0.001) {
        return "VD - bytové družstvo";
    }

    return category;
}

function normalizeImportKey(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\d+/g, '')
        .replace(/[^a-z\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildHistorySuggestionMap(existingTransactions) {
    const stats = new Map();
    existingTransactions.forEach((tx) => {
        const key = normalizeImportKey((tx.note || '').split(' - ')[0] || tx.note || '');
        if (!key || !tx.category) return;
        if (!stats.has(key)) stats.set(key, new Map());
        const categoryMap = stats.get(key);
        categoryMap.set(tx.category, (categoryMap.get(tx.category) || 0) + 1);
    });
    return stats;
}

function getHistorySuggestion(counterParty, suggestionMap) {
    const key = normalizeImportKey(counterParty);
    const categoryMap = suggestionMap.get(key);
    if (!categoryMap) return null;
    const ranked = Array.from(categoryMap.entries()).sort((left, right) => right[1] - left[1]);
    if (!ranked.length) return null;
    return { category: ranked[0][0], hits: ranked[0][1] };
}

function detectImportConfidence(fullText, category, suggestion) {
    if (suggestion && suggestion.hits >= 2) {
        return { level: 'medium', label: 'História', review: 'review-warning' };
    }
    if (category !== 'VD - iné' && category !== 'PD - iné') {
        return { level: 'high', label: 'Pravidlo', review: 'review-ok' };
    }
    if (/(poplatok|fee|sluzba|služba|prevod|sepa)/i.test(fullText)) {
        return { level: 'medium', label: 'Vzorec', review: 'review-warning' };
    }
    return { level: 'low', label: 'Nejasné', review: 'review-danger' };
}

function detectDuplicateTier(tx, existingTransactions, existingRefs, existingSignatures) {
    const refsToCheck = Array.isArray(tx.sourceBankRefs) ? tx.sourceBankRefs : [tx.bankRef];
    const signature = buildTxSignature(tx);
    if (refsToCheck.filter(Boolean).some((ref) => existingRefs.has(ref)) || existingSignatures.has(signature)) {
        return 'exact';
    }
    const probable = existingTransactions.find((item) => item.date === tx.date && item.type === tx.type && Math.abs((Number(item.amount) || 0) - (Number(tx.amount) || 0)) < 0.001);
    if (probable) return 'probable';

    const similar = existingTransactions.find((item) => {
        if (item.type !== tx.type) return false;
        if (Math.abs((Number(item.amount) || 0) - (Number(tx.amount) || 0)) > 0.5) return false;
        return normalizeImportKey(item.note || '').includes(normalizeImportKey(tx.counterParty || ''));
    });
    return similar ? 'similar' : 'none';
}

function isImportFeeLike(tx) {
    const text = `${tx.counterParty || ''} ${tx.note || ''} ${tx.narrative || ''}`;
    return /poplatok|fee|sluzba|služba|vedenie uctu|vedenie účtu|kartovy|kartový/i.test(text);
}

function mergeHousingSplitPayments(transactions) {
    const merged = [];
    const usedIndices = new Set();

    for (let i = 0; i < transactions.length; i++) {
        if (usedIndices.has(i)) continue;

        const current = transactions[i];
        if (!current || current.type !== 'Výdaj') {
            merged.push(current);
            continue;
        }

        const currentNote = (current.note || '').toLowerCase();
        const currentLooksLikeRent = currentNote.includes('najom') || currentNote.includes('nájom');
        const currentAmount = Number.parseFloat(current.amount || 0);

        if (!currentLooksLikeRent && Math.abs(currentAmount - MERGED_HOUSING_AMOUNT) < 0.001) {
            const hasRentCounterpart = transactions.some((candidate, idx) => {
                if (idx === i || usedIndices.has(idx)) return false;
                if (!candidate || candidate.type !== 'Výdaj') return false;
                if (candidate.date !== current.date) return false;
                const candidateNote = (candidate.note || '').toLowerCase();
                return candidateNote.includes('najom') || candidateNote.includes('nájom');
            });

            // Ak je k 40.73 v rovnaký deň nájom, samostatnú položku teraz nevkladáme.
            // Spracuje sa až pri nájomovej položke ako zlúčená transakcia.
            if (hasRentCounterpart) {
                continue;
            }
        }

        if (!currentLooksLikeRent) {
            merged.push(current);
            continue;
        }

        const partnerIndex = transactions.findIndex((candidate, idx) => {
            if (idx === i || usedIndices.has(idx)) return false;
            if (!candidate || candidate.type !== 'Výdaj') return false;
            if (candidate.date !== current.date) return false;

            const candidateAmount = Number.parseFloat(candidate.amount || 0);
            return Math.abs(candidateAmount - MERGED_HOUSING_AMOUNT) < 0.001;
        });

        if (partnerIndex === -1) {
            merged.push(current);
            continue;
        }

        const partner = transactions[partnerIndex];
        usedIndices.add(partnerIndex);

        const mergedAmount = Number.parseFloat(current.amount || 0) + Number.parseFloat(partner.amount || 0);
        merged.push({
            ...current,
            amount: Number.parseFloat(mergedAmount.toFixed(2)),
            category: 'VD - bytové družstvo',
            note: 'bytové družstvo',
            counterParty: current.counterParty || partner.counterParty,
            sourceBankRefs: [...(current.sourceBankRefs || []), ...(partner.sourceBankRefs || [])],
            bankRef: [...(current.sourceBankRefs || []), ...(partner.sourceBankRefs || [])].filter(Boolean).join('|')
        });
    }

    return merged;
}

function buildTxSignature(tx) {
    const amount = Number.parseFloat(tx.amount || 0).toFixed(2);
    return [
        tx.uid || '',
        tx.date || '',
        tx.type || '',
        tx.category || '',
        amount,
        tx.note || ''
    ].join('|');
}

export function setupImportEvents(db, user, refreshCallback) {
    const fileInput = document.getElementById('bankImportInput');
    const modal = document.getElementById('importPreviewModal');
    const previewList = document.getElementById('importPreviewList');
    const searchInput = document.getElementById('importPreviewSearchInput');
    const previewTableWrap = modal?.querySelector('.table-wrap');
    const previewModalBody = modal?.querySelector('.modal-body');
    const selectVisibleCheckbox = document.getElementById('selectAllImport');
    const hideDuplicatesCheckbox = document.getElementById('hideDuplicateImports');
    const selectVisibleButton = document.getElementById('btnSelectVisibleImport');
    const selectNewButton = document.getElementById('btnSelectNewImport');
    const clearSelectionButton = document.getElementById('btnClearImportSelection');
    const ignoreFeesButton = document.getElementById('btnIgnoreImportFees');
    const selectLowConfidenceButton = document.getElementById('btnSelectLowConfidenceImport');

    const summaryNodes = {
        total: document.getElementById('importSummaryTotalCount'),
        visible: document.getElementById('importSummaryVisibleCount'),
        duplicates: document.getElementById('importSummaryDuplicateCount'),
        selected: document.getElementById('importSummarySelectedCount'),
        income: document.getElementById('importSummaryIncome'),
        expense: document.getElementById('importSummaryExpense'),
        merged: document.getElementById('importSummaryMergedCount')
    };

    const normalizeSearchValue = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const getVisibleRows = () => Array.from(previewList.querySelectorAll('tr')).filter((row) => row.style.display !== 'none');

    const countMergeCandidates = (transactions) => {
        const rentDates = new Set();
        const amountDates = new Set();

        transactions.forEach((tx) => {
            if (!tx || tx.type !== 'Výdaj') return;
            const note = String(tx.note || '').toLowerCase();
            const amount = Number.parseFloat(tx.amount || 0);
            if (note.includes('najom') || note.includes('nájom')) {
                rentDates.add(tx.date);
            }
            if (Math.abs(amount - MERGED_HOUSING_AMOUNT) < 0.001) {
                amountDates.add(tx.date);
            }
        });

        let count = 0;
        rentDates.forEach((date) => {
            if (amountDates.has(date)) {
                count += 1;
            }
        });
        return count;
    };

    const updateImportPreviewSummary = () => {
        const rows = Array.from(previewList.querySelectorAll('tr'));
        const visibleRows = getVisibleRows();
        const selectedTransactions = [];
        let income = 0;
        let expense = 0;
        let duplicates = 0;

        rows.forEach((row) => {
            const index = Number.parseInt(row.dataset.index || '-1', 10);
            const tx = pendingTransactions[index];
            if (!tx) return;
            if (tx.isDuplicate) {
                duplicates += 1;
            }
            const checkbox = row.querySelector('.import-check');
            if (checkbox?.checked) {
                selectedTransactions.push(tx);
                if (tx.type === 'Príjem') {
                    income += Number(tx.amount) || 0;
                } else {
                    expense += Number(tx.amount) || 0;
                }
            }
        });

        if (summaryNodes.total) summaryNodes.total.textContent = String(rows.length);
        if (summaryNodes.visible) summaryNodes.visible.textContent = String(visibleRows.length);
        if (summaryNodes.duplicates) summaryNodes.duplicates.textContent = String(duplicates);
        if (summaryNodes.selected) summaryNodes.selected.textContent = String(selectedTransactions.length);
        if (summaryNodes.income) summaryNodes.income.textContent = formatCurrencySK(income);
        if (summaryNodes.expense) summaryNodes.expense.textContent = formatCurrencySK(expense);
        if (summaryNodes.merged) summaryNodes.merged.textContent = String(countMergeCandidates(selectedTransactions));

        if (selectVisibleCheckbox) {
            const selectableVisible = visibleRows.filter((row) => {
                const checkbox = row.querySelector('.import-check');
                return Boolean(checkbox) && !checkbox.disabled;
            });
            selectVisibleCheckbox.checked = selectableVisible.length > 0 && selectableVisible.every((row) => row.querySelector('.import-check')?.checked);
        }
    };

    const applyImportPreviewFilters = () => {
        const term = normalizeSearchValue(searchInput?.value || '');
        const rows = previewList.querySelectorAll('tr');
        rows.forEach((row) => {
            const haystack = row.dataset.search || '';
            const isDuplicate = row.dataset.duplicate === 'true';
            const isIgnored = row.dataset.ignored === 'true';
            const matchesSearch = !term || haystack.includes(term);
            const visible = !isIgnored && matchesSearch && !(hideDuplicatesCheckbox?.checked && isDuplicate);
            row.style.display = visible ? '' : 'none';
        });
        updateImportPreviewSummary();
    };

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setImportWizardStep(1);
        showToast('Import krok 1/4: súbor načítaný', 'info', { durationMs: 1400 });

        const reader = new FileReader();
        reader.onload = async (event) => {
            setImportWizardStep(2);
            showToast('Import krok 2/4: validujem a párujem duplicity', 'warning', { durationMs: 1400 });
            const xmlText = event.target.result;
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const entries = xmlDoc.getElementsByTagName("Ntry");

            // Načítanie existujúcich transakcií kvôli duplicitám
            const existingRefs = new Set();
            const existingSignatures = new Set();
            const existingTransactions = [];
            const relevantYears = buildRelevantYears(entries);
            let querySnapshot = null;

            if (relevantYears.length > 0 && relevantYears.length <= 10) {
                const q = query(
                    collection(db, "transactions"),
                    where("uid", "==", user.uid),
                    where("year", "in", relevantYears)
                );
                querySnapshot = await getDocs(q);
            } else {
                const q = query(collection(db, "transactions"), where("uid", "==", user.uid));
                querySnapshot = await getDocs(q);
            }

            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data() || {};
                if (data.bankRef) existingRefs.add(data.bankRef);
                existingSignatures.add(buildTxSignature({ uid: user.uid, ...data }));
                existingTransactions.push({ id: docSnap.id, uid: user.uid, ...data });
            });
            const suggestionMap = buildHistorySuggestionMap(existingTransactions);

            const importedRows = [];
            const customRules = parseImportRulesText(document.getElementById('importRulesText')?.value || '').rules;

            for (let ntry of entries) {
                const bankRef = ntry.getElementsByTagName("NtryRef")[0]?.textContent;
                const amount = parseFloat(ntry.getElementsByTagName("Amt")[0].textContent);
                const indicator = ntry.getElementsByTagName("CdtDbtInd")[0].textContent; // CRDT/DBIT
                const date = ntry.getElementsByTagName("BookgDt")[0].getElementsByTagName("Dt")[0].textContent;
                const txDetails = ntry.getElementsByTagName("TxDtls")[0];
                const merchantName = txDetails
                    ?.getElementsByTagName("TradgPty")[0]
                    ?.getElementsByTagName("Nm")[0]
                    ?.textContent;
                const creditorName = txDetails
                    ?.getElementsByTagName("Cdtr")[0]
                    ?.getElementsByTagName("Nm")[0]
                    ?.textContent;
                const debtorName = txDetails
                    ?.getElementsByTagName("Dbtr")[0]
                    ?.getElementsByTagName("Nm")[0]
                    ?.textContent;
                const fallbackName = ntry.getElementsByTagName("Nm")[0]?.textContent;
                const counterParty = (merchantName || creditorName || debtorName || fallbackName || "Neznámy").trim();
                const narrative = ntry.getElementsByTagName("Nrtv")[0]?.textContent || "";
                const unstructured = ntry.getElementsByTagName("Ustrd")[0]?.textContent || "";

                const note = `${counterParty} - ${narrative || unstructured}`.trim();
                let category = classifyImportedTransaction(indicator, counterParty, narrative, unstructured, amount, customRules);
                const historySuggestion = getHistorySuggestion(counterParty, suggestionMap);
                const fullImportText = `${counterParty} ${narrative || ''} ${unstructured || ''}`;
                if ((category === 'VD - iné' || category === 'PD - iné') && historySuggestion?.category) {
                    category = historySuggestion.category;
                }
                const confidence = detectImportConfidence(fullImportText, category, historySuggestion);

                importedRows.push({
                    bankRef,
                    sourceBankRefs: bankRef ? [bankRef] : [],
                    date,
                    amount,
                    category,
                    type: indicator === "CRDT" ? "Príjem" : "Výdaj",
                    note,
                    counterParty,
                    narrative: narrative || unstructured,
                    importConfidence: confidence.level,
                    importConfidenceLabel: confidence.label,
                    importReview: confidence.review,
                    suggestedCategory: historySuggestion?.category || '',
                    suggestedHits: historySuggestion?.hits || 0
                });
            }

            // V náhľade nechávame položky oddelene; zlúčenie sa vykoná až pri potvrdení importu.
            pendingTransactions = importedRows;
            previewList.innerHTML = "";
            if (selectVisibleCheckbox) {
                selectVisibleCheckbox.checked = false;
            }
            if (hideDuplicatesCheckbox) {
                hideDuplicatesCheckbox.checked = false;
            }
            if (searchInput) {
                searchInput.value = '';
            }
            if (previewTableWrap) {
                previewTableWrap.scrollTop = 0;
            }
            if (previewModalBody) {
                previewModalBody.scrollTop = 0;
            }

            pendingTransactions.forEach((tx) => {
                const signature = buildTxSignature({
                    uid: user.uid,
                    date: tx.date,
                    type: tx.type,
                    category: tx.category,
                    amount: tx.amount,
                    note: tx.note
                });
                const duplicateTier = detectDuplicateTier({ ...tx, uid: user.uid }, existingTransactions, existingRefs, existingSignatures);
                const isDuplicate = duplicateTier === 'exact';

                tx.isDuplicate = isDuplicate;
                tx.duplicateTier = duplicateTier;
                if (!isDuplicate) {
                    existingSignatures.add(signature);
                }

                // Vykreslenie riadku do tabuľky
                const tr = document.createElement('tr');
                tr.style.opacity = isDuplicate ? '0.5' : '1';
                tr.classList.toggle('import-preview-row-danger', duplicateTier === 'exact');
                tr.classList.toggle('import-preview-row-warning', duplicateTier === 'probable' || tx.importConfidence === 'low');
                tr.dataset.index = String(pendingTransactions.indexOf(tx));
                tr.dataset.duplicate = isDuplicate ? 'true' : 'false';
                tr.dataset.confidence = tx.importConfidence || 'low';
                tr.dataset.duplicateTier = duplicateTier;
                tr.dataset.search = normalizeSearchValue([
                    tx.date,
                    tx.counterParty,
                    tx.narrative,
                    tx.note,
                    tx.category,
                    tx.type,
                    formatCurrencySK(tx.amount)
                ].join(' '));
                tr.innerHTML = `
                    <td style="padding: 10px;"><input type="checkbox" class="import-check" ${isDuplicate ? 'disabled' : ''}></td>
                    <td style="white-space: nowrap;">${tx.date.split('-').reverse().join('.')}</td>
                    
                    <td style="word-break: break-word; min-width: 200px; padding-right: 15px;">
                        <div class="import-preview-row-main">
                            <strong>${tx.counterParty || 'Neznámy'}</strong>
                            <small>${tx.narrative || tx.note || ''}</small>
                            ${tx.suggestedCategory ? `<div class="import-preview-helper"><span class="import-review-badge review-warning">História ${tx.suggestedHits}x</span></div>` : ''}
                        </div>
                    </td>
                    
                    <td style="text-align: right; font-weight: bold; color: ${tx.type === 'Príjem' ? 'var(--success)' : 'var(--danger)'}; white-space: nowrap;">
                        ${formatCurrencySK(tx.amount)}
                    </td>
                    <td><span class="tx-category-pill ${tx.type === 'Príjem' ? 'category-income' : 'category-other'}">${tx.category}</span></td>
                    <td><span class="import-confidence-badge confidence-${tx.importConfidence}">${tx.importConfidenceLabel}</span></td>
                    <td><span class="import-review-badge ${tx.duplicateTier === 'exact' ? 'review-danger' : tx.duplicateTier === 'probable' || tx.duplicateTier === 'similar' ? 'review-warning' : tx.importReview}">${tx.duplicateTier === 'exact' ? 'Duplicita' : tx.duplicateTier === 'probable' ? 'Pravdepodobná' : tx.duplicateTier === 'similar' ? 'Podobná' : 'OK'}</span></td>
                `;
                tr.querySelector('.import-check')?.addEventListener('change', updateImportPreviewSummary);
                previewList.appendChild(tr);
            });

            applyImportPreviewFilters();

            setImportWizardStep(3);
            modal.style.display = "flex";
        };
        reader.readAsText(file);
    });

    // Tlačidlo: Potvrdiť import vybraných
    document.getElementById('btnConfirmFinalImport').addEventListener('click', async () => {
        setImportWizardStep(4);
        showToast('Import krok 4/4: zapisujem transakcie', 'warning', { durationMs: 1400 });
        const checkboxes = document.querySelectorAll('.import-check');
        let count = 0;
        let skippedDuplicates = 0;
        const selectedForImport = [];
        const importedDocIds = [];

        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                const data = pendingTransactions[i];
                if (data?.isDuplicate) {
                    skippedDuplicates++;
                    continue;
                }
                selectedForImport.push(data);
            }
        }

        const transactionsToSave = mergeHousingSplitPayments(selectedForImport);
        const selectedTotal = transactionsToSave.length;
        const importBatchId = selectedTotal > 0 ? `xml-${Date.now()}` : '';
        const mergedPairs = countMergeCandidates(selectedForImport);

        for (let i = 0; i < transactionsToSave.length; i++) {
            const data = transactionsToSave[i];
            const txYear = Number.parseInt(String(data.date || '').slice(0, 4), 10);
            const docRef = await addDoc(collection(db, "transactions"), {
                uid: user.uid,
                date: data.date,
                type: data.type,
                amount: data.amount,
                category: data.category,
                note: data.note,
                account: "banka",
                bankRef: data.bankRef,
                importBatchId,
                importedAt: new Date().toISOString(),
                importedBy: user.email || '',
                source: 'import',
                importConfidence: data.importConfidence || 'low',
                importReview: data.duplicateTier || data.importReview || 'review-warning',
                year: Number.isNaN(txYear) ? activeYear : txYear,
                archived: false,
                createdAt: new Date()
            });
            importedDocIds.push(docRef.id);
            count++;

            if (selectedTotal > 0 && count % 25 === 0) {
                showToast(`Spracované ${count}/${selectedTotal} položiek`, 'info', { durationMs: 1200 });
            }
        }

        modal.style.display = "none";
        lastImportedDocIds = importedDocIds;
        if (count > 0 && importBatchId) {
            await setDoc(doc(db, 'users', user.uid), {
                lastImportBatchId: importBatchId,
                lastImportCount: count,
                lastImportAt: new Date().toISOString()
            }, { merge: true });

            await logAuditEvent(db, {
                uid: user.uid,
                actor: user.email,
                action: 'import-xml',
                entityType: 'transaction-import',
                batchId: importBatchId,
                year: activeYear,
                message: `Import XML: ${count} pridaných, duplicity ${skippedDuplicates}, zlúčené páry ${mergedPairs}`,
                metadata: {
                    importedCount: count,
                    skippedDuplicates,
                    mergedPairs
                }
            });
        }
        if (skippedDuplicates > 0) {
            showToast(`Pridaných ${count} transakcií, preskočené duplicity: ${skippedDuplicates}`, "warning");
        } else {
            showToast(`Úspešne pridaných ${count} transakcií`, "success");
        }
        if (count > 0) {
            showToast('Posledný import môžeš vrátiť', 'info', {
                durationMs: 9000,
                action: {
                    label: 'Storno importu',
                    onClick: async () => {
                        await undoLastImport(db, user);
                        await refreshCallback();
                    }
                }
            });
        }
        refreshCallback();
        document.getElementById('bankImportInput').value = ""; // Reset
    });

    // Tlačidlo: Zrušiť
    document.getElementById('btnCancelImport').addEventListener('click', () => {
        modal.style.display = "none";
        setImportWizardStep(2);
        document.getElementById('bankImportInput').value = "";
        if (previewTableWrap) {
            previewTableWrap.scrollTop = 0;
        }
        if (previewModalBody) {
            previewModalBody.scrollTop = 0;
        }
    });

    // Logika pre výber viditeľných položiek
    selectVisibleCheckbox?.addEventListener('change', (e) => {
        getVisibleRows().forEach((row) => {
            const checkbox = row.querySelector('.import-check');
            if (checkbox && !checkbox.disabled) {
                checkbox.checked = e.target.checked;
            }
        });
        updateImportPreviewSummary();
    });

    selectVisibleButton?.addEventListener('click', () => {
        getVisibleRows().forEach((row) => {
            const checkbox = row.querySelector('.import-check');
            if (checkbox && !checkbox.disabled) {
                checkbox.checked = true;
            }
        });
        updateImportPreviewSummary();
    });

    selectNewButton?.addEventListener('click', () => {
        Array.from(previewList.querySelectorAll('tr')).forEach((row) => {
            const checkbox = row.querySelector('.import-check');
            if (!checkbox || checkbox.disabled) {
                if (checkbox) checkbox.checked = false;
                return;
            }
            checkbox.checked = row.style.display !== 'none';
        });
        updateImportPreviewSummary();
    });

    clearSelectionButton?.addEventListener('click', () => {
        document.querySelectorAll('.import-check').forEach((checkbox) => {
            checkbox.checked = false;
        });
        updateImportPreviewSummary();
    });

    ignoreFeesButton?.addEventListener('click', () => {
        Array.from(previewList.querySelectorAll('tr')).forEach((row) => {
            const index = Number.parseInt(row.dataset.index || '-1', 10);
            const tx = pendingTransactions[index];
            if (!tx || !isImportFeeLike(tx)) return;
            const checkbox = row.querySelector('.import-check');
            if (checkbox) checkbox.checked = false;
            row.style.display = 'none';
            row.dataset.ignored = 'true';
        });
        updateImportPreviewSummary();
    });

    selectLowConfidenceButton?.addEventListener('click', () => {
        Array.from(previewList.querySelectorAll('tr')).forEach((row) => {
            const checkbox = row.querySelector('.import-check');
            if (!checkbox || checkbox.disabled) return;
            checkbox.checked = row.dataset.confidence === 'low' && row.style.display !== 'none';
        });
        updateImportPreviewSummary();
    });

    hideDuplicatesCheckbox?.addEventListener('change', applyImportPreviewFilters);
    searchInput?.addEventListener('input', applyImportPreviewFilters);
}

async function undoLastImport(db, user) {
    if (!user?.uid) {
        showToast('Nie je čo stornovať', 'warning');
        return;
    }

    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (Array.isArray(lastImportedDocIds) && lastImportedDocIds.length > 0) {
        const ids = [...lastImportedDocIds];
        for (const id of ids) {
            await deleteDoc(doc(db, 'transactions', id));
        }
        lastImportedDocIds = [];
        await setDoc(doc(db, 'users', user.uid), {
            lastImportBatchId: '',
            lastImportCount: 0
        }, { merge: true });
        await logAuditEvent(db, {
            uid: user.uid,
            actor: user.email,
            action: 'import-undo',
            entityType: 'transaction-import',
            year: activeYear,
            message: `Storno posledného importu (${ids.length} transakcií)`
        });
        showToast(`Import bol vrátený (${ids.length} transakcií)`, 'success');
        return;
    }

    const batchId = userDoc.exists() ? userDoc.data().lastImportBatchId : '';
    if (!batchId) {
        showToast('Nie je čo stornovať', 'warning');
        return;
    }

    const batchSnapshot = await getDocs(query(
        collection(db, 'transactions'),
        where('uid', '==', user.uid),
        where('importBatchId', '==', batchId)
    ));

    if (batchSnapshot.empty) {
        showToast('Posledná dávka importu sa nenašla', 'warning');
        return;
    }

    let deleted = 0;
    for (const docSnap of batchSnapshot.docs) {
        await deleteDoc(docSnap.ref);
        deleted += 1;
    }

    await setDoc(doc(db, 'users', user.uid), {
        lastImportBatchId: '',
        lastImportCount: 0
    }, { merge: true });

    await logAuditEvent(db, {
        uid: user.uid,
        actor: user.email,
        action: 'import-undo',
        entityType: 'transaction-import',
        batchId,
        year: activeYear,
        message: `Storno posledného importu (${deleted} transakcií)`
    });

    showToast(`Import bol vrátený (${deleted} transakcií)`, 'success');
}

function setImportWizardStep(step) {
    const steps = document.querySelectorAll('#importWizardSteps .wizard-step');
    if (!steps.length) return;

    steps.forEach((el, index) => {
        const position = index + 1;
        el.classList.toggle('active', position === step);
        el.classList.toggle('done', position < step);
    });
}