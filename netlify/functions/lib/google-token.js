// lib/google-token.js
// Gère le cycle de vie du token Google OAuth (Gmail + Calendar).
// Les tokens sont stockés dans Supabase (table "google_tokens", une seule ligne id='main').
// Le refresh est automatique grâce à googleapis (OAuth2Client émet "tokens" quand il refresh).

const { google } = require('googleapis');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TOKEN_ROW_ID = 'main';

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function loadTokens() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY manquants dans les variables d\'environnement Netlify.');
  }
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/google_tokens?id=eq.${TOKEN_ROW_ID}&select=*`,
    { headers: sbHeaders() }
  );
  if (!r.ok) throw new Error('Supabase (lecture tokens) HTTP ' + r.status);
  const rows = await r.json();
  if (!rows.length) return null;
  return rows[0];
}

async function saveTokens(tokens) {
  const payload = {
    id: TOKEN_ROW_ID,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token, // peut être undefined sur un simple refresh
    expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens.scope || null,
    updated_at: new Date().toISOString(),
  };
  // Ne pas écraser le refresh_token existant s'il n'est pas renvoyé
  if (!payload.refresh_token) delete payload.refresh_token;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/google_tokens`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Supabase (écriture tokens) HTTP ' + r.status + ' — ' + txt);
  }
}

function buildOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI manquants.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Retourne un client OAuth2 authentifié, prêt à appeler Gmail / Calendar.
 * Lève une erreur explicite si la connexion Google n'a jamais été faite.
 */
async function getAuthorizedClient() {
  const oAuth2Client = buildOAuthClient();
  const row = await loadTokens();

  if (!row || !row.refresh_token) {
    throw new Error(
      "Connexion Google non initialisée. Clique sur « Connexion Google (Gmail/Calendar) » dans la barre latérale pour autoriser l'accès."
    );
  }

  oAuth2Client.setCredentials({
    access_token: row.access_token || undefined,
    refresh_token: row.refresh_token,
    expiry_date: row.expiry_date ? new Date(row.expiry_date).getTime() : undefined,
    scope: row.scope || undefined,
  });

  // Quand googleapis rafraîchit le token automatiquement, on le sauvegarde.
  oAuth2Client.on('tokens', (tokens) => {
    saveTokens(tokens).catch((e) => console.error('Échec sauvegarde refresh token', e));
  });

  return oAuth2Client;
}

module.exports = { getAuthorizedClient, saveTokens, loadTokens, buildOAuthClient };
