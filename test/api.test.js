'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb, seed } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;
let db;

before(async () => {
  db = openDb(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const loginAs = async (email) => (await api('POST', '/api/auth/login', { email, password: 'demo1234' })).body.token;
const cityId = (name) => db.prepare('SELECT id FROM cities WHERE name = ?').get(name).id;

test('login refuse un mauvais mot de passe', async () => {
  const r = await api('POST', '/api/auth/login', { email: 'client@demo.app', password: 'nope' });
  assert.equal(r.status, 401);
});

test('catalogue par ville regroupé par distributeur', async () => {
  const r = await api('GET', `/api/catalog?city_id=${cityId('Abidjan')}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((t) => t.name).sort(), ['GazExpress', 'Oryx Point Yopougon']);
  assert.ok(r.body.find((t) => t.name === 'GazExpress').offers.length >= 3);
  const douala = await api('GET', `/api/catalog?city_id=${cityId('Douala')}`);
  assert.equal(douala.body[0].name, 'Butane Services');
});

test('cycle complet : commande → confirmation → assignation → livraison', async () => {
  const client = await loginAs('client@demo.app');
  const admin = await loginAs('admin@gazexpress.ci');
  const driver = await loginAs('livreur@gazexpress.ci');
  const abj = cityId('Abidjan');
  const cat = (await api('GET', `/api/catalog?city_id=${abj}`)).body.find((t) => t.name === 'GazExpress');
  const offer = cat.offers[0];

  const created = await api('POST', '/api/orders', {
    tenant_id: cat.tenant_id, city_id: abj, address: 'Cocody, Rue des Jardins',
    payment_method: 'especes', items: [{ offer_id: offer.offer_id, qty: 2 }],
  }, client);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const o = created.body;
  assert.equal(o.total, offer.price * 2 + cat.delivery_fee);
  assert.equal(o.status, 'en_attente');
  const stockAfter = db.prepare('SELECT stock FROM offers WHERE id = ?').get(offer.offer_id).stock;
  assert.equal(stockAfter, offer.stock - 2);

  // Le livreur ne voit pas une commande non assignée.
  assert.equal((await api('GET', `/api/orders/${o.id}`, null, driver)).status, 404);
  // Un autre distributeur ne la voit pas non plus.
  const other = await loginAs('admin@butane.cm');
  assert.equal((await api('GET', `/api/orders/${o.id}`, null, other)).status, 404);

  assert.equal((await api('POST', `/api/orders/${o.id}/status`, { status: 'confirmee' }, admin)).body.status, 'confirmee');
  const driverId = db.prepare("SELECT id FROM users WHERE email = 'livreur@gazexpress.ci'").get().id;
  assert.equal((await api('POST', `/api/orders/${o.id}/assign`, { driver_id: driverId }, admin)).body.status, 'assignee');

  // Le client ne peut plus annuler une fois assignée.
  assert.equal((await api('POST', `/api/orders/${o.id}/status`, { status: 'annulee' }, client)).status, 400);

  assert.equal((await api('POST', `/api/orders/${o.id}/status`, { status: 'en_livraison' }, driver)).body.status, 'en_livraison');
  const done = await api('POST', `/api/orders/${o.id}/status`, { status: 'livree' }, driver);
  assert.equal(done.body.status, 'livree');
  assert.equal(done.body.payment_status, 'paye');
  assert.equal(done.body.events.length, 5);

  const stats = await api('GET', '/api/admin/stats', null, admin);
  assert.ok(stats.body.totals.revenue >= o.total);
});

test("annulation par le client remet le stock", async () => {
  const client = await loginAs('client@demo.app');
  const douala = cityId('Douala');
  const cat = (await api('GET', `/api/catalog?city_id=${douala}`)).body[0];
  const offer = cat.offers[0];
  const o = (await api('POST', '/api/orders', {
    tenant_id: cat.tenant_id, city_id: douala, address: 'Akwa, Douala',
    payment_method: 'mobile_money', items: [{ offer_id: offer.offer_id, qty: 3 }],
  }, client)).body;
  const r = await api('POST', `/api/orders/${o.id}/status`, { status: 'annulee' }, client);
  assert.equal(r.body.status, 'annulee');
  assert.equal(db.prepare('SELECT stock FROM offers WHERE id = ?').get(offer.offer_id).stock, offer.stock);
});

test('refus du stock insuffisant et des produits hors ville', async () => {
  const client = await loginAs('client@demo.app');
  const abj = cityId('Abidjan');
  const cat = (await api('GET', `/api/catalog?city_id=${abj}`)).body.find((t) => t.name === 'GazExpress');
  const scarce = cat.offers.reduce((a, b) => (b.stock < a.stock ? b : a));
  const before = scarce.stock;
  const big = await api('POST', '/api/orders', {
    tenant_id: cat.tenant_id, city_id: abj, address: 'Plateau, Abidjan',
    payment_method: 'especes', items: [{ offer_id: cat.offers[1].offer_id, qty: 1 }, { offer_id: scarce.offer_id, qty: before + 1 }],
  }, client);
  assert.equal(big.status, 409);
  // La transaction est annulée : aucun stock n'a bougé.
  assert.equal(db.prepare('SELECT stock FROM offers WHERE id = ?').get(scarce.offer_id).stock, before);
  assert.equal(db.prepare('SELECT stock FROM offers WHERE id = ?').get(cat.offers[1].offer_id).stock, cat.offers[1].stock);
  const douala = (await api('GET', `/api/catalog?city_id=${cityId('Douala')}`)).body[0];
  const wrong = await api('POST', '/api/orders', {
    tenant_id: cat.tenant_id, city_id: abj, address: 'Plateau, Abidjan',
    payment_method: 'especes', items: [{ offer_id: douala.offers[0].offer_id, qty: 1 }],
  }, client);
  assert.equal(wrong.status, 400);
});

test('inscription distributeur + limites du plan Starter', async () => {
  const s = await api('POST', '/api/tenants/signup', {
    company: 'Gaz Lomé Rapide', name: 'Kofi', email: 'kofi@gazlome.tg', phone: '+22890000000', password: 'motdepasse', plan: 'starter',
  });
  assert.equal(s.status, 200);
  const t = s.body.token;
  assert.equal((await api('POST', '/api/admin/zones', { city_id: cityId('Lomé'), delivery_fee: 500 }, t)).status, 200);
  const second = await api('POST', '/api/admin/zones', { city_name: 'Kara', country: 'Togo', delivery_fee: 500 }, t);
  assert.equal(second.status, 402);

  const p = (await api('POST', '/api/admin/products', { name: 'Recharge 12 kg', kind: 'recharge', weight_kg: 12 }, t)).body;
  assert.equal((await api('PUT', '/api/admin/offers', { product_id: p.id, city_id: cityId('Lomé'), price: 6000, stock: 10 }, t)).status, 200);
  const cat = (await api('GET', `/api/catalog?city_id=${cityId('Lomé')}`)).body;
  assert.equal(cat[0].name, 'Gaz Lomé Rapide');

  for (let i = 0; i < 3; i++) {
    const d = await api('POST', '/api/admin/drivers', { name: `L${i}`, email: `l${i}@gazlome.tg`, phone: '+22890000001', password: 'motdepasse' }, t);
    assert.equal(d.status, 200);
  }
  assert.equal((await api('POST', '/api/admin/drivers', { name: 'L4', email: 'l4@gazlome.tg', phone: '+22890000001', password: 'motdepasse' }, t)).status, 402);
});

test('superadmin peut suspendre un distributeur', async () => {
  const sa = await loginAs('super@gazflow.app');
  const tenants = (await api('GET', '/api/platform/tenants', null, sa)).body;
  const butane = tenants.find((x) => x.slug === 'butane-services');
  await api('PATCH', `/api/platform/tenants/${butane.id}`, { active: false }, sa);
  assert.equal((await api('GET', `/api/catalog?city_id=${cityId('Douala')}`)).body.length, 0);
  assert.equal((await api('POST', '/api/auth/login', { email: 'admin@butane.cm', password: 'demo1234' })).status, 403);
  await api('PATCH', `/api/platform/tenants/${butane.id}`, { active: true }, sa);
  // Un client ne peut pas accéder à l'espace plateforme.
  assert.equal((await api('GET', '/api/platform/tenants', null, await loginAs('client@demo.app'))).status, 403);
});

// Position de test : Cocody, Abidjan.
const COCODY = { lat: 5.3600, lng: -3.9800 };

test('recherche « ori » : trouve Oryx, points disponibles et les plus proches en premier', async () => {
  const r = await api('GET', `/api/search?q=ori&lat=${COCODY.lat}&lng=${COCODY.lng}`);
  assert.equal(r.status, 200);
  const res = r.body.results;
  assert.ok(res.length >= 3);
  for (const p of res) assert.ok(p.products.every((o) => o.brand === 'Oryx'), p.name);
  // Butane Services (Tradex, Douala) n'a pas d'Oryx.
  assert.ok(!res.some((p) => p.tenant_name === 'Butane Services'));
  assert.equal(res[0].name, 'GazExpress Cocody');
  const avail = res.filter((p) => p.available);
  for (let i = 1; i < avail.length; i++) assert.ok(avail[i - 1].distance_km <= avail[i].distance_km);
});

test('recherche par marque + poids, et marques suggérées', async () => {
  const r = await api('GET', '/api/search?q=total%206');
  assert.ok(r.body.results.length > 0);
  for (const p of r.body.results) assert.ok(p.products.every((o) => o.brand === 'Total' && o.weight_kg === 6));
  const brands = (await api('GET', `/api/brands?city_id=${cityId('Abidjan')}`)).body;
  assert.ok(brands.includes('Oryx') && brands.includes('Total') && !brands.includes('Tradex'));
  assert.equal((await api('GET', '/api/search?q=marqueinexistante')).body.results.length, 0);
});

test('demande de recharge : publiée, vue par les distributeurs de la ville, prise par un seul', async () => {
  const client = await loginAs('client@demo.app');
  const gx = await loginAs('admin@gazexpress.ci');
  const oryxPoint = await loginAs('admin@oryxpoint.ci');
  const butane = await loginAs('admin@butane.cm');
  const created = await api('POST', '/api/requests', {
    city_id: cityId('Abidjan'), service: 'collecte', brand: 'Oryx', weight_kg: 12.5, qty: 1,
    address: 'Cocody Angré 8e tranche', ...COCODY,
  }, client);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal(created.body.status, 'ouverte');

  // Les deux distributeurs d'Abidjan la voient, pas celui de Douala.
  const seen = (await api('GET', '/api/requests', null, gx)).body.open.find((x) => x.id === id);
  assert.ok(seen);
  assert.equal(seen.nearest_point.name, 'GazExpress Cocody');
  assert.equal(seen.phone, null); // téléphone masqué avant prise en charge
  assert.equal(seen.options[0].brand, 'Oryx'); // le produit demandé est proposé en premier
  assert.equal(seen.options[0].weight_kg, 12.5);
  assert.ok((await api('GET', '/api/requests', null, oryxPoint)).body.open.some((x) => x.id === id));
  assert.ok(!(await api('GET', '/api/requests', null, butane)).body.open.some((x) => x.id === id));

  const accepted = await api('POST', `/api/requests/${id}/accept`, { offer_id: seen.options[0].offer_id }, gx);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, 'confirmee');
  assert.equal(accepted.body.service, 'collecte');
  assert.equal(accepted.body.lat, COCODY.lat);

  // Le second distributeur arrive trop tard.
  const oOffer = (await api('GET', `/api/catalog?city_id=${cityId('Abidjan')}`)).body
    .find((t) => t.name === 'Oryx Point Yopougon').offers.find((o) => o.in_stock);
  assert.equal((await api('POST', `/api/requests/${id}/accept`, { offer_id: oOffer.offer_id }, oryxPoint)).status, 409);

  // Le client voit qui a pris sa demande et peut le contacter.
  const mine = (await api('GET', `/api/requests/${id}`, null, client)).body;
  assert.equal(mine.status, 'acceptee');
  assert.equal(mine.tenant_name, 'GazExpress');
  assert.ok(mine.tenant_phone);
  assert.equal(mine.order_id, accepted.body.id);
  assert.equal((await api('POST', `/api/requests/${id}/cancel`, null, client)).status, 400);
});

test('demande annulée par le client avant prise en charge', async () => {
  const client = await loginAs('client@demo.app');
  const r = (await api('POST', '/api/requests', {
    city_id: cityId('Douala'), service: 'echange', brand: 'Tradex', address: 'Akwa, Douala',
  }, client)).body;
  assert.equal((await api('POST', `/api/requests/${r.id}/cancel`, null, client)).body.status, 'annulee');
  const butane = await loginAs('admin@butane.cm');
  assert.ok(!(await api('GET', '/api/requests', null, butane)).body.open.some((x) => x.id === r.id));
  // Pas de demande dans une ville sans distributeur.
  assert.equal((await api('POST', '/api/requests', { city_id: cityId('Cotonou'), service: 'echange', address: 'Cotonou centre' }, client)).status, 400);
});

test('le distributeur gère ses points de vente', async () => {
  const gx = await loginAs('admin@gazexpress.ci');
  const created = await api('POST', '/api/admin/points', {
    city_id: cityId('Abidjan'), name: 'GazExpress Bingerville', address: 'Bingerville centre', lat: 5.355, lng: -3.885,
  }, gx);
  assert.equal(created.status, 200);
  assert.equal((await api('POST', '/api/admin/points', { city_id: cityId('Douala'), name: 'X', address: 'Douala', lat: 4, lng: 9 }, gx)).status, 400);
  assert.equal((await api('POST', '/api/admin/points', { city_id: cityId('Abidjan'), name: 'Sans GPS', address: 'Abidjan' }, gx)).status, 400);
  await api('PATCH', `/api/admin/points/${created.body.id}`, { active: false }, gx);
  const res = (await api('GET', '/api/search?q=total')).body.results;
  assert.ok(!res.some((p) => p.name === 'GazExpress Bingerville'));
  // Un autre distributeur ne peut pas le modifier.
  const other = await loginAs('admin@butane.cm');
  assert.equal((await api('DELETE', `/api/admin/points/${created.body.id}`, null, other)).status, 404);
  assert.equal((await api('DELETE', `/api/admin/points/${created.body.id}`, null, gx)).status, 200);
});
