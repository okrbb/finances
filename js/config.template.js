// 1. Importy z CDN (rovnaké ako v lokálnom config.js)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 2. Konfigurácia s placeholdermi (túto časť GitHub Actions nahradí tajnými kľúčmi)
const firebaseConfig = {
    apiKey: "FIREBASE_API_KEY_PLACEHOLDER",
    authDomain: "FIREBASE_AUTH_DOMAIN_PLACEHOLDER",
    projectId: "FIREBASE_PROJECT_ID_PLACEHOLDER",
    storageBucket: "FIREBASE_STORAGE_BUCKET_PLACEHOLDER",
    messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER",
    appId: "FIREBASE_APP_ID_PLACEHOLDER"
};

// 3. Inicializácia Firebase (TOTO TI CHÝBALO)
const app = initializeApp(firebaseConfig);

// 4. Exporty, ktoré app.js očakáva (TOTO SPÔSOBOVALO CHYBU)
export const auth = getAuth(app);
export const db = getFirestore(app);

// 5. Konštanty (ak ich používaš)
export const APP_CONSTANTS = {
    TOAST_DURATION: 3000,
    SEARCH_DEBOUNCE_MS: 300,
    DEFAULT_AVATAR: '--'
};