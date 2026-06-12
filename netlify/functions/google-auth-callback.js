// netlify/functions/google-auth-callback.js
// Google redirige ici après autorisation, avec ?code=...
// On échange ce code contre access_token + refresh_token, qu'on stocke dans Supabase.

const { buildOAuthClient, saveTokens } = require('./lib/google-token');

exports.handler = async (event) => {
  const code = event.queryStringParameters && event.queryStringParameters.code;
  const errorParam = event.queryStringParameters && event.queryStringParameters.error;

  if (errorParam) {
    return htmlResponse(
      `<h1>Connexion annulée</h1><p>Google a renvoyé : ${escapeHtml(errorParam)}</p>`
    );
  }
  if (!code) {
    return htmlResponse('<h1>Erreur</h1><p>Aucun code reçu de Google.</p>');
  }

  try {
    const oAuth2Client = buildOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // Arrive si l'utilisateur avait déjà autorisé l'app sans repasser par "prompt=consent"
      return htmlResponse(`
        <h1>⚠️ Pas de refresh token reçu</h1>
        <p>Google n'a pas renvoyé de "refresh_token" (souvent parce que l'accès avait déjà été autorisé précédemment).</p>
        <p>Va dans <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a>,
        retire l'accès à l'application, puis recommence la connexion depuis le tableau de bord.</p>
      `);
    }

    await saveTokens(tokens);

    return htmlResponse(`
      <h1>✅ Connexion Google réussie</h1>
      <p>Gmail et Google Calendar sont maintenant connectés à ton tableau de bord.</p>
      <p>Tu peux fermer cet onglet et retourner sur ton dashboard.</p>
    `);
  } catch (err) {
    return htmlResponse(`<h1>❌ Erreur</h1><p>${escapeHtml(err.message)}</p>`);
  }
};

function htmlResponse(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#0A0A0A;line-height:1.6}
      h1{font-size:22px} a{color:#185FA5}</style></head>
      <body>${body}</body></html>`,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
