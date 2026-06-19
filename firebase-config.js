// firebase-config.js — Configuration Firebase centralisée
// ⚠️  Ce fichier doit rester public : la clé Firebase côté client est conçue pour ça.
//     La vraie sécurité passe par les Firestore Security Rules (côté serveur).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

const firebaseConfig = {
    apiKey: "AIzaSyBFzPc8WF4IGN74RZ1axtpUBu6Bv8Iu-UQ",
    authDomain: "abysz-esports.firebaseapp.com",
    projectId: "abysz-esports",
    storageBucket: "abysz-esports.firebasestorage.app",
    messagingSenderId: "200968659347",
    appId: "1:200968659347:web:3a13d1614d00ed29968866",
    measurementId: "G-HPQNQK5XL1"
};

export const app = initializeApp(firebaseConfig);
