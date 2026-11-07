// prerender.mjs : écrit dans index.html le contenu Firebase (annonces, partenaires,
// textes d'accueil, section « À la Une »), pour que Google le voie dans le HTML.
// La page ne change pas : ton JavaScript reconstruit tout en direct comme avant.
//
// Utilisation (Node 18 ou plus) :   node prerender.mjs [index.html]
// Test sans réseau :                node prerender.mjs index.html --mock donnees.json
import fs from "node:fs";

const PROJECT = "abysz-esports";
const API_KEY = "AIzaSyBFzPc8WF4IGN74RZ1axtpUBu6Bv8Iu-UQ"; // clé web publique déjà présente dans le site
const file = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "index.html";
const mockIdx = process.argv.indexOf("--mock");

// ---------- helpers (mêmes règles que le site) ----------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
const safeColor = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : d);
const ALLOWED = new Set(["strong", "b", "em", "i", "br", "p", "ul", "ol", "li"]);
const sanitizeHtml = (h) => String(h).replace(/<\/?([a-z0-9]+)[^>]*>/gi, (m, tag) => {
  if (!ALLOWED.has(tag.toLowerCase())) return "";
  return m.startsWith("</") ? `</${tag.toLowerCase()}>` : `<${tag.toLowerCase()}>`;
});
const fmtDate = (ts) => new Date(Number(ts)).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// ---------- lecture Firestore (REST, sans compte : mêmes droits qu'un visiteur) ----------
const val = (v) => {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)]));
  return null;
};
const fields = (d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, val(x)]));
const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function getDoc(path) {
  const r = await fetch(`${base}/${path}?key=${API_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} : HTTP ${r.status} (les règles Firestore autorisent-elles la lecture publique ?)`);
  return fields(await r.json());
}
async function getCol(name) {
  const out = []; let token = "";
  do {
    const r = await fetch(`${base}/${name}?pageSize=300&key=${API_KEY}${token ? "&pageToken=" + encodeURIComponent(token) : ""}`);
    if (!r.ok) throw new Error(`${name} : HTTP ${r.status} (les règles Firestore autorisent-elles la lecture publique ?)`);
    const j = await r.json();
    (j.documents || []).forEach((d) => out.push({ id: d.name.split("/").pop(), ...fields(d) }));
    token = j.nextPageToken || "";
  } while (token);
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

let data;
if (mockIdx > -1) data = JSON.parse(fs.readFileSync(process.argv[mockIdx + 1], "utf8"));
else {
  const [home, custom, announcements, partners] = await Promise.all([getDoc("site_content/home"), getDoc("site_content/custom_section"), getCol("announcements"), getCol("partners")]);
  data = { home, custom, announcements, partners };
}

// ---------- rendu (même HTML que celui produit par le JavaScript du site) ----------
const CAT = { match: ["cat_match", "badge-match", "Match / Tournoi"], recrutement: ["cat_recruit", "badge-recrutement", "Recrutement"], evenement: ["cat_event", "badge-evenement", "Événement"] };
const now = Date.now();
const anns = (data.announcements || []).filter((a) => !(a.expiresAt && a.expiresAt <= now));

const feed = anns.length ? anns.map((a) => {
  const [key, cls, label] = CAT[a.category] || ["cat_general", "badge-general", "Général"];
  const likes = typeof a.likes === "number" ? a.likes : (Array.isArray(a.likedBy) ? a.likedBy.length : 0);
  const img = safeUrl(a.imageUrl), link = safeUrl(a.btnLink);
  return `<div class="announcement-card ${a.priority === "urgent" ? "priority-urgent" : ""}">
                    <div class="announcement-meta">
                        <span class="badge ${cls}" data-i18n="${key}">${label}</span>
                        ${a.priority === "urgent" ? '<span class="badge badge-urgent">URGENT</span>' : ""}
                    </div>
                    <h3>${esc(a.title)}</h3>
                    <p>${esc(a.content)}</p>
                    ${img ? `<img src="${esc(img)}" class="announcement-img" alt="${esc(a.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
                    ${a.btnText && link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="announcement-action-btn">${esc(a.btnText)}</a>` : ""}
                    <div class="announcement-footer">
                        <span class="announcement-date"><span data-i18n="published_on">Publié le</span> <span data-date="${a.createdAt || ""}">${a.createdAt ? fmtDate(a.createdAt) : ""}</span></span>
                        <button class="like-btn" data-id="${esc(a.id)}"><span class="like-heart">🤍</span><span class="like-count">${likes}</span></button>
                    </div>
                </div>`;
}).join("\n") : '<p class="loading-text" data-i18n="ann_empty">Aucune annonce publiée pour le moment.</p>';

const dots = anns.length ? anns.map((_, i) => `<div class="dot ${i === 0 ? "active" : ""}"></div>`).join("") : "";

const partners = (data.partners || []).length ? data.partners.map((p) => {
  const c = safeColor(p.color, "#a855f7");
  return `<div class="partner-card" style="--partner-color: ${c}; --partner-btn-text: ${safeColor(p.btnTextColor, "#ffffff")}; --partner-glow: ${c}33;">
                    <span class="partner-tier-badge"${p.tier ? "" : ' data-i18n="partner_default"'}>${esc(p.tier || "PARTENAIRE")}</span>
                    <div class="partner-logo-wrapper"><img src="${esc(safeUrl(p.logoUrl))}" alt="${esc(p.name)}" class="partner-logo" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>
                    <h3 class="partner-name">${esc(p.name)}</h3>
                    <div class="partner-role">${esc(p.role)}</div>
                    ${p.promo ? `<div class="partner-promo-code">🏷️ ${esc(p.promo)}</div>` : ""}
                    <p class="partner-desc">${esc(p.description)}</p>
                    <a href="${esc(safeUrl(p.siteUrl))}" target="_blank" rel="noopener noreferrer" class="partner-link-btn"${p.btnLabel ? "" : ' data-i18n="visit_site"'}>${esc(p.btnLabel || "Visiter le site")}</a>
                </div>`;
}).join("\n") : '<p class="loading-text" data-i18n="partners_empty">Aucun partenaire affiché pour le moment.</p>';

const h = data.home || {}, c = data.custom || {};
const ABOUT_DEFAULT = "Bienvenue sur la plateforme officielle d'<strong>Abysz Esports</strong>. Structure esport passionnée et ambitieuse, nous réunissons des joueurs de haut niveau, une équipe encadrante dédiée et une communauté passionnée de gaming. Suivez nos matchs en direct, découvrez nos rosters officiels et rejoignez l'aventure compétitive dès aujourd'hui.";
const blocks = {
  hero: `<h1 id="hero-title">${esc(h.heroTitle || "ABYSZ")}</h1>`,
  slogan: `<p class="slogan" id="hero-slogan">${esc(h.heroSlogan || "The beginning of every legend")}</p>`,
  atitle: `<h2 id="about-title"${h.aboutTitle ? "" : ' data-i18n="about_title"'}>${esc(h.aboutTitle || "À Propos d'Abysz Esports")}</h2>`,
  atext: `<p id="about-text"${h.aboutText ? "" : ' data-i18n-html="about_text"'}>${h.aboutText ? sanitizeHtml(h.aboutText) : ABOUT_DEFAULT}</p>`,
  ctitle: `<h2 id="custom-section-title"${c.title ? "" : ' data-i18n="custom_title"'}>${esc(c.title || "À la Une")}</h2>`,
  ctext: `<p id="custom-section-text"${c.text ? "" : ' data-i18n="custom_default"'}>${esc(c.text || "Bienvenue dans cette nouvelle section ! Vous pouvez la personnaliser depuis le panneau d'administration.")}</p>`,
  cimg: `<img src="${c.imageUrl ? esc(safeUrl(c.imageUrl)) : ""}" id="custom-section-img" class="custom-card-img${c.imageUrl ? "" : " hidden"}" alt="Illustration">`,
  feed, dots, partners,
};

// ---------- injection entre les marqueurs ----------
let html = fs.readFileSync(file, "utf8");
for (const [name, content] of Object.entries(blocks)) {
  const re = new RegExp(`(<!--SSR:${name}-->)[\\s\\S]*?(<!--/SSR:${name}-->)`);
  if (!re.test(html)) { console.error(`Marqueur manquant : ${name}`); process.exit(1); }
  html = html.replace(re, (_, a, b) => a + content + b);
}
fs.writeFileSync(file, html);
console.log(`OK : ${anns.length} annonce(s), ${(data.partners || []).length} partenaire(s), section « ${c.title || "À la Une"} » écrits dans ${file}`);
