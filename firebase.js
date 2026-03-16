const firebaseConfig = {
  apiKey: "AIzaSyA90OVkTb5svXjHrF37wI_0dUWv-4Pr7Xc",
  authDomain: "svs-booking-4a785.firebaseapp.com",
  projectId: "svs-booking-4a785",
  storageBucket: "svs-booking-4a785.firebasestorage.app",
  messagingSenderId: "815196694859",
  appId: "1:815196694859:web:eb39b55526841c248860ce"
};

try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  window.db = firebase.firestore();
  console.log("Firebase initialized");
} catch (error) {
  console.error("Firebase initialization failed:", error);
}
