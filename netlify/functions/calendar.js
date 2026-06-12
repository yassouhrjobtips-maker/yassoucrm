// netlify/functions/calendar.js
// Actions :
//  - list   : liste les prochains événements du calendrier principal
//  - create : crée un événement (RDV horodaté OU échéance journée entière)
//  - search : cherche le prochain événement à venir contenant un mot-clé (ex: nom du client)

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
    const calendar = google.calendar({ version: 'v3', auth });

    if (body.action === 'list') return await listEvents(calendar, body);
    if (body.action === 'create') return await createEvent(calendar, body);
    if (body.action === 'search') return await searchEvent(calendar, body);

    return json(400, { error: 'Action inconnue : ' + body.action });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

async function listEvents(calendar, body) {
  const maxResults = body.maxResults || 15;
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = (res.data.items || []).map((e) => ({
    id: e.id,
    title: e.summary || '(sans titre)',
    start: e.start ? (e.start.dateTime || e.start.date) : null,
    location: e.location || '',
  }));

  return json(200, { events });
}

async function createEvent(calendar, body) {
  const { summary, description = '', location = '' } = body;
  if (!summary) return json(400, { error: 'Champ requis manquant : summary' });

  let eventBody = { summary, description, location };

  if (body.date) {
    // Échéance "journée entière" (ex: rendu CV/LinkedIn)
    eventBody.start = { date: body.date };
    eventBody.end = { date: body.date };
  } else if (body.start) {
    // RDV horodaté : body.start = "YYYY-MM-DDTHH:MM"
    const startDate = new Date(body.start);
    const durationMinutes = body.durationMinutes || 60;
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
    const tz = 'Europe/Paris';
    eventBody.start = { dateTime: startDate.toISOString(), timeZone: tz };
    eventBody.end = { dateTime: endDate.toISOString(), timeZone: tz };
  } else {
    return json(400, { error: 'Il faut fournir "date" (journée entière) ou "start" (RDV horodaté)' });
  }

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: eventBody,
  });

  return json(200, { ok: true, id: res.data.id, htmlLink: res.data.htmlLink });
}

async function searchEvent(calendar, body) {
  const { query } = body;
  if (!query) return json(400, { error: 'Champ requis manquant : query' });

  const res = await calendar.events.list({
    calendarId: 'primary',
    q: query,
    timeMin: new Date().toISOString(),
    maxResults: 1,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const items = res.data.items || [];
  if (!items.length) return json(200, { found: false });

  const e = items[0];
  return json(200, {
    found: true,
    title: e.summary || '',
    start: e.start ? (e.start.dateTime || e.start.date) : null,
  });
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
