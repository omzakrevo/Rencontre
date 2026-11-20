'use strict';
/*
 * Génère la migration SQL des données de démonstration (Burkina Faso) :
 *   node scripts/demo-data.js > netlify/database/migrations/20261120100100_demo_data.sql
 * Les mots de passe sont hachés (scrypt) au moment de la génération.
 */
const { hashPassword } = require('../src/auth');

// Petit enregistreur qui imite l'API « prepare(sql).run(...) » et produit des INSERT SQL avec des identifiants fixes.
function recorder() {
  const out = [];
  const ids = {};
  const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return {
    out, ids,
    prepare(sql) {
      return {
        get: () => ({ n: 0 }),
        run(...args) {
          const m = sql.match(/INSERT INTO (\w+) \(([^)]+)\)/);
          const table = m[1];
          const cols = m[2].split(',').map((c) => c.trim());
          const hasId = table !== 'tenant_cities';
          const id = hasId ? (ids[table] = (ids[table] || 0) + 1) : null;
          out.push(`INSERT INTO ${table} (${hasId ? 'id, ' : ''}${cols.join(', ')}) VALUES (${hasId ? `${id}, ` : ''}${args.map(lit).join(', ')});`);
          return { lastInsertRowid: id };
        },
      };
    },
  };
}
const tx = (_db, fn) => fn();

/**
 * Données de démonstration — Burkina Faso (exécuté seulement si la base est vide).
 * Distributeurs fictifs ; marques et prix indicatifs (recharges Sodigaz 12,5 kg ≈ 5 500 FCFA, bouteille neuve ≈ 22 000 FCFA).
 * Coordonnées GPS des quartiers approximatives : à remplacer par la position réelle des dépôts.
 */
