// À AJOUTER dans ton Cloudflare Worker (même fichier que /api/pr-key, /api/push, /api/email).
// Adapte les 3 lignes marquées "ADAPTER" aux fonctions que ton Worker utilise déjà.

// Dans ton routeur, ajoute :
//   if (url.pathname === "/api/player-stats" && request.method === "POST") return handlePlayerStats(request, env);

async function handlePlayerStats(request, env) {
  const body = await request.json().catch(() => ({}));
  await verifyAdmin(body.idToken, env);                 // ADAPTER : ta vérification admin existante
  const key = await getTrnKey(env);                     // ADAPTER : là où /api/pr-key lit la clé enregistrée
  if (!key) return json({ error: "Clé API non configurée." }, 400);   // ADAPTER : ton helper de réponse JSON

  const platform = ["epic", "psn", "xbl"].includes(body.platform) ? body.platform : "epic";
  const players = Array.isArray(body.players) ? body.players.slice(0, 10) : [];
  const results = [];

  for (const p of players) {
    try {
      const r = await fetch(
        `https://api.fortnitetracker.com/v1/profile/${platform}/${encodeURIComponent(String(p.name || "").slice(0, 60))}`,
        { headers: { "TRN-Api-Key": key } }
      );
      if (!r.ok) throw new Error(r.status === 404 ? "joueur introuvable" : r.status === 429 ? "limite de l'API atteinte" : "API " + r.status);
      const data = await r.json();
      const items = (data.lifeTimeStats || []).map((s) => ({ label: s.key, value: s.value }));
      results.push(items.length ? { id: p.id, ok: true, items } : { id: p.id, ok: false, error: "aucune stat" });
    } catch (e) {
      results.push({ id: p.id, ok: false, error: e.message });
    }
    await new Promise((res) => setTimeout(res, 1100));  // Fortnite Tracker : ~1 requête / seconde
  }
  return json({ results });
}
