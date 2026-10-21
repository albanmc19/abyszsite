/* Gestionnaire de consentement cookies — Abysz Esports
   Injecte son propre CSS et son propre HTML. Choix stocké dans localStorage (6 mois).
   API : AbyszConsent.on('analytics'|'ads', fn), AbyszConsent.open(), AbyszConsent.get() */
(function () {
    if (window.AbyszConsent) return;
    var KEY = 'abysz_cookie_consent_v1';
    var MAX_AGE = 182 * 24 * 60 * 60 * 1000;
    var ADS_CLIENT = 'ca-pub-1494144032841410';
    var applied = { analytics: false, ads: false };
    var waiting = { analytics: [], ads: [] };
    var state = null, lastFocus = null;
    var $ = function (id) { return document.getElementById(id); };

    var CSS = ".cc-banner{position:fixed;left:0;right:0;bottom:0;z-index:9000;display:flex;justify-content:center;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));pointer-events:none;animation:cc-up .45s cubic-bezier(.25,1,.5,1)}" +
    "@keyframes cc-up{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}" +
    ".cc-hidden{display:none!important}" +
    ".cc-inner{pointer-events:auto;max-width:920px;width:100%;box-sizing:border-box;background:rgba(20,20,20,.97);border:1px solid #2a2a2a;border-top:3px solid #a855f7;border-radius:16px;padding:20px 22px;display:flex;gap:22px;align-items:center;box-shadow:0 10px 40px rgba(0,0,0,.7),0 0 25px rgba(168,85,247,.18);backdrop-filter:blur(10px);color:#fff;font-family:'Inter',sans-serif}" +
    ".cc-title{font-family:'Orbitron',sans-serif;font-size:.95rem;display:block;margin-bottom:6px}" +
    ".cc-text p{margin:0;color:#b3b3b3;font-size:.85rem;line-height:1.55}.cc-text a{color:#a855f7}" +
    ".cc-actions{display:flex;gap:10px;flex-shrink:0}" +
    ".cc-btn{font-family:'Orbitron',sans-serif;font-size:.74rem;font-weight:700;letter-spacing:.4px;padding:11px 16px;border-radius:8px;cursor:pointer;border:1px solid transparent;white-space:nowrap;transition:transform .2s ease,box-shadow .3s ease,background .2s ease}" +
    ".cc-btn:hover{transform:translateY(-2px)}" +
    ".cc-btn-accept{background:#a855f7;color:#fff}.cc-btn-accept:hover{background:#b975ff;box-shadow:0 0 15px rgba(168,85,247,.5)}" +
    ".cc-btn-refuse{background:#262626;color:#fff;border-color:#3a3a3a}.cc-btn-refuse:hover{background:#333}" +
    ".cc-btn-custom{background:transparent;color:#a855f7;border-color:#a855f7}.cc-btn-custom:hover{background:rgba(168,85,247,.15)}" +
    ".cc-btn:focus-visible,.cc-text a:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
    ".cc-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;justify-content:center;align-items:center;padding:15px}" +
    ".cc-overlay.cc-active{display:flex}" +
    ".cc-modal{background:#141414;border:2px solid #a855f7;border-radius:20px;max-width:580px;width:100%;padding:30px 25px;position:relative;box-shadow:0 0 30px rgba(168,85,247,.25);box-sizing:border-box;max-height:90vh;overflow-y:auto;color:#fff;font-family:'Inter',sans-serif}" +
    ".cc-modal h3{font-family:'Orbitron',sans-serif;margin:5px 0 25px;font-size:1.4rem;text-align:center;letter-spacing:1px}" +
    ".cc-close{position:absolute;top:12px;right:18px;font-size:1.8rem;color:#777;cursor:pointer;line-height:1}.cc-close:hover{color:#ff4444}" +
    ".cc-cat{background:#0a0a0a;border:1px solid #2a2a2a;border-radius:12px;padding:14px 16px;margin-bottom:12px}" +
    ".cc-cat-head{display:flex;justify-content:space-between;align-items:center;gap:12px}" +
    ".cc-cat-name{font-family:'Orbitron',sans-serif;font-size:.85rem;color:#fff}" +
    ".cc-cat p{margin:8px 0 0;color:#999;font-size:.82rem;line-height:1.5}" +
    ".cc-always{font-family:'Orbitron',sans-serif;font-size:.7rem;color:#10b981;white-space:nowrap}" +
    ".cc-switch{position:relative;width:46px;height:26px;flex-shrink:0}" +
    ".cc-switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:2}" +
    ".cc-slider{position:absolute;inset:0;background:#333;border-radius:26px;transition:background .25s}" +
    ".cc-slider::before{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .25s}" +
    ".cc-switch input:checked+.cc-slider{background:#a855f7}.cc-switch input:checked+.cc-slider::before{transform:translateX(20px)}" +
    ".cc-switch input:focus-visible+.cc-slider{outline:2px solid #fff;outline-offset:2px}" +
    ".cc-save{background:#a855f7;color:#fff;border:none;width:100%;padding:14px;border-radius:8px;font-weight:700;cursor:pointer;font-family:'Orbitron',sans-serif;font-size:.95rem;margin-top:5px;transition:background .2s,box-shadow .2s}" +
    ".cc-save:hover{background:#b975ff;box-shadow:0 0 15px rgba(168,85,247,.4)}" +
    "@media(max-width:768px){.cc-inner{flex-direction:column;align-items:stretch;gap:16px;padding:18px 16px}.cc-actions{flex-direction:column}.cc-btn{width:100%;padding:13px 16px}}" +
    "@media(prefers-reduced-motion:reduce){.cc-banner{animation:none}}";

    var HTML = '<div id="cookie-banner" class="cc-banner cc-hidden" role="region" aria-label="Gestion des cookies"><div class="cc-inner">' +
        '<div class="cc-text"><strong class="cc-title">🍪 Vos préférences cookies</strong><p>Abysz utilise des traceurs pour mesurer l\'audience du site et afficher de la publicité. Vous pouvez tout accepter, tout refuser ou choisir, et modifier votre choix à tout moment. <a href="cookies.html">En savoir plus</a></p></div>' +
        '<div class="cc-actions"><button type="button" class="cc-btn cc-btn-refuse" id="cc-refuse">Tout refuser</button><button type="button" class="cc-btn cc-btn-accept" id="cc-accept">Tout accepter</button><button type="button" class="cc-btn cc-btn-custom" id="cc-custom">Personnaliser</button></div></div></div>' +
        '<div id="cookie-prefs" class="cc-overlay" role="dialog" aria-modal="true" aria-labelledby="cc-prefs-title"><div class="cc-modal">' +
        '<span class="cc-close" id="cc-prefs-close" role="button" tabindex="0" aria-label="Fermer">&times;</span><h3 id="cc-prefs-title">Préférences cookies</h3>' +
        '<div class="cc-cat"><div class="cc-cat-head"><span class="cc-cat-name">Nécessaires</span><span class="cc-always">Toujours actifs</span></div><p>Mémorisent votre choix de cookies, votre connexion et un identifiant anonyme pour les « J\'aime » des annonces. Indispensables au fonctionnement du site.</p></div>' +
        '<div class="cc-cat"><div class="cc-cat-head"><span class="cc-cat-name">Mesure d\'audience</span><label class="cc-switch"><input type="checkbox" id="cc-analytics" aria-label="Mesure d\'audience"><span class="cc-slider"></span></label></div><p>Statistiques de fréquentation (pages vues, appareil, durée de visite, visiteurs en ligne) pour améliorer le site.</p></div>' +
        '<div class="cc-cat"><div class="cc-cat-head"><span class="cc-cat-name">Publicité</span><label class="cc-switch"><input type="checkbox" id="cc-ads" aria-label="Publicité"><span class="cc-slider"></span></label></div><p>Affichage de publicités via Google AdSense, qui peut déposer ses propres cookies.</p></div>' +
        '<button type="button" class="cc-save" id="cc-save">Enregistrer mes choix</button></div></div>';

    function read() {
        try { var r = JSON.parse(localStorage.getItem(KEY)); if (r && r.v === 1 && r.t && Date.now() - r.t < MAX_AGE) return r; } catch (e) {}
        return null;
    }
    function write(a, d) {
        var r = { v: 1, t: Date.now(), analytics: !!a, ads: !!d };
        try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {}
        return r;
    }
    function loadAds() {
        if (!document.querySelector('ins.adsbygoogle')) return; // pas d'encart pub sur cette page
        document.querySelectorAll('.adsense-container').forEach(function (c) { c.classList.remove('hidden'); });
        var s = document.createElement('script');
        s.async = true; s.crossOrigin = 'anonymous';
        s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADS_CLIENT;
        s.onload = function () {
            document.querySelectorAll('ins.adsbygoogle').forEach(function () { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {} });
        };
        document.head.appendChild(s);
    }
    function run(cat) {
        applied[cat] = true;
        if (cat === 'ads') loadAds();
        waiting[cat].splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    }
    function apply(r) {
        if (r.analytics && !applied.analytics) run('analytics');
        if (r.ads && !applied.ads) run('ads');
    }
    function cleanup() {
        try { ['abysz_last_day', 'abysz_first_seen', 'abysz_last_hour'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
        document.cookie.split(';').forEach(function (c) {
            var n = c.split('=')[0].trim();
            if (/^(__gads|__gpi|__eoi|_ga|_gid|IDE|test_cookie)/.test(n)) {
                ['', ';domain=' + location.hostname, ';domain=.' + location.hostname].forEach(function (d) {
                    document.cookie = n + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/' + d;
                });
            }
        });
    }
    function openPrefs() {
        lastFocus = document.activeElement;
        $('cc-analytics').checked = !!(state && state.analytics);
        $('cc-ads').checked = !!(state && state.ads);
        $('cookie-prefs').classList.add('cc-active');
        $('cc-analytics').focus();
    }
    function closePrefs() {
        $('cookie-prefs').classList.remove('cc-active');
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function commit(a, d) {
        var prev = state || {};
        state = write(a, d);
        $('cookie-banner').classList.add('cc-hidden');
        $('cookie-prefs').classList.remove('cc-active');
        if ((prev.analytics && !state.analytics) || (prev.ads && !state.ads)) { cleanup(); location.reload(); return; }
        apply(state);
    }

    function init() {
        var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
        document.body.insertAdjacentHTML('beforeend', HTML);
        $('cc-accept').addEventListener('click', function () { commit(true, true); });
        $('cc-refuse').addEventListener('click', function () { commit(false, false); });
        $('cc-custom').addEventListener('click', openPrefs);
        $('cc-save').addEventListener('click', function () { commit($('cc-analytics').checked, $('cc-ads').checked); });
        $('cc-prefs-close').addEventListener('click', closePrefs);
        $('cc-prefs-close').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closePrefs(); } });
        $('cookie-prefs').addEventListener('click', function (e) { if (e.target === this) closePrefs(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('cookie-prefs').classList.contains('cc-active')) closePrefs(); });
        document.addEventListener('click', function (e) {
            var t = e.target.closest && e.target.closest('[data-open-cookie-prefs]');
            if (t) { e.preventDefault(); openPrefs(); }
        });
        state = read();
        if (state) apply(state); else $('cookie-banner').classList.remove('cc-hidden');
    }

    window.AbyszConsent = {
        on: function (cat, fn) { if (applied[cat]) fn(); else waiting[cat].push(fn); },
        open: openPrefs,
        get: function () { return state; }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
