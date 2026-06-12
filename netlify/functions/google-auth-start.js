// netlify/functions/google-auth-start.js
// Redirige l'utilisateur vers l'écran de consentement Google.
// Appelée quand on clique sur "🔗 Connexion Google (Gmail/Calendar)".

const { buildOAuthClient } = require('./lib/google-token');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
];

exports.handler = async () => {
  try {
    const oAuth2Client = buildOAuthClient();
    const url = oAuth2Client.generateAuthUrl({
      access_type: 'offline', // nécessaire pour obtenir un refresh_token
      prompt: 'consent',      // force le renvoi du refresh_token même si déjà autorisé
      scope: SCOPES,
    });
    return {
      statusCode: 302,
      headers: { Location: url },
      body: '',
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `<h1>Erreur de configuration</h1><p>${err.message}</p>
        <p>Vérifie les variables d'environnement GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et GOOGLE_REDIRECT_URI dans Netlify.</p>`,
    };
  }
};
