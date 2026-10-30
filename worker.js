/* ============================================================================
   ABYSZ — Serveur d'envoi (Cloudflare Worker, offre gratuite)
   - POST /api/push            : envoie des notifications push (Firebase Cloud Messaging)
   - POST /api/email           : envoie des e-mails (Brevo)
   - GET/POST /unsubscribe/... : désabonnement en un clic (lien dans chaque e-mail)
   - GET  /api/health          : état de la configuration (aucun secret renvoyé)

   Seul l'administrateur (ADMIN_EMAIL) peut utiliser /api/push et /api/email :
   le Worker vérifie à chaque appel le jeton Firebase de la personne connectée.

   Variables / secrets à définir dans Cloudflare (Settings > Variables and Secrets) :
     SERVICE_ACCOUNT  (secret)  JSON complet du compte de service Firebase
     BREVO_API_KEY    (secret)  clé API Brevo
     UNSUB_SECRET     (secret)  longue chaîne aléatoire (signe les liens de désabonnement)
     SENDER_EMAIL     (texte)   adresse expéditrice validée dans Brevo
     SENDER_NAME      (texte)   ex : Abysz Esports
     SITE_URL         (texte)   ex : https://www.ton-site.fr   (sans / final)
     ALLOWED_ORIGIN   (texte)   identique à SITE_URL (autorise uniquement ton dashboard)
   Optionnelles : ADMIN_EMAIL, FIREBASE_API_KEY (valeurs par défaut ci-dessous)
   ============================================================================ */

const DEFAULT_ADMIN_EMAIL = "abyszofficial@gmail.com";
const DEFAULT_FIREBASE_API_KEY = "AIzaSyBFzPc8WF4IGN74RZ1axtpUBu6Bv8Iu-UQ"; // clé web publique du projet

const MAX_CHUNK = 40; // l'offre gratuite autorise 50 appels sortants par requête
const enc = new TextEncoder();
const EMAIL_RE = /^[^\s@<>"',;:\\\/]+@[^\s@<>"',;:\\\/]+\.[^\s@<>"',;:\\\/]{2,}$/;

const httpErr = (status, message) => Object.assign(new Error(message), { status });

