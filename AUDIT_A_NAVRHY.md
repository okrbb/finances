# 📊 AUDIT APLIKÁCIE - NÁLEZY A NÁVRHY

**Dátum auditu:** 11. január 2026  
**Aplikácia:** Daňová Evidencia (PWA)  
**Verzia:** Cache v5

---

## 🔴 KRITICKÉ PROBLÉMY

### 1. BEZPEČNOSŤ - Firebase API kľúče v kóde
**Problém:**
- `js/config.js` obsahuje všetky Firebase credentials priamo v kóde
- Tieto údaje sú verejne viditeľné v GitHub repozitári
- Hoci Firebase má Security Rules, API key by nemal byť verejný

**Riziko:**
- Potenciálne zneužitie API kvóty
- Neoprávnený prístup k databáze (ak Security Rules nie sú správne nastavené)

**Riešenie:**
- Použiť `config.template.js` ako vzor a skutočný `config.js` pridať do `.gitignore`
- Prípadne presunúť na server-side endpointy s Firebase Admin SDK
- Overiť a sprínsniť Firebase Security Rules

---

### 2. Import aktívneho roka v transactions.js
**Problém:**
```javascript
import { activeYear } from '../app.js';
```
- Tento import môže viesť k circular dependency problémom
- `activeYear` je premenná, nie konštanta - import nemusí zachytiť zmeny hodnoty
- Pri prepnutí roka v aplikácii sa nová hodnota nemusí preniesť

**Riešenie:**
- Použiť callback pattern (podobne ako `getUserCallback`)
- Pridať `getActiveYear` callback do `setupTransactionEvents`
- Príklad:
```javascript
export function setupTransactionEvents(db, getUserCallback, getActiveYearCallback, refreshDataCallback)
```

---

## 🟠 STREDNE ZÁVAŽNÉ PROBLÉMY

### 3. Chýbajúce error handling v kritických operáciách
**Problém:**
- `loadBudgetForMonth` - loguje chybu len do konzoly, používateľ nevidí problém
- `saveAllBudget` - ukáže len generické "Chyba!", bez detailov
- `handleFormSubmit` - chyby sa zobrazujú v toast, ktoré môžu zmiznúť príliš rýchlo

**Príklady:**
```javascript
// budget.js - riadok 145
catch (error) {
    console.error("Chyba načítania rozpočtu:", error);
    // Používateľ nevidí chybu!
}

// budget.js - riadok 174
catch (error) {
    statusElem.textContent = 'Chyba!';
    // Žiadne detaily o tom, čo sa pokazilo
}
```

**Riešenie:**
- Implementovať jednotný error handling systém
- Zobrazovať používateľsky priateľské chybové hlásenia
- Logovať detaily do konzoly pre debugging
- Príklad:
```javascript
catch (error) {
    console.error("Detail chyby:", error);
    showToast("Nepodarilo sa načítať rozpočet. Skúste obnoviť stránku.", "danger");
}
```

---

### 4. Race conditions pri prepínaní rokov
**Problém:**
- Pri rýchlom prepnutí medzi rokmi (2025 → 2026 → 2025) môže dôjsť k načítaniu nesprávnych dát
- `refreshData()` sa volá bez debouncing
- Viacero súbežných Firestore requestov môže vrátiť dáta v nesprávnom poradí

**Riešenie:**
- Implementovať debouncing (300-500ms)
- Použiť request ID a ignorovať staršie requesty
- Zobrazovať loading state počas prepínania

---

### 5. Chýbajúca validácia dátumov
**Problém:**
- Používateľ môže pridať transakciu s dátumom z uzavretého roka
- Month selector v rozpočte umožňuje vybrať budúce roky (napr. 2030)
- Nie je kontrola logickosti dátumu (napr. 1.1.1900)

**Riešenie:**
- Pri pridávaní transakcie kontrolovať, či dátum patrí do aktívneho roka
- Obmedziť month selector na rozsah ±5 rokov
- Pridať min/max atribúty na date inputy

---

### 6. Nekonzistentná validácia vstupov
**Problém:**
- Transakcie: validuje sa len `amount > 0`
- Rozpočet: žiadna validácia číselných hodnôt
- Nastavenia: žiadna validácia DIČ formátu (SK1234567890), IBAN formátu

**Príklady chýb:**
- Používateľ zadá záporné číslo do rozpočtu
- Nesprávny formát DIČ alebo IBAN
- Text namiesto čísel v sume

**Riešenie:**
- Vytvoriť validation helper funkcie
- Validovať DIČ: SK + 10 číslic
- Validovať IBAN: SK + 22 znakov
- Blokovať neplatné vstupy v reálnom čase

---

## 🟡 MENŠIE PROBLÉMY A UX VYLEPŠENIA

### 7. Duplicitný kód v reports.js
**Problém:**
- `exportMonthlyPdfReport` (300+ riadkov) a `exportRentPdfReport` (250+ riadkov)
- Cca 70% kódu je identický
- Ťažké udržiavanie - zmena v jednom vyžaduje zmenu v druhom

**Riešenie:**
- Vytvoriť spoločnú funkciu `generateMonthlyPdfReport(transactions, options)`
- Použiť parameter `filterType: 'all' | 'rent'`
- Zredukovať kód o cca 200 riadkov

---

### 8. Žiadne loading stavy
**Problém:**
- Pri načítavaní dát z Firestore nie je žiadny vizuálny indikátor
- Používateľ nevidí, či aplikácia načítava dáta alebo zamrzla
- Najmä problém pri pomalšom internete

**Riešenie:**
- Pridať loading spinner do dashboard, transakcií, rozpočtu
- Zobrazovať "Načítavam..." stav
- Disable tlačidlá počas operácií

---

### 9. Chýbajúca offline podpora
**Problém:**
- Service Worker cachuje len statické súbory (.js, .css, .html)
- Firestore dáta nie sú dostupné offline
- Pri strate pripojenia aplikácia nefunguje

**Riešenie:**
- Aktivovať Firestore offline persistence:
```javascript
import { enableIndexedDbPersistence } from 'firebase/firestore';
await enableIndexedDbPersistence(db);
```

---

### 10. Neoptimalizované Firestore queries
**Problém:**
- `refreshData()` vždy načíta VŠETKY transakcie pre celý rok
- Pri 1000+ transakciách to môže byť pomalé
- Dashboard zobrazuje len sumáre, nepotrebuje všetky detaily

**Riešenie:**
- Implementovať pagination (napr. 50 transakcií na stránku)
- Dashboard: načítať len agregované dáta
- Lazy loading pre staršie mesiace

---

### 11. Editácia transakcie nemá cancel tlačidlo
**Problém:**
- Po kliknutí "Upraviť" sa formulár naplní dátami
- Submit tlačidlo sa zmení na "Uložiť zmeny"
- Nie je spôsob ako zrušiť editáciu bez reloadu stránky

**Riešenie:**
- Pridať "Zrušiť" tlačidlo vedľa "Uložiť zmeny"
- Kliknutie na "Zrušiť" vyčistí formulár a resetuje stav

---

### 12. Month selector v rozpočte bez limitov
**Problém:**
- Používateľ môže vybrať ľubovoľný rok (1900-2100)
- Nemá zmysel zobrazovať rozpočet pre rok 2050
- Môže to viesť k náhodným kliknutiam a chybám

**Riešenie:**
- Obmedziť na rozsah: `aktívny rok - 2` až `aktívny rok + 1`
- Príklad: ak je aktívny rok 2026, povoliť len 2024-2027

---

### 13. Chýbajúce potvrdzovacie dialógy
**Problém:**
- Niektoré kritické akcie nemají potvrdenie:
  - Mazanie transakcie: má confirm ✅
  - Mazanie rozpočtovej sekcie: má confirm ✅
  - Uzavretie roka: má len v yearClosure view
  - Export zálohy: nemá potvrdenie

