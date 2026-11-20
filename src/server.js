'use strict';
const { openDb, seed } = require('./db');
const { createApp } = require('./app');

const db = openDb();
if (seed(db)) console.log('Base initialisée avec les données de démonstration (mot de passe : demo1234).');
if (!process.env.AUTH_SECRET) console.warn('⚠  AUTH_SECRET non défini : secret de développement utilisé.');

const port = Number(process.env.PORT) || 3000;
createApp(db).listen(port, () => console.log(`GazFlow démarré sur http://localhost:${port}`));