function seed(db) {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return false;
  const pw = hashPassword('demo1234');
  tx(db, () => {
    const BF = 'Burkina Faso';
    const city = db.prepare('INSERT INTO cities (name, country) VALUES (?, ?)');
    const C = {};
    for (const n of ['Ouagadougou', 'Bobo-Dioulasso', 'Banfora', 'Koudougou', 'Ouahigouya', 'Kaya', 'Tenkodogo',
      "Fada N'Gourma", 'Dédougou', 'Gaoua', 'Dori', 'Ziniaré']) {
      C[n] = Number(city.run(n, BF).lastInsertRowid);
    }
    const ouaga = C.Ouagadougou;
    const bobo = C['Bobo-Dioulasso'];
    const banfora = C.Banfora;
    const koudougou = C.Koudougou;

    const user = db.prepare('INSERT INTO users (tenant_id, role, name, email, phone, password_hash, city_id) VALUES (?,?,?,?,?,?,?)');
    const tenant = db.prepare('INSERT INTO tenants (name, slug, plan, currency, phone) VALUES (?,?,?,?,?)');
    const tc = db.prepare('INSERT INTO tenant_cities (tenant_id, city_id, delivery_fee, min_delay_minutes) VALUES (?,?,?,?)');
    const prod = db.prepare('INSERT INTO products (tenant_id, name, brand, weight_kg, kind) VALUES (?,?,?,?,?)');
    const offer = db.prepare('INSERT INTO offers (tenant_id, product_id, city_id, price, stock) VALUES (?,?,?,?,?)');
    const pt = db.prepare('INSERT INTO points (tenant_id, city_id, name, address, phone, hours, lat, lng) VALUES (?,?,?,?,?,?,?,?)');
    const P = (t, name, brand, kg, kind) => Number(prod.run(t, name, brand, kg, kind).lastInsertRowid);
    // Prix arrondis à 50 FCFA, majorés hors de Ouagadougou (transport).
    const price = (base, k = 1) => Math.round((base * k) / 50) * 50;

    user.run(null, 'superadmin', 'Opérateur plateforme', 'super@gazflow.app', '+22670000000', pw, null);

    // 1. Faso Gaz Express (Pro) : Ouagadougou, Bobo-Dioulasso, Banfora — Total, Sodigaz, Oryx.
    const t1 = Number(tenant.run('Faso Gaz Express', 'faso-gaz-express', 'pro', 'FCFA', '+22670100000').lastInsertRowid);
    tc.run(t1, ouaga, 500, 40); tc.run(t1, bobo, 750, 60); tc.run(t1, banfora, 1000, 90);
    const f = {
      total6: P(t1, 'Recharge 6 kg', 'Total', 6, 'recharge'),
      total12: P(t1, 'Recharge 12,5 kg', 'Total', 12.5, 'recharge'),
      sodi12: P(t1, 'Recharge 12,5 kg', 'Sodigaz', 12.5, 'recharge'),
      oryx6: P(t1, 'Recharge 6 kg', 'Oryx', 6, 'recharge'),
      oryx12: P(t1, 'Recharge 12,5 kg', 'Oryx', 12.5, 'recharge'),
      neuve: P(t1, 'Bouteille neuve 12,5 kg chargée (consigne incluse)', 'Sodigaz', 12.5, 'bouteille'),
      bruleur: P(t1, 'Brûleur + détendeur', null, null, 'accessoire'),
    };
    for (const [c, k] of [[ouaga, 1], [bobo, 1.04], [banfora, 1.06]]) {
      offer.run(t1, f.total6, c, price(2500, k), 120);
      offer.run(t1, f.total12, c, price(5500, k), 80);
      offer.run(t1, f.sodi12, c, price(5500, k), 90);
      offer.run(t1, f.oryx6, c, price(2500, k), 60);
      offer.run(t1, f.oryx12, c, price(5500, k), 40);
      offer.run(t1, f.neuve, c, price(22000, k), 15);
      offer.run(t1, f.bruleur, c, 4500, 30);
    }
    user.run(t1, 'admin', 'Aminata Kaboré', 'admin@fasogaz.bf', '+22670100001', pw, null);
    user.run(t1, 'driver', 'Issouf Ouédraogo', 'livreur@fasogaz.bf', '+22670100002', pw, ouaga);
    user.run(t1, 'driver', 'Salif Traoré', 'livreur2@fasogaz.bf', '+22676100003', pw, bobo);
    pt.run(t1, ouaga, 'Faso Gaz Ouaga 2000', 'Ouaga 2000, avenue Pascal Zagré', '+22670100010', '6h30 – 21h', 12.3170, -1.5040);
    pt.run(t1, ouaga, 'Faso Gaz Zogona', 'Zogona, près de l’université', '+22670100011', '7h – 21h', 12.3790, -1.4990);
    pt.run(t1, ouaga, 'Faso Gaz Gounghin', 'Gounghin, route de Bobo', '+22670100012', '7h – 20h', 12.3600, -1.5550);
    pt.run(t1, bobo, 'Faso Gaz Accart-Ville', 'Accart-Ville, près de la gare', '+22676100010', '7h – 20h', 11.1790, -4.2950);
    pt.run(t1, bobo, 'Faso Gaz Sarfalao', 'Sarfalao, route de Banfora', '+22676100011', '7h – 20h', 11.1590, -4.3200);
    pt.run(t1, banfora, 'Faso Gaz Banfora', 'Centre-ville, près du marché', '+22676100012', '7h – 19h', 10.6330, -4.7610);

    // 2. Koudougou Gaz Services (Starter) : Koudougou — Sodigaz, Shell.
    const t2 = Number(tenant.run('Koudougou Gaz Services', 'koudougou-gaz-services', 'starter', 'FCFA', '+22670200000').lastInsertRowid);
    tc.run(t2, koudougou, 500, 45);
    const k12 = P(t2, 'Recharge 12,5 kg', 'Sodigaz', 12.5, 'recharge');
    const k6 = P(t2, 'Recharge 6 kg', 'Shell', 6, 'recharge');
    offer.run(t2, k12, koudougou, 5600, 50);
    offer.run(t2, k6, koudougou, 2550, 35);
    user.run(t2, 'admin', 'Rasmané Compaoré', 'admin@koudougougaz.bf', '+22670200001', pw, null);
    user.run(t2, 'driver', 'Moussa Zongo', 'livreur@koudougougaz.bf', '+22670200002', pw, koudougou);
    pt.run(t2, koudougou, 'Koudougou Gaz centre', 'Secteur 1, près du grand marché', '+22670200010', '7h – 20h', 12.2526, -2.3627);
    pt.run(t2, koudougou, 'Koudougou Gaz secteur 7', 'Secteur 7', '+22670200011', '7h – 19h', 12.2600, -2.3500);

    // 3. Kadiogo Gaz (Starter) : Ouagadougou — Oryx, Sodigaz (Oryx 6 kg en rupture).
    const t3 = Number(tenant.run('Kadiogo Gaz', 'kadiogo-gaz', 'starter', 'FCFA', '+22671300000').lastInsertRowid);
    tc.run(t3, ouaga, 400, 35);
    const r12 = P(t3, 'Recharge 12,5 kg', 'Oryx', 12.5, 'recharge');
    const r6 = P(t3, 'Recharge 6 kg', 'Oryx', 6, 'recharge');
    const rs = P(t3, 'Recharge 12,5 kg', 'Sodigaz', 12.5, 'recharge');
    offer.run(t3, r12, ouaga, 5450, 30);
    offer.run(t3, r6, ouaga, 2450, 0); // en rupture de stock
    offer.run(t3, rs, ouaga, 5500, 20);
    user.run(t3, 'admin', 'Awa Sawadogo', 'admin@kadiogogaz.bf', '+22671300001', pw, null);
    user.run(t3, 'driver', 'Adama Ilboudo', 'livreur@kadiogogaz.bf', '+22671300002', pw, ouaga);
    pt.run(t3, ouaga, 'Kadiogo Gaz Tampouy', 'Tampouy, près du marché', '+22671300010', '6h – 22h', 12.4030, -1.5590);
    pt.run(t3, ouaga, 'Kadiogo Gaz Pissy', 'Pissy, route de Ouahigouya', '+22671300011', '6h – 21h', 12.3390, -1.5800);

    // 4. Gaz du Houet (Starter) : Bobo-Dioulasso — Sodigaz, Shell.
    const t4 = Number(tenant.run('Gaz du Houet', 'gaz-du-houet', 'starter', 'FCFA', '+22676400000').lastInsertRowid);
    tc.run(t4, bobo, 600, 45);
    const h12 = P(t4, 'Recharge 12,5 kg', 'Sodigaz', 12.5, 'recharge');
    const h6 = P(t4, 'Recharge 6 kg', 'Shell', 6, 'recharge');
    offer.run(t4, h12, bobo, 5650, 40);
    offer.run(t4, h6, bobo, 2600, 25);
    user.run(t4, 'admin', 'Fatimata Sanou', 'admin@gazduhouet.bf', '+22676400001', pw, null);
    user.run(t4, 'driver', 'Boubacar Dao', 'livreur@gazduhouet.bf', '+22676400002', pw, bobo);
    pt.run(t4, bobo, 'Gaz du Houet Dogona', 'Dogona, près du marché', '+22676400010', '7h – 20h', 11.1960, -4.2720);

    user.run(null, 'customer', 'Client Démo', 'client@demo.app', '+22670101010', pw, ouaga);
  });
  return true;
}

const db = recorder();
seed(db);
const lines = [
  '-- Données de démonstration GazFlow — Burkina Faso (générées par scripts/demo-data.js).',
  '-- Distributeurs fictifs, prix indicatifs, positions GPS approximatives. Mot de passe des comptes : demo1234.',
  ...db.out,
  ...Object.keys(db.ids).map((t) => `SELECT setval(pg_get_serial_sequence('${t}', 'id'), (SELECT MAX(id) FROM ${t}));`),
];
process.stdout.write(`${lines.join('\n')}\n`);
