export async function onRequest(context) {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "https://albanmc19.github.io",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    // Gestion de la pré-vérification CORS (requête OPTIONS du navigateur)
    if (context.request.method === "OPTIONS") {
        return new Response(null, { 
            status: 204, 
            headers: corsHeaders 
        });
    }

    // Traitement de l'envoi Discord (requête POST)
    if (context.request.method === "POST") {
        try {
            const data = await context.request.json();
            
            // Vérification de la variable d'environnement (DISCORD_WEBHOOK)
            const webhookUrl = context.env.DISCORD_WEBHOOK;
            if (!webhookUrl) {
                return new Response(JSON.stringify({ error: "Le webhook n'est pas configuré sur Cloudflare" }), { 
                    status: 500, 
                    headers: { ...corsHeaders, "Content-Type": "application/json" } 
                });
            }

            // Envoi effectif vers Discord
            const responseDiscord = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: data.message || "Nouveau message depuis le site !"
                })
            });

            return new Response(JSON.stringify({ success: responseDiscord.ok }), { 
                status: responseDiscord.ok ? 200 : 400, 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: "Erreur interne : " + error.message }), { 
                status: 500, 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
            });
        }
    }

    return new Response("Méthode non autorisée", { status: 405, headers: corsHeaders });
}
