'use strict';
// Démarrage local : Postgres embarqué dans .data/db (créé et migré automatiquement), ou DATABASE_URL si défini.
const { openDb } = require('./db');
const { createApp } = require('./app');

(async () => {
  if (!process.env.AUTH_SECRET) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET doit être défini en production.');
    console.warn('⚠  AUTH_SECRET non défini : secret de développement utilisé.');
  }
  const db = await openDb();
  const port = Number(process.env.PORT) || 3000;
  const server = createApp(db).listen(port, () => console.log(`GazFlow démarré sur le port ${port}`));
  // Arrêt propre (redéploiement Coolify / docker stop) : on termine les requêtes puis on ferme la base.
  const stop = () => server.close(() => db.close().finally(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})().catch((e) => { console.error(e); process.exit(1); });
