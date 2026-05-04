// Firebase Configuration — AR Construction Safety Visualizer
// Project: ar-worker-safety

// ESM CDN imports (no build step needed — vanilla JS PWA)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAQ52vD5iYR3PllzqaC9FJbpV8qK80Xeis",
  authDomain:        "ar-worker-safety.firebaseapp.com",
  databaseURL:       "https://ar-worker-safety-default-rtdb.firebaseio.com",
  projectId:         "ar-worker-safety",
  storageBucket:     "ar-worker-safety.firebasestorage.app",
  messagingSenderId: "211350584852",
  appId:             "1:211350584852:web:4265253b609e34ac703101",
  measurementId:     "G-X7Z770WPJ2"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

export { app, db };

