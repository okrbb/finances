// js/yearManager.js
// Modul pre správu rokov a uzavretie roka

import { 
    doc, 
    getDoc, 
    setDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    writeBatch,
    addDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { showToast } from './notifications.js';

/**
 * Migrácia existujúcich dát na year system
 * Volá sa automaticky pri prvom načítaní aplikácie
 */
export async function migrateToYearSystem(user, db) {
    try {
        console.log("🔄 Kontrola migrácie na year system...");
        
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        
        // Ak už je migrácia hotová, preskočíme
        if (userDoc.exists() && userDoc.data().migrationCompleted) {
            console.log("✅ Migrácia už bola dokončená");
            return userDoc.data().activeYear;
        }
        
        console.log("🚀 Spúšťam migráciu...");
        
        // 1. Nastaviť activeYear = 2025
        const userData = userDoc.exists() ? userDoc.data() : {};
        await setDoc(userDocRef, {
            ...userData,
            activeYear: 2025,
            archivedYears: [],
            yearClosureDates: {},
            migrationCompleted: true,
            migratedAt: new Date().toISOString()
        }, { merge: true });
        
        // 2. Pridať year: 2025 všetkým existujúcim transakciám
        const txQuery = query(
            collection(db, "transactions"),
            where("uid", "==", user.uid)
        );
        
        const snapshot = await getDocs(txQuery);
        
        if (snapshot.size > 0) {
            const batch = writeBatch(db);
            let updateCount = 0;
            
            snapshot.forEach(docSnap => {
                if (!docSnap.data().year) {
                    batch.update(docSnap.ref, { 
                        year: 2025,
                        archived: false 
                    });
                    updateCount++;
                }
            });
            
            if (updateCount > 0) {
                await batch.commit();
                console.log(`✅ Aktualizovaných ${updateCount} transakcií`);
            }
        }
        
        // 3. Aktualizovať budgets ak existujú
        const budgetQuery = query(
            collection(db, "budgets"),
            where("uid", "==", user.uid)
        );
        
        const budgetSnapshot = await getDocs(budgetQuery);
        
        if (budgetSnapshot.size > 0) {
            const batch = writeBatch(db);
            let budgetUpdateCount = 0;
            
            budgetSnapshot.forEach(docSnap => {
                if (!docSnap.data().year) {
                    batch.update(docSnap.ref, { 
                        year: 2025
                    });
                    budgetUpdateCount++;
                }
            });
            
            if (budgetUpdateCount > 0) {
                await batch.commit();
                console.log(`✅ Aktualizovaných ${budgetUpdateCount} rozpočtov`);
            }
        }
        
        showToast("Aplikácia bola aktualizovaná na nový systém rokov", "success");
        return 2025;
        
    } catch (error) {
        console.error("❌ Chyba pri migrácii:", error);
        showToast("Chyba pri migrácii dát: " + error.message, "danger");
        return 2025; // Fallback
    }
}

/**
 * Získať aktívny rok používateľa
 */
export async function getUserActiveYear(user, db) {
    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            return userDoc.data().activeYear || 2025;
        }
        return 2025;
    } catch (error) {
        console.error("Chyba pri načítaní aktívneho roka:", error);
        return 2025;
    }
}

/**
 * Získať zoznam uzavretých rokov
 */
export async function getArchivedYears(user, db) {
    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            return userDoc.data().archivedYears || [];
        }
        return [];
    } catch (error) {
        console.error("Chyba pri načítaní archívu:", error);
        return [];
    }
}

/**
 * Prepnúť aktívny rok (pre zobrazenie archívu)
 */