function corsHeaders(env, request) {
    const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const allow = allowed.length ? (allowed.includes(origin) ? origin : allowed[0]) : "*";
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

const json = (data, status, headers) =>
    new Response(JSON.stringify(data), { status: status || 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Encodages ---------- */
function b64url(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(str) {
    const b = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
    const bin = atob(b);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/* ---------- Signature des liens de désabonnement ---------- */
async function hmacHex(secret, message) {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
    return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}
async function unsubUrl(env, origin, email) {
    const sig = await hmacHex(env.UNSUB_SECRET, email);
    return `${origin}/unsubscribe/${sig}/${b64url(enc.encode(email))}`;
}

/* ---------- Jeton d'accès Google (compte de service) ---------- */
let tokenCache = { token: null, exp: 0 };
let saCache = null;
function serviceAccount(env) {
    if (!saCache) {
        if (!env.SERVICE_ACCOUNT) throw httpErr(500, "SERVICE_ACCOUNT non configuré sur le serveur d'envoi");
        saCache = JSON.parse(env.SERVICE_ACCOUNT);
    }
    return saCache;
}
async function googleToken(env) {
    if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
    const sa = serviceAccount(env);
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const claim = b64url(enc.encode(JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600
    })));
    const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claim}`));
    const jwt = `${header}.${claim}.${b64url(sig)}`;

    const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + jwt
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw httpErr(500, "Authentification Google impossible : " + (d.error_description || d.error || r.status));
    tokenCache = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
    return d.access_token;
}

/* ---------- Vérification : la personne connectée est bien l'admin ---------- */
async function verifyAdmin(env, idToken) {
    if (!idToken || typeof idToken !== "string") throw httpErr(401, "Non connecté");
    const apiKey = env.FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY;
    const admin = String(env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).toLowerCase();
    const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Referer": (env.SITE_URL || "") + "/" },
        body: JSON.stringify({ idToken })
    });
    if (!r.ok) throw httpErr(401, "Session expirée : reconnecte-toi au dashboard");
    const d = await r.json().catch(() => ({}));
    const u = d.users && d.users[0];
    if (!u || !u.email || String(u.email).toLowerCase() !== admin) throw httpErr(403, "Accès refusé");
}

/* ---------- Notifications push ---------- */
async function handlePush(env, body) {
    const title = String(body.title || "").trim();
    const text = String(body.body || "").trim();
    const tokens = Array.isArray(body.tokens) ? body.tokens : [];
    if (!title || title.length > 100) throw httpErr(400, "Titre invalide");
    if (!text || text.length > 240) throw httpErr(400, "Message invalide");
    if (!tokens.length || tokens.length > MAX_CHUNK) throw httpErr(400, `Entre 1 et ${MAX_CHUNK} appareils par lot`);
    if (tokens.some((t) => typeof t !== "string" || t.length < 20 || t.length > 1024)) throw httpErr(400, "Jeton invalide");

    const site = String(env.SITE_URL || "").replace(/\/$/, "");
    const link = typeof body.link === "string" && /^https:\/\//i.test(body.link) ? body.link : site + "/";
    const image = typeof body.image === "string" && /^https:\/\//i.test(body.image) ? body.image : null;

    const access = await googleToken(env);
    const projectId = serviceAccount(env).project_id;

    const results = await Promise.all(tokens.map(async (token) => {
        const message = {
            token,
            notification: { title, body: text, ...(image ? { image } : {}) },
            webpush: { fcm_options: { link }, notification: { icon: site + "/logo.png" } }
        };
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
            method: "POST",
            headers: { "Authorization": "Bearer " + access, "Content-Type": "application/json" },
            body: JSON.stringify({ message })
        });
        if (r.ok) return { ok: true };
        const e = await r.json().catch(() => null);
        const detail = e && e.error && Array.isArray(e.error.details) ? e.error.details.find((x) => x.errorCode) : null;
        const gone = r.status === 404 || (detail && detail.errorCode === "UNREGISTERED");
        return { ok: false, token, gone, error: (e && e.error && e.error.message) || ("HTTP " + r.status) };
    }));

    const failed = results.filter((x) => !x.ok);
    return {
        sent: results.length - failed.length,
        failed: failed.length,
        gone: failed.filter((x) => x.gone).map((x) => x.token),
        firstError: failed.length ? failed[0].error : null
    };
}

/* ---------- E-mails (Brevo) ---------- */
async function handleEmail(env, body, origin) {
    if (!env.BREVO_API_KEY || !env.SENDER_EMAIL) throw httpErr(500, "Brevo (BREVO_API_KEY / SENDER_EMAIL) non configuré sur le serveur d'envoi");
    if (!env.UNSUB_SECRET) throw httpErr(500, "UNSUB_SECRET non configuré sur le serveur d'envoi");

    const subject = String(body.subject || "").trim();
    const html = String(body.html || "");
    const text = body.text ? String(body.text) : "";
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) throw httpErr(400, "Objet invalide");
    if (!html || html.length > 300000) throw httpErr(400, "Contenu HTML invalide");
    if (!html.includes("{{UNSUB_URL}}")) throw httpErr(400, "Le lien de désabonnement ({{UNSUB_URL}}) est obligatoire");
    if (!recipients.length || recipients.length > MAX_CHUNK) throw httpErr(400, `Entre 1 et ${MAX_CHUNK} destinataires par lot`);

    const results = await Promise.all(recipients.map(async (r) => {
        const email = String((r && r.email) || "").trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, email, error: "adresse invalide" };
        try {
            const url = await unsubUrl(env, origin, email);
            const payload = {
                sender: { name: env.SENDER_NAME || "Abysz Esports", email: env.SENDER_EMAIL },
                to: [{ email }],
                subject,
                htmlContent: html.split("{{UNSUB_URL}}").join(url),
                ...(text ? { textContent: text.split("{{UNSUB_URL}}").join(url) } : {}),
                headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
            };
            const res = await fetch("https://api.brevo.com/v3/smtp/email", {
                method: "POST",
                headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "accept": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) return { ok: true };
            const e = await res.json().catch(() => null);
            return { ok: false, email, error: (e && e.message) || ("HTTP " + res.status) };
        } catch (err) {
            return { ok: false, email, error: err.message || "erreur" };
        }
    }));

    const failed = results.filter((x) => !x.ok);
    return {
        sent: results.length - failed.length,
        failed: failed.length,
        errors: failed.map((x) => ({ email: x.email, error: x.error }))
    };
}

/* ---------- Désabonnement ---------- */
function page(title, inner) {
    return new Response(
        `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>` +
        `<body style="margin:0;background:#0a0a0a;color:#fff;font-family:Arial,Helvetica,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;">` +
        `<div style="max-width:440px;text-align:center;background:#141414;border:1px solid #2a2a2a;border-radius:16px;padding:34px 28px;">${inner}</div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } }
    );
}

