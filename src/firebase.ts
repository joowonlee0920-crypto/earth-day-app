import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAXfcBJVT7QYEQq3HhgQW7YqIOQ8m2BC0GE",
  authDomain: "earth-day-app.firebaseapp.com",
  projectId: "earth-day-app",
  storageBucket: "earth-day-app.firebasestorage.app",
  messagingSenderId: "965708547266",
  appId: "1:965708547266:web:37e46278660f67d143675b",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);