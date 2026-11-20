// Serveur GazFlow sur Netlify Server : l'API Express (/api/*). Les fichiers de public/ sont servis par le CDN.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { openDb } = require('../../src/db.js');
const { createApp } = require('../../src/app.js');

if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET doit être défini dans les variables d’environnement Netlify');

const db = await openDb(); // base Netlify DB (migrations appliquées par Netlify au déploiement)
createApp(db).listen(Number(process.env.PORT) || 3000);

export const config = { path: '/api/*' };
