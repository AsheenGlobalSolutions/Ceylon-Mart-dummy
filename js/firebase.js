// 1) config
const firebaseConfig = {
   apiKey: "AIzaSyCCOGY9c2V2Z1hSTTAeRwwXQnsLtD2jlIU",
    authDomain: "ceylon-mart.firebaseapp.com",
    projectId: "ceylon-mart",
    storageBucket: "ceylon-mart.firebasestorage.app",
    messagingSenderId: "333910815553",
    appId: "1:333910815553:web:185545cb70cce16e97a7c0"
};

// 2) init
firebase.initializeApp(firebaseConfig);

// 3) services
const auth = firebase.auth();
const db = firebase.firestore();


// 4) collections
const productsCol = db.collection("products");
const ordersCol = db.collection("orders");

// 5) expose globals
window.auth = auth;
window.db = db;
window.productsCol = productsCol;
window.ordersCol = ordersCol;

console.log("✅ firebase.js loaded:", {
  auth: !!window.auth,
  db: !!window.db,
  productsCol: !!window.productsCol,
  ordersCol: !!window.ordersCol
});