**Riešenie:**
- Pridať konzistentné confirm dialógy pre všetky deštruktívne akcie
- Možno vytvoriť vlastný modal pre lepší UX namiesto `confirm()`

---

### 14. Export PDF/Excel nemá progress indikátor
**Problém:**
- Pri exporte veľkého množstva dát (napr. celý rok s 1000+ transakciami)
- Generovanie môže trvať niekoľko sekúnd
- Používateľ nevidí žiadny feedback

**Riešenie:**
- Zobraziť toast "Pripravujem export..." na začiatku
- Progress bar pre dlhé operácie
- Toast "Export dokončený" po skončení

---

## 💡 NÁVRHY NA VYLEPŠENIA

### 15. Dashboard - chýbajúce grafy
**Návrh:**
- Dashboard má len číselné sumáre, chýba vizualizácia
- Pridať mini grafy (sparklines) pre mesačné trendy
- Graf príjmov vs. výdavkov za posledných 6 mesiacov

**Benefit:**
- Rýchly vizuálny prehľad finančnej situácie
- Identifikácia trendov bez otvárania Prehľadov

---

### 16. Kategórie transakcií - hardcoded
**Návrh:**
- Aktuálne sú kategórie hardcoded v HTML `<select>`
- Používateľ nemôže pridať vlastnú kategóriu
- Zmena kategórií vyžaduje úpravu kódu

**Riešenie:**
- Presunúť kategórie do Firestore kolekcie `categories`
- Umožniť používateľovi pridávať/upravovať/mazať kategórie
- Farby kategórií pre lepšiu vizualizáciu

---

### 17. Pokročilé filtrovanie transakcií
**Návrh:**
- Aktuálne len jednoduchý text search
- Pridať filtre:
  - Podľa dátumu (od-do, tento mesiac, tento rok)
  - Podľa kategórie (multiselect)
  - Podľa sumy (min-max)
  - Podľa účtu

**Benefit:**
- Rýchlejšie nájdenie konkrétnych transakcií
- Lepší prehľad pri veľkom množstve dát

---

### 18. Bulk operácie
**Návrh:**
- Aktuálne sa dá upravovať/mazať len jedna transakcia
- Pridať checkboxy pre výber viacerých transakcií
- Akcie:
  - Bulk delete (hromadné mazanie)
  - Bulk export (export vybraných)
  - Bulk kategorizácia (zmena kategórie pre všetky vybraté)
  - Bulk move to archive

**Benefit:**
- Úspora času pri správe veľkého množstva transakcií
- Napríklad: zmazať všetky testovacie záznamy naraz

---

### 19. Notifikácie pre daňové termíny
**Návrh:**
- Automatické pripomienky pre:
  - Podanie daňového priznania (31. marec)
  - Platba preddavkov (15. každého mesiaca)
  - Uzavretie roka (koniec januára)
- Push notifikácie ak je PWA nainštalovaná

**Implementácia:**
- Používať Web Notifications API
- Nastaviteľné v Settings (vypnúť/zapnúť)

---

### 20. Automatické zálohovanie
**Návrh:**
- Aktuálne je záloha len manuálna
- Pridať automatickú zálohu:
  - Každý týždeň/mesiac
  - Do Google Drive / Dropbox
  - Alebo sťahovanie do Downloads s dátumom

**Benefit:**
- Ochrana pred stratou dát
- Používateľ nemusí myslieť na zálohovanie

---

### 21. Dark mode
**Návrh:**
- Pridať prepínač svetlý/tmavý režim
- Automatická detekcia podľa systémového nastavenia
- Uloženie preferencie do localStorage

**Benefit:**
- Lepšia použiteľnosť v noci
- Moderný look & feel
- Šetrenie batérie na OLED displejoch

---