async function handleUnsubscribe(env, request, url) {
    const parts = url.pathname.split("/").filter(Boolean); // ["unsubscribe", sig, emailB64]
    let email = "";
    try { email = new TextDecoder().decode(fromB64url(parts[2] || "")).toLowerCase(); } catch (e) { /* ignore */ }
    const sig = parts[1] || "";
    const valid = env.UNSUB_SECRET && EMAIL_RE.test(email) && safeEqual(sig, await hmacHex(env.UNSUB_SECRET, email));
    if (!valid) return page("Lien invalide", `<h2 style="margin:0 0 10px;">Lien invalide</h2><p style="color:#aaa;margin:0;">Ce lien de désabonnement n'est pas valide.</p>`);

    if (request.method === "POST") {
        const access = await googleToken(env);
        const projectId = serviceAccount(env).project_id;
        const r = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/subscribers/${encodeURIComponent(email)}`, {
            method: "DELETE",
            headers: { "Authorization": "Bearer " + access }
        });
        if (!r.ok && r.status !== 404) {
            return page("Erreur", `<h2 style="margin:0 0 10px;">Une erreur est survenue</h2><p style="color:#aaa;margin:0;">Réessaie dans un instant ou écris-nous pour te désabonner.</p>`);
        }
        return page("Désabonné", `<div style="font-size:42px;margin-bottom:10px;">✅</div><h2 style="margin:0 0 10px;">Tu es désabonné(e)</h2><p style="color:#aaa;margin:0;">${esc(email)} ne recevra plus la newsletter d'Abysz Esports.</p>`);
    }

    // GET : page de confirmation (évite qu'un antivirus / scanner de mails désabonne automatiquement)
    return page("Se désabonner",
        `<h2 style="margin:0 0 10px;">Se désabonner ?</h2>` +
        `<p style="color:#aaa;margin:0 0 22px;">Tu ne recevras plus la newsletter à l'adresse<br><strong style="color:#fff;">${esc(email)}</strong></p>` +
        `<form method="POST"><button type="submit" style="background:#a855f7;color:#fff;border:none;padding:13px 26px;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer;">Confirmer le désabonnement</button></form>`);
}

/* ---------- Routeur ---------- */
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const cors = corsHeaders(env, request);

        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

        try {
            if (url.pathname === "/api/health") {
                return json({
                    ok: true,
                    push: !!env.SERVICE_ACCOUNT,
                    email: !!(env.BREVO_API_KEY && env.SENDER_EMAIL),
                    unsub: !!env.UNSUB_SECRET
                }, 200, cors);
            }

            if (url.pathname.startsWith("/unsubscribe/")) {
                if (request.method !== "GET" && request.method !== "POST") throw httpErr(405, "Méthode non autorisée");
                return await handleUnsubscribe(env, request, url);
            }

            if (request.method === "POST" && (url.pathname === "/api/push" || url.pathname === "/api/email")) {
                const body = await request.json().catch(() => null);
                if (!body || typeof body !== "object") throw httpErr(400, "Requête invalide");
                await verifyAdmin(env, body.idToken);
                const data = url.pathname === "/api/push"
                    ? await handlePush(env, body)
                    : await handleEmail(env, body, url.origin);
                return json(data, 200, cors);
            }

            throw httpErr(404, "Introuvable");
        } catch (e) {
            return json({ error: e.message || "Erreur serveur" }, e.status || 500, cors);
        }
    }
};
