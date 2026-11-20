'use strict';
/*
 * Accès aux données (Postgres).
 * - En production (Netlify) : base Netlify DB, connexion fournie par @netlify/database / NETLIFY_DB_URL.
 *   Les migrations de netlify/database/migrations sont appliquées par Netlify à chaque déploiement.
 * - En local et dans les tests : Postgres embarqué (@netlify/database-dev, sans installation),
 *   sur lequel ce module applique lui-même les migrations.
 */
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const pg = require('pg');

// COUNT/SUM renvoient des bigint : on les veut en nombres JS.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));

const MIGRATIONS_DIR = path.join(__dirname, '..', 'netlify', 'database', 'migrations');

// Plans d'abonnement SaaS proposés aux distributeurs.
const PLANS = {
  starter: { label: 'Starter', price: 15000, maxCities: 1, maxDrivers: 3 },
  pro: { label: 'Pro', price: 45000, maxCities: 5, maxDrivers: 20 },
  entreprise: { label: 'Entreprise', price: 120000, maxCities: Infinity, maxDrivers: Infinity },
};

/** Date courante UTC au format texte stocké en base. */
const NOW = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";
const SINCE = (interval) => `to_char((now() - interval '${interval}') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

/** Les requêtes s'écrivent avec « ? » ; Postgres attend $1, $2… */
const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

function wrapPool(pool, onClose) {
  const txStore = new AsyncLocalStorage();
  const exec = (sql, params) => (txStore.getStore() || pool).query(toPg(sql), params);
  return {
    pool,
    async all(sql, ...params) { return (await exec(sql, params)).rows; },
    async get(sql, ...params) { return (await exec(sql, params)).rows[0]; },
    /** Écriture : { changes, id } (id si la requête finit par RETURNING id). */
    async run(sql, ...params) {
      const r = await exec(sql, params);
      return { changes: r.rowCount, id: r.rows[0]?.id, rows: r.rows };
    },
    /** Transaction : toutes les requêtes faites pendant fn() utilisent la même connexion. */
    async tx(fn) {
      if (txStore.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await txStore.run(client, fn);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
      if (onClose) await onClose();
    },
  };
}

/** Applique les migrations non encore appliquées (base embarquée uniquement). */
async function applyMigrations(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS _gazflow_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM _gazflow_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        await client.query('INSERT INTO _gazflow_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} : ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

/** Chaîne de connexion fournie par l'environnement (Netlify, ou DATABASE_URL), sinon null. */
function hostedConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NETLIFY_DB_URL) return process.env.NETLIFY_DB_URL;
  try {
    return require('@netlify/database').getConnectionString() || null;
  } catch {
    return null;
  }
}

/**
 * Ouvre la base. Options :
 *   memory : base embarquée éphémère (tests)
 *   dir    : dossier de la base embarquée persistante (développement local)
 */
async function openDb({ memory = false, dir = process.env.DB_DIR || '.data/db' } = {}) {
  const hosted = memory ? null : hostedConnectionString();
  if (hosted) {
    return wrapPool(new pg.Pool({ connectionString: hosted, max: 5, idleTimeoutMillis: 30_000 }));
  }
  // Import dynamique non littéral : le paquet de développement n'est pas embarqué dans le serveur Netlify.
  const devPkg = '@netlify/database-dev';
  const { NetlifyDB } = await import(devPkg);
  const embedded = new NetlifyDB(memory ? {} : { directory: path.resolve(dir) });
  const connectionString = await embedded.start();
  await applyMigrations(connectionString);
  // Moteur embarqué mono-connexion : une seule connexion dans le pool.
  const pool = new pg.Pool({ connectionString, max: 1 });
  return wrapPool(pool, () => embedded.stop());
}

module.exports = { openDb, applyMigrations, PLANS, NOW, SINCE };
