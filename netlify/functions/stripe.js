// netlify/functions/stripe.js
// Actions :
//  - sync           : récupère les derniers paiements, le nb de clients et les liens de paiement
//  - balance        : solde Stripe (disponible / en attente)
//  - create_link    : crée un produit + prix + lien de paiement
//  - create_customer: crée un client Stripe

const Stripe = require('stripe');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Méthode non autorisée' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return json(500, { error: "STRIPE_SECRET_KEY manquant dans les variables d'environnement Netlify." });
  }
  const stripe = new Stripe(secretKey);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'JSON invalide' });
  }

  try {
    switch (body.action) {
      case 'sync': return await syncStripe(stripe);
      case 'balance': return await getBalance(stripe);
      case 'create_link': return await createLink(stripe, body);
      case 'create_customer': return await createCustomer(stripe, body);
      default: return json(400, { error: 'Action inconnue : ' + body.action });
    }
  } catch (err) {
    return json(500, { error: err.message });
  }
};

/* ============ SYNCHRONISATION ============ */
async function syncStripe(stripe) {
  // Derniers paiements (charges)
  const charges = await stripe.charges.list({ limit: 25 });
  const payments = charges.data.map((c) => ({
    email: c.billing_details?.email || c.receipt_email || null,
    amount: c.amount,
    status: c.status === 'succeeded' ? 'succeeded' : c.status,
    created: c.created,
  }));

  // Nombre de clients
  const customers = await stripe.customers.list({ limit: 100 });
  const customerCount = customers.data.length + (customers.has_more ? 100 : 0); // approximatif si > 100

  // Liens de paiement actifs avec leur montant (via line items)
  const linksRes = await stripe.paymentLinks.list({ limit: 25 });
  const links = [];
  for (const link of linksRes.data) {
    let amount = null;
    let name = null;
    try {
      const items = await stripe.paymentLinks.listLineItems(link.id, { limit: 1 });
      if (items.data.length) {
        amount = items.data[0].amount_total ?? items.data[0].price?.unit_amount ?? null;
        name = items.data[0].description || null;
      }
    } catch (e) { /* ignore */ }
    links.push({ id: link.id, url: link.url, active: link.active, amount, name });
  }

  return json(200, { payments, customerCount, links });
}

/* ============ SOLDE ============ */
async function getBalance(stripe) {
  const balance = await stripe.balance.retrieve();
  const available = (balance.available || []).reduce((s, b) => s + b.amount, 0);
  const pending = (balance.pending || []).reduce((s, b) => s + b.amount, 0);
  return json(200, { available, pending });
}

/* ============ CRÉATION D'UN LIEN DE PAIEMENT ============ */
async function createLink(stripe, body) {
  const { name, amount } = body;
  if (!name || !amount) return json(400, { error: 'Champs requis manquants : name, amount (en centimes)' });

  const price = await stripe.prices.create({
    currency: 'eur',
    unit_amount: Math.round(amount),
    product_data: { name },
  });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
  });

  return json(200, { ok: true, id: link.id, url: link.url });
}

/* ============ CRÉATION D'UN CLIENT ============ */
async function createCustomer(stripe, body) {
  const { name, email, phone } = body;
  if (!name || !email) return json(400, { error: 'Champs requis manquants : name, email' });

  const customer = await stripe.customers.create({
    name,
    email,
    phone: phone || undefined,
  });

  return json(200, { ok: true, id: customer.id });
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
