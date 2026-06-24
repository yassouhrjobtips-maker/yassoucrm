// netlify/functions/gmail.js
//
// Interagit avec Gmail (compte connecté via google-auth-start).
//
// Body attendu (JSON, POST), selon "action" :
//
//  { action: 'send', to, subject, body, fromName }
//    -> envoie un email (comportement historique, action par défaut si absente)
//
//  { action: 'thread', email, maxResults: 10 }
//    -> { messages: [{ id, from, to, subject, snippet, date, direction }] }
//       Liste les derniers échanges (envoyés ET reçus) avec cette adresse,
//       du plus récent au plus ancien.

const { getAccessToken, CORS_HEADERS } = require('./_google-auth');

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const action = payload.action || 'send';

  try {
    const accessToken = await getAccessToken();

    if (action === 'send') {
      return await sendEmail(accessToken, payload);
    }
    if (action === 'thread') {
      return await getThread(accessToken, payload);
    }
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Action inconnue : '" + action + "'" }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};

async function sendEmail(accessToken, payload) {
  const { to, subject, body, fromName, attachments } = payload;
  if (!to || !subject || !body) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'to, subject et body sont requis' }) };
  }

  const subjectHeader = `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
  const fromHeader = fromName ? `From: ${fromName}\r\n` : '';

  let message;

  if (attachments && attachments.length) {
    // Email avec pièce(s) jointe(s) -> multipart/mixed
    const boundary = 'yassou_boundary_' + Date.now();

    const headerLines = [
      `To: ${to}`,
      subjectHeader,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ];

    let mime = fromHeader + headerLines.join('\r\n') + '\r\n\r\n';

    // Partie texte
    mime += `--${boundary}\r\n`;
    mime += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
    mime += Buffer.from(body, 'utf-8').toString('base64') + '\r\n\r\n';

    // Pièces jointes
    for (const att of attachments) {
      let data = att.data; // base64 déjà encodé, si fourni directement (ex: fichier uploadé par l'utilisateur)
      if (!data && att.url) {
        const fileResp = await fetch(att.url);
        if (!fileResp.ok) throw new Error("Impossible de récupérer la pièce jointe : " + att.url);
        const buf = Buffer.from(await fileResp.arrayBuffer());
        data = buf.toString('base64');
      }
      if (!data) continue;

      const filename = att.filename || 'piece-jointe';
      const mimeType = att.mimeType || 'application/octet-stream';

      mime += `--${boundary}\r\n`;
      mime += `Content-Type: ${mimeType}; name="${filename}"\r\n`;
      mime += `Content-Disposition: attachment; filename="${filename}"\r\n`;
      mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
      // Découpage en lignes de 76 caractères (norme MIME)
      mime += data.match(/.{1,76}/g).join('\r\n') + '\r\n\r\n';
    }

    mime += `--${boundary}--`;
    message = mime;
  } else {
    const headerLines = [
      `To: ${to}`,
      subjectHeader,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
    ];
    message = fromHeader + headerLines.join('\r\n') + '\r\n\r\n' + Buffer.from(body, 'utf-8').toString('base64');
  }

  const raw = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const resp = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(data.error?.message || ('Erreur Gmail (HTTP ' + resp.status + ')'));
  }
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, id: data.id }) };
}

async function getThread(accessToken, payload) {
  const { email, maxResults = 10 } = payload;
  if (!email) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'email est requis' }) };
  }

  const authHeaders = { Authorization: `Bearer ${accessToken}` };
  const q = `from:${email} OR to:${email}`;
  const listResp = await fetch(
    `${GMAIL_BASE}/messages?${new URLSearchParams({ q, maxResults: String(maxResults) })}`,
    { headers: authHeaders }
  );
  const listData = await listResp.json();
  if (!listResp.ok) throw new Error(listData.error?.message || ('Erreur Gmail (HTTP ' + listResp.status + ')'));

  const ids = (listData.messages || []).map((m) => m.id);
  const messages = await Promise.all(
    ids.map(async (id) => {
      const params = new URLSearchParams({ format: 'metadata' });
      params.append('metadataHeaders', 'From');
      params.append('metadataHeaders', 'To');
      params.append('metadataHeaders', 'Subject');
      params.append('metadataHeaders', 'Date');
      const r = await fetch(`${GMAIL_BASE}/messages/${id}?${params.toString()}`, { headers: authHeaders });
      const m = await r.json();
      const headers = {};
      (m.payload?.headers || []).forEach((h) => { headers[h.name.toLowerCase()] = h.value; });
      const fromHeader = headers.from || '';
      const direction = fromHeader.toLowerCase().includes(email.toLowerCase()) ? 'received' : 'sent';
      return {
        id: m.id,
        from: headers.from || '',
        to: headers.to || '',
        subject: headers.subject || '(sans objet)',
        snippet: m.snippet || '',
        date: headers.date || '',
        direction,
      };
    })
  );

  messages.sort((a, b) => new Date(b.date) - new Date(a.date));

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ messages }) };
}
