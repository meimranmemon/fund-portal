// ============================================================================
// FIREBASE WEB CONFIGURATION — Fund Investor Portal
// Project: fund-investor-portal (toimran.memon@gmail.com)
// ============================================================================
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCh7uxdyAsWpg6fIy75_ai5p_ZQ8t9LVlw",
  authDomain: "fund-investor-portal.firebaseapp.com",
  projectId: "fund-investor-portal",
  storageBucket: "fund-investor-portal.firebasestorage.app",
  messagingSenderId: "915781424805",
  appId: "1:915781424805:web:0ddb9d0605ce070005df4c"
};

// Initialize Firebase App
if (typeof firebase !== "undefined" && !firebase.apps.length) {
  try {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  } catch (e) {
    console.error("Firebase init error:", e);
  }
}

// Helper to get fresh ID token
async function getFreshToken(forceRefresh = false) {
  return new Promise((resolve) => {
    const unsubscribe = firebase.auth().onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) {
        resolve(null);
      } else {
        try {
          const token = await user.getIdToken(forceRefresh);
          resolve(token);
        } catch (err) {
          console.error("Failed to fetch fresh ID token:", err);
          resolve(null);
        }
      }
    });
  });
}
