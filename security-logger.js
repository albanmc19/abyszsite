/* security-logger.js : journal de sécurité Abysz. À charger sur CHAQUE page :
   <script type="module" src="security-logger.js"></script>
   Écrit dans Firestore (collection security_logs). Aucune IP ni donnée personnelle n'est collectée.
   Pour ne pas te journaliser toi-même, exécute une fois dans ta console : localStorage.abysz_no_log = "1" */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const db = getFirestore(initializeApp({ apiKey: "AIzaSyBFzPc8WF4IGN74RZ1axtpUBu6Bv8Iu-UQ", authDomain: "abysz-esports.firebaseapp.com", projectId: "abysz-esports", appId: "1:200968659347:web:3a13d1614d00ed29968866" }, "sec-logger"));
const OFF = (() => { try { return localStorage.getItem("abysz_no_log") === "1"; } catch { return false; } })();
const visitor = (() => { try { return (localStorage.getItem("abysz_visitor_id") || "anon").slice(-8); } catch { return "anon"; } })();
const seen = new Set(), perType = {}; let total = 0;
const MAX_TOTAL = 20, MAX_TYPE = 5, DAYS = 30;

function report(type, detail, severity = "medium") {
    if (OFF) return;
    detail = String(detail || "").slice(0, 280);
    const key = type + "|" + detail;
    if (seen.has(key) || total >= MAX_TOTAL || (perType[type] = (perType[type] || 0) + 1) > MAX_TYPE) return;
    seen.add(key); total++;
    addDoc(collection(db, "security_logs"), {
        type: String(type).slice(0, 39), severity, detail,
        page: location.pathname.slice(0, 99) || "/", visitor,
        ua: navigator.userAgent.slice(0, 190),
        ts: serverTimestamp(), expireAt: new Date(Date.now() + DAYS * 864e5)
    }).catch(() => {});
}
window.abyszSecurity = { report };
// Les pages peuvent signaler un événement sans importer ce module : window.dispatchEvent(new CustomEvent("abysz:security", { detail: { type, detail, severity } }))
window.addEventListener("abysz:security", (e) => { const d = e.detail || {}; report(d.type || "custom", d.detail, d.severity || "medium"); });

// 1) Script bloqué par la politique de sécurité (tentative d'injection)
document.addEventListener("securitypolicyviolation", (e) => {
    const u = String(e.blockedURI || "");
    if (/^(chrome|moz|safari)-extension/.test(u)) return;
    report("csp_violation", e.violatedDirective + " : " + (u.split("?")[0] || "inline"), "medium");
});

// 2) Accès Firebase refusé (règles Firestore / Realtime Database)
const DENIED = /permission-denied|permission_denied|Missing or insufficient permissions/i;
const oldErr = console.error;
console.error = function (...a) {
    try { const s = a.map((x) => (x && (x.code || x.message)) || String(x)).join(" "); if (DENIED.test(s)) report("firebase_denied", s.replace(/\s+/g, " "), "medium"); } catch {}
    return oldErr.apply(this, a);
};
window.addEventListener("unhandledrejection", (e) => { const r = e.reason; const s = String((r && (r.code || r.message)) || r); if (DENIED.test(s)) report("firebase_denied", s, "medium"); });

// 3) Script ou iframe étranger ajouté dans la page (hors services Google / Cloudflare)
const OK_HOST = /(^|\.)(google|googleapis|gstatic|googlesyndication|doubleclick|googletagmanager|google-analytics|cloudflare|cloudflareinsights|firebaseapp)\.(com|net)$|(^|\.)adtrafficquality\.google$/;
new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || !/^(SCRIPT|IFRAME)$/.test(n.tagName)) continue;
        const src = n.src || "";
        if (!src) { if (n.tagName === "SCRIPT") report("script_injected", "script inline ajouté après le chargement", "high"); continue; }
        try { const u = new URL(src, location.href); if (u.origin !== location.origin && !OK_HOST.test(u.hostname)) report("script_injected", n.tagName.toLowerCase() + " externe : " + u.origin, "high"); } catch {}
    }
}).observe(document.documentElement, { childList: true, subtree: true });

// 4) Console / outils de développement ouverts (simple indice, pas une preuve : facilement contournable)
let devSeen = false;
setInterval(() => {
    if (devSeen || document.hidden) return;
    if (window.outerWidth - window.innerWidth > 200 || window.outerHeight - window.innerHeight > 200) { devSeen = true; report("devtools_open", "outils de développement ouverts (heuristique)", "info"); }
}, 3000);
