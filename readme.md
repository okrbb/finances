# Finančná aplikácia - Budget Manager

Moderná webová aplikácia na správu osobných financií s pokročilými funkciami pre rozpočtovanie, sledovanie transakcií a výpočet daní podľa slovenského daňového systému.

## 🎯 Účel aplikácie

Táto aplikácia je určená na komplexné sledovanie príjmov, výdavkov a správu osobného rozpočtu. Automaticky počítá daňové povinnosti vrátane špeciálnych prípadov ako prenájom nehnuteľností, výsluhový dôchodok a odvody na zdravotné a sociálne pojistenie podľa slovenských zákonov.

## ✨ Hlavné funkcie

### 1. **Autentifikácia používateľov**
- Registrácia nových používateľov (email + heslo)
- Prihlásenie/odhlásenie
- Firebase Authentication zabezpečenie
- Ochrana dát na úrovni používateľa

### 2. **Správa transakcií**
- **Pridávanie transakcií** s nasledujúcimi atribútmi:
  - Dátum
  - Číslo dokladu
  - Druh (Príjem/Výdaj)
  - Účet (peňaženka/banka)
  - Kategória (mzda, prenájom, dôchodok, poistenie, energie...)
  - Poznámka
  - Suma
- **Úprava a mazanie** existujúcich transakcií
- **Automatické vyplňovanie** formulárov na základe dátumu a kategórie
- **Automatické generovanie súvisiacich transakcií** pri zadaní mzdy:
  - Automatický výpočet odvodov (13,4%)
  - Automatické pridanie DDS (15 €)
  - Automatický výpočet preddavku na daň (19% bez NČZD)

### 3. **Mesačný rozpočet**
- **Plánovanie príjmov:**
  - Zamestnanie
  - Dôchodok
  - Prenájom
- **Plánovanie výdavkov:**
  - Bývanie (byt, fond opráv, energie, internet, telefóny, hypotéka...)
  - Ostatné náklady (škola, výživné, poistenie...)
- **Automatický prepočet súm** pri zmene hodnôt
- **Zobrazenie zostatku** (príjmy mínus výdavky)
- **Ukladanie rozpočtu** pre konkrétny mesiac
- **Kopírovanie rozpočtu** do iných mesiacov
- **Vizuálne zvýraznenie** celkových súm farbami

### 4. **Dashboard (Prehľad)**
- Zobrazenie kľúčových finančných ukazovateľov
- Aktuálny zostatok na účtoch
- Prehľad príjmov a výdavkov za zvolené obdobie
- Vizualizácia finančného zdravia

### 5. **Daňový kalkulátor**
Pokročilý výpočet daní podľa slovenského daňového zákona:

- **Príjmy zo závislej činnosti (§5):**
  - Výpočet čiastkového základu dane z mzdy
  - Odpočet povinného poistenia (13,4%)
  
- **Príjmy z prenájmu nehnuteľnosti (§6 ods. 3):**
  - Oslobodenie do 500 € mesačne
  - Proporcionálne krátenie výdavkov vzorcom: (Príjem - 500) / Celkový príjem
  - Odpočet daňových výdavkov (energie, internet, správa nehnuteľnosti...)
  
- **Výsluhový dôchodok:**
  - Zohľadnenie nezdaniteľného príjmu dôchodcov
  
- **Celkový výpočet dane:**
  - Základ dane = (ZD z mzdy + ZD z prenájmu) - DDS
  - Daň = Základ dane × 19%
  - Daň na úhradu = Vypočítaná daň - Zaplatené preddavky

### 6. **Reporting a export**
- **Filtrovanie transakcií:**
  - Podľa dátumového obdobia
  - Podľa druhu (príjem/výdaj)
  - Podľa kategórií (mzda, prenájom, dane, bývanie, energie, TV/internet...)
  
- **Export do Excel (XLSX):**
  - Profesionálne formátovanie
  - Automatické filtre
  - Formátovanie meny (€)
  - Nastaviteľná šírka stĺpcov
  
- **Export do PDF:**
  - Profesionálna šablóna s hlavičkou
  - Údaje používateľa (meno, DIČ, adresa, IBAN)
  - Detailná tabuľka transakcií
  - Výsledná bilancia
  - Farebné zvýraznenie príjmov/výdavkov
  
- **Grafická vizualizácia:**
  - Graf rozdelenia výdavkov podľa kategórií
  - Interaktívne zobrazenie/skrytie grafu

### 7. **Nastavenia**
- Uloženie osobných údajov používateľa:
  - Meno a priezvisko
  - DIČ (Daňové identifikačné číslo)
  - Adresa
  - IBAN

## 🛠️ Technológie

- **Frontend:**
  - Vanilla JavaScript (ES6 modules)
  - HTML5
  - CSS3 (Moderný responsive dizajn)
  
- **Backend:**
  - Firebase Authentication (autentifikácia)
  - Firebase Firestore (databáza v reálnom čase)
  
- **Knižnice:**
  - Firebase SDK 10.7.1
  - SheetJS (XLSX) - export do Excel
  - pdfMake - generovanie PDF
  - Chart.js - grafy a vizualizácie

## 📁 Štruktúra projektu

