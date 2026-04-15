// Firebase Cloud Messaging service worker for web push notifications.
// This file MUST be at the root of the web/ directory.
//
// Replace the firebaseConfig values with your real Firebase project
// configuration (same values as in firebase_options.dart).

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAzxr1hhh-d11WM8AJ7-ZDQSvBXlIRyQLo",
  authDomain: "safewalk-backend-sns.firebaseapp.com",
  projectId: "safewalk-backend-sns",
  storageBucket: "safewalk-backend-sns.firebasestorage.app",
  messagingSenderId: "188485248388",
  appId: "1:188485248388:web:0d90c579ae97744da5e9d1",
});

const messaging = firebase.messaging();

// Handle background messages (when the browser tab is not focused).
messaging.onBackgroundMessage(function (payload) {
  console.log("[firebase-messaging-sw.js] Background message:", payload);

  const notificationTitle = payload.notification?.title || "SafeWalk";
  const notificationOptions = {
    body: payload.notification?.body || "",
    icon: "/icons/Icon-192.png",
  };

  return self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});
