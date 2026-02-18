// 1) config
const firebaseConfig = {
   apiKey: "AIzaSyCCOGY9c2V2Z1hSTTAeRwwXQnsLtD2jlIU",
    authDomain: "ceylon-mart.firebaseapp.com",
    projectId: "ceylon-mart",
    storageBucket: "ceylon-mart.firebasestorage.app",
    messagingSenderId: "333910815553",
    appId: "1:333910815553:web:185545cb70cce16e97a7c0"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();

window.productsCol = db.collection("products");
window.ordersCol = db.collection("orders");


