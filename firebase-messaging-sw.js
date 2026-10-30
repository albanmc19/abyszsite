/* Service worker des notifications push Abysz — à placer à la RACINE du site (à côté d'index.html) */
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
    apiKey: "AIzaSyBFzPc8WF4IGN74RZ1axtpUBu6Bv8Iu-UQ",
    authDomain: "abysz-esports.firebaseapp.com",
    projectId: "abysz-esports",
    storageBucket: "abysz-esports.firebasestorage.app",
    messagingSenderId: "200968659347",
    appId: "1:200968659347:web:3a13d1614d00ed29968866"
});

const messaging = firebase.messaging();

// Les messages avec "notification" sont affichés automatiquement par le navigateur.
// Ce handler ne s'occupe que des messages "data-only" pour éviter les doublons.
messaging.onBackgroundMessage((payload) => {
    if (payload.notification) return;
    const d = payload.data || {};
    self.registration.showNotification(d.title || "Abysz Esports", {
        body: d.body || "",
        icon: d.icon || "/logo.png",
        data: { link: d.link || "/" }
    });
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const link = (event.notification.data && (event.notification.data.link || (event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.notification && event.notification.data.FCM_MSG.notification.click_action))) || "/";
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
            for (const c of list) { if ("focus" in c) { c.navigate(link); return c.focus(); } }
            return clients.openWindow(link);
        })
    );
});