export async function switchToYear(year, user, db) {
    try {
        console.log(`🔄 Prepínam na rok ${year}`);
        
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data();
        const activeYear = userData.activeYear;
        const archivedYears = userData.archivedYears || [];
        
        // Kontrola či je rok platný
        if (year !== activeYear && !archivedYears.includes(year)) {
            throw new Error(`Rok ${year} neexistuje`);
        }
        
        return {
            year,
            isArchived: archivedYears.includes(year),
            isActive: year === activeYear
        };
        
    } catch (error) {
        console.error("Chyba pri prepínaní roka:", error);
        showToast("Chyba pri prepínaní roka: " + error.message, "danger");
        return null;
    }
}

/**
 * Kontrola či je potrebné uzavrieť rok
 */
export function checkYearClosureNeeded(activeYear) {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth(); // 0-11
    
    // Ak je december aktívneho roka alebo január nasledujúceho
    if (currentYear === activeYear && currentMonth === 11) {
        return { needed: true, reason: 'december' };
    }
    
    if (currentYear > activeYear && currentMonth === 0) {
        return { needed: true, reason: 'january_next_year' };
    }
    
    return { needed: false };
}

/**
 * Validácia pred uzavretím roka
 */
export async function validateYearClosure(year, user, db) {
    const results = {
        valid: true,
        warnings: [],
        errors: [],
        stats: {}
    };
    
    try {
        // 1. Načítať všetky transakcie za rok
        const txQuery = query(
            collection(db, "transactions"),
            where("uid", "==", user.uid),
            where("year", "==", year)
        );
        
        const snapshot = await getDocs(txQuery);
        const transactions = [];
        snapshot.forEach(doc => transactions.push({ id: doc.id, ...doc.data() }));
        
        results.stats.totalTransactions = transactions.length;
        
        // 2. Kontrola úplnosti
        if (transactions.length === 0) {
            results.errors.push("Žiadne transakcie za rok " + year);
            results.valid = false;
        }
        
        // 3. Kontrola kategórií
        const uncategorized = transactions.filter(tx => 
            !tx.category || tx.category.includes('iné')
        );
        
        if (uncategorized.length > 0) {
            results.warnings.push(`${uncategorized.length} transakcií bez kategórie alebo s kategóriou "iné"`);
        }
        
        // 4. Kontrola pokrytia mesiacov
        const months = new Set();
        transactions.forEach(tx => {
            if (tx.date) {
                const month = tx.date.substring(0, 7); // YYYY-MM
                months.add(month);
            }
        });
        
        results.stats.coveredMonths = months.size;
        
        if (months.size < 12) {
            results.warnings.push(`Pokryté len ${months.size}/12 mesiacov`);
        }
        
        // 5. Kontrola user profilu
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (!userData.dic) results.warnings.push("DIČ nie je vyplnené");
            if (!userData.iban) results.warnings.push("IBAN nie je vyplnený");
        }
        
        // 6. Štatistiky
        const income = transactions
            .filter(tx => tx.type === 'Príjem')
            .reduce((sum, tx) => sum + (tx.amount || 0), 0);
            
        const expenses = transactions
            .filter(tx => tx.type === 'Výdaj')
            .reduce((sum, tx) => sum + (tx.amount || 0), 0);
        
        results.stats.totalIncome = income;
        results.stats.totalExpenses = expenses;
        results.stats.balance = income - expenses;
        
    } catch (error) {
        console.error("Chyba pri validácii:", error);
        results.errors.push("Chyba pri validácii: " + error.message);
        results.valid = false;
    }
    
    return results;
}

/**
 * Uzavretie roka - hlavná funkcia
 */
