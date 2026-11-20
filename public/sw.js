'use strict';
/* FasoGaz — service worker : installation (PWA) et fonctionnement hors connexion. */
const VERSION = 'fasogaz-v2';
const SHELL = [
  '/', '/styles.css', '/parcours.css', '/app.js', '/parcours.js', '/art.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-48.png',
];
// API publiques gardées en cache pour l'affichage hors connexion (villes, marques, catalogue).
const CACHED_API = ['/api/cities', '/api/brands', '/api/catalog', '/api/plans', '/api/stats/public'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

const networkFirst = async (req, fallbackUrl) => {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(fallbackUrl || req, res.clone());
    return res;
  } catch {
    return (await cache.match(fallbackUrl || req)) || Response.error();
  }
};
const staleWhileRevalidate = async (req) => {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || update;
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages : réseau d'abord, sinon la page d'accueil en cache.
  if (req.mode === 'navigate') { event.respondWith(networkFirst(req, '/')); return; }

  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) {
      // Seules les API publiques sont mises en cache ; les données personnelles restent en ligne.
      if (CACHED_API.includes(url.pathname) && !req.headers.get('authorization')) event.respondWith(networkFirst(req));
      return;
    }
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // Polices et Leaflet (CDN) : cache puis mise à jour. Les tuiles de carte ne sont pas stockées.
  if (/fonts\.(googleapis|gstatic)\.com$|unpkg\.com$/.test(url.hostname)) event.respondWith(staleWhileRevalidate(req));
});