### 22. Multi-currency podpora
**Návrh:**
- Aktuálne len EUR
- Pridať podporu pre:
  - Viacero mien (USD, CZK, GBP)
  - Kurzové prepočty (API napr. exchangerate-api.com)
  - Zobrazenie v hlavnej mene + pôvodnej

**Use case:**
- Ak pracujete s klientmi v zahraničí
- Cestovné výdavky v iných menách

---

### 23. Štatistiky a trendy
**Návrh:**
- Nová záložka "Štatistiky" s:
  - Dlhodobými trendmi (roky, kvartály)
  - Porovnanie rokov (2025 vs. 2024)
  - Predikcie (ak pokračuje trend, aká bude daň)
  - Top kategórie výdavkov
  - Mesačný priemer príjmov/výdavkov

**Benefit:**
- Lepšie finančné plánovanie
- Identifikácia úspor
- Data-driven rozhodovanie

---

### 24. Export pre účtovníka
**Návrh:**
- Špecifický export formát pre účtovné SW:
  - Money S3
  - Pohoda
  - iDoklad
- CSV v požadovanej štruktúre

**Benefit:**
- Uľahčenie spolupráce s účtovníkom
- Automatické importy do účtovného SW

---

### 25. Automatická kategorizácia (AI)
**Návrh:**
- Machine learning pre automatické priradenie kategórií
- Na základe poznámky a histórie:
  - "ZSE Elektrina" → automaticky kategória "VD - ZSE"
  - "Prenájom Jankovič" → automaticky "PD - prenájom"
- Používateľ len potvrdí alebo upraví

**Implementácia:**
- Začať s jednoduchými pravidlami (keywords)
- Postupne pridávať ML model (TensorFlow.js)

**Benefit:**
- Úspora času pri kategorizácii
- Menej manuálnej práce

---

## 📋 PRIORITIZÁCIA

### 🔥 Kritické - implementovať OKAMŽITE
1. ✅ Firebase API kľúče - presunúť do .gitignore
2. ✅ Fix activeYear import v transactions.js

### ⚡ Vysoká priorita - do 2 týždňov
3. Error handling v kritických operáciách
4. Race conditions pri prepínaní rokov
5. Validácia dátumov
6. Validácia vstupov (DIČ, IBAN, sumy)

### 📌 Stredná priorita - do mesiaca
7. Refaktoring duplicitného kódu (reports.js)
8. Loading stavy
9. Offline podpora (Firestore persistence)
10. Optimalizácia queries
11. Cancel tlačidlo pri editácii
12. Limit month selectora
13. Potvrdzovacie dialógy
14. Progress indikátor pre export

### 🌟 Vylepšenia - podľa potreby
15. Dashboard grafy
16. Vlastné kategórie
17. Pokročilé filtrovanie
18. Bulk operácie
19. Notifikácie
20. Automatické zálohovanie
21. Dark mode
22. Multi-currency
23. Štatistiky a trendy
24. Export pre účtovníka
25. AI kategorizácia

---

## 🎯 ODPORÚČANÝ PLÁN IMPLEMENTÁCIE

### Sprint 1 (Týždeň 1-2) - Security & Stability
- [ ] Body 1, 2 (Kritické bezpečnostné problémy)
- [ ] Body 3, 4 (Error handling, race conditions)

### Sprint 2 (Týždeň 3-4) - Validácia & UX
- [ ] Body 5, 6 (Validácia dátumov a vstupov)
- [ ] Body 8, 11, 13 (Loading stavy, cancel tlačidlo, dialógy)

### Sprint 3 (Mesiac 2) - Optimalizácia
- [ ] Body 7, 9, 10 (Refaktoring, offline, optimalizácia)
- [ ] Body 12, 14 (Limitácie, progress)

### Sprint 4+ - Features
- Postupne pridávať vylepšenia podľa potreby a feedbacku

---

**Poznámka:** Tento dokument je živý - aktualizujte ho podľa postupu implementácie.
