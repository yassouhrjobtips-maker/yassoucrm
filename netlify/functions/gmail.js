// netlify/functions/gmail.js
// Actions :
//  - send  : envoie un email via Gmail (avec pièces jointes), depuis l'adresse Google connectée
//  - thread: liste les derniers échanges (envoyés + reçus) avec une adresse email donnée

const { google } = require('googleapis');
const { getAuthorizedClient } = require('./lib/google-token');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Méthode non autorisée' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'JSON invalide' });
  }

  try {
    const auth = await getAuthorizedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const action = body.action || 'send';
    if (action === 'send') return await sendEmail(gmail, body);
    if (action === 'thread') return await getThread(gmail, body);

    return json(400, { error: 'Action inconnue : ' + action });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

/* ============ ENVOI ============ */
async function sendEmail(gmail, body) {
  const { to, subject, body: text, fromName, attachments = [] } = body;
  if (!to || !subject || !text) {
    return json(400, { error: 'Champs requis manquants : to, subject, body' });
  }

  const profile = await gmail.users.getProfile({ userId: 'me' });
  const fromEmail = profile.data.emailAddress;
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  // Récupère le contenu (base64) de chaque pièce jointe
  const preparedAttachments = [];
  for (const att of attachments) {
    if (att.data) {
      // déjà fourni en base64 par le frontend
      preparedAttachments.push({
        filename: att.filename,
        mimeType: att.mimeType || 'application/octet-stream',
        data: att.data,
      });
    } else if (att.url) {
      // ex : CGS hébergées sur le site -> on les télécharge puis on les encode
      const r = await fetch(att.url);
      if (!r.ok) throw new Error(`Impossible de récupérer la pièce jointe ${att.filename} (HTTP ${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      preparedAttachments.push({
        filename: att.filename,
        mimeType: att.mimeType || 'application/pdf',
        data: buf.toString('base64'),
      });
    }
  }

  const raw = buildMimeMessage({ from, to, subject, text, attachments: preparedAttachments });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return json(200, { ok: true, id: res.data.id, threadId: res.data.threadId });
}

/**
 * Construit un message MIME multipart/mixed encodé en base64url,
 * prêt pour l'API Gmail (champ "raw").
 */
function buildMimeMessage({ from, to, subject, text, attachments }) {
  const boundary = 'yassou_career_boundary_' + Date.now();
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;

  let message = '';
  message += `From: ${from}\r\n`;
  message += `To: ${to}\r\n`;
  message += `Subject: ${encodedSubject}\r\n`;
  message += `MIME-Version: 1.0\r\n`;

  if (!attachments.length) {
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `Content-Transfer-Encoding: 7bit\r\n\r\n`;
    message += text;
  } else {
    message += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

    // Corps du texte
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `Content-Transfer-Encoding: 7bit\r\n\r\n`;
    message += text + '\r\n\r\n';

    // Pièces jointes
    for (const att of attachments) {
      message += `--${boundary}\r\n`;
      message += `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n`;
      message += `Content-Disposition: attachment; filename="${att.filename}"\r\n`;
      message += `Content-Transfer-Encoding: base64\r\n\r\n`;
      message += chunkBase64(att.data) + '\r\n\r\n';
    }
    message += `--${boundary}--`;
  }

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function chunkBase64(b64) {
  // Découpe en lignes de 76 caractères (norme MIME)
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

/* ============ HISTORIQUE D'ÉCHANGES ============ */
async function getThread(gmail, body) {
  const { email, maxResults = 10 } = body;
  if (!email) return json(400, { error: 'Champ requis manquant : email' });

  const profile = await gmail.users.getProfile({ userId: 'me' });
  const myEmail = (profile.data.emailAddress || '').toLowerCase();

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `from:${email} OR to:${email}`,
    maxResults,
  });

  const ids = (list.data.messages || []).map((m) => m.id);
  const messages = [];

  for (const id of ids) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'],
    });
    const headers = msg.data.payload.headers || [];
    const get = (name) => (headers.find((h) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
    const from = get('From').toLowerCase();
    const direction = from.includes(myEmail) ? 'sent' : 'received';

    messages.push({
      id,
      subject: get('Subject'),
      date: get('Date') ? new Date(get('Date')).toISOString() : null,
      snippet: msg.data.snippet || '',
      direction,
    });
  }

  // Plus récent en premier
  messages.sort((a, b) => new Date(b.date) - new Date(a.date));

  return json(200, { messages });
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
