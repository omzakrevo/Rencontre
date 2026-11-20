'use strict';
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

// Plans d'abonnement SaaS proposés aux distributeurs.
const PLANS = {
  starter: { label: 'Starter', price: 15000, maxCities: 1, maxDrivers: 3 },
  pro: { label: 'Pro', price: 45000, maxCities: 5, maxDrivers: 20 },
  entreprise: { label: 'Entreprise', price: 120000, maxCities: Infinity, maxDrivers: Infinity },
};

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter',
  currency TEXT NOT NULL DEFAULT 'FCFA',
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  UNIQUE(name, country)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('superadmin','admin','driver','customer')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  city_id INTEGER REFERENCES cities(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Villes (zones) desservies par un distributeur, avec frais de livraison.
CREATE TABLE IF NOT EXISTS tenant_cities (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  min_delay_minutes INTEGER NOT NULL DEFAULT 60,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, city_id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  weight_kg REAL,
  kind TEXT NOT NULL CHECK (kind IN ('recharge','bouteille','accessoire')),
  active INTEGER NOT NULL DEFAULT 1
);

-- Prix et stock d'un produit dans une ville.
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  price INTEGER NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  UNIQUE(product_id, city_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  city_id INTEGER NOT NULL REFERENCES cities(id),
  driver_id INTEGER REFERENCES users(id),
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  notes TEXT,
  slot TEXT NOT NULL DEFAULT 'asap',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('especes','mobile_money','carte')),
  payment_status TEXT NOT NULL DEFAULT 'en_attente' CHECK (payment_status IN ('en_attente','paye','rembourse')),
  status TEXT NOT NULL DEFAULT 'en_attente',
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(driver_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES offers(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file = process.env.DB_FILE || 'gazflow.db') {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

/** Exécute fn dans une transaction (rollback en cas d'erreur). */
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Données de démonstration (exécuté seulement si la base est vide). */
function seed(db) {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return false;
  const pw = hashPassword('demo1234');
  tx(db, () => {
    const city = db.prepare('INSERT INTO cities (name, country) VALUES (?, ?)');
    const cities = [
      ['Abidjan', "Côte d'Ivoire"], ['Bouaké', "Côte d'Ivoire"], ['Dakar', 'Sénégal'],
      ['Thiès', 'Sénégal'], ['Douala', 'Cameroun'], ['Yaoundé', 'Cameroun'],
      ['Lomé', 'Togo'], ['Cotonou', 'Bénin'],
    ].map(([n, c]) => Number(city.run(n, c).lastInsertRowid));
    const [abidjan, bouake, dakar, thies, douala] = cities;

    const user = db.prepare('INSERT INTO users (tenant_id, role, name, email, phone, password_hash, city_id) VALUES (?,?,?,?,?,?,?)');
    user.run(null, 'superadmin', 'Opérateur plateforme', 'super@gazflow.app', '+000000000', pw, null);

    const tenant = db.prepare('INSERT INTO tenants (name, slug, plan, currency, phone) VALUES (?,?,?,?,?)');
    const tc = db.prepare('INSERT INTO tenant_cities (tenant_id, city_id, delivery_fee, min_delay_minutes) VALUES (?,?,?,?)');
    const prod = db.prepare('INSERT INTO products (tenant_id, name, brand, weight_kg, kind) VALUES (?,?,?,?,?)');
    const offer = db.prepare('INSERT INTO offers (tenant_id, product_id, city_id, price, stock) VALUES (?,?,?,?,?)');

    const t1 = Number(tenant.run('GazExpress', 'gazexpress', 'pro', 'FCFA', '+2250700000000').lastInsertRowid);
    tc.run(t1, abidjan, 1000, 45); tc.run(t1, bouake, 1500, 90); tc.run(t1, dakar, 1000, 60);
    const p = [
      prod.run(t1, 'Recharge 6 kg', 'Total', 6, 'recharge'),
      prod.run(t1, 'Recharge 12,5 kg', 'Total', 12.5, 'recharge'),
      prod.run(t1, 'Bouteille neuve 12,5 kg (consigne incluse)', 'Total', 12.5, 'bouteille'),
      prod.run(t1, 'Détendeur + tuyau', null, null, 'accessoire'),
    ].map((r) => Number(r.lastInsertRowid));
    for (const c of [abidjan, bouake, dakar]) {
      const k = c === bouake ? 1.05 : 1;
      offer.run(t1, p[0], c, Math.round(2000 * k), 120);
      offer.run(t1, p[1], c, Math.round(5200 * k), 80);
      offer.run(t1, p[2], c, Math.round(25000 * k), 15);
      offer.run(t1, p[3], c, 4500, 30);
    }
    user.run(t1, 'admin', 'Awa Koné', 'admin@gazexpress.ci', '+2250700000001', pw, null);
    user.run(t1, 'driver', 'Moussa Traoré', 'livreur@gazexpress.ci', '+2250700000002', pw, abidjan);
    user.run(t1, 'driver', 'Ibrahima Diallo', 'livreur2@gazexpress.ci', '+221770000002', pw, dakar);

    const t2 = Number(tenant.run('Butane Services', 'butane-services', 'starter', 'FCFA', '+237600000000').lastInsertRowid);
    tc.run(t2, douala, 800, 60);
    const q = [
      prod.run(t2, 'Recharge 12,5 kg', 'Tradex', 12.5, 'recharge'),
      prod.run(t2, 'Recharge 6 kg', 'Tradex', 6, 'recharge'),
    ].map((r) => Number(r.lastInsertRowid));
    offer.run(t2, q[0], douala, 6500, 60);
    offer.run(t2, q[1], douala, 3000, 40);
    user.run(t2, 'admin', 'Jean Mbarga', 'admin@butane.cm', '+237600000001', pw, null);
    user.run(t2, 'driver', 'Paul Ndongo', 'livreur@butane.cm', '+237600000002', pw, douala);

    user.run(null, 'customer', 'Client Démo', 'client@demo.app', '+2250101010101', pw, abidjan);
    void thies;
  });
  return true;
}

module.exports = { openDb, seed, tx, PLANS };
