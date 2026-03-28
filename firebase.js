// firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    orderBy,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAB0uKbCylOiSaX5ltE8K3gasK5d1si_BI",
    authDomain: "bmdapp-a001.firebaseapp.com",
    projectId: "bmdapp-a001",
    storageBucket: "bmdapp-a001.firebasestorage.app",
    messagingSenderId: "968215629877",
    appId: "1:968215629877:web:3ab3d0b39c58195745a17c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export {
    db, auth, provider,
    collection, doc, addDoc, getDoc, getDocs, setDoc, deleteDoc,
    onSnapshot, query, where, orderBy, serverTimestamp, writeBatch,
    signInWithPopup, onAuthStateChanged, signOut
};