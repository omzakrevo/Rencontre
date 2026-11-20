'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { hashPassword, verifyPassword, createToken, readToken } = require('./auth');
const { tx, PLANS } = require('./db');

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

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const q = (sql) => db.prepare(sql);
  const wrap = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (e) {
      next(e);
    }
  };

  // ---------- Authentification ----------
  app.use((req, _res, next) => {
    const h = req.headers.authorization || '';
    const data = h.startsWith('Bearer ') ? readToken(h.slice(7)) : null;
    if (data) {
      const u = q('SELECT * FROM users WHERE id = ? AND active = 1').get(data.sub);
      if (u) {
        if (u.tenant_id) {
          const t = q('SELECT active FROM tenants WHERE id = ?').get(u.tenant_id);
          if (t && t.active) req.user = u;
        } else {
          req.user = u;
        }
      }
    }
    next();
  });
  const need = (...roles) => (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Authentification requise'));
    if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'Accès refusé'));
    next();
  };

  const login = (u) => ({ token: createToken(u), user: publicUser(u) });

  app.post('/api/auth/register', wrap((req) => {
    const b = req.body || {};
    const e = email(b.email);
    const password = str(b.password, 'mot de passe', { min: 8, max: 100 });
    if (q('SELECT 1 FROM users WHERE email = ?').get(e)) fail(409, 'Cet email est déjà utilisé');
    const cityId = int(b.city_id, 'ville', { min: 1, optional: true });
    const r = q('INSERT INTO users (role, name, email, phone, password_hash, city_id) VALUES (?,?,?,?,?,?)')
      .run('customer', str(b.name, 'nom', { max: 80 }), e, str(b.phone, 'téléphone', { min: 6, max: 30 }), hashPassword(password), cityId);
    return login(q('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid));
  }));

  app.post('/api/auth/login', wrap((req) => {
    const b = req.body || {};
    const u = q('SELECT * FROM users WHERE email = ?').get(String(b.email || '').trim().toLowerCase());
    if (!u || !u.active || !verifyPassword(String(b.password || ''), u.password_hash)) fail(401, 'Identifiants incorrects');
    if (u.tenant_id && !q('SELECT active FROM tenants WHERE id = ?').get(u.tenant_id).active) fail(403, 'Compte distributeur suspendu');
    return login(u);
  }));

  app.get('/api/me', need(), wrap((req) => {
    const tenant = req.user.tenant_id ? q('SELECT * FROM tenants WHERE id = ?').get(req.user.tenant_id) : null;
    return { user: publicUser(req.user), tenant, plan: tenant ? { id: tenant.plan, ...PLANS[tenant.plan] } : null };
  }));

  // Inscription d'un distributeur (onboarding SaaS) : crée l'entreprise + son administrateur.
  app.post('/api/tenants/signup', wrap((req) => {
    const b = req.body || {};
    const name = str(b.company, "nom de l'entreprise", { min: 2, max: 80 });
    const plan = b.plan && PLANS[b.plan] ? b.plan : 'starter';
    const e = email(b.email);
    const password = str(b.password, 'mot de passe', { min: 8, max: 100 });
    if (q('SELECT 1 FROM users WHERE email = ?').get(e)) fail(409, 'Cet email est déjà utilisé');
    let slug = slugify(name);
    for (let i = 2; q('SELECT 1 FROM tenants WHERE slug = ?').get(slug); i++) slug = `${slugify(name)}-${i}`;
    const userId = tx(db, () => {
      const t = q('INSERT INTO tenants (name, slug, plan, currency, phone) VALUES (?,?,?,?,?)')
        .run(name, slug, plan, str(b.currency, 'devise', { max: 10, optional: true }) || 'FCFA', str(b.phone, 'téléphone', { min: 6, max: 30 }));
      return q('INSERT INTO users (tenant_id, role, name, email, phone, password_hash) VALUES (?,?,?,?,?,?)')
        .run(t.lastInsertRowid, 'admin', str(b.name, 'nom', { max: 80 }), e, b.phone, hashPassword(password)).lastInsertRowid;
    });
    return login(q('SELECT * FROM users WHERE id = ?').get(userId));
  }));

  // ---------- Catalogue public ----------
  app.get('/api/plans', wrap(() => Object.entries(PLANS).map(([id, p]) => ({
    id, ...p, maxCities: Number.isFinite(p.maxCities) ? p.maxCities : null, maxDrivers: Number.isFinite(p.maxDrivers) ? p.maxDrivers : null,
  }))));

  app.get('/api/cities', wrap(() => q(`
    SELECT c.id, c.name, c.country, COUNT(DISTINCT tc.tenant_id) AS providers
    FROM cities c
    LEFT JOIN tenant_cities tc ON tc.city_id = c.id AND tc.active = 1
      AND tc.tenant_id IN (SELECT id FROM tenants WHERE active = 1)
    GROUP BY c.id ORDER BY c.country, c.name`).all()));

  // Offres disponibles dans une ville, regroupées par distributeur.
  app.get('/api/catalog', wrap((req) => {
    const cityId = int(req.query.city_id, 'ville', { min: 1 });
    const rows = q(`
      SELECT o.id AS offer_id, o.price, o.stock, p.name, p.brand, p.weight_kg, p.kind,
             t.id AS tenant_id, t.name AS tenant_name, t.currency, tc.delivery_fee, tc.min_delay_minutes
      FROM offers o
      JOIN products p ON p.id = o.product_id AND p.active = 1
      JOIN tenants t ON t.id = o.tenant_id AND t.active = 1
      JOIN tenant_cities tc ON tc.tenant_id = t.id AND tc.city_id = o.city_id AND tc.active = 1
      WHERE o.city_id = ?
      ORDER BY t.name, CASE p.kind WHEN 'recharge' THEN 0 WHEN 'bouteille' THEN 1 ELSE 2 END, p.weight_kg`).all(cityId);
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

  // ---------- Commandes ----------
  const orderDetail = (id) => {
    const o = q(`
      SELECT o.*, c.name AS city_name, t.name AS tenant_name, t.currency,
             cu.name AS customer_name, d.name AS driver_name, d.phone AS driver_phone
      FROM orders o
      JOIN cities c ON c.id = o.city_id
      JOIN tenants t ON t.id = o.tenant_id
      JOIN users cu ON cu.id = o.customer_id
      LEFT JOIN users d ON d.id = o.driver_id
      WHERE o.id = ?`).get(id);
    if (!o) return null;
    o.items = q('SELECT offer_id, product_name, qty, unit_price FROM order_items WHERE order_id = ?').all(id);
    o.events = q(`SELECT e.status, e.note, e.created_at, u.name AS by_name
                  FROM order_events e LEFT JOIN users u ON u.id = e.user_id
                  WHERE e.order_id = ? ORDER BY e.id`).all(id);
    o.status_label = STATUS_LABELS[o.status];
    return o;
  };

  const canSee = (u, o) => (u.role === 'superadmin')
    || (u.role === 'customer' && o.customer_id === u.id)
    || (u.role === 'admin' && o.tenant_id === u.tenant_id)
    || (u.role === 'driver' && o.driver_id === u.id);

  const loadOrder = (req) => {
    const o = orderDetail(int(req.params.id, 'commande', { min: 1 }));
    if (!o || !canSee(req.user, o)) fail(404, 'Commande introuvable');
    return o;
  };

  const restock = (orderId) => {
    for (const it of q('SELECT offer_id, qty FROM order_items WHERE order_id = ?').all(orderId)) {
      q('UPDATE offers SET stock = stock + ? WHERE id = ?').run(it.qty, it.offer_id);
    }
  };

  app.post('/api/orders', need('customer'), wrap((req) => {
    const b = req.body || {};
    const tenantId = int(b.tenant_id, 'distributeur', { min: 1 });
    const cityId = int(b.city_id, 'ville', { min: 1 });
    const zone = q(`SELECT tc.* FROM tenant_cities tc JOIN tenants t ON t.id = tc.tenant_id AND t.active = 1
                    WHERE tc.tenant_id = ? AND tc.city_id = ? AND tc.active = 1`).get(tenantId, cityId);
    if (!zone) fail(400, "Ce distributeur ne livre pas dans cette ville");
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length || items.length > 20) fail(400, 'Le panier est vide');
    const payment = ['especes', 'mobile_money', 'carte'].includes(b.payment_method) ? b.payment_method : fail(400, 'Mode de paiement invalide');
    const slot = ['asap', 'matin', 'apres_midi', 'soir'].includes(b.slot) ? b.slot : 'asap';
    const address = str(b.address, 'adresse', { min: 5, max: 300 });
    const phone = str(b.phone || req.user.phone, 'téléphone', { min: 6, max: 30 });
    const notes = str(b.notes, 'notes', { max: 500, optional: true });

    const id = tx(db, () => {
      let subtotal = 0;
      const lines = new Map();
      for (const it of items) {
        const offerId = int(it.offer_id, 'produit', { min: 1 });
        const qty = int(it.qty, 'quantité', { min: 1, max: 50 });
        lines.set(offerId, (lines.get(offerId) || 0) + qty);
      }
      const resolved = [];
      for (const [offerId, qty] of lines) {
        const o = q(`SELECT o.*, p.name FROM offers o JOIN products p ON p.id = o.product_id AND p.active = 1
                     WHERE o.id = ? AND o.tenant_id = ? AND o.city_id = ?`).get(offerId, tenantId, cityId);
        if (!o) fail(400, 'Produit indisponible dans cette ville');
        // Décrément conditionnel : évite la survente en cas de commandes simultanées.
        const upd = q('UPDATE offers SET stock = stock - ? WHERE id = ? AND stock >= ?').run(qty, offerId, qty);
        if (upd.changes !== 1) fail(409, `Stock insuffisant pour « ${o.name} »`);
        subtotal += o.price * qty;
        resolved.push({ ...o, qty });
      }
      const ref = `GZ-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const r = q(`INSERT INTO orders (ref, tenant_id, customer_id, city_id, address, phone, notes, slot, payment_method, subtotal, delivery_fee, total)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(ref, tenantId, req.user.id, cityId, address, phone, notes, slot, payment, subtotal, zone.delivery_fee, subtotal + zone.delivery_fee);
      const oid = Number(r.lastInsertRowid);
      const ins = q('INSERT INTO order_items (order_id, offer_id, product_name, qty, unit_price) VALUES (?,?,?,?,?)');
      for (const l of resolved) ins.run(oid, l.id, l.name, l.qty, l.price);
      q('INSERT INTO order_events (order_id, status, note, user_id) VALUES (?,?,?,?)').run(oid, 'en_attente', null, req.user.id);
      return oid;
    });
    return orderDetail(id);
  }));

  app.get('/api/orders', need(), wrap((req) => {
    const u = req.user;
    const where = [];
    const args = [];
    if (u.role === 'customer') { where.push('o.customer_id = ?'); args.push(u.id); }
    if (u.role === 'admin') { where.push('o.tenant_id = ?'); args.push(u.tenant_id); }
    if (u.role === 'driver') { where.push('o.driver_id = ?'); args.push(u.id); }
    if (req.query.status) { where.push('o.status = ?'); args.push(String(req.query.status)); }
    if (req.query.city_id) { where.push('o.city_id = ?'); args.push(int(req.query.city_id, 'ville')); }
    const rows = q(`
      SELECT o.id, o.ref, o.status, o.total, o.created_at, o.address, o.phone, o.slot,
             o.payment_method, o.payment_status, o.driver_id,
             c.name AS city_name, t.name AS tenant_name, t.currency, cu.name AS customer_name, d.name AS driver_name,
             (SELECT group_concat(qty || ' × ' || product_name, ', ') FROM order_items WHERE order_id = o.id) AS summary
      FROM orders o
      JOIN cities c ON c.id = o.city_id
      JOIN tenants t ON t.id = o.tenant_id
      JOIN users cu ON cu.id = o.customer_id
      LEFT JOIN users d ON d.id = o.driver_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.id DESC LIMIT 200`).all(...args);
    return rows.map((r) => ({ ...r, status_label: STATUS_LABELS[r.status] }));
  }));

  app.get('/api/orders/:id', need(), wrap((req) => loadOrder(req)));

  app.post('/api/orders/:id/status', need('admin', 'driver', 'customer'), wrap((req) => {
    const o = loadOrder(req);
    const next = String((req.body || {}).status || '');
    const allowed = (TRANSITIONS[req.user.role] || {})[o.status] || [];
    if (!allowed.includes(next)) fail(400, `Transition impossible : ${STATUS_LABELS[o.status]} → ${STATUS_LABELS[next] || next}`);
    const note = str((req.body || {}).note, 'note', { max: 300, optional: true });
    tx(db, () => {
      q("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, o.id);
      if (next === 'annulee') {
        restock(o.id);
        if (o.payment_status === 'paye') q("UPDATE orders SET payment_status = 'rembourse' WHERE id = ?").run(o.id);
      }
      if (next === 'livree' && o.payment_method === 'especes') q("UPDATE orders SET payment_status = 'paye' WHERE id = ?").run(o.id);
      q('INSERT INTO order_events (order_id, status, note, user_id) VALUES (?,?,?,?)').run(o.id, next, note, req.user.id);
    });
    return orderDetail(o.id);
  }));

  app.post('/api/orders/:id/assign', need('admin'), wrap((req) => {
    const o = loadOrder(req);
    if (!['en_attente', 'confirmee', 'assignee'].includes(o.status)) fail(400, 'Cette commande ne peut plus être assignée');
    const driverId = int((req.body || {}).driver_id, 'livreur', { min: 1 });
    const d = q("SELECT * FROM users WHERE id = ? AND role = 'driver' AND tenant_id = ? AND active = 1").get(driverId, req.user.tenant_id);
    if (!d) fail(400, 'Livreur introuvable');
    tx(db, () => {
      q("UPDATE orders SET driver_id = ?, status = 'assignee', updated_at = datetime('now') WHERE id = ?").run(d.id, o.id);
      q('INSERT INTO order_events (order_id, status, note, user_id) VALUES (?,?,?,?)').run(o.id, 'assignee', `Assignée à ${d.name}`, req.user.id);
    });
    return orderDetail(o.id);
  }));

  app.post('/api/orders/:id/paid', need('admin'), wrap((req) => {
    const o = loadOrder(req);
    if (o.status === 'annulee') fail(400, 'Commande annulée');
    q("UPDATE orders SET payment_status = 'paye', updated_at = datetime('now') WHERE id = ?").run(o.id);
    return orderDetail(o.id);
  }));

  // ---------- Espace distributeur (admin) ----------
  const admin = express.Router();
  admin.use(need('admin'));
  const tenantOf = (req) => q('SELECT * FROM tenants WHERE id = ?').get(req.user.tenant_id);

  admin.get('/zones', wrap((req) => q(`
    SELECT tc.*, c.name, c.country FROM tenant_cities tc JOIN cities c ON c.id = tc.city_id
    WHERE tc.tenant_id = ? ORDER BY c.name`).all(req.user.tenant_id)));

  admin.post('/zones', wrap((req) => {
    const b = req.body || {};
    let cityId = int(b.city_id, 'ville', { min: 1, optional: true });
    if (!cityId) {
      const name = str(b.city_name, 'ville', { min: 2, max: 80 });
      const country = str(b.country, 'pays', { min: 2, max: 80 });
      const existing = q('SELECT id FROM cities WHERE name = ? AND country = ?').get(name, country);
      cityId = existing ? existing.id : Number(q('INSERT INTO cities (name, country) VALUES (?,?)').run(name, country).lastInsertRowid);
    } else if (!q('SELECT 1 FROM cities WHERE id = ?').get(cityId)) fail(400, 'Ville inconnue');
    const fee = int(b.delivery_fee, 'frais de livraison', { max: 1e7 });
    const delay = int(b.min_delay_minutes ?? 60, 'délai', { min: 5, max: 10080 });
    const exists = q('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ?').get(req.user.tenant_id, cityId);
    if (!exists) {
      const plan = PLANS[tenantOf(req).plan];
      const n = q('SELECT COUNT(*) n FROM tenant_cities WHERE tenant_id = ?').get(req.user.tenant_id).n;
      if (n >= plan.maxCities) fail(402, `Votre offre ${plan.label} est limitée à ${plan.maxCities} ville(s). Passez à une offre supérieure.`);
    }
    q(`INSERT INTO tenant_cities (tenant_id, city_id, delivery_fee, min_delay_minutes, active) VALUES (?,?,?,?,?)
       ON CONFLICT(tenant_id, city_id) DO UPDATE SET delivery_fee = excluded.delivery_fee,
       min_delay_minutes = excluded.min_delay_minutes, active = excluded.active`)
      .run(req.user.tenant_id, cityId, fee, delay, b.active === false ? 0 : 1);
    return q('SELECT * FROM tenant_cities WHERE tenant_id = ? AND city_id = ?').get(req.user.tenant_id, cityId);
  }));

  admin.get('/products', wrap((req) => {
    const products = q(`SELECT * FROM products WHERE tenant_id = ? ORDER BY CASE kind WHEN 'recharge' THEN 0 WHEN 'bouteille' THEN 1 ELSE 2 END, weight_kg`).all(req.user.tenant_id);
    const offers = q(`SELECT o.*, c.name AS city_name FROM offers o JOIN cities c ON c.id = o.city_id WHERE o.tenant_id = ?`).all(req.user.tenant_id);
    return products.map((p) => ({ ...p, offers: offers.filter((o) => o.product_id === p.id) }));
  }));

  admin.post('/products', wrap((req) => {
    const b = req.body || {};
    const kind = ['recharge', 'bouteille', 'accessoire'].includes(b.kind) ? b.kind : fail(400, 'Type de produit invalide');
    const weight = b.weight_kg === '' || b.weight_kg == null ? null : Number(b.weight_kg);
    if (weight !== null && !(weight > 0 && weight < 1000)) fail(400, 'Poids invalide');
    const r = q('INSERT INTO products (tenant_id, name, brand, weight_kg, kind) VALUES (?,?,?,?,?)')
      .run(req.user.tenant_id, str(b.name, 'nom', { max: 100 }), str(b.brand, 'marque', { max: 60, optional: true }), weight, kind);
    return q('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid);
  }));

  admin.patch('/products/:id', wrap((req) => {
    const p = q('SELECT * FROM products WHERE id = ? AND tenant_id = ?').get(int(req.params.id, 'produit'), req.user.tenant_id);
    if (!p) fail(404, 'Produit introuvable');
    const b = req.body || {};
    q('UPDATE products SET name = ?, active = ? WHERE id = ?')
      .run(b.name ? str(b.name, 'nom', { max: 100 }) : p.name, b.active === undefined ? p.active : (b.active ? 1 : 0), p.id);
    return q('SELECT * FROM products WHERE id = ?').get(p.id);
  }));

  // Crée ou met à jour le prix/stock d'un produit dans une ville desservie.
  admin.put('/offers', wrap((req) => {
    const b = req.body || {};
    const productId = int(b.product_id, 'produit', { min: 1 });
    const cityId = int(b.city_id, 'ville', { min: 1 });
    if (!q('SELECT 1 FROM products WHERE id = ? AND tenant_id = ?').get(productId, req.user.tenant_id)) fail(404, 'Produit introuvable');
    if (!q('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ?').get(req.user.tenant_id, cityId)) fail(400, "Ajoutez d'abord cette ville à vos zones");
    q(`INSERT INTO offers (tenant_id, product_id, city_id, price, stock) VALUES (?,?,?,?,?)
       ON CONFLICT(product_id, city_id) DO UPDATE SET price = excluded.price, stock = excluded.stock`)
      .run(req.user.tenant_id, productId, cityId, int(b.price, 'prix', { max: 1e8 }), int(b.stock, 'stock', { max: 1e6 }));
    return q('SELECT * FROM offers WHERE product_id = ? AND city_id = ?').get(productId, cityId);
  }));

  admin.get('/drivers', wrap((req) => q(`
    SELECT u.id, u.name, u.email, u.phone, u.city_id, u.active, c.name AS city_name,
      (SELECT COUNT(*) FROM orders o WHERE o.driver_id = u.id AND o.status IN ('assignee','en_livraison')) AS active_orders,
      (SELECT COUNT(*) FROM orders o WHERE o.driver_id = u.id AND o.status = 'livree') AS delivered
    FROM users u LEFT JOIN cities c ON c.id = u.city_id
    WHERE u.tenant_id = ? AND u.role = 'driver' ORDER BY u.name`).all(req.user.tenant_id)));

  admin.post('/drivers', wrap((req) => {
    const b = req.body || {};
    const plan = PLANS[tenantOf(req).plan];
    const n = q("SELECT COUNT(*) n FROM users WHERE tenant_id = ? AND role = 'driver' AND active = 1").get(req.user.tenant_id).n;
    if (n >= plan.maxDrivers) fail(402, `Votre offre ${plan.label} est limitée à ${plan.maxDrivers} livreur(s).`);
    const e = email(b.email);
    if (q('SELECT 1 FROM users WHERE email = ?').get(e)) fail(409, 'Cet email est déjà utilisé');
    const cityId = int(b.city_id, 'ville', { min: 1, optional: true });
    if (cityId && !q('SELECT 1 FROM tenant_cities WHERE tenant_id = ? AND city_id = ?').get(req.user.tenant_id, cityId)) fail(400, 'Ville hors de vos zones');
    const r = q('INSERT INTO users (tenant_id, role, name, email, phone, password_hash, city_id) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.tenant_id, 'driver', str(b.name, 'nom', { max: 80 }), e, str(b.phone, 'téléphone', { min: 6, max: 30 }),
        hashPassword(str(b.password, 'mot de passe', { min: 8, max: 100 })), cityId);
    return publicUser(q('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid));
  }));

  admin.patch('/drivers/:id', wrap((req) => {
    const d = q("SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role = 'driver'").get(int(req.params.id, 'livreur'), req.user.tenant_id);
    if (!d) fail(404, 'Livreur introuvable');
    q('UPDATE users SET active = ? WHERE id = ?').run((req.body || {}).active ? 1 : 0, d.id);
    return publicUser(q('SELECT * FROM users WHERE id = ?').get(d.id));
  }));

  admin.get('/stats', wrap((req) => {
    const t = req.user.tenant_id;
    const totals = q(`SELECT COUNT(*) AS orders,
        SUM(CASE WHEN status = 'livree' THEN total ELSE 0 END) AS revenue,
        SUM(CASE WHEN status = 'livree' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status IN ('en_attente','confirmee','assignee','en_livraison') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN status = 'annulee' THEN 1 ELSE 0 END) AS cancelled
      FROM orders WHERE tenant_id = ?`).get(t);
    const byCity = q(`SELECT c.name, COUNT(*) AS orders, SUM(CASE WHEN o.status = 'livree' THEN o.total ELSE 0 END) AS revenue
      FROM orders o JOIN cities c ON c.id = o.city_id WHERE o.tenant_id = ? GROUP BY c.id ORDER BY orders DESC`).all(t);
    const lowStock = q(`SELECT p.name, c.name AS city_name, o.stock FROM offers o
      JOIN products p ON p.id = o.product_id JOIN cities c ON c.id = o.city_id
      WHERE o.tenant_id = ? AND o.stock <= 10 AND p.active = 1 ORDER BY o.stock`).all(t);
    const tenant = tenantOf(req);
    return { totals, byCity, lowStock, tenant, plan: { id: tenant.plan, ...PLANS[tenant.plan] } };
  }));

  admin.patch('/plan', wrap((req) => {
    const plan = (req.body || {}).plan;
    if (!PLANS[plan]) fail(400, 'Offre inconnue');
    q('UPDATE tenants SET plan = ? WHERE id = ?').run(plan, req.user.tenant_id);
    return tenantOf(req);
  }));

  app.use('/api/admin', admin);

  // ---------- Espace plateforme (superadmin) ----------
  app.get('/api/platform/tenants', need('superadmin'), wrap(() => q(`
    SELECT t.*,
      (SELECT COUNT(*) FROM tenant_cities WHERE tenant_id = t.id) AS cities,
      (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND role = 'driver') AS drivers,
      (SELECT COUNT(*) FROM orders WHERE tenant_id = t.id) AS orders,
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE tenant_id = t.id AND status = 'livree') AS gmv
    FROM tenants t ORDER BY t.created_at DESC`).all().map((t) => ({ ...t, mrr: PLANS[t.plan]?.price || 0 }))));

  app.patch('/api/platform/tenants/:id', need('superadmin'), wrap((req) => {
    const id = int(req.params.id, 'distributeur', { min: 1 });
    const t = q('SELECT * FROM tenants WHERE id = ?').get(id);
    if (!t) fail(404, 'Distributeur introuvable');
    const b = req.body || {};
    const plan = b.plan && PLANS[b.plan] ? b.plan : t.plan;
    const active = b.active === undefined ? t.active : (b.active ? 1 : 0);
    q('UPDATE tenants SET plan = ?, active = ? WHERE id = ?').run(plan, active, id);
    return q('SELECT * FROM tenants WHERE id = ?').get(id);
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
