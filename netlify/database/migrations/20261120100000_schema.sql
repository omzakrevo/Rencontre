-- Schéma GazFlow (Postgres). Les dates sont stockées en texte UTC « AAAA-MM-JJ HH:MM:SS ».

CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter',
  currency TEXT NOT NULL DEFAULT 'FCFA',
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE cities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  UNIQUE (name, country)
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'driver', 'customer')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  city_id INTEGER REFERENCES cities(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- Villes desservies par un distributeur, avec frais et délai de livraison.
CREATE TABLE tenant_cities (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  min_delay_minutes INTEGER NOT NULL DEFAULT 60,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, city_id)
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  weight_kg DOUBLE PRECISION,
  kind TEXT NOT NULL CHECK (kind IN ('recharge', 'bouteille', 'accessoire')),
  active INTEGER NOT NULL DEFAULT 1
);

-- Prix et stock d'un produit dans une ville.
CREATE TABLE offers (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  price INTEGER NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  UNIQUE (product_id, city_id)
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  city_id INTEGER NOT NULL REFERENCES cities(id),
  driver_id INTEGER REFERENCES users(id),
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  notes TEXT,
  slot TEXT NOT NULL DEFAULT 'asap',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('especes', 'mobile_money', 'carte')),
  payment_status TEXT NOT NULL DEFAULT 'en_attente' CHECK (payment_status IN ('en_attente', 'paye', 'rembourse')),
  status TEXT NOT NULL DEFAULT 'en_attente',
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  service TEXT NOT NULL DEFAULT 'livraison',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  request_id INTEGER,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX idx_orders_tenant ON orders (tenant_id, status);
CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_driver ON orders (driver_id);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES offers(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

-- Points de vente / dépôts physiques d'un distributeur (géolocalisés).
CREATE TABLE points (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  hours TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_points_city ON points (city_id);

-- Demande publiée par un client, que les distributeurs de la ville peuvent prendre.
CREATE TABLE requests (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  city_id INTEGER NOT NULL REFERENCES cities(id),
  service TEXT NOT NULL CHECK (service IN ('echange', 'collecte', 'achat')),
  brand TEXT,
  weight_kg DOUBLE PRECISION,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 20),
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT,
  payment_method TEXT NOT NULL DEFAULT 'especes',
  status TEXT NOT NULL DEFAULT 'ouverte' CHECK (status IN ('ouverte', 'acceptee', 'annulee')),
  tenant_id INTEGER REFERENCES tenants(id),
  order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX idx_requests_city ON requests (city_id, status);

CREATE TABLE order_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX idx_order_events_order ON order_events (order_id);
