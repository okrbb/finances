import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// --- 1. Setup Events (Volané raz pri štarte) ---
// Prijíma callback na získanie aktuálneho užívateľa, pretože pri štarte ešte nemusí byť prihlásený
export function initSettings(db, getUserCallback) {
    const settingsForm = document.getElementById('settingsForm');

    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const user = getUserCallback();
            if (!user) {
                alert("Chyba: Nie ste prihlásený.");
                return;
            }

            const userData = {
                name: document.getElementById('settingsName').value,
                dic: document.getElementById('settingsDIC').value,
                address: document.getElementById('settingsAddress').value,
                iban: document.getElementById('settingsIBAN').value,
                year: document.getElementById('settingsYear').value
            };
            
            try {
                await setDoc(doc(db, "users", user.uid), userData);
                alert("Nastavenia úspešne uložené");
                // Po uložení obnovíme zobrazenie (sidebar atď.)
                loadUserProfile(user, db); 
            } catch (err) {
                alert("Chyba pri ukladaní: " + err.message);
            }
        });
    }
}

// --- 2. Data Loading (Volané z refreshData pri každej zmene) ---
export async function loadUserProfile(user, db) {
    if (!user) return;

    try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Sidebar info (ľavý panel)
            const userNameEl = document.getElementById('userName');
            const userDicEl = document.getElementById('userDIC');
            if (userNameEl) userNameEl.textContent = data.name || user.email;
            if (userDicEl) userDicEl.textContent = data.dic ? `DIČ: ${data.dic}` : 'DIČ: -';
            
            // Top bar info (hlavička)
            const userAddrEl = document.getElementById('userAddress');
            const userAccEl = document.getElementById('userAccount');
            if (userAddrEl) userAddrEl.textContent = data.address || '-';
            if (userAccEl) userAccEl.textContent = data.iban || '-';
            
            // Form inputs (nastavenia)
            // Kontrolujeme existenciu elementov pre istotu
            const setName = document.getElementById('settingsName');
            const setDic = document.getElementById('settingsDIC');
            const setAddr = document.getElementById('settingsAddress');
            const setIban = document.getElementById('settingsIBAN');
            const setYear = document.getElementById('settingsYear');

            if (setName) setName.value = data.name || '';
            if (setDic) setDic.value = data.dic || '';
            if (setAddr) setAddr.value = data.address || '';
            if (setIban) setIban.value = data.iban || '';
            if (setYear) setYear.value = data.year || '2025';
        }
    } catch (e) {
        console.error("Chyba pri načítaní profilu:", e);
    }
}