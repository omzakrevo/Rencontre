'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { hashPassword, verifyPassword, createToken, readToken } = require('./auth');
const { PLANS, NOW, SINCE } = require('./db');
const { matches, distanceKm, extractCities } = require('./search');

const STATUS_LABELS = {
  en_attente: 'En attente',
  confirmee: 'Confirmée',
  assignee: 'Livreur assigné',
  en_livraison: 'En cours de livraison',
  livree: 'Livrée',
  annulee: 'Annulée',
};

// Transitions autorisées par rôle : { rôle: { statut_actuel: [statuts_suivants] } }
const TRANSITIONS = {
  admin: {
    en_attente: ['confirmee', 'annulee'],
    confirmee: ['annulee'],
    assignee: ['en_livraison', 'annulee'],
    en_livraison: ['livree', 'annulee'],
  },
  driver: {
    assignee: ['en_livraison'],
    en_livraison: ['livree'],
  },
  customer: {
    en_attente: ['annulee'],
    confirmee: ['annulee'],
  },
};

const SERVICES = {
  echange: 'Livraison + reprise de la bouteille vide',
  collecte: 'Collecte de la bouteille, recharge et retour',
  achat: "Achat d'une bouteille neuve",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const str = (v, field, { min = 1, max = 200, optional = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    fail(400, `Champ requis : ${field}`);
  }
  const s = String(v).trim();
  if (s.length < min || s.length > max) fail(400, `Champ invalide : ${field}`);
  return s;
};
const int = (v, field, { min = 0, max = 1e9, optional = false } = {}) => {
  if ((v === undefined || v === null || v === '') && optional) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `Champ invalide : ${field}`);
  return n;
};
const coord = (v, field, max) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) fail(400, `Champ invalide : ${field}`);
  return n;
};
const email = (v) => {
  const s = str(v, 'email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail(400, 'Email invalide');
  return s;
};
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'distributeur';

const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
  tenant_id: u.tenant_id, city_id: u.city_id, active: !!u.active,
});

