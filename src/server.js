'use strict';
// Démarrage local : Postgres embarqué dans .data/db (créé et migré automatiquement), ou DATABASE_URL si défini.
const { openDb } = require('./db');
const { createApp } = require('./app');

(async () => {
  if (!process.env.AUTH_SECRET) console.warn('⚠  AUTH_SECRET non défini : secret de développement utilisé.');
  const db = await openDb();
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => console.log(`GazFlow démarré sur http://localhost:${port}`));
})().catch((e) => { console.error(e); process.exit(1); });
