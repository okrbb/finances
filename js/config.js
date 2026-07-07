// js/config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyCXBQ3Cs14JyvIxFxYb0XbjuccpE1UoekU",
    authDomain: "majky-finances.firebaseapp.com",
    projectId: "majky-finances",
    storageBucket: "majky-finances.firebasestorage.app",
    messagingSenderId: "466566645868",
    appId: "1:466566645868:web:2f183a050e9c201f00b049"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);