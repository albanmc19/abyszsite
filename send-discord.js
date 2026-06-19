export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const webhookUrl = context.env.DISCORD_WEBHOOK;

    if (!webhookUrl) {
      return new Response("Erreur : Le webhook n'est pas configuré sur GitHub", { status: 500 });
    }

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: data.message || "Nouveau message depuis le site !"
      })
    });

    return new Response("Succès", { status: 200 });
  } catch (error) {
    return new Response("Erreur interne", { status: 500 });
  }
}