export async function closeYear(year, user, db) {
    try {
        console.log(`🔒 Uzatváranie roka ${year}...`);
        
        // 1. Validácia
        const validation = await validateYearClosure(year, user, db);
        if (!validation.valid) {
            throw new Error("Validácia zlyhala: " + validation.errors.join(", "));
        }
        
        // 2. Vytvoriť year summary
        const summaryData = {
            uid: user.uid,
            year: year,
            closedAt: new Date().toISOString(),
            finalStats: validation.stats,
            createdAt: new Date()
        };
        
        await addDoc(collection(db, "yearSummaries"), summaryData);
        
        // 3. Označiť všetky transakcie ako archived
        const txQuery = query(
            collection(db, "transactions"),
            where("uid", "==", user.uid),
            where("year", "==", year)
        );
        
        const snapshot = await getDocs(txQuery);
        const batch = writeBatch(db);
        
        snapshot.forEach(docSnap => {
            batch.update(docSnap.ref, { archived: true });
        });
        
        await batch.commit();
        
        // 4. Aktualizovať user profil
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        const userData = userDoc.data();
        
        const newYear = year + 1;
        const archivedYears = userData.archivedYears || [];
        archivedYears.push(year);
        
        const yearClosureDates = userData.yearClosureDates || {};
        yearClosureDates[year] = new Date().toISOString();
        
        await setDoc(userDocRef, {
            ...userData,
            activeYear: newYear,
            archivedYears: archivedYears,
            yearClosureDates: yearClosureDates
        }, { merge: true });
        
        console.log(`✅ Rok ${year} úspešne uzavretý`);
        
        return {
            success: true,
            newActiveYear: newYear,
            summary: summaryData
        };
        
    } catch (error) {
        console.error("❌ Chyba pri uzavretí roka:", error);
        throw error;
    }
}

/**
 * Export finálneho reportu pred uzavretím
 */
export async function exportYearReport(year, user, db) {
    try {
        // Načítať všetky dáta za rok
        const txQuery = query(
            collection(db, "transactions"),
            where("uid", "==", user.uid),
            where("year", "==", year),
            where("archived", "==", false)
        );
        
        const snapshot = await getDocs(txQuery);
        const transactions = [];
        snapshot.forEach(doc => transactions.push({ id: doc.id, ...doc.data() }));
        
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data();
        
        // Pripraviť JSON export
        const exportData = {
            exportedAt: new Date().toISOString(),
            year: year,
            userEmail: user.email,
            userName: userData.name,
            transactions: transactions,
            summary: {
                totalTransactions: transactions.length,
                totalIncome: transactions
                    .filter(tx => tx.type === 'Príjem')
                    .reduce((sum, tx) => sum + tx.amount, 0),
                totalExpenses: transactions
                    .filter(tx => tx.type === 'Výdaj')
                    .reduce((sum, tx) => sum + tx.amount, 0)
            }
        };
        
        return exportData;
        
    } catch (error) {
        console.error("Chyba pri exporte reportu:", error);
        throw error;
    }
}

/**
 * Odomknutie uzavretého roku - umožní ďalšie editácie
 */
export async function unlockYear(year, user, db) {
    try {
        console.log(`🔓 Odomykam rok ${year}...`);
        
        // 1. Aktualizovať user profil
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        const userData = userDoc.data();
        
        let archivedYears = userData.archivedYears || [];
        archivedYears = archivedYears.filter(y => y !== year);
        
        const yearClosureDates = userData.yearClosureDates || {};
        delete yearClosureDates[year];
        
        await setDoc(userDocRef, {
            ...userData,
            activeYear: year,
            archivedYears: archivedYears,
            yearClosureDates: yearClosureDates
        }, { merge: true });
        
        // 2. Označiť všetky transakcie ako ne-archived
        const txQuery = query(
            collection(db, "transactions"),
            where("uid", "==", user.uid),
            where("year", "==", year)
        );
        
        const snapshot = await getDocs(txQuery);
        const batch = writeBatch(db);
        
        snapshot.forEach(docSnap => {
            batch.update(docSnap.ref, { archived: false });
        });
        
        if (snapshot.size > 0) {
            await batch.commit();
        }
        
        console.log(`✅ Rok ${year} úspešne odomknutý`);
        
        return {
            success: true,
            year: year,
            transactionsUnarchived: snapshot.size
        };
        
    } catch (error) {
        console.error("❌ Chyba pri odomykaní roka:", error);
        throw error;
    }
}
