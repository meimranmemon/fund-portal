// CLOUD_API_URL: Set to your Vercel backend URL after deployment
// e.g. "https://fund-portal.vercel.app/api"
// Leave empty ("") when frontend and backend are on the same domain (Vercel)
window.CLOUD_API_URL = "";
// ============================================================================
// FIREBASE WEB CONFIGURATION - Fund Investor Portal
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
  if (typeof firebase === "undefined" || !firebase.auth) return null;
  
  // 1. If currentUser is already known, grab token immediately
  const cur = firebase.auth().currentUser;
  if (cur) {
    try {
      const token = await cur.getIdToken(forceRefresh);
      if (token) return token;
    } catch (e) {
      console.warn("Direct getIdToken error:", e);
    }
  }

  // 2. Otherwise wait for initial onAuthStateChanged event (with safety timeout)
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, 6000);

    const unsubscribe = firebase.auth().onAuthStateChanged(async (user) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
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
