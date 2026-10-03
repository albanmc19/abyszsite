/* ============================================================================
   ABYSZ TRACKER : même système que l'index (présence + stats jour/heure + clics)
   À inclure sur roster.html et boutique.html (PAS sur index.html, qui a déjà son tracking).
   Pas de suivi Discord ici : ces pages n'ont pas de bouton Discord.
   ============================================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, onValue, onDisconnect, set, update, remove, increment, serverTimestamp, runTransaction }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBFzPc8WF4IGN74RZ1axtpUBu6Bv8Iu-UQ",
    authDomain: "abysz-esports.firebaseapp.com",
    databaseURL: "https://abysz-esports-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "abysz-esports",
    storageBucket: "abysz-esports.firebasestorage.app",
    messagingSenderId: "200968659347",
    appId: "1:200968659347:web:3a13d1614d00ed29968866"
};

// App nommée : ne rentre pas en conflit avec l'app Firebase déjà créée par la page (Firestore / Auth)
const app = initializeApp(firebaseConfig, "abysz-tracker");
const rtdb = getDatabase(app);

const HEARTBEAT_MS = 25000;
const STALE_MS = 75000;

// ---------- Helpers ----------
const safeKey = (s) => String(s || "inconnu").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "_").slice(0, 40) || "inconnu";
const todayKey = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
function parisHour() {
    const part = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Paris" })
        .formatToParts(new Date()).find((x) => x.type === "hour");
    return (part ? part.value : "00").padStart(2, "0");
}
const dayPath = (sub) => `stats/daily/${todayKey()}/${sub}`;
const hourPath = (sub) => `stats/hourly/${todayKey()}/${parisHour()}/${sub}`;
const bump = (obj) => update(ref(rtdb), obj).catch(() => {});

// Un clic = +1 dans le jour ET dans l'heure, pour chaque nom fourni
function incClicks(names) {
    const upd = {};
    names.forEach((n) => {
        upd[dayPath(`clicks/${n}`)] = increment(1);
        upd[hourPath(`clicks/${n}`)] = increment(1);
    });
    bump(upd);
}

function computeOnline(val, now) {
    let total = 0;
    for (const sessions of Object.values(val || {})) {
        if (!sessions || typeof sessions !== "object") continue;
        let alive = false;
        for (const s of Object.values(sessions)) {
            if (s && typeof s === "object") {
                if (typeof s.lastSeen === "number" && now - s.lastSeen > STALE_MS) continue;
                alive = true;
            } else alive = true;
        }
        if (alive) total++;
    }
    return total;
}

// ---------- Identité de la page et du visiteur (mêmes clés localStorage que l'index) ----------
let visitorId = null;
try {
    visitorId = localStorage.getItem("abysz_visitor_id");
    if (!visitorId) {
        visitorId = "usr_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        localStorage.setItem("abysz_visitor_id", visitorId);
    }
} catch (e) {}
if (!visitorId) visitorId = "usr_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

let fileName = location.pathname.toLowerCase().split("/").pop();
if (!fileName) fileName = "index.html";
const pageKey = fileName.replace(/\.html?$/, "").replace(/[^a-z0-9_-]/g, "_").slice(0, 30) || "index";
const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";

// ---------- 1) Présence en temps réel + pics (jour et heure) ----------
const sessionId = "s_" + Math.random().toString(36).substring(2, 9);
const sessionRef = ref(rtdb, `online_users/${visitorId}/${sessionId}`);
let connected = false, serverOffset = 0, lastVal = null, dayPeakSent = 0;
const hourPeakSent = {};
const isVisible = () => document.visibilityState === "visible";

const register = () => set(sessionRef, {
    page: pageKey, device, visible: isVisible(),
    joinedAt: serverTimestamp(), lastSeen: serverTimestamp()
});
const heartbeat = () => {
    if (!connected) return;
    update(sessionRef, { lastSeen: serverTimestamp(), visible: isVisible(), page: pageKey }).catch(() => {});
};

onValue(ref(rtdb, ".info/serverTimeOffset"), (s) => { serverOffset = s.val() || 0; });
onValue(ref(rtdb, ".info/connected"), async (snap) => {
    connected = snap.val() === true;
    if (!connected) return;
    try {
        await onDisconnect(sessionRef).remove();
        await register();
    } catch (e) { console.warn("Présence indisponible :", e.message); }
});
setInterval(heartbeat, HEARTBEAT_MS);
document.addEventListener("visibilitychange", heartbeat);
window.addEventListener("pagehide", () => { remove(sessionRef).catch(() => {}); });
window.addEventListener("pageshow", (e) => { if (e.persisted && connected) register().catch(() => {}); });

function refreshPeaks() {
    if (lastVal === null) return;
    const total = computeOnline(lastVal, Date.now() + serverOffset);
    if (total < 1) return;
    if (total > dayPeakSent) {
        dayPeakSent = total;
        runTransaction(ref(rtdb, dayPath("peakOnline")), (cur) => ((cur || 0) >= total ? undefined : total)).catch(() => {});
    }
    const hk = todayKey() + "_" + parisHour();
    if ((hourPeakSent[hk] || 0) < total) {
        hourPeakSent[hk] = total;
        runTransaction(ref(rtdb, hourPath("peakOnline")), (cur) => ((cur || 0) >= total ? undefined : total)).catch(() => {});
    }
}
onValue(ref(rtdb, "online_users"), (snap) => { lastVal = snap.val() || {}; refreshPeaks(); });
setInterval(refreshPeaks, 15000);

// ---------- 2) Compteurs au chargement (jour + heure) + contexte visiteur ----------
(function trackPageView() {
    const today = todayKey();
    const hour = parisHour();
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? "edge" : /OPR\/|Opera/.test(ua) ? "opera" : /Chrome\//.test(ua) ? "chrome"
                  : /Firefox\//.test(ua) ? "firefox" : /Safari\//.test(ua) ? "safari" : "autre";
    const os = /Windows/.test(ua) ? "windows" : /Android/.test(ua) ? "android" : /iPhone|iPad|iPod/.test(ua) ? "ios"
             : /Mac OS/.test(ua) ? "macos" : /Linux/.test(ua) ? "linux" : "autre";
    const lang = safeKey((navigator.language || "inconnu").split("-")[0]);
    const w = window.innerWidth;
    const screenSize = w < 600 ? "petit" : w < 1024 ? "moyen" : "grand";
    const tz = safeKey(Intl.DateTimeFormat().resolvedOptions().timeZone);

    // Source : utm > referrer externe > direct
    let source = "direct";
    try {
        const utm = new URLSearchParams(location.search).get("utm_source");
        if (utm) source = "utm_" + safeKey(utm);
        else if (document.referrer) {
            const host = new URL(document.referrer).hostname.replace(/^www\./, "");
            if (host && host !== location.hostname) source = safeKey(host);
        }
    } catch (e) {}

    let kind = "returning";
    try {
        if (!localStorage.getItem("abysz_first_seen")) {
            localStorage.setItem("abysz_first_seen", String(Date.now()));
            kind = "new";
        }
    } catch (e) {}

    const upd = {
        [dayPath("visits")]: increment(1),
        [dayPath(`pages/${pageKey}`)]: increment(1),
        [dayPath(`devices/${device}`)]: increment(1),
        [dayPath(`browsers/${browser}`)]: increment(1),
        [dayPath(`os/${os}`)]: increment(1),
        [dayPath(`languages/${lang}`)]: increment(1),
        [dayPath(`screens/${screenSize}`)]: increment(1),
        [dayPath(`timezones/${tz}`)]: increment(1),
        [dayPath(`hours/h${hour}`)]: increment(1),
        [dayPath(`sources/${source}`)]: increment(1),
        [dayPath(`visitorType/${kind}`)]: increment(1),
        [hourPath("visits")]: increment(1),
        [hourPath(`pages/${pageKey}`)]: increment(1),
        [hourPath(`devices/${device}`)]: increment(1)
    };
    try {
        if (localStorage.getItem("abysz_last_day") !== today) {
            localStorage.setItem("abysz_last_day", today);
            upd[dayPath("uniqueVisitors")] = increment(1);
        }
        const stamp = today + "_" + hour;
        if (localStorage.getItem("abysz_last_hour") !== stamp) {
            localStorage.setItem("abysz_last_hour", stamp);
            upd[hourPath("uniqueVisitors")] = increment(1);
        }
    } catch (e) {}
    bump(upd);
})();

// ---------- 3) Clics (délégation en phase de capture) ----------
// Noms de clics communs à toutes les pages. "boutique" et "roster" alimentent la carte « Intérêt boutique » du dashboard.
const NAV_LINKS = [
    ["a[href='boutique.html']", "boutique", "boutique"],
    ["a[href='roster.html']", "roster", "roster"],
    ["a[href='index.html']", "accueil", "index"]
];

function clickNames(target) {
    if (pageKey === "boutique") {
        const buy = target.closest(".add-to-cart-btn");
        if (buy) {
            const title = buy.closest(".product-card")?.querySelector(".product-title");
            return ["achat", `achat_${safeKey(title ? title.textContent : "produit")}`];
        }
        if (target.closest("#confirmOrderBtn")) return ["commande_yoko"];
    }
    if (pageKey === "roster") {
        const card = target.closest(".player-card");
        if (card) {
            const h = card.querySelector("h3");
            return ["fiche_joueur", `joueur_${safeKey(h ? h.textContent : "inconnu")}`];
        }
        const social = target.closest(".social-icon-link");
        if (social) return [`joueur_social_${safeKey(social.getAttribute("title"))}`];
        if (target.closest("#login-btn")) return ["connexion"];
    }
    for (const [selector, name, skipOn] of NAV_LINKS) {
        if (pageKey !== skipOn && target.closest(selector)) return [name];
    }
    return [];
}

document.addEventListener("click", (e) => {
    if (!e.target || !e.target.closest) return;
    const names = clickNames(e.target);
    if (names.length) incClicks(names);
}, true);

// ---------- 4) Temps passé (onglet visible) : jour + heure ----------
let visibleSince = isVisible() ? Date.now() : null;
function flushTime() {
    if (visibleSince === null) return;
    const s = Math.round((Date.now() - visibleSince) / 1000);
    visibleSince = null;
    if (s > 0 && s < 7200) bump({
        [dayPath("engagement/totalSeconds")]: increment(s),
        [hourPath("engagement/totalSeconds")]: increment(s)
    });
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushTime();
    else visibleSince = Date.now();
});
window.addEventListener("pagehide", flushTime);

// ---------- 5) Profondeur de scroll ----------
const scrollDone = {};
window.addEventListener("scroll", () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    const pct = (window.scrollY / max) * 100;
    [25, 50, 75, 100].forEach((m) => {
        if (pct >= m - 1 && !scrollDone[m]) {
            scrollDone[m] = true;
            bump({ [dayPath(`scroll/p${m}`)]: increment(1) });
        }
    });
}, { passive: true });

// ---------- 6) Erreurs JavaScript (max 3 par chargement) ----------
let jsErrorsSent = 0;
window.addEventListener("error", () => {
    if (jsErrorsSent++ < 3) bump({ [dayPath("errors/js")]: increment(1) });
});