const PAYMENTS = ['especes', 'mobile_money', 'carte'];
const KIND_LABEL = { recharge: 'Recharge', bouteille: 'Bouteille neuve', accessoire: 'Accessoire' };
const offerText = (o) => `${o.brand || ''} ${o.name} ${o.weight_kg ? `${o.weight_kg} kg` : ''} ${KIND_LABEL[o.kind]}`;

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // derrière le proxy de Coolify (Traefik) ou de Netlify
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const { get, all, run } = db;
  const tx = (fn) => db.tx(fn);
  /** Route asynchrone : la valeur renvoyée est envoyée en JSON, les erreurs passent au gestionnaire. */
  const wrap = (fn) => (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => { if (out !== undefined) res.json(out); })
      .catch(next);
  };

  // ---------- Authentification ----------
  app.use((req, _res, next) => {
    const h = req.headers.authorization || '';
    const data = h.startsWith('Bearer ') ? readToken(h.slice(7)) : null;
    if (!data) return next();
    (async () => {
      const u = await get('SELECT * FROM users WHERE id = ? AND active = 1', data.sub);
      if (!u) return;
      if (u.tenant_id) {
        const t = await get('SELECT active FROM tenants WHERE id = ?', u.tenant_id);
        if (t && t.active) req.user = u;
      } else {
        req.user = u;
      }
    })().then(() => next(), next);
  });
  const need = (...roles) => (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Authentification requise'));
    if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'Accès refusé'));
    next();
  };

  const login = (u) => ({ token: createToken(u), user: publicUser(u) });

  app.post('/api/auth/register', wrap(async (req) => {
    const b = req.body || {};
    const e = email(b.email);
    const password = str(b.password, 'mot de passe', { min: 8, max: 100 });
    if (await get('SELECT 1 FROM users WHERE email = ?', e)) fail(409, 'Cet email est déjà utilisé');
    const cityId = int(b.city_id, 'ville', { min: 1, optional: true });
    const r = await run('INSERT INTO users (role, name, email, phone, password_hash, city_id) VALUES (?,?,?,?,?,?) RETURNING id',
      'customer', str(b.name, 'nom', { max: 80 }), e, str(b.phone, 'téléphone', { min: 6, max: 30 }), hashPassword(password), cityId);
    return login(await get('SELECT * FROM users WHERE id = ?', r.id));
  }));

  app.post('/api/auth/login', wrap(async (req) => {
    const b = req.body || {};
    const u = await get('SELECT * FROM users WHERE email = ?', String(b.email || '').trim().toLowerCase());
    if (!u || !u.active || !verifyPassword(String(b.password || ''), u.password_hash)) fail(401, 'Identifiants incorrects');
    if (u.tenant_id && !(await get('SELECT active FROM tenants WHERE id = ?', u.tenant_id)).active) fail(403, 'Compte distributeur suspendu');
    return login(u);
  }));

  app.get('/api/me', need(), wrap(async (req) => {
    const tenant = req.user.tenant_id ? await get('SELECT * FROM tenants WHERE id = ?', req.user.tenant_id) : null;
    return { user: publicUser(req.user), tenant, plan: tenant ? { id: tenant.plan, ...PLANS[tenant.plan] } : null };
  }));

  // Inscription d'un distributeur (onboarding SaaS) : crée l'entreprise + son administrateur.
  app.post('/api/tenants/signup', wrap(async (req) => {
    const b = req.body || {};
    const name = str(b.company, "nom de l'entreprise", { min: 2, max: 80 });
    const plan = b.plan && PLANS[b.plan] ? b.plan : 'starter';
    const e = email(b.email);
    const password = str(b.password, 'mot de passe', { min: 8, max: 100 });
    const phone = str(b.phone, 'téléphone', { min: 6, max: 30 });
    const adminName = str(b.name, 'nom', { max: 80 });
    const currency = str(b.currency, 'devise', { max: 10, optional: true }) || 'FCFA';
    if (await get('SELECT 1 FROM users WHERE email = ?', e)) fail(409, 'Cet email est déjà utilisé');
    let slug = slugify(name);
    for (let i = 2; await get('SELECT 1 FROM tenants WHERE slug = ?', slug); i++) slug = `${slugify(name)}-${i}`;
    const userId = await tx(async () => {
      const t = await run('INSERT INTO tenants (name, slug, plan, currency, phone) VALUES (?,?,?,?,?) RETURNING id', name, slug, plan, currency, phone);
      return (await run('INSERT INTO users (tenant_id, role, name, email, phone, password_hash) VALUES (?,?,?,?,?,?) RETURNING id',
        t.id, 'admin', adminName, e, phone, hashPassword(password))).id;
    });
    return login(await get('SELECT * FROM users WHERE id = ?', userId));
  }));

  // Santé de l'application (utilisée par Docker / Coolify).
  app.get('/api/health', wrap(async () => {
    await get('SELECT 1 AS ok');
    return { ok: true };
  }));

  // ---------- Catalogue public ----------
  app.get('/api/plans', wrap(() => Object.entries(PLANS).map(([id, p]) => ({
    id, ...p, maxCities: Number.isFinite(p.maxCities) ? p.maxCities : null, maxDrivers: Number.isFinite(p.maxDrivers) ? p.maxDrivers : null,
  }))));

  app.get('/api/cities', wrap(() => all(`
    SELECT c.id, c.name, c.country, COUNT(DISTINCT tc.tenant_id) AS providers
    FROM cities c
    LEFT JOIN tenant_cities tc ON tc.city_id = c.id AND tc.active = 1
      AND tc.tenant_id IN (SELECT id FROM tenants WHERE active = 1)
    GROUP BY c.id ORDER BY c.country, c.name`)));

  // Offres disponibles dans une ville, regroupées par distributeur.
  app.get('/api/catalog', wrap(async (req) => {
    const cityId = int(req.query.city_id, 'ville', { min: 1 });
    const rows = await all(`
      SELECT o.id AS offer_id, o.price, o.stock, p.name, p.brand, p.weight_kg, p.kind,
             t.id AS tenant_id, t.name AS tenant_name, t.currency, tc.delivery_fee, tc.min_delay_minutes
      FROM offers o
      JOIN products p ON p.id = o.product_id AND p.active = 1
      JOIN tenants t ON t.id = o.tenant_id AND t.active = 1
      JOIN tenant_cities tc ON tc.tenant_id = t.id AND tc.city_id = o.city_id AND tc.active = 1
      WHERE o.city_id = ?
      ORDER BY t.name, CASE p.kind WHEN 'recharge' THEN 0 WHEN 'bouteille' THEN 1 ELSE 2 END, p.weight_kg, o.id`, cityId);
    const byTenant = new Map();
    for (const r of rows) {
      if (!byTenant.has(r.tenant_id)) {
        byTenant.set(r.tenant_id, {
          tenant_id: r.tenant_id, name: r.tenant_name, currency: r.currency,
          delivery_fee: r.delivery_fee, min_delay_minutes: r.min_delay_minutes, offers: [],
        });
      }
      byTenant.get(r.tenant_id).offers.push({
        offer_id: r.offer_id, name: r.name, brand: r.brand, weight_kg: r.weight_kg,
        kind: r.kind, price: r.price, in_stock: r.stock > 0, stock: r.stock,
      });
    }
    return [...byTenant.values()];
  }));

  // ---------- Recherche de points de vente ----------
  /** Offres en vente (distributeur actif, ville desservie), éventuellement limitées à une ville. */
  const liveOffers = (cityId) => all(`
    SELECT o.id AS offer_id, o.tenant_id, o.city_id, o.price, o.stock, p.name, p.brand, p.weight_kg, p.kind
    FROM offers o
    JOIN products p ON p.id = o.product_id AND p.active = 1
    JOIN tenants t ON t.id = o.tenant_id AND t.active = 1
    JOIN tenant_cities tc ON tc.tenant_id = o.tenant_id AND tc.city_id = o.city_id AND tc.active = 1
    ${cityId ? 'WHERE o.city_id = ?' : ''}
    ORDER BY CASE p.kind WHEN 'recharge' THEN 0 WHEN 'bouteille' THEN 1 ELSE 2 END, p.weight_kg, o.id`, ...(cityId ? [cityId] : []));

  // Recherche publique : « Oryx », « total 12 », « ori »… → points de vente qui l'ont, du plus proche au plus loin.
  app.get('/api/search', wrap(async (req) => {
    let query = String(req.query.q || '').slice(0, 60);
    const lat = coord(req.query.lat, 'latitude', 90);
    const lng = coord(req.query.lng, 'longitude', 180);
    const cityId = int(req.query.city_id, 'ville', { min: 1, optional: true });
    // « Oryx Bobo » : la ville tapée filtre les résultats, le reste cherche le produit.
    let typedCities = [];
    if (query) {
      const found = extractCities(query, await all('SELECT id, name FROM cities'));
      typedCities = found.cityIds;
      query = found.rest;
    }
    const [points, offers] = await Promise.all([
      all(`
        SELECT pt.*, c.name AS city_name, t.name AS tenant_name, t.currency, tc.delivery_fee, tc.min_delay_minutes
        FROM points pt
        JOIN tenants t ON t.id = pt.tenant_id AND t.active = 1
        JOIN tenant_cities tc ON tc.tenant_id = pt.tenant_id AND tc.city_id = pt.city_id AND tc.active = 1
        JOIN cities c ON c.id = pt.city_id
        WHERE pt.active = 1 ${cityId ? 'AND pt.city_id = ?' : ''}`, ...(cityId ? [cityId] : [])),
      liveOffers(cityId),
    ]);
    const results = [];
    for (const pt of points) {
      if (typedCities.length && !typedCities.includes(pt.city_id)) continue;
      const allOffers = offers.filter((o) => o.tenant_id === pt.tenant_id && o.city_id === pt.city_id);
      const products = (query ? allOffers.filter((o) => matches(query, offerText(o))) : allOffers)
        .map(({ tenant_id: _t, city_id: _c, stock, ...o }) => ({ ...o, in_stock: stock > 0 }));
      if (query && !products.length) continue;
      results.push({
        id: pt.id, name: pt.name, address: pt.address, phone: pt.phone, hours: pt.hours, lat: pt.lat, lng: pt.lng,
        city_id: pt.city_id, city_name: pt.city_name, tenant_id: pt.tenant_id, tenant_name: pt.tenant_name,
        currency: pt.currency, delivery_fee: pt.delivery_fee, min_delay_minutes: pt.min_delay_minutes,
        available: products.some((o) => o.in_stock), products,
        distance_km: lat !== null && lng !== null ? Math.round(distanceKm(lat, lng, pt.lat, pt.lng) * 10) / 10 : null,
      });
    }
    // Disponibles d'abord, puis du plus proche au plus loin.
    results.sort((a, b) => (b.available - a.available)
      || ((a.distance_km ?? 0) - (b.distance_km ?? 0))
      || a.city_name.localeCompare(b.city_name) || a.name.localeCompare(b.name));
    return { query, cities: typedCities, results: results.slice(0, 40) };
  }));

  // Chiffres publics affichés sur l'accueil (calculés sur les données réelles).
  app.get('/api/stats/public', wrap(async () => {
    const active = 'SELECT tc.tenant_id, tc.city_id FROM tenant_cities tc JOIN tenants t ON t.id = tc.tenant_id AND t.active = 1 WHERE tc.active = 1';
    const [c, d, p, offers] = await Promise.all([
      get(`SELECT COUNT(DISTINCT city_id) AS n FROM (${active}) z`),
      get(`SELECT COUNT(DISTINCT tenant_id) AS n FROM (${active}) z`),
      get(`SELECT COUNT(*) AS n FROM points p JOIN (${active}) z ON z.tenant_id = p.tenant_id AND z.city_id = p.city_id WHERE p.active = 1`),
      liveOffers(),
    ]);
    return {
      cities: c.n, distributors: d.n, points: p.n,
      brands: new Set(offers.filter((o) => o.brand && o.stock > 0).map((o) => o.brand)).size,
    };
  }));

  // Marques disponibles (suggestions de recherche).
  app.get('/api/brands', wrap(async (req) => {
    const cityId = int(req.query.city_id, 'ville', { min: 1, optional: true });
    const counts = new Map();
    for (const o of await liveOffers(cityId)) {
      if (o.brand && o.stock > 0) counts.set(o.brand, (counts.get(o.brand) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([brand]) => brand);
  }));

  // ---------- Commandes ----------
  const orderDetail = async (id) => {
    const o = await get(`
      SELECT o.*, c.name AS city_name, t.name AS tenant_name, t.currency,
             cu.name AS customer_name, d.name AS driver_name, d.phone AS driver_phone
      FROM orders o
      JOIN cities c ON c.id = o.city_id
      JOIN tenants t ON t.id = o.tenant_id
      JOIN users cu ON cu.id = o.customer_id
      LEFT JOIN users d ON d.id = o.driver_id
      WHERE o.id = ?`, id);
    if (!o) return null;
    o.items = await all('SELECT offer_id, product_name, qty, unit_price FROM order_items WHERE order_id = ? ORDER BY id', id);
    o.events = await all(`SELECT e.status, e.note, e.created_at, u.name AS by_name
                  FROM order_events e LEFT JOIN users u ON u.id = e.user_id
                  WHERE e.order_id = ? ORDER BY e.id`, id);
    o.status_label = STATUS_LABELS[o.status];
    o.service_label = { livraison: 'Livraison', ...SERVICES }[o.service] || o.service;
    return o;
  };

  const canSee = (u, o) => (u.role === 'superadmin')
    || (u.role === 'customer' && o.customer_id === u.id)
    || (u.role === 'admin' && o.tenant_id === u.tenant_id)
    || (u.role === 'driver' && o.driver_id === u.id);

  const loadOrder = async (req) => {
    const o = await orderDetail(int(req.params.id, 'commande', { min: 1 }));
    if (!o || !canSee(req.user, o)) fail(404, 'Commande introuvable');
    return o;
  };

  const restock = async (orderId) => {
    for (const it of await all('SELECT offer_id, qty FROM order_items WHERE order_id = ?', orderId)) {
      await run('UPDATE offers SET stock = stock + ? WHERE id = ?', it.qty, it.offer_id);
    }
  };

  const event = (orderId, status, note, userId) => run('INSERT INTO order_events (order_id, status, note, user_id) VALUES (?,?,?,?)', orderId, status, note, userId);

  /**
   * Crée une commande et décrémente le stock. À appeler dans une transaction.
   * Utilisé par la commande directe et par l'acceptation d'une demande.
   */
  const insertOrder = async (customerId, b, { service = 'livraison', requestId = null, note = null, byUserId = customerId } = {}) => {
    const tenantId = int(b.tenant_id, 'distributeur', { min: 1 });
    const cityId = int(b.city_id, 'ville', { min: 1 });
    const zone = await get(`SELECT tc.* FROM tenant_cities tc JOIN tenants t ON t.id = tc.tenant_id AND t.active = 1
                    WHERE tc.tenant_id = ? AND tc.city_id = ? AND tc.active = 1`, tenantId, cityId);
    if (!zone) fail(400, 'Ce distributeur ne livre pas dans cette ville');
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length || items.length > 20) fail(400, 'Le panier est vide');
    const payment = PAYMENTS.includes(b.payment_method) ? b.payment_method : fail(400, 'Mode de paiement invalide');
    const slot = ['asap', 'matin', 'apres_midi', 'soir'].includes(b.slot) ? b.slot : 'asap';
    const address = str(b.address, 'adresse', { min: 5, max: 300 });
    const phone = str(b.phone, 'téléphone', { min: 6, max: 30 });
    const notes = str(b.notes, 'notes', { max: 500, optional: true });
    const lat = coord(b.lat, 'latitude', 90);
    const lng = coord(b.lng, 'longitude', 180);

    let subtotal = 0;
    const lines = new Map();
    for (const it of items) {
      const offerId = int(it.offer_id, 'produit', { min: 1 });
      const qty = int(it.qty, 'quantité', { min: 1, max: 50 });
      lines.set(offerId, (lines.get(offerId) || 0) + qty);
    }
    const resolved = [];
    for (const [offerId, qty] of lines) {
      const o = await get(`SELECT o.*, p.name, p.brand FROM offers o JOIN products p ON p.id = o.product_id AND p.active = 1
                   WHERE o.id = ? AND o.tenant_id = ? AND o.city_id = ?`, offerId, tenantId, cityId);
      if (!o) fail(400, 'Produit indisponible dans cette ville');
      // Décrément conditionnel : évite la survente en cas de commandes simultanées.
      const upd = await run('UPDATE offers SET stock = stock - ? WHERE id = ? AND stock >= ?', qty, offerId, qty);
      if (upd.changes !== 1) fail(409, `Stock insuffisant pour « ${o.name} »`);
      subtotal += o.price * qty;
      resolved.push({ ...o, qty });
    }
    const ref = `GZ-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const r = await run(`INSERT INTO orders (ref, tenant_id, customer_id, city_id, address, phone, notes, slot, payment_method,
                   subtotal, delivery_fee, total, service, lat, lng, request_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    ref, tenantId, customerId, cityId, address, phone, notes, slot, payment, subtotal, zone.delivery_fee,
    subtotal + zone.delivery_fee, service, lat, lng, requestId);
    for (const l of resolved) {
      await run('INSERT INTO order_items (order_id, offer_id, product_name, qty, unit_price) VALUES (?,?,?,?,?)',
        r.id, l.id, l.brand ? `${l.name} ${l.brand}` : l.name, l.qty, l.price);
    }
    await event(r.id, 'en_attente', note, byUserId);
    return r.id;
  };

  app.post('/api/orders', need('customer'), wrap(async (req) => {
    const b = { ...(req.body || {}) };
    b.phone = b.phone || req.user.phone;
    const id = await tx(() => insertOrder(req.user.id, b));
    return orderDetail(id);
  }));

  app.get('/api/orders', need(), wrap(async (req) => {
    const u = req.user;
    const where = [];
    const args = [];
    if (u.role === 'customer') { where.push('o.customer_id = ?'); args.push(u.id); }
    if (u.role === 'admin') { where.push('o.tenant_id = ?'); args.push(u.tenant_id); }
    if (u.role === 'driver') { where.push('o.driver_id = ?'); args.push(u.id); }
    if (req.query.status) { where.push('o.status = ?'); args.push(String(req.query.status)); }
    if (req.query.city_id) { where.push('o.city_id = ?'); args.push(int(req.query.city_id, 'ville')); }
    const rows = await all(`
      SELECT o.id, o.ref, o.status, o.total, o.created_at, o.address, o.phone, o.slot,
             o.payment_method, o.payment_status, o.driver_id, o.service, o.lat, o.lng,
             c.name AS city_name, t.name AS tenant_name, t.currency, cu.name AS customer_name, d.name AS driver_name,
             (SELECT string_agg(i.qty || ' × ' || i.product_name, ', ' ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS summary
      FROM orders o
      JOIN cities c ON c.id = o.city_id
      JOIN tenants t ON t.id = o.tenant_id
      JOIN users cu ON cu.id = o.customer_id
      LEFT JOIN users d ON d.id = o.driver_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.id DESC LIMIT 200`, ...args);
    return rows.map((r) => ({ ...r, status_label: STATUS_LABELS[r.status] }));
  }));

  app.get('/api/orders/:id', need(), wrap((req) => loadOrder(req)));

  app.post('/api/orders/:id/status', need('admin', 'driver', 'customer'), wrap(async (req) => {
    const o = await loadOrder(req);
    const next = String((req.body || {}).status || '');
    const allowed = (TRANSITIONS[req.user.role] || {})[o.status] || [];
    if (!allowed.includes(next)) fail(400, `Transition impossible : ${STATUS_LABELS[o.status]} → ${STATUS_LABELS[next] || next}`);
    const note = str((req.body || {}).note, 'note', { max: 300, optional: true });
    await tx(async () => {
      // Mise à jour conditionnelle : deux changements simultanés ne peuvent pas partir du même statut.
      const upd = await run(`UPDATE orders SET status = ?, updated_at = ${NOW} WHERE id = ? AND status = ?`, next, o.id, o.status);
      if (upd.changes !== 1) fail(409, 'La commande vient de changer de statut, rechargez la page');
      if (next === 'annulee') {
        await restock(o.id);
        if (o.payment_status === 'paye') await run("UPDATE orders SET payment_status = 'rembourse' WHERE id = ?", o.id);
      }
      if (next === 'livree' && o.payment_method === 'especes') await run("UPDATE orders SET payment_status = 'paye' WHERE id = ?", o.id);
      await event(o.id, next, note, req.user.id);
    });
    return orderDetail(o.id);
  }));

  app.post('/api/orders/:id/assign', need('admin'), wrap(async (req) => {
    const o = await loadOrder(req);
    if (!['en_attente', 'confirmee', 'assignee'].includes(o.status)) fail(400, 'Cette commande ne peut plus être assignée');
    const driverId = int((req.body || {}).driver_id, 'livreur', { min: 1 });
    const d = await get("SELECT * FROM users WHERE id = ? AND role = 'driver' AND tenant_id = ? AND active = 1", driverId, req.user.tenant_id);
    if (!d) fail(400, 'Livreur introuvable');
    await tx(async () => {
      await run(`UPDATE orders SET driver_id = ?, status = 'assignee', updated_at = ${NOW} WHERE id = ?`, d.id, o.id);
      await event(o.id, 'assignee', `Assignée à ${d.name}`, req.user.id);
    });
    return orderDetail(o.id);
  }));

  app.post('/api/orders/:id/paid', need('admin'), wrap(async (req) => {
    const o = await loadOrder(req);
    if (o.status === 'annulee') fail(400, 'Commande annulée');
    await run(`UPDATE orders SET payment_status = 'paye', updated_at = ${NOW} WHERE id = ?`, o.id);
    return orderDetail(o.id);
  }));

  // ---------- Demandes (recharge, échange, achat) ----------
  const requestRow = (id) => get(`
    SELECT r.*, c.name AS city_name, u.name AS customer_name, t.name AS tenant_name, t.phone AS tenant_phone,
           o.ref AS order_ref, o.status AS order_status, o.total AS order_total, t.currency,
           d.name AS driver_name, d.phone AS driver_phone
    FROM requests r
    JOIN cities c ON c.id = r.city_id
    JOIN users u ON u.id = r.customer_id
    LEFT JOIN tenants t ON t.id = r.tenant_id
    LEFT JOIN orders o ON o.id = r.order_id
    LEFT JOIN users d ON d.id = o.driver_id
    WHERE r.id = ?`, id);

  const decorateRequest = (r) => r && ({
    ...r,
    service_label: SERVICES[r.service],
    order_status_label: r.order_status ? STATUS_LABELS[r.order_status] : null,
  });

  // Pour un distributeur : distance à son point le plus proche et produits qu'il peut proposer.
  const requestForTenant = async (r, tenantId) => {
    const [pts, offers] = await Promise.all([
      all('SELECT name, lat, lng FROM points WHERE tenant_id = ? AND city_id = ? AND active = 1', tenantId, r.city_id),
      liveOffers(r.city_id),
    ]);
    let nearest = null;
    if (r.lat !== null && r.lng !== null) {
      for (const p of pts) {
        const d = distanceKm(r.lat, r.lng, p.lat, p.lng);
        if (!nearest || d < nearest.distance_km) nearest = { name: p.name, distance_km: Math.round(d * 10) / 10 };
      }
    }
    const want = `${r.brand || ''} ${r.weight_kg ? r.weight_kg : ''}`.trim();
    const kinds = r.service === 'achat' ? ['bouteille'] : ['recharge', 'bouteille'];
    const options = offers
      .filter((o) => o.tenant_id === tenantId && kinds.includes(o.kind))
      .map((o) => ({ ...o, label: `${o.brand ? `${o.brand} · ` : ''}${o.name}`, match: want ? matches(want, offerText(o)) : true }))
      .sort((a, b) => (b.match - a.match) || ((b.stock > 0) - (a.stock > 0)));
    const out = { ...decorateRequest(r), nearest_point: nearest, options };
    // Coordonnées du client réservées au distributeur qui prend la demande.
    if (r.tenant_id !== tenantId) {
      out.phone = null;
      out.customer_name = String(r.customer_name).split(' ')[0];
    }
    return out;
  };

  app.post('/api/requests', need('customer'), wrap(async (req) => {
    const b = req.body || {};
    const cityId = int(b.city_id, 'ville', { min: 1 });
    const served = (await get(`SELECT COUNT(*) AS n FROM tenant_cities tc JOIN tenants t ON t.id = tc.tenant_id AND t.active = 1
                      WHERE tc.city_id = ? AND tc.active = 1`, cityId)).n;
    if (!served) fail(400, 'Aucun distributeur ne couvre encore cette ville');
    const service = SERVICES[b.service] ? b.service : fail(400, 'Type de demande invalide');
    const weight = b.weight_kg === '' || b.weight_kg == null ? null : Number(b.weight_kg);
    if (weight !== null && !(weight > 0 && weight < 100)) fail(400, 'Poids invalide');
    const r = await run(`INSERT INTO requests (customer_id, city_id, service, brand, weight_kg, qty, address, phone, lat, lng, notes, payment_method)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    req.user.id, cityId, service, str(b.brand, 'marque', { max: 40, optional: true }), weight,
    int(b.qty ?? 1, 'quantité', { min: 1, max: 20 }), str(b.address, 'adresse', { min: 5, max: 300 }),
    str(b.phone || req.user.phone, 'téléphone', { min: 6, max: 30 }), coord(b.lat, 'latitude', 90), coord(b.lng, 'longitude', 180),
    str(b.notes, 'notes', { max: 500, optional: true }), PAYMENTS.includes(b.payment_method) ? b.payment_method : 'especes');
    return decorateRequest(await requestRow(r.id));
  }));

  app.get('/api/requests', need('customer', 'admin'), wrap(async (req) => {
    const u = req.user;
    const rows = (ids) => Promise.all(ids.map((r) => requestRow(r.id)));
    if (u.role === 'customer') {
      const ids = await all('SELECT id FROM requests WHERE customer_id = ? ORDER BY id DESC LIMIT 50', u.id);
      return (await rows(ids)).map(decorateRequest);
    }
    // Distributeur : demandes ouvertes (48 h) dans ses villes + celles qu'il a acceptées.
    const open = await all(`SELECT r.id FROM requests r
      JOIN tenant_cities tc ON tc.city_id = r.city_id AND tc.tenant_id = ? AND tc.active = 1
      WHERE r.status = 'ouverte' AND r.created_at >= ${SINCE('48 hours')} ORDER BY r.id DESC`, u.tenant_id);
    const mine = await all('SELECT id FROM requests WHERE tenant_id = ? ORDER BY id DESC LIMIT 30', u.tenant_id);
    const openRows = await Promise.all((await rows(open)).map((r) => requestForTenant(r, u.tenant_id)));
    return {
      open: openRows.sort((a, b) => (a.nearest_point?.distance_km ?? 1e9) - (b.nearest_point?.distance_km ?? 1e9)),
      accepted: (await rows(mine)).map(decorateRequest),
    };
  }));

  const loadRequest = async (req) => {
    const r = await requestRow(int(req.params.id, 'demande', { min: 1 }));
    const u = req.user;
    const visible = r && ((u.role === 'customer' && r.customer_id === u.id)
      || (u.role === 'admin' && (r.tenant_id === u.tenant_id || (r.status === 'ouverte'
        && await get('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ? AND active = 1', u.tenant_id, r.city_id)))));
    if (!visible) fail(404, 'Demande introuvable');
    return r;
  };

  app.get('/api/requests/:id', need('customer', 'admin'), wrap(async (req) => {
    const r = await loadRequest(req);
    return req.user.role === 'admin' ? requestForTenant(r, req.user.tenant_id) : decorateRequest(r);
  }));

  app.post('/api/requests/:id/cancel', need('customer'), wrap(async (req) => {
    const r = await loadRequest(req);
    const upd = await run("UPDATE requests SET status = 'annulee' WHERE id = ? AND status = 'ouverte'", r.id);
    if (upd.changes !== 1) fail(400, 'Cette demande a déjà été prise en charge : annulez la commande associée.');
    return decorateRequest(await requestRow(r.id));
  }));

  // Le distributeur prend la demande : elle devient une commande confirmée, suivie comme les autres.
  app.post('/api/requests/:id/accept', need('admin'), wrap(async (req) => {
    const r = await requestRow(int(req.params.id, 'demande', { min: 1 }));
    if (!r || !(await get('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ? AND active = 1', req.user.tenant_id, r.city_id))) {
      fail(404, 'Demande introuvable');
    }
    const offerId = int((req.body || {}).offer_id, 'produit', { min: 1 });
    const orderId = await tx(async () => {
      const upd = await run("UPDATE requests SET status = 'acceptee', tenant_id = ? WHERE id = ? AND status = 'ouverte'", req.user.tenant_id, r.id);
      if (upd.changes !== 1) fail(409, 'Cette demande a déjà été prise par un autre distributeur ou annulée');
      const tenant = await get('SELECT name FROM tenants WHERE id = ?', req.user.tenant_id);
      const oid = await insertOrder(r.customer_id, {
        tenant_id: req.user.tenant_id, city_id: r.city_id, items: [{ offer_id: offerId, qty: r.qty }],
        payment_method: r.payment_method, address: r.address, phone: r.phone, notes: r.notes, lat: r.lat, lng: r.lng,
      }, { service: r.service, requestId: r.id, note: `Demande prise en charge par ${tenant.name}`, byUserId: req.user.id });
      await run("UPDATE orders SET status = 'confirmee' WHERE id = ?", oid);
      await event(oid, 'confirmee', null, req.user.id);
      await run('UPDATE requests SET order_id = ? WHERE id = ?', oid, r.id);
      return oid;
    });
    return orderDetail(orderId);
  }));

  // ---------- Espace distributeur (admin) ----------
  const admin = express.Router();
  admin.use(need('admin'));
  const tenantOf = (req) => get('SELECT * FROM tenants WHERE id = ?', req.user.tenant_id);

  admin.get('/zones', wrap((req) => all(`
    SELECT tc.*, c.name, c.country FROM tenant_cities tc JOIN cities c ON c.id = tc.city_id
    WHERE tc.tenant_id = ? ORDER BY c.name`, req.user.tenant_id)));

  admin.post('/zones', wrap(async (req) => {
    const b = req.body || {};
    let cityId = int(b.city_id, 'ville', { min: 1, optional: true });
    if (!cityId) {
      const name = str(b.city_name, 'ville', { min: 2, max: 80 });
      const country = str(b.country, 'pays', { min: 2, max: 80 });
      const existing = await get('SELECT id FROM cities WHERE name = ? AND country = ?', name, country);
      cityId = existing ? existing.id : (await run('INSERT INTO cities (name, country) VALUES (?,?) RETURNING id', name, country)).id;
    } else if (!(await get('SELECT 1 FROM cities WHERE id = ?', cityId))) fail(400, 'Ville inconnue');
    const fee = int(b.delivery_fee, 'frais de livraison', { max: 1e7 });
    const delay = int(b.min_delay_minutes ?? 60, 'délai', { min: 5, max: 10080 });
    const exists = await get('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ?', req.user.tenant_id, cityId);
    if (!exists) {
      const plan = PLANS[(await tenantOf(req)).plan];
      const n = (await get('SELECT COUNT(*) AS n FROM tenant_cities WHERE tenant_id = ?', req.user.tenant_id)).n;
      if (n >= plan.maxCities) fail(402, `Votre offre ${plan.label} est limitée à ${plan.maxCities} ville(s). Passez à une offre supérieure.`);
    }
    await run(`INSERT INTO tenant_cities (tenant_id, city_id, delivery_fee, min_delay_minutes, active) VALUES (?,?,?,?,?)
       ON CONFLICT (tenant_id, city_id) DO UPDATE SET delivery_fee = EXCLUDED.delivery_fee,
       min_delay_minutes = EXCLUDED.min_delay_minutes, active = EXCLUDED.active`,
    req.user.tenant_id, cityId, fee, delay, b.active === false ? 0 : 1);
    return get('SELECT * FROM tenant_cities WHERE tenant_id = ? AND city_id = ?', req.user.tenant_id, cityId);
  }));

  admin.get('/products', wrap(async (req) => {
    const [products, offers] = await Promise.all([
      all(`SELECT * FROM products WHERE tenant_id = ? ORDER BY CASE kind WHEN 'recharge' THEN 0 WHEN 'bouteille' THEN 1 ELSE 2 END, weight_kg, id`, req.user.tenant_id),
      all('SELECT o.*, c.name AS city_name FROM offers o JOIN cities c ON c.id = o.city_id WHERE o.tenant_id = ?', req.user.tenant_id),
    ]);
    return products.map((p) => ({ ...p, offers: offers.filter((o) => o.product_id === p.id) }));
  }));

  admin.post('/products', wrap(async (req) => {
    const b = req.body || {};
    const kind = ['recharge', 'bouteille', 'accessoire'].includes(b.kind) ? b.kind : fail(400, 'Type de produit invalide');
    const weight = b.weight_kg === '' || b.weight_kg == null ? null : Number(b.weight_kg);
    if (weight !== null && !(weight > 0 && weight < 1000)) fail(400, 'Poids invalide');
    const r = await run('INSERT INTO products (tenant_id, name, brand, weight_kg, kind) VALUES (?,?,?,?,?) RETURNING id',
      req.user.tenant_id, str(b.name, 'nom', { max: 100 }), str(b.brand, 'marque', { max: 60, optional: true }), weight, kind);
    return get('SELECT * FROM products WHERE id = ?', r.id);
  }));

  admin.patch('/products/:id', wrap(async (req) => {
    const p = await get('SELECT * FROM products WHERE id = ? AND tenant_id = ?', int(req.params.id, 'produit'), req.user.tenant_id);
    if (!p) fail(404, 'Produit introuvable');
    const b = req.body || {};
    await run('UPDATE products SET name = ?, active = ? WHERE id = ?',
      b.name ? str(b.name, 'nom', { max: 100 }) : p.name, b.active === undefined ? p.active : (b.active ? 1 : 0), p.id);
    return get('SELECT * FROM products WHERE id = ?', p.id);
  }));

  // Crée ou met à jour le prix/stock d'un produit dans une ville desservie.
  admin.put('/offers', wrap(async (req) => {
    const b = req.body || {};
    const productId = int(b.product_id, 'produit', { min: 1 });
    const cityId = int(b.city_id, 'ville', { min: 1 });
    if (!(await get('SELECT 1 FROM products WHERE id = ? AND tenant_id = ?', productId, req.user.tenant_id))) fail(404, 'Produit introuvable');
    if (!(await get('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ?', req.user.tenant_id, cityId))) fail(400, "Ajoutez d'abord cette ville à vos zones");
    await run(`INSERT INTO offers (tenant_id, product_id, city_id, price, stock) VALUES (?,?,?,?,?)
       ON CONFLICT (product_id, city_id) DO UPDATE SET price = EXCLUDED.price, stock = EXCLUDED.stock`,
    req.user.tenant_id, productId, cityId, int(b.price, 'prix', { max: 1e8 }), int(b.stock, 'stock', { max: 1e6 }));
    return get('SELECT * FROM offers WHERE product_id = ? AND city_id = ?', productId, cityId);
  }));

  admin.get('/drivers', wrap((req) => all(`
    SELECT u.id, u.name, u.email, u.phone, u.city_id, u.active, c.name AS city_name,
      (SELECT COUNT(*) FROM orders o WHERE o.driver_id = u.id AND o.status IN ('assignee','en_livraison')) AS active_orders,
      (SELECT COUNT(*) FROM orders o WHERE o.driver_id = u.id AND o.status = 'livree') AS delivered
    FROM users u LEFT JOIN cities c ON c.id = u.city_id
    WHERE u.tenant_id = ? AND u.role = 'driver' ORDER BY u.name`, req.user.tenant_id)));

  admin.post('/drivers', wrap(async (req) => {
    const b = req.body || {};
    const plan = PLANS[(await tenantOf(req)).plan];
    const n = (await get("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role = 'driver' AND active = 1", req.user.tenant_id)).n;
    if (n >= plan.maxDrivers) fail(402, `Votre offre ${plan.label} est limitée à ${plan.maxDrivers} livreur(s).`);
    const e = email(b.email);
    if (await get('SELECT 1 FROM users WHERE email = ?', e)) fail(409, 'Cet email est déjà utilisé');
    const cityId = int(b.city_id, 'ville', { min: 1, optional: true });
    if (cityId && !(await get('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ?', req.user.tenant_id, cityId))) fail(400, 'Ville hors de vos zones');
    const r = await run('INSERT INTO users (tenant_id, role, name, email, phone, password_hash, city_id) VALUES (?,?,?,?,?,?,?) RETURNING id',
      req.user.tenant_id, 'driver', str(b.name, 'nom', { max: 80 }), e, str(b.phone, 'téléphone', { min: 6, max: 30 }),
      hashPassword(str(b.password, 'mot de passe', { min: 8, max: 100 })), cityId);
    return publicUser(await get('SELECT * FROM users WHERE id = ?', r.id));
  }));

  admin.patch('/drivers/:id', wrap(async (req) => {
    const d = await get("SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role = 'driver'", int(req.params.id, 'livreur'), req.user.tenant_id);
    if (!d) fail(404, 'Livreur introuvable');
    await run('UPDATE users SET active = ? WHERE id = ?', (req.body || {}).active ? 1 : 0, d.id);
    return publicUser(await get('SELECT * FROM users WHERE id = ?', d.id));
  }));

  admin.get('/points', wrap((req) => all(`SELECT pt.*, c.name AS city_name FROM points pt JOIN cities c ON c.id = pt.city_id
    WHERE pt.tenant_id = ? ORDER BY c.name, pt.name`, req.user.tenant_id)));

  const pointFields = (b, cur = {}) => {
    const lat = coord(b.lat ?? cur.lat, 'latitude', 90);
    const lng = coord(b.lng ?? cur.lng, 'longitude', 180);
    if (lat === null || lng === null) fail(400, 'Position GPS requise (latitude et longitude)');
    return {
      name: str(b.name ?? cur.name, 'nom', { min: 2, max: 80 }),
      address: str(b.address ?? cur.address, 'adresse', { min: 3, max: 200 }),
      phone: str(b.phone ?? cur.phone, 'téléphone', { min: 6, max: 30, optional: true }),
      hours: str(b.hours ?? cur.hours, 'horaires', { max: 60, optional: true }),
      lat, lng,
    };
  };

  admin.post('/points', wrap(async (req) => {
    const b = req.body || {};
    const cityId = int(b.city_id, 'ville', { min: 1 });
    if (!(await get('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ?', req.user.tenant_id, cityId))) fail(400, "Ajoutez d'abord cette ville à vos zones");
    const f = pointFields(b);
    const r = await run('INSERT INTO points (tenant_id, city_id, name, address, phone, hours, lat, lng) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
      req.user.tenant_id, cityId, f.name, f.address, f.phone, f.hours, f.lat, f.lng);
    return get('SELECT * FROM points WHERE id = ?', r.id);
  }));

  admin.patch('/points/:id', wrap(async (req) => {
    const cur = await get('SELECT * FROM points WHERE id = ? AND tenant_id = ?', int(req.params.id, 'point'), req.user.tenant_id);
    if (!cur) fail(404, 'Point introuvable');
    const b = req.body || {};
    const f = pointFields(b, cur);
    await run('UPDATE points SET name = ?, address = ?, phone = ?, hours = ?, lat = ?, lng = ?, active = ? WHERE id = ?',
      f.name, f.address, f.phone, f.hours, f.lat, f.lng, b.active === undefined ? cur.active : (b.active ? 1 : 0), cur.id);
    return get('SELECT * FROM points WHERE id = ?', cur.id);
  }));

  admin.delete('/points/:id', wrap(async (req) => {
    const r = await run('DELETE FROM points WHERE id = ? AND tenant_id = ?', int(req.params.id, 'point'), req.user.tenant_id);
    if (r.changes !== 1) fail(404, 'Point introuvable');
    return { ok: true };
  }));

  admin.get('/stats', wrap(async (req) => {
    const t = req.user.tenant_id;
    const [totals, byCity, lowStock, open, tenant] = await Promise.all([
      get(`SELECT COUNT(*) AS orders,
          SUM(CASE WHEN status = 'livree' THEN total ELSE 0 END) AS revenue,
          SUM(CASE WHEN status = 'livree' THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN status IN ('en_attente','confirmee','assignee','en_livraison') THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN status = 'annulee' THEN 1 ELSE 0 END) AS cancelled
        FROM orders WHERE tenant_id = ?`, t),
      all(`SELECT c.name, COUNT(*) AS orders, SUM(CASE WHEN o.status = 'livree' THEN o.total ELSE 0 END) AS revenue
        FROM orders o JOIN cities c ON c.id = o.city_id WHERE o.tenant_id = ? GROUP BY c.id ORDER BY orders DESC`, t),
      all(`SELECT p.name, c.name AS city_name, o.stock FROM offers o
        JOIN products p ON p.id = o.product_id JOIN cities c ON c.id = o.city_id
        WHERE o.tenant_id = ? AND o.stock <= 10 AND p.active = 1 ORDER BY o.stock`, t),
      get(`SELECT COUNT(*) AS n FROM requests r
        JOIN tenant_cities tc ON tc.city_id = r.city_id AND tc.tenant_id = ? AND tc.active = 1
        WHERE r.status = 'ouverte' AND r.created_at >= ${SINCE('48 hours')}`, t),
      tenantOf(req),
    ]);
    return { totals, byCity, lowStock, openRequests: open.n, tenant, plan: { id: tenant.plan, ...PLANS[tenant.plan] } };
  }));

  admin.patch('/plan', wrap(async (req) => {
    const plan = (req.body || {}).plan;
    if (!PLANS[plan]) fail(400, 'Offre inconnue');
    await run('UPDATE tenants SET plan = ? WHERE id = ?', plan, req.user.tenant_id);
    return tenantOf(req);
  }));

  app.use('/api/admin', admin);

  // ---------- Espace plateforme (superadmin) ----------
  app.get('/api/platform/tenants', need('superadmin'), wrap(async () => (await all(`
    SELECT t.*,
      (SELECT COUNT(*) FROM tenant_cities WHERE tenant_id = t.id) AS cities,
      (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND role = 'driver') AS drivers,
      (SELECT COUNT(*) FROM orders WHERE tenant_id = t.id) AS orders,
      (SELECT COALESCE(SUM(total), 0) FROM orders WHERE tenant_id = t.id AND status = 'livree') AS gmv
    FROM tenants t ORDER BY t.created_at DESC, t.id DESC`)).map((t) => ({ ...t, mrr: PLANS[t.plan]?.price || 0 }))));

  app.patch('/api/platform/tenants/:id', need('superadmin'), wrap(async (req) => {
    const id = int(req.params.id, 'distributeur', { min: 1 });
    const t = await get('SELECT * FROM tenants WHERE id = ?', id);
    if (!t) fail(404, 'Distributeur introuvable');
    const b = req.body || {};
    const plan = b.plan && PLANS[b.plan] ? b.plan : t.plan;
    const active = b.active === undefined ? t.active : (b.active ? 1 : 0);
    await run('UPDATE tenants SET plan = ?, active = ? WHERE id = ?', plan, active, id);
    return get('SELECT * FROM tenants WHERE id = ?', id);
  }));

  // ---------- Erreurs ----------
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Route inconnue')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message });
  });

  return app;
}

module.exports = { createApp, STATUS_LABELS, TRANSITIONS };
