'use strict';
/* FasoGaz — interface web (SPA sans framework, routage par hash). */

function readStore(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}
function writeStore(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

const state = {
  token: localStorage.getItem('gf_token'),
  me: null,
  cities: [],
  cart: { tenantId: null, cityId: null, items: {} }, // items: { offer_id: qty }
  pos: readStore('gf_pos'), // dernière position GPS connue { lat, lng }
};
let refreshTimer = null;
let routeSeq = 0; // incrémenté à chaque changement de page : ignore les réponses d'une page quittée

// ---------- Utilitaires ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur = 'FCFA') => `${Number(n || 0).toLocaleString('fr-FR')} ${esc(cur)}`;
const date = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const view = $('#view');
const REDUCED = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SKELETON = '<div class="skeleton" aria-busy="true" aria-label="Chargement"><div class="sk h"></div><div class="sk b"></div><div class="sk"></div><div class="sk" style="width:70%"></div></div>';

// ---------- Motion design : apparitions au défilement, compteurs, parallaxe ----------
let motionObserver = null;
if ('IntersectionObserver' in window) {
  document.documentElement.classList.add('js-reveal');
  motionObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = e.target;
      if (el.classList.contains('reveal') && e.isIntersecting) { el.classList.add('in'); motionObserver.unobserve(el); }
      if (el.classList.contains('art')) {
        // Les animations ne tournent que lorsque l'illustration est visible.
        el.classList.toggle('paused', !e.isIntersecting);
        if (!REDUCED && el.pauseAnimations) { if (e.isIntersecting) el.unpauseAnimations(); else el.pauseAnimations(); }
      }
      if (el.dataset.count && e.isIntersecting) { countUp(el); motionObserver.unobserve(el); }
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
}
function observeMotion(root = document) {
  if (REDUCED) $$('svg.art', root).forEach((svg) => svg.pauseAnimations?.());
  if (!motionObserver) return;
  $$('.reveal:not(.in), .art, [data-count]', root).forEach((el) => {
    if (el.dataset.obs) return;
    el.dataset.obs = '1';
    motionObserver.observe(el);
  });
}
function countUp(el) {
  const target = Number(el.dataset.count) || 0;
  if (REDUCED || !target) { el.textContent = target; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 1400);
    el.textContent = Math.round(target * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
let parallaxTick = false;
window.addEventListener('scroll', () => {
  if (REDUCED || parallaxTick) return;
  parallaxTick = true;
  requestAnimationFrame(() => {
    parallaxTick = false;
    for (const img of $$('[data-parallax]')) {
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const k = (r.top + r.height / 2 - innerHeight / 2) / innerHeight; // -1 … 1
      img.style.transform = `scale(1.12) translateY(${(k * -24).toFixed(1)}px)`;
    }
  });
}, { passive: true });
function enterPage() {
  view.classList.toggle('enter', false);
  void view.offsetWidth; // relance l'animation d'entrée
  view.classList.add('enter');
  observeMotion();
}

const KIND = { recharge: 'Recharge', bouteille: 'Bouteille neuve', accessoire: 'Accessoire' };
const PAY = { especes: 'Espèces à la livraison', mobile_money: 'Mobile Money (Orange Money, Moov Money)', carte: 'Carte bancaire' };
const BF_CENTER = [12.25, -1.6]; // Burkina Faso
const SHORT_CITY = { Ouagadougou: 'Ouaga', 'Bobo-Dioulasso': 'Bobo', "Fada N'Gourma": 'Fada' };
const PAY_STATUS = { en_attente: 'Non payé', paye: 'Payé', rembourse: 'Remboursé' };
const SLOT = { asap: 'Dès que possible', matin: 'Matin (8h–12h)', apres_midi: 'Après-midi (12h–17h)', soir: 'Soir (17h–21h)' };
const FLOW = ['en_attente', 'confirmee', 'assignee', 'en_livraison', 'livree'];
const SERVICE = {
  echange: ['♻️', 'Recharge (échange)', 'Le livreur apporte une bouteille pleine et reprend votre bouteille vide.'],
  collecte: ['🚚', 'Collecte et recharge', 'On vient chercher votre bouteille, on la recharge et on vous la ramène.'],
  achat: ['🆕', 'Bouteille neuve', "Vous n'avez pas de bouteille : achat d'une bouteille neuve (consigne incluse)."],
};
const SERVICE_LABEL = { livraison: 'Livraison', echange: 'Recharge (échange)', collecte: 'Collecte et recharge', achat: 'Bouteille neuve' };
const km = (d) => (d == null ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);
const ago = (s) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(`${s.replace(' ', 'T')}Z`)) / 60000));
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};
const directions = (lat, lng, fallback) => (lat != null && lng != null
  ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallback)}`);

/** Position GPS de l'utilisateur (mémorisée pour la session). */
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("La localisation n'est pas disponible sur cet appareil")); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      state.pos = { lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 };
      writeStore('gf_pos', state.pos);
      resolve(state.pos);
    }, () => reject(new Error("Localisation refusée. Choisissez votre ville dans la liste.")), { timeout: 10000, maximumAge: 300000 });
  });
}

const ROLE = { superadmin: 'Plateforme', admin: 'Distributeur', driver: 'Livreur', customer: 'Client' };

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${err ? ' err' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = ''; }, 3200);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(false); }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());
const badge = (status, label) => `<span class="badge s-${esc(status)}">${esc(label)}</span>`;
const payBadge = (s) => `<span class="badge p-${esc(s)}">${esc(PAY_STATUS[s] || s)}</span>`;
const cityOptions = (selected, filter = () => true) => {
  const multi = new Set(state.cities.map((c) => c.country)).size > 1;
  return state.cities.filter(filter)
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}>${esc(c.name)}${multi ? ` — ${esc(c.country)}` : ''}</option>`).join('');
};

function setSession(data) {
  state.token = data.token;
  localStorage.setItem('gf_token', data.token);
}
function logout(redirect = true) {
  state.token = null; state.me = null;
  localStorage.removeItem('gf_token');
  if (redirect) location.hash = '#/';
  renderNav();
}
function homeFor(role) {
  return { superadmin: '#/plateforme', admin: '#/admin', driver: '#/livraisons', customer: '#/' }[role] || '#/';
}

// ---------- Navigation ----------
function renderNav() {
  const u = state.me?.user;
  const links = {
    guest: [['#/', 'Trouver du gaz'], ['#/demande', 'Faire une demande'], ['#/commander', 'Commander'],
      ['#/devenir-distributeur', 'Distributeurs'], ['#/connexion', 'Connexion']],
    customer: [['#/', 'Trouver du gaz'], ['#/demande', 'Mes demandes'], ['#/commander', 'Commander'], ['#/commandes', 'Mes commandes']],
    admin: [['#/admin', 'Tableau de bord'], ['#/admin/demandes', 'Demandes'], ['#/admin/commandes', 'Commandes'],
      ['#/admin/catalogue', 'Catalogue'], ['#/admin/points', 'Points de vente'], ['#/admin/zones', 'Villes'],
      ['#/admin/livreurs', 'Livreurs'], ['#/admin/abonnement', 'Abonnement']],
    driver: [['#/livraisons', 'Mes livraisons']],
    superadmin: [['#/plateforme', 'Distributeurs']],
  }[u ? u.role : 'guest'];
  const cur = (location.hash || '#/').split('?')[0];
  $('#nav').innerHTML = links.map(([href, label]) => `<a href="${href}" class="${cur === href ? 'active' : ''}${!u && href === '#/demande' ? ' cta-nav' : ''}">${label}</a>`).join('')
    + (u ? `<span class="who hide-sm">${esc(u.name)} · ${ROLE[u.role]}</span><button id="logout">Déconnexion</button>` : '');
  $('#logout')?.addEventListener('click', () => logout());
  const tabs = !u || u.role === 'customer'
    ? [['#/', 'home', 'Accueil'], ['#/demande', 'refresh', 'Demandes'], ['#/commander', 'cart', 'Commander'], [u ? '#/commandes' : '#/connexion', 'clock', u ? 'Mes commandes' : 'Connexion']]
    : null;
  document.body.classList.toggle('has-tabbar', !!tabs);
  $('#tabbar').innerHTML = tabs ? tabs.map(([href, ic, label]) => `<a href="${href}" class="${cur === href ? 'active' : ''}" aria-label="${label}" title="${label}">${Art.icon(ic, 22)}</a>`).join('') : '';
}

// ---------- Pages publiques ----------
let searchMap = null;
let searchLayer = null;

const plansGrid = (plans) => plans.map((p, i) => `
  <div class="card plan lift reveal d${i} ${p.id === 'pro' ? 'featured' : ''}">
    <h3>${esc(p.label)}</h3>
    <div class="price">${money(p.price)}<span class="small muted"> /mois</span></div>
    <p class="muted">${p.maxCities ? `${p.maxCities} ville(s)` : 'Villes illimitées'} · ${p.maxDrivers ? `${p.maxDrivers} livreurs` : 'Livreurs illimités'}</p>
    <a class="btn ${p.id === 'pro' ? 'primary' : ''}" href="#/devenir-distributeur?plan=${p.id}">Choisir ${esc(p.label)}</a>
  </div>`).join('');

const emptyBox = (html) => `<div class="empty">${window.Art ? Art.empty() : ''}<div>${html}</div></div>`;

const PHOTO_CREDITS = [
  ['JNY AAA', 'ynjatwork'], ['Ariel Nathan Ada Mbita', 'adambita237'], ['Eric Prouzet', 'eprouzet'], ['Elise Gaumier', 'e_g_e_photographie'],
];
const footer = () => `<footer class="footer"><div class="wrap row">
  <div style="max-width:320px"><a href="#/" class="brand"><span class="logo">${Art.logo()}</span> FasoGaz</a>
    <p>Trouver, commander et se faire livrer du gaz, ville par ville.</p></div>
  <div class="stack" style="--g:6px"><b>Clients</b><a href="#/">Trouver du gaz</a><a href="#/demande">Faire une demande</a><a href="#/commander">Commander</a></div>
  <div class="stack"><b>Distributeurs</b><a href="#/devenir-distributeur">Créer mon espace</a><a href="#/connexion">Connexion</a></div>
  <div class="small" style="max-width:300px">Photos : ${PHOTO_CREDITS.map(([n, u]) => `<a href="https://unsplash.com/@${u}?utm_source=gazflow&utm_medium=referral" target="_blank" rel="noopener">${n}</a>`).join(', ')}
    sur <a href="https://unsplash.com/?utm_source=gazflow&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>. Illustrations animées : FasoGaz.</div>
</div></footer>`;

const servicesSection = () => `
  <section class="wrap section tight" id="services">
    <div class="section-head reveal"><span class="kicker">Nos services</span><h2 class="section-title">Recharge, collecte ou bouteille neuve</h2>
      <p>Publiez une demande : les distributeurs proches la reçoivent et le premier disponible s'en occupe.</p></div>
    <div class="services">${[
      ['echange', Art.serviceEchange(), 'Recharge (échange)', 'Le livreur apporte une bouteille pleine et repart avec votre bouteille vide.'],
      ['collecte', Art.serviceCollecte(), 'Collecte et recharge', 'On vient chercher votre bouteille, on la recharge et on vous la ramène.'],
      ['achat', Art.serviceNeuve(), 'Bouteille neuve', "Première bouteille ? Achetez-la avec la consigne, livrée chez vous."],
    ].map(([k, art, t, d], i) => `<a class="card service lift reveal d${i}" href="#/demande?service=${k}">${art}<h3>${t}</h3><p class="muted">${d}</p><span class="go">Faire une demande →</span></a>`).join('')}
    </div>
  </section>`;

function landingSections(stats, plans, brands) {
  return `
  <section class="wrap section tight"><div class="stats">
    ${[[stats.cities, 'villes desservies'], [stats.points, 'points de vente'], [stats.distributors, 'distributeurs'], [stats.brands, 'marques de gaz']]
      .map(([n, l], i) => `<div class="card stat reveal d${i}"><div class="n" data-count="${n}">${n}</div><div class="l">${l}</div></div>`).join('')}
  </div></section>

  <section class="wrap section" id="comment">
    <div class="section-head reveal"><span class="kicker">Comment ça marche</span>
      <h2 class="section-title">De la bouteille vide à la bouteille pleine, en 3 étapes</h2>
      <p>Plus besoin de faire le tour des dépôts ni d'appeler partout : FasoGaz sait qui a votre gaz, et à quelle distance.</p></div>
    <div class="steps3">${[
      [Art.stepSearch(), 'Tapez votre marque', 'Oryx, Sodigaz, Total, Shell… même mal écrite, avec ou sans la ville (« Oryx Bobo »). Les points de vente s’affichent du plus proche au plus loin.'],
      [Art.stepRequest(), 'Publiez une demande', 'Recharge, collecte ou bouteille neuve : tous les distributeurs de votre ville la reçoivent. Le premier la prend.'],
      [Art.stepDelivery(), 'Le livreur arrive', 'Vous voyez qui s’en occupe, vous pouvez l’appeler et suivre la livraison jusqu’à votre porte.'],
    ].map(([art, t, d], i) => `<div class="card step lift reveal d${i}"><span class="num">${i + 1}</span>${art}<h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}
    </div>
  </section>

  <section class="wrap section"><div class="story">
    <div class="story-media reveal"><img src="/img/livreur-gaz.jpg" alt="Un livreur à moto transporte une bouteille de gaz" loading="lazy" data-parallax>
      <div class="float-card a"><span class="ic">🛵</span><div>Livreur à 600 m<small>Arrivée dans 6 min</small></div></div>
      <div class="float-card b"><span class="ic">✅</span><div>Demande acceptée<small>par un dépôt de Ouaga</small></div></div>
    </div>
    <div class="reveal d1"><span class="kicker">Fini le tour des dépôts</span>
      <h2 class="section-title">Votre bouteille est vide ? On sait qui l'a, tout près de chez vous.</h2>
      <ul class="checks">
        <li><div><b>Disponibilité réelle</b><br><span class="muted">Les ruptures sont signalées : vous ne vous déplacez pas pour rien.</span></div></li>
        <li><div><b>Le plus proche en premier</b><br><span class="muted">Distance calculée depuis votre position, itinéraire en un clic.</span></div></li>
        <li><div><b>Un contact direct</b><br><span class="muted">Appelez le dépôt ou le livreur, payez en espèces ou Mobile Money.</span></div></li>
      </ul>
      <a class="btn primary lg" href="#/demande">♻️ Faire une demande</a></div>
  </div></section>

  ${servicesSection()}

  <section class="wrap section tight"><div class="mosaic">
    <figure class="reveal"><img src="/img/cuisine.jpg" alt="Une cuisinière souriante prépare le repas" loading="lazy"><figcaption>Le gaz de tous les jours<small>Pour la maison, le maquis ou le restaurant</small></figcaption></figure>
    <figure class="reveal d1"><img src="/img/bouteilles.jpg" alt="Des bouteilles de gaz orange alignées" loading="lazy"><figcaption>Toutes les marques<small>${esc(brands.join(' · ') || 'Sodigaz · Oryx · Total · Shell')}</small></figcaption></figure>
    <figure class="reveal d2"><img src="/img/scooter-ville.jpg" alt="Un livreur à moto traverse la ville" loading="lazy"><figcaption>Livré en ville<small>Par les livreurs du dépôt le plus proche</small></figcaption></figure>
  </div></section>

  <section class="dark-band section" id="distributeurs"><div class="wrap">
    <div class="story">
      <div class="reveal">${Art.dashboard()}</div>
      <div class="reveal d1"><span class="kicker">Pour les distributeurs</span>
        <h2 class="section-title">Vos dépôts visibles. Vos clients servis plus vite.</h2>
        <ul class="checks">
          <li>Apparaissez dans la recherche avec vos marques, vos prix et vos stocks</li>
          <li>Recevez les demandes des clients proches de vos dépôts</li>
          <li>Assignez vos livreurs et suivez chaque commande en temps réel</li>
          <li>Pilotez votre chiffre d'affaires ville par ville</li>
        </ul>
        <a class="btn primary lg" href="#/devenir-distributeur">Créer mon espace distributeur</a></div>
    </div>
    <div class="grid g3" style="margin-top:56px">${plansGrid(plans)}</div>
  </div></section>

  <section class="wrap section"><div class="final-cta reveal">
    <h2>Votre bouteille est vide ?</h2><p>Trouvez le point de vente le plus proche en quelques secondes.</p>
    <a class="btn lg" href="#/" id="totop">🔍 Trouver du gaz maintenant</a>
  </div></section>`;
}

// ---------- Style application (espace client) ----------
const SERVICE_ICON = { livraison: ['cart', ''], echange: ['refresh', ''], collecte: ['truck', 'blue'], achat: ['sparkle', 'green'] };
const LIVE = ['en_attente', 'confirmee', 'assignee', 'en_livraison'];

const SHORT_STATUS = { en_attente: 'En attente', confirmee: 'Confirmée', assignee: 'Livreur assigné', en_livraison: 'En route', livree: 'Livrée', annulee: 'Annulée' };
const shortDate = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function orderItem(o) {
  const [ic, tone] = SERVICE_ICON[o.service] || SERVICE_ICON.livraison;
  return `<a class="o-item" href="#/commande/${o.id}">
    <span class="o-ic ${tone}">${Art.icon(ic)}</span>
    <span class="o-main"><b>#${esc(o.ref.replace(/^GZ-\d+-/, ''))}</b><small>${shortDate(o.created_at)} · ${esc(SHORT_CITY[o.city_name] || o.city_name)}</small></span>
    <span class="o-side"><small>${money(o.total, o.currency)}</small><span class="pill s-${esc(o.status)}">${esc(SHORT_STATUS[o.status] || o.status_label)}</span></span>
  </a>`;
}
function requestItem(r) {
  const [ic, tone] = SERVICE_ICON[r.service] || SERVICE_ICON.echange;
  return `<a class="o-item" href="#/demande">
    <span class="o-ic ${tone}">${Art.icon(ic)}</span>
    <span class="o-main"><b>${esc(SERVICE_LABEL[r.service])}</b><small>${ago(r.created_at)} · ${esc(SHORT_CITY[r.city_name] || r.city_name)}</small></span>
    <span class="o-side"><small>${esc([r.brand, r.weight_kg ? `${String(r.weight_kg).replace('.', ',')} kg` : ''].filter(Boolean).join(' ') || `${r.qty} bouteille(s)`)}</small>
      <span class="pill s-ouverte">En attente</span></span>
  </a>`;
}

const SVC_CARDS = [
  ['refresh', 'Recharge de gaz', 'Bouteille pleine livrée, la vide reprise', 'orange', 'Recharger', '#/demande?service=echange'],
  ['truck', 'Collecte et recharge', 'On vient chercher votre bouteille', 'blue', 'Programmer une collecte', '#/demande?service=collecte'],
  ['sparkle', 'Bouteille neuve', 'Votre première bouteille, consigne incluse', 'green', 'Acheter', '#/demande?service=achat'],
  ['cart', 'Commander en ligne', 'Choisissez le dépôt, payez à la livraison', 'orange', 'Commander', '#/commander'],
];

function clientTop({ first, initials, cityName, orders, requests, query, cityId, brands, served }) {
  const openReq = requests.filter((r) => r.status === 'ouverte');
  const items = [...openReq.map(requestItem), ...orders.slice(0, Math.max(0, 4 - openReq.length)).map(orderItem)];
  const busy = openReq.length || orders.some((o) => LIVE.includes(o.status));
  return `
  <section class="wrap app-home">
    <div class="app-top">
      <span class="avatar" aria-hidden="true">${esc(initials)}</span>
      <button type="button" class="loc-pill" id="geo" aria-label="Utiliser ma position">${Art.icon('pin', 18)}<span id="loclabel">${esc(state.pos ? 'Ma position' : cityName)}</span>${Art.icon('chev', 16)}</button>
      <a class="icon-btn" href="#/demande" aria-label="Mes demandes${busy ? ' (en cours)' : ''}">${Art.icon('bell')}${busy ? '<i class="dot"></i>' : ''}</a>
    </div>
    <div class="app-hello"><h1>Bonjour ${first} 👋</h1><p class="muted">De quoi avez-vous besoin aujourd'hui ?</p></div>
    <form class="searchbox app-search" id="sf" role="search">
      <div class="q"><input id="q" type="search" value="${esc(query)}" placeholder="Sodigaz, Oryx Bobo, Total 6 kg…" autocomplete="off" aria-label="Marque ou produit"></div>
      <select id="sc" aria-label="Ville" hidden><option value="">Toutes les villes</option>${cityOptions(cityId, (c) => c.providers > 0)}</select>
    </form>
    <div class="chips app-chips">${brands.map((b) => `<button type="button" class="chip" data-brand="${esc(b)}">${esc(b)}</button>`).join('')}
      ${served.map((c) => `<button type="button" class="chip" data-city="${c.id}">📍 ${esc(SHORT_CITY[c.name] || c.name)}</button>`).join('')}</div>
    <div class="geo-note" id="geonote"></div>

    <div class="app-col">
      <div class="carousel" id="carousel" aria-label="Services">
        ${SVC_CARDS.map(([ic, t, d, color, cta, href]) => `
          <article class="svc-card ${color}">
            <div class="svc-head"><span class="svc-ic">${Art.icon(ic)}</span><div><b>${t}</b><small>${d}</small></div></div>
            ${Art.bottleStudio(color)}
            <a class="btn-pill" href="${href}">${cta}</a>
          </article>`).join('')}
      </div>
      <div class="dots" id="dots">${SVC_CARDS.map((_, i) => `<button type="button" aria-label="Service ${i + 1}" class="${i ? '' : 'on'}"></button>`).join('')}</div>
    </div>

    <div class="sheet">
      <div class="sheet-head"><h2>Mes commandes</h2><a href="#/commandes">Tout voir</a></div>
      ${items.length ? items.join('') : `<div class="o-empty">${Art.icon('flame', 22)}<span>Pas encore de commande.<br><a href="#/demande">Faites votre première demande</a></span></div>`}
    </div>
  </section>
  <h2 class="wrap app-h2">Points de vente près de vous</h2>`;
}

/** Accueil client : recherche par marque, points de vente du plus proche au plus loin. */
async function pageSearch(params) {
  const pageId = routeSeq;
  const guest = !state.me;
  let query = params.get('q') || '';
  let cityId = params.get('ville') || '';
  const [brands, stats, plans, myOrders, myRequests] = await Promise.all([
    api('GET', '/api/brands'), api('GET', '/api/stats/public'), guest ? api('GET', '/api/plans') : [],
    guest ? [] : api('GET', '/api/orders'), guest ? [] : api('GET', '/api/requests'),
  ]);
  if (pageId !== routeSeq) return; // page quittée entre-temps
  const PRIORITY = ['Ouagadougou', 'Bobo-Dioulasso', 'Banfora'];
  const rank = (c) => (PRIORITY.includes(c.name) ? PRIORITY.indexOf(c.name) : 99);
  const served = state.cities.filter((c) => c.providers > 0).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const rot = brands.length ? brands : ['Sodigaz', 'Oryx', 'Total', 'Shell'];
  const first = state.me ? esc(state.me.user.name.split(' ')[0]) : '';
  view.className = guest ? 'landing' : 'landing app';
  const me = state.me?.user;
  view.innerHTML = `${guest ? '' : clientTop({
    first, initials: me.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    cityName: state.cities.find((c) => c.id === me.city_id)?.name || 'Choisir ma position',
    orders: myOrders, requests: myRequests, query, cityId, brands, served,
  })}
    ${!guest ? '' : `<section class="hero">
      <div class="wrap hero-grid">
        <div>
          <span class="eyebrow"><b>🇧🇫 Burkina Faso</b> ${stats.points} points de vente · ${stats.cities} villes</span>
          <h1>${guest
            ? `Votre gaz <span class="rotator" aria-live="off">${rot.map((b, i) => `<span class="${i ? '' : 'on'}">${esc(b)}</span>`).join('')}</span><br>trouvé et livré.`
            : `Bonjour ${first},<br><span class="grad">quel gaz cherchez-vous ?</span>`}</h1>
          <p class="lead">Tapez votre marque : les points de vente qui l'ont s'affichent, du plus proche au plus loin.
            ${served.length ? `Disponible à ${served.map((c) => esc(c.name)).join(', ').replace(/, ([^,]*)$/, ' et $1')}.` : ''}</p>
          <form class="searchbox" id="sf" role="search">
            <div class="q"><input id="q" type="search" value="${esc(query)}" placeholder="Sodigaz, Oryx Bobo, Total 6 kg…" autocomplete="off" aria-label="Marque ou produit"></div>
            <select id="sc" aria-label="Ville"><option value="">Toutes les villes</option>${cityOptions(cityId, (c) => c.providers > 0)}</select>
            <button type="button" class="btn primary" id="geo">📍 Autour de moi</button>
          </form>
          <div class="chips">${brands.map((b) => `<button type="button" class="chip" data-brand="${esc(b)}">${esc(b)}</button>`).join('')}</div>
          <div class="chips city-chips" aria-label="Villes">${served.map((c) => `<button type="button" class="chip" data-city="${c.id}">📍 ${esc(SHORT_CITY[c.name] || c.name)}</button>`).join('')}</div>
          <div class="geo-note" id="geonote"></div>
        </div>
        <div class="hero-art">${Art.hero()}</div>
      </div>
      <svg class="hero-wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 38 C 240 78 480 0 720 22 S 1200 70 1440 28 V70 H0Z"/></svg>
    </section>`}
    <section class="wrap results-wrap" id="results">
      <div class="results"><div id="list" class="stack"></div><div id="map" role="region" aria-label="Carte des points de vente"></div></div>
      <div class="card cta" style="margin-top:16px">
        <div><b>Pas le temps de chercher ?</b><br><span class="muted small">Faites une demande de recharge : les distributeurs proches la reçoivent, l'un d'eux vous contacte et vient livrer ou chercher votre bouteille.</span></div>
        <a class="btn primary" id="cta" href="#/demande">♻️ Faire une demande</a>
      </div>
    </section>
    ${guest ? landingSections(stats, plans, brands) : ''}
    ${footer()}`;

  // Marque qui défile dans le titre.
  if (guest && !REDUCED && rot.length > 1) {
    let i = 0;
    const spans = $$('.rotator span');
    const tick = () => {
      if (pageId !== routeSeq || !spans[0].isConnected) return;
      const cur = spans[i];
      i = (i + 1) % spans.length;
      cur.classList.replace('on', 'out');
      spans[i].classList.remove('out');
      spans[i].classList.add('on');
      setTimeout(() => cur.classList.remove('out'), 650);
      setTimeout(tick, 2400);
    };
    setTimeout(tick, 2400);
  }
  const car = $('#carousel');
  if (car) {
    const dots = $$('#dots button');
    const step = () => car.firstElementChild.getBoundingClientRect().width + 12;
    car.addEventListener('scroll', () => {
      const i = Math.min(dots.length - 1, Math.round(car.scrollLeft / step()));
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
    }, { passive: true });
    dots.forEach((d, k) => d.addEventListener('click', () => car.scrollTo({ left: k * step(), behavior: REDUCED ? 'auto' : 'smooth' })));
  }
  $('#totop')?.addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }); setTimeout(() => $('#q')?.focus(), 500); });

  if (searchMap) { searchMap.remove(); searchMap = null; }
  const hasMap = typeof window.L !== 'undefined';
  if (!hasMap) { $('#map').style.display = 'none'; $('.results').style.gridTemplateColumns = '1fr'; }
  let markers = {};
  let seq = 0;
  let showAll = false;

  const note = () => {
    $('#geonote').textContent = state.pos ? '📍 Résultats triés selon votre position.' : 'Astuce : touchez « Autour de moi » pour voir le point de vente le plus proche.';
  };
  const showResults = () => {
    const r = $('#results');
    if (r && r.getBoundingClientRect().top > window.innerHeight * 0.75) r.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  };

  const draw = (results) => {
    const list = $('#list');
    const where = cityId ? ` à ${esc(state.cities.find((c) => String(c.id) === String(cityId))?.name || '')}` : '';
    list.classList.remove('stagger'); void list.offsetWidth; list.classList.add('stagger');
    if (!results.length) {
      list.innerHTML = `<div class="card">${emptyBox(`<b>Aucun point de vente${query ? ` n'a « ${esc(query)} »` : ''}${where}.</b><br>
        Essayez une autre marque, ou <a href="${$('#cta').getAttribute('href')}">faites une demande</a> : les distributeurs vous répondront.`)}</div>`;
    } else {
      const nearest = results.find((p) => p.available && p.distance_km != null && p.distance_km <= 30);
      const LIMIT = 4;
      const visible = showAll || query || results.length <= LIMIT + 1 ? results : results.slice(0, LIMIT);
      list.innerHTML = `<div class="results-head"><b>${results.length} point(s) de vente${query ? ` avec « ${esc(query)} »` : ''}${where}</b>
          ${state.pos ? '<span class="small muted">du plus proche au plus loin</span>' : ''}</div>`
        + visible.map((p) => {
          const shown = p.products.slice(0, 5);
          const brand = p.products.find((o) => o.in_stock)?.brand || p.products[0]?.brand || '';
          return `<div class="card point lift ${p.available ? '' : 'off'}" data-pt="${p.id}">
            <div class="head"><div><b>${esc(p.name)}</b> ${p === nearest ? '<span class="badge near">Le plus proche</span>' : ''}<br>
              <span class="small muted">${esc(p.tenant_name)} · ${esc(p.address)}, ${esc(p.city_name)}</span></div>
              <div class="right">${p.distance_km != null ? `<div class="dist">${km(p.distance_km)}</div>` : ''}
                <span class="badge ${p.available ? 's-livree' : 's-annulee'}">${p.available ? 'Disponible' : 'Rupture'}</span></div></div>
            <div style="margin-top:8px">${shown.map((o) => `<div class="prod"><span>${o.brand ? `<b>${esc(o.brand)}</b> · ` : ''}${esc(o.name)}</span>
              ${o.in_stock ? `<span class="price">${money(o.price, p.currency)}</span>` : '<span class="no">Rupture</span>'}</div>`).join('')}
              ${p.products.length > shown.length ? `<div class="small muted">+ ${p.products.length - shown.length} autre(s) produit(s)</div>` : ''}</div>
            <div class="small muted" style="margin-top:6px">🕒 ${esc(p.hours || 'Horaires non précisés')} · Livraison ${money(p.delivery_fee, p.currency)} (~${p.min_delay_minutes} min)</div>
            <div class="actions">
              ${p.phone ? `<a class="btn sm" href="tel:${esc(p.phone)}">📞 Appeler</a>` : ''}
              <a class="btn sm" target="_blank" rel="noopener" href="${directions(p.lat, p.lng)}">🗺️ Y aller</a>
              <a class="btn sm primary" href="#/commander?ville=${p.city_id}">🛵 Me faire livrer</a>
              <a class="btn sm" href="#/demande?ville=${p.city_id}${brand ? `&marque=${encodeURIComponent(brand)}` : ''}">♻️ Demande de recharge</a>
            </div></div>`;
        }).join('')
        + (visible.length < results.length ? `<button type="button" class="btn" id="more" style="width:100%">Voir les ${results.length} points de vente ↓</button>` : '');
    }
    $('#more')?.addEventListener('click', () => { showAll = true; draw(results); });
    $$('.point').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const m = markers[el.dataset.pt];
      if (m && searchMap) { searchMap.setView(m.getLatLng(), Math.max(searchMap.getZoom(), 14)); m.openPopup(); }
      $$('.point.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
    }));
    observeMotion(list);
    if (hasMap) drawMap(results);
  };
  const drawMap = (results) => {
    if (!searchMap) {
      searchMap = L.map('map', { scrollWheelZoom: false }).setView(BF_CENTER, 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(searchMap);
      searchLayer = L.layerGroup().addTo(searchMap);
    }
    searchLayer.clearLayers();
    markers = {};
    const bounds = [];
    for (const p of results) {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 9, weight: 2, color: '#fff', fillOpacity: 1, fillColor: p.available ? '#2b8a3e' : '#9aa7b4',
      }).addTo(searchLayer).bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.tenant_name)}${p.distance_km != null ? ` · ${km(p.distance_km)}` : ''}<br>${p.available ? '✅ Disponible' : '❌ Rupture'}`);
      m.on('click', () => {
        const el = $(`[data-pt="${p.id}"]`);
        $$('.point.sel').forEach((x) => x.classList.remove('sel'));
        if (el) { el.classList.add('sel'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      });
      markers[p.id] = m;
      bounds.push([p.lat, p.lng]);
    }
    if (state.pos) {
      L.circleMarker([state.pos.lat, state.pos.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1c64b4', fillOpacity: 1 })
        .addTo(searchLayer).bindTooltip('Vous êtes ici');
    }
    // Cadrage : autour de moi + les points disponibles les plus proches, sinon tous les résultats.
    const near = state.pos ? results.filter((p) => p.available && p.distance_km != null && p.distance_km < 30).slice(0, 5) : [];
    const frame = near.length ? [...near.map((p) => [p.lat, p.lng]), [state.pos.lat, state.pos.lng]] : bounds;
    const fit = () => { if (searchMap && frame.length) searchMap.fitBounds(frame, { padding: [30, 30], maxZoom: 15 }); };
    fit();
    // La page s'anime à l'arrivée : on recadre quand la carte a sa taille définitive.
    setTimeout(() => { if (searchMap) { searchMap.invalidateSize(); fit(); } }, 700);
  };

  const run = async () => {
    const mySeq = ++seq;
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    if (cityId) qs.set('city_id', cityId);
    if (state.pos) { qs.set('lat', state.pos.lat); qs.set('lng', state.pos.lng); }
    const { results } = await api('GET', `/api/search?${qs}`);
    if (mySeq !== seq || pageId !== routeSeq) return; // recherche plus récente, ou page quittée
    const page = new URLSearchParams();
    if (query) page.set('q', query);
    if (cityId) page.set('ville', cityId);
    history.replaceState(null, '', `#/${page.toString() ? `?${page}` : ''}`);
    const firstCity = cityId || results[0]?.city_id || '';
    // Marque reconnue (« ori » → « Oryx ») pour pré-remplir la demande.
    const brand = query ? (results.flatMap((p) => p.products).find((o) => o.in_stock && o.brand)?.brand || query) : '';
    $('#cta').setAttribute('href', `#/demande?${new URLSearchParams({ ...(firstCity && { ville: firstCity }), ...(brand && { marque: brand }) })}`);
    $$('.chip[data-brand]').forEach((c) => c.classList.toggle('on', c.dataset.brand.toLowerCase() === query.trim().toLowerCase()));
    $$('.chip[data-city]').forEach((c) => c.classList.toggle('on', c.dataset.city === String(cityId)));
    note();
    if ($('#loclabel') && state.pos) $('#loclabel').textContent = results[0] ? `Près de ${SHORT_CITY[results[0].city_name] || results[0].city_name}` : 'Ma position';
    draw(results);
  };

  let timer;
  $('#q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { query = e.target.value.trim(); run(); }, 250); });
  $('#sf').addEventListener('submit', async (e) => { e.preventDefault(); query = $('#q').value.trim(); await run(); showResults(); });
  $('#sc').addEventListener('change', (e) => { cityId = e.target.value; run(); });
  $$('[data-city]').forEach((c) => c.addEventListener('click', () => {
    cityId = String(cityId) === c.dataset.city ? '' : c.dataset.city;
    $('#sc').value = cityId;
    run().then(showResults);
  }));
  $$('.chip[data-brand]').forEach((c) => c.addEventListener('click', () => {
    query = c.classList.contains('on') ? '' : c.dataset.brand;
    $('#q').value = query;
    run().then(showResults);
  }));
  $('#geo').addEventListener('click', async () => {
    $('#geonote').textContent = 'Localisation en cours…';
    try { await locate(); cityId = ''; $('#sc').value = ''; await run(); showResults(); } catch (e) { toast(e.message, true); note(); }
  });

  await run();
  // Première visite : on propose directement de trouver le point le plus proche.
  if (!state.pos && !readStore('gf_geo_asked')) {
    writeStore('gf_geo_asked', true);
    locate().then(() => pageId === routeSeq && run()).catch(() => pageId === routeSeq && note());
  }
}

const DEMO = `<div class="demo">Comptes de démonstration (mot de passe <b>demo1234</b>) :<br>
  ${['client@demo.app', 'admin@fasogaz.bf', 'livreur@fasogaz.bf', 'super@gazflow.app'].map((e) => `<code data-demo="${e}">${e}</code>`).join(' · ')}</div>`;

function pageLogin(params) {
  const tab = params.get('tab') || 'login';
  view.innerHTML = `
    <div class="auth-split">
     <div class="auth-art">
       <div><h2>${tab === 'login' ? 'Content de vous revoir 👋' : 'Bienvenue sur FasoGaz'}</h2>
         <p>Trouvez votre gaz au dépôt le plus proche, demandez une recharge et suivez votre livreur en direct.</p></div>
       ${Art.hero()}
     </div>
     <div class="auth-form">
      <div class="tabs"><button data-tab="login" class="${tab === 'login' ? 'on' : ''}">Connexion</button><button data-tab="register" class="${tab === 'register' ? 'on' : ''}">Créer un compte client</button></div>
      ${tab === 'login' ? `
        <form id="f">
          <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
          <div class="field"><label>Mot de passe</label><input name="password" type="password" required autocomplete="current-password"></div>
          <button class="btn primary lg" style="width:100%">Se connecter</button>
        </form>
        <p></p>${DEMO}` : `
        <form id="f">
          <div class="field"><label>Nom complet</label><input name="name" required></div>
          <div class="field"><label>Téléphone</label><input name="phone" type="tel" required placeholder="+226 70 00 00 00"></div>
          <div class="field"><label>Ville</label><select name="city_id">${cityOptions(null)}</select></div>
          <div class="field"><label>Email</label><input name="email" type="email" required></div>
          <div class="field"><label>Mot de passe (8 caractères min.)</label><input name="password" type="password" minlength="8" required></div>
          <button class="btn primary" style="width:100%">Créer mon compte</button>
        </form>`}
     </div>
    </div>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/connexion?tab=${b.dataset.tab}${params.get('next') ? `&next=${encodeURIComponent(params.get('next'))}` : ''}`; }));
  $$('[data-demo]').forEach((c) => c.addEventListener('click', () => { $('[name=email]').value = c.dataset.demo; $('[name=password]').value = 'demo1234'; }));
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      setSession(await api('POST', tab === 'login' ? '/api/auth/login' : '/api/auth/register', formData(e.target)));
      await loadMe();
      location.hash = params.get('next') || homeFor(state.me.user.role);
    } catch (err) { toast(err.message, true); }
  });
}

async function pageTenantSignup(params) {
  const pageId = routeSeq;
  const plans = await api('GET', '/api/plans');
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `
    <div class="card auth" style="max-width:560px">
      <h1>Devenir distributeur</h1>
      <p class="muted">Créez votre espace en 2 minutes : ajoutez vos villes, vos produits et vos livreurs, puis recevez des commandes.</p>
      <form id="f">
        <div class="field"><label>Nom de l'entreprise</label><input name="company" required></div>
        <div class="row">
          <div class="field"><label>Votre nom</label><input name="name" required></div>
          <div class="field"><label>Téléphone</label><input name="phone" type="tel" required></div>
        </div>
        <div class="row">
          <div class="field"><label>Email</label><input name="email" type="email" required></div>
          <div class="field"><label>Mot de passe</label><input name="password" type="password" minlength="8" required></div>
        </div>
        <div class="row">
          <div class="field"><label>Offre</label><select name="plan">${plans.map((p) => `<option value="${p.id}" ${params.get('plan') === p.id ? 'selected' : ''}>${esc(p.label)} — ${money(p.price)}/mois</option>`).join('')}</select></div>
          <div class="field"><label>Devise</label><select name="currency"><option>FCFA</option><option>GNF</option><option>MAD</option><option>DZD</option><option>TND</option><option>CDF</option><option>EUR</option></select></div>
        </div>
        <button class="btn primary" style="width:100%">Créer mon espace distributeur</button>
      </form>
    </div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      setSession(await api('POST', '/api/tenants/signup', formData(e.target)));
      await loadMe();
      toast('Bienvenue ! Commencez par ajouter vos villes.');
      location.hash = '#/admin/zones';
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- Client : commander ----------
async function pageOrder(params) {
  const pageId = routeSeq;
  const u = state.me?.user;
  const cityId = params.get('ville') || state.cart.cityId || u?.city_id || '';
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `
    <div class="row between"><h1>Commander du gaz</h1>
      <select id="city" style="max-width:320px" aria-label="Ville"><option value="">Choisir une ville…</option>${cityOptions(cityId)}</select>
    </div>
    <div id="catalog" class="stack"></div>`;
  $('#city').addEventListener('change', (e) => { location.hash = `#/commander?ville=${e.target.value}`; });
  if (!cityId) { $('#catalog').innerHTML = '<div class="card empty">Sélectionnez votre ville pour voir les distributeurs disponibles.</div>'; return; }

  if (String(state.cart.cityId) !== String(cityId)) state.cart = { tenantId: null, cityId, items: {} };
  const providers = await api('GET', `/api/catalog?city_id=${cityId}`);
  if (pageId !== routeSeq) return;
  const box = $('#catalog');
  if (!providers.length) { box.innerHTML = '<div class="card empty">Aucun distributeur ne livre encore dans cette ville.</div>'; return; }

  const offersById = {};
  providers.forEach((p) => p.offers.forEach((o) => { offersById[o.offer_id] = { ...o, provider: p }; }));

  const draw = () => {
    box.innerHTML = providers.map((p) => `
      <div class="card">
        <div class="row between"><h2>${esc(p.name)}</h2>
          <span class="muted small">Livraison ${money(p.delivery_fee, p.currency)} · ~${p.min_delay_minutes} min</span></div>
        ${p.offers.map((o) => {
          const q = state.cart.tenantId === p.tenant_id ? (state.cart.items[o.offer_id] || 0) : 0;
          return `<div class="offer">
            <div><b>${esc(o.name)}</b> ${o.brand ? `<span class="muted">· ${esc(o.brand)}</span>` : ''}<br>
              <span class="small muted">${KIND[o.kind]}${o.in_stock ? '' : ' · <span style="color:var(--danger)">Rupture</span>'}</span></div>
            <div class="row"><span class="price">${money(o.price, p.currency)}</span>
              <span class="qty"><button data-dec="${o.offer_id}" aria-label="Retirer" ${q ? '' : 'disabled'}>−</button><span>${q}</span>
              <button data-inc="${o.offer_id}" aria-label="Ajouter" ${o.in_stock && q < o.stock ? '' : 'disabled'}>+</button></span></div>
          </div>`;
        }).join('')}
      </div>`).join('') + cartBar();
    $$('[data-inc]').forEach((b) => b.addEventListener('click', () => change(b.dataset.inc, 1)));
    $$('[data-dec]').forEach((b) => b.addEventListener('click', () => change(b.dataset.dec, -1)));
    $('#checkout')?.addEventListener('click', checkout);
  };

  const cartLines = () => Object.entries(state.cart.items).filter(([, q]) => q > 0).map(([id, q]) => ({ ...offersById[id], qty: q }));
  const cartBar = () => {
    const lines = cartLines();
    if (!lines.length) return '';
    const p = lines[0].provider;
    const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
    return `<div class="card cart-bar row between"><div><b>${lines.reduce((s, l) => s + l.qty, 0)} article(s)</b> chez ${esc(p.name)}<br>
      <span class="small muted">Sous-total ${money(sub, p.currency)} + livraison ${money(p.delivery_fee, p.currency)}</span></div>
      <button class="btn primary" id="checkout">Valider · ${money(sub + p.delivery_fee, p.currency)}</button></div>`;
  };

  const change = (offerId, delta) => {
    const o = offersById[offerId];
    if (state.cart.tenantId && state.cart.tenantId !== o.provider.tenant_id && delta > 0) {
      if (!confirm('Votre panier contient des produits d\'un autre distributeur. Le vider ?')) return;
      state.cart.items = {};
    }
    state.cart.tenantId = o.provider.tenant_id;
    state.cart.items[offerId] = Math.max(0, (state.cart.items[offerId] || 0) + delta);
    if (!Object.values(state.cart.items).some((q) => q > 0)) state.cart.tenantId = null;
    draw();
  };

  const checkout = () => {
    if (!state.me) { location.hash = `#/connexion?next=${encodeURIComponent(`#/commander?ville=${cityId}`)}`; return; }
    if (state.me.user.role !== 'customer') { toast('Connectez-vous avec un compte client pour commander.', true); return; }
    const lines = cartLines();
    const p = lines[0].provider;
    const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<form class="card" id="co">
      <h2>Finaliser la commande</h2>
      <p class="small muted">${lines.map((l) => `${l.qty} × ${esc(l.name)}`).join(', ')}</p>
      <div class="field"><label>Adresse de livraison (quartier, rue, repère)</label><textarea name="address" rows="2" required minlength="5"></textarea></div>
      <div class="row">
        <div class="field"><label>Téléphone</label><input name="phone" type="tel" value="${esc(state.me.user.phone)}" required></div>
        <div class="field"><label>Créneau</label><select name="slot">${Object.entries(SLOT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Paiement</label><select name="payment_method">${Object.entries(PAY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Instructions (facultatif)</label><input name="notes" placeholder="Ex. : apporter la bouteille vide en échange"></div>
      <div class="row between"><b>Total : ${money(sub + p.delivery_fee, p.currency)}</b>
        <div class="row"><button type="button" class="btn" id="cancel">Annuler</button><button class="btn primary">Confirmer la commande</button></div></div>
    </form>`;
    document.body.append(dlg);
    dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove());
    $('#cancel', dlg).addEventListener('click', () => dlg.close());
    $('#co', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const order = await api('POST', '/api/orders', {
          ...formData(e.target), tenant_id: p.tenant_id, city_id: Number(cityId),
          items: lines.map((l) => ({ offer_id: l.offer_id, qty: l.qty })),
        });
        state.cart = { tenantId: null, cityId: null, items: {} };
        dlg.close();
        toast(`Commande ${order.ref} enregistrée !`);
        location.hash = `#/commande/${order.id}`;
      } catch (err) { toast(err.message, true); }
    });
  };
  draw();
}

// ---------- Listes de commandes ----------
function ordersTable(orders, { showCustomer = false, showTenant = false } = {}) {
  if (!orders.length) return emptyBox('Aucune commande pour le moment.');
  return `<div class="table-wrap"><table class="cards"><thead><tr><th>Réf.</th><th>Date</th>${showTenant ? '<th>Distributeur</th>' : ''}${showCustomer ? '<th>Client</th>' : ''}
    <th>Ville</th><th class="hide-sm">Articles</th><th>Total</th><th>Statut</th>${showCustomer ? '<th class="hide-sm">Livreur</th>' : ''}</tr></thead><tbody>
    ${orders.map((o) => `<tr class="click" data-id="${o.id}"><td data-label="Réf."><b>${esc(o.ref)}</b></td><td data-label="Date" class="small">${date(o.created_at)}</td>
      ${showTenant ? `<td data-label="Distributeur">${esc(o.tenant_name)}</td>` : ''}${showCustomer ? `<td data-label="Client">${esc(o.customer_name)}<br><span class="small muted">${esc(o.phone)}</span></td>` : ''}
      <td data-label="Ville">${esc(o.city_name)}</td><td data-label="Articles" class="small hide-sm">${esc(o.summary)}</td><td data-label="Total" class="price">${money(o.total, o.currency)}</td>
      <td data-label="Statut">${badge(o.status, o.status_label)} ${payBadge(o.payment_status)}</td>
      ${showCustomer ? `<td data-label="Livreur" class="small hide-sm">${esc(o.driver_name || '—')}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}
const bindRows = () => $$('tr[data-id]').forEach((r) => r.addEventListener('click', () => { location.hash = `#/commande/${r.dataset.id}`; }));

async function pageMyOrders() {
  const pageId = routeSeq;
  const orders = await api('GET', '/api/orders');
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<div class="row between"><h1>Mes commandes</h1><a class="btn primary" href="#/commander">Nouvelle commande</a></div>
    <div class="sheet stagger">${orders.length ? orders.map(orderItem).join('') : emptyBox('Aucune commande pour le moment.')}</div>`;
}

// ---------- Détail d'une commande (tous rôles) ----------
async function pageOrderDetail(id) {
  const pageId = routeSeq;
  const o = await api('GET', `/api/orders/${id}`);
  const role = state.me.user.role;
  const step = o.status === 'annulee' ? -1 : FLOW.indexOf(o.status);
  const actions = [];
  if (role === 'customer' && ['en_attente', 'confirmee'].includes(o.status)) actions.push(['annulee', 'Annuler la commande', 'danger']);
  if (role === 'admin') {
    if (o.status === 'en_attente') actions.push(['confirmee', 'Confirmer', 'primary']);
    if (o.status === 'assignee') actions.push(['en_livraison', 'Marquer en livraison', '']);
    if (o.status === 'en_livraison') actions.push(['livree', 'Marquer livrée', 'ok']);
    if (['en_attente', 'confirmee', 'assignee', 'en_livraison'].includes(o.status)) actions.push(['annulee', 'Annuler', 'danger']);
  }
  if (role === 'driver') {
    if (o.status === 'assignee') actions.push(['en_livraison', 'Démarrer la livraison', 'primary']);
    if (o.status === 'en_livraison') actions.push(['livree', 'Confirmer la livraison', 'ok']);
  }
  let drivers = [];
  if (role === 'admin' && ['en_attente', 'confirmee', 'assignee'].includes(o.status)) {
    // Livreurs de la ville de la commande d'abord (puis « toutes villes »), les moins chargés en tête.
    const rank = (d) => (d.city_id === o.city_id ? 0 : d.city_id == null ? 1 : 2);
    drivers = (await api('GET', '/api/admin/drivers')).filter((d) => d.active)
      .sort((a, b) => rank(a) - rank(b) || a.active_orders - b.active_orders);
  }
  const maps = directions(o.lat, o.lng, `${o.address}, ${o.city_name}`);

  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `
    <a href="javascript:history.back()" class="small">← Retour</a>
    <div class="row between"><h1>Commande ${esc(o.ref)}</h1><div class="row">${badge(o.status, o.status_label)} ${payBadge(o.payment_status)}</div></div>
    ${step >= 0 ? `<div class="track" data-step="${step}" aria-label="Avancement : ${esc(o.status_label)}">
        <div class="rider">${Art.miniScooter()}</div><div class="rail"><div class="fill"></div></div>
        <div class="labels">${['Reçue', 'Confirmée', 'Livreur', 'En route', 'Livrée'].map((l, i) => `<span class="${i === step ? 'on' : ''}">${l}</span>`).join('')}</div>
      </div>` : ''}
    <div class="grid g2">
      <div class="card stack">
        <div><h3>${esc(SERVICE_LABEL[o.service] || 'Livraison')}</h3>
          ${SERVICE[o.service] ? `<div class="small muted">${SERVICE[o.service][2]}</div>` : ''}
          <div>${esc(o.address)}, <b>${esc(o.city_name)}</b></div>
          <div class="small muted">📞 <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a> · ${SLOT[o.slot] || esc(o.slot)} · <a href="${maps}" target="_blank" rel="noopener">Itinéraire</a></div>
          ${o.notes ? `<div class="small">📝 ${esc(o.notes)}</div>` : ''}
        </div>
        <div><h3>Articles</h3>
          ${o.items.map((i) => `<div class="row between"><span>${i.qty} × ${esc(i.product_name)}</span><span>${money(i.qty * i.unit_price, o.currency)}</span></div>`).join('')}
          <div class="row between muted"><span>Livraison</span><span>${money(o.delivery_fee, o.currency)}</span></div>
          <div class="row between"><b>Total</b><b>${money(o.total, o.currency)}</b></div>
          <div class="small muted">${PAY[o.payment_method]}</div>
        </div>
        <div class="small muted">Distributeur : ${esc(o.tenant_name)} · Client : ${esc(o.customer_name)}${o.driver_name ? ` · Livreur : ${esc(o.driver_name)} (<a href="tel:${esc(o.driver_phone)}">${esc(o.driver_phone)}</a>)` : ''}</div>
        ${drivers.length ? `<form id="assign" class="row"><select name="driver_id" style="flex:1">${drivers.map((d) => `<option value="${d.id}" ${d.id === o.driver_id ? 'selected' : ''}>${esc(d.name)} — ${esc(d.city_name || 'toutes villes')} (${d.active_orders} en cours)</option>`).join('')}</select><button class="btn primary">${o.driver_id ? 'Réassigner' : 'Assigner'}</button></form>` : ''}
        ${role === 'admin' && o.payment_status === 'en_attente' && o.status !== 'annulee' ? '<button class="btn sm" id="paid">Marquer comme payé</button>' : ''}
        ${actions.length ? `<div class="row">${actions.map(([s, l, c]) => `<button class="btn ${c}" data-status="${s}">${l}</button>`).join('')}</div>` : ''}
      </div>
      <div class="card"><h3>Suivi</h3><ul class="timeline">
        ${o.events.map((e) => `<li><b>${esc({ en_attente: 'Commande passée', confirmee: 'Confirmée', assignee: 'Livreur assigné', en_livraison: 'En route', livree: 'Livrée', annulee: 'Annulée' }[e.status] || e.status)}</b>
          <div class="small muted">${date(e.created_at)}${e.by_name ? ` · ${esc(e.by_name)}` : ''}</div>${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}</li>`).join('')}
      </ul></div>
    </div>`;
  // Le scooter avance jusqu'à l'étape courante.
  const track = $('.track');
  if (track) {
    const pct = (Number(track.dataset.step) / (FLOW.length - 1)) * 100;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $('.fill', track).style.width = `${pct}%`;
      $('.rider', track).style.left = `${pct}%`;
      $('.rider', track).style.transform = `translateX(-${pct}%)`; // reste dans la barre aux extrémités
    }));
  }
  $$('[data-status]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.status === 'annulee' && !confirm('Annuler cette commande ?')) return;
    try { await api('POST', `/api/orders/${o.id}/status`, { status: b.dataset.status }); toast('Statut mis à jour'); refresh(); } catch (e) { toast(e.message, true); }
  }));
  $('#assign')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', `/api/orders/${o.id}/assign`, formData(e.target)); toast('Livreur assigné'); refresh(); } catch (err) { toast(err.message, true); }
  });
  $('#paid')?.addEventListener('click', async () => { await api('POST', `/api/orders/${o.id}/paid`); toast('Paiement enregistré'); refresh(); });
  if (['en_attente', 'confirmee', 'assignee', 'en_livraison'].includes(o.status)) refreshTimer = setTimeout(refresh, 30000);
}

// ---------- Livreur ----------
async function pageDriver() {
  const pageId = routeSeq;
  const orders = await api('GET', '/api/orders');
  const open = orders.filter((o) => ['assignee', 'en_livraison'].includes(o.status));
  const done = orders.filter((o) => !['assignee', 'en_livraison'].includes(o.status));
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Mes livraisons</h1>
    <div class="stack stagger">${open.length ? open.map((o) => `
      <div class="card"><div class="row between"><b>${esc(o.ref)}</b>${badge(o.status, o.status_label)}</div>
        ${o.service && o.service !== 'livraison' ? `<div><b>${SERVICE[o.service][0]} ${SERVICE_LABEL[o.service]}</b></div>` : ''}
        <div>${esc(o.address)}, ${esc(o.city_name)}</div>
        <div class="small muted">${esc(o.summary)} · ${money(o.total, o.currency)} · ${PAY[o.payment_method]} · ${SLOT[o.slot]}</div>
        <div class="row" style="margin-top:10px">
          <a class="btn sm" href="tel:${esc(o.phone)}">📞 ${esc(o.customer_name)}</a>
          <a class="btn sm" target="_blank" rel="noopener" href="${directions(o.lat, o.lng, `${o.address}, ${o.city_name}`)}">🗺️ Itinéraire</a>
          ${o.status === 'assignee' ? `<button class="btn sm primary" data-go="${o.id}" data-s="en_livraison">Démarrer</button>` : `<button class="btn sm ok" data-go="${o.id}" data-s="livree">Livrée ✓</button>`}
          <a class="btn sm" href="#/commande/${o.id}">Détails</a>
        </div></div>`).join('') : `<div class="card">${emptyBox('Aucune livraison en attente. 🎉')}</div>`}
      <div class="card"><h2>Historique</h2>${ordersTable(done)}</div>
    </div>`;
  bindRows();
  $$('[data-go]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('POST', `/api/orders/${b.dataset.go}/status`, { status: b.dataset.s }); toast('Statut mis à jour'); refresh(); } catch (e) { toast(e.message, true); }
  }));
  refreshTimer = setTimeout(refresh, 20000);
}

// ---------- Distributeur ----------
async function pageAdminDashboard() {
  const pageId = routeSeq;
  const s = await api('GET', '/api/admin/stats');
  const cur = s.tenant.currency;
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `
    <div class="row between"><h1>${esc(s.tenant.name)}</h1><span class="muted">Offre ${esc(s.plan.label)}</span></div>
    <div class="grid g4">
      <div class="card kpi"><div class="v">${money(s.totals.revenue, cur)}</div><div class="l">Chiffre d'affaires livré</div></div>
      <div class="card kpi"><div class="v">${s.totals.orders || 0}</div><div class="l">Commandes</div></div>
      <div class="card kpi"><div class="v">${s.totals.open || 0}</div><div class="l">En cours</div></div>
      <div class="card kpi"><div class="v">${s.totals.delivered || 0}</div><div class="l">Livrées</div></div>
      <a class="card kpi" href="#/admin/demandes" style="text-decoration:none;color:inherit;${s.openRequests ? 'border-color:var(--primary)' : ''}">
        <div class="v">${s.openRequests}</div><div class="l">Demandes clients en attente →</div></a>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Par ville</h2>${s.byCity.length ? `<table><thead><tr><th>Ville</th><th>Commandes</th><th class="right">CA livré</th></tr></thead><tbody>
        ${s.byCity.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.orders}</td><td class="right">${money(c.revenue, cur)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Pas encore de commandes.</div>'}</div>
      <div class="card"><h2>⚠️ Stock bas</h2>${s.lowStock.length ? `<table><thead><tr><th>Produit</th><th>Ville</th><th class="right">Stock</th></tr></thead><tbody>
        ${s.lowStock.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.city_name)}</td><td class="right" style="color:var(--danger)"><b>${l.stock}</b></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Tous les stocks sont suffisants.</div>'}
        <a class="btn sm" href="#/admin/catalogue">Gérer le stock</a></div>
    </div>`;
}

async function pageAdminOrders(params) {
  const pageId = routeSeq;
  const status = params.get('statut') || '';
  const orders = await api('GET', `/api/orders${status ? `?status=${status}` : ''}`);
  const tabs = [['', 'Toutes'], ['en_attente', 'En attente'], ['confirmee', 'Confirmées'], ['assignee', 'Assignées'], ['en_livraison', 'En livraison'], ['livree', 'Livrées'], ['annulee', 'Annulées']];
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Commandes</h1>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${k === status ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
    <div class="card">${ordersTable(orders, { showCustomer: true })}</div>`;
  $$('[data-st]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/admin/commandes${b.dataset.st ? `?statut=${b.dataset.st}` : ''}`; }));
  bindRows();
  refreshTimer = setTimeout(refresh, 20000);
}

async function pageAdminCatalog() {
  const pageId = routeSeq;
  const [products, zones] = await Promise.all([api('GET', '/api/admin/products'), api('GET', '/api/admin/zones')]);
  const cur = state.me.tenant.currency;
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Catalogue, prix et stock</h1>
    ${!zones.length ? '<div class="card">Ajoutez d\'abord une ville dans <a href="#/admin/zones">Villes</a> pour définir vos prix.</div>' : ''}
    <div class="stack">
      ${products.map((p) => `<div class="card">
        <div class="row between"><div><b>${esc(p.name)}</b> <span class="muted small">${KIND[p.kind]}${p.brand ? ` · ${esc(p.brand)}` : ''}${p.weight_kg ? ` · ${p.weight_kg} kg` : ''}</span></div>
          <button class="btn sm" data-toggle="${p.id}" data-active="${p.active}">${p.active ? 'Désactiver' : 'Activer'}</button></div>
        <div class="table-wrap"><table><thead><tr><th>Ville</th><th>Prix (${esc(cur)})</th><th>Stock</th><th></th></tr></thead><tbody>
          ${zones.map((z) => {
            const o = p.offers.find((x) => x.city_id === z.city_id);
            return `<tr><td>${esc(z.name)}</td>
              <td><input type="number" min="0" value="${o ? o.price : ''}" data-price="${p.id}-${z.city_id}" placeholder="Non vendu" style="max-width:140px"></td>
              <td><input type="number" min="0" value="${o ? o.stock : 0}" data-stock="${p.id}-${z.city_id}" style="max-width:100px"></td>
              <td><button class="btn sm" data-save="${p.id}-${z.city_id}">Enregistrer</button></td></tr>`;
          }).join('')}
        </tbody></table></div></div>`).join('')}
      <form class="card" id="newp"><h2>Nouveau produit</h2>
        <div class="row">
          <div class="field"><label>Nom</label><input name="name" required placeholder="Recharge 12,5 kg"></div>
          <div class="field"><label>Type</label><select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="field"><label>Marque</label><input name="brand"></div>
          <div class="field"><label>Poids (kg)</label><input name="weight_kg" type="number" step="0.1" min="0"></div>
        </div>
        <button class="btn primary">Ajouter le produit</button>
      </form>
    </div>`;
  $$('[data-save]').forEach((b) => b.addEventListener('click', async () => {
    const [pid, cid] = b.dataset.save.split('-');
    const price = $(`[data-price="${b.dataset.save}"]`).value;
    if (price === '') { toast('Indiquez un prix', true); return; }
    try {
      await api('PUT', '/api/admin/offers', { product_id: Number(pid), city_id: Number(cid), price: Number(price), stock: Number($(`[data-stock="${b.dataset.save}"]`).value || 0) });
      toast('Prix et stock enregistrés');
    } catch (e) { toast(e.message, true); }
  }));
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    await api('PATCH', `/api/admin/products/${b.dataset.toggle}`, { active: b.dataset.active !== '1' }); refresh();
  }));
  $('#newp').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/admin/products', formData(e.target)); toast('Produit ajouté'); refresh(); } catch (err) { toast(err.message, true); }
  });
}

async function pageAdminZones() {
  const pageId = routeSeq;
  const zones = await api('GET', '/api/admin/zones');
  const plan = state.me.plan;
  const cur = state.me.tenant.currency;
  const taken = new Set(zones.map((z) => z.city_id));
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Villes desservies</h1>
    <p class="muted">${zones.length} / ${plan.maxCities ?? '∞'} ville(s) incluses dans votre offre ${esc(plan.label)}.</p>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Ville</th><th>Frais de livraison (${esc(cur)})</th><th>Délai (min)</th><th>Active</th><th></th></tr></thead><tbody>
      ${zones.map((z) => `<tr data-z="${z.city_id}"><td><b>${esc(z.name)}</b><br><span class="small muted">${esc(z.country)}</span></td>
        <td><input type="number" min="0" name="delivery_fee" value="${z.delivery_fee}" style="max-width:120px"></td>
        <td><input type="number" min="5" name="min_delay_minutes" value="${z.min_delay_minutes}" style="max-width:100px"></td>
        <td><input type="checkbox" name="active" ${z.active ? 'checked' : ''} style="width:auto"></td>
        <td><button class="btn sm" data-savez="${z.city_id}">Enregistrer</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Aucune ville pour le moment.</td></tr>'}
    </tbody></table></div></div>
    <form class="card" id="newz" style="margin-top:16px"><h2>Ajouter une ville</h2>
      <div class="row">
        <div class="field"><label>Ville existante</label><select name="city_id"><option value="">— Nouvelle ville —</option>${cityOptions(null, (c) => !taken.has(c.id))}</select></div>
        <div class="field"><label>… ou nouvelle ville</label><input name="city_name" placeholder="Nom"></div>
        <div class="field"><label>Pays</label><input name="country" placeholder="Pays"></div>
      </div>
      <div class="row">
        <div class="field"><label>Frais de livraison</label><input name="delivery_fee" type="number" min="0" value="1000" required></div>
        <div class="field"><label>Délai moyen (min)</label><input name="min_delay_minutes" type="number" min="5" value="60" required></div>
      </div>
      <button class="btn primary">Ajouter</button>
    </form>`;
  $$('[data-savez]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr');
    try {
      await api('POST', '/api/admin/zones', {
        city_id: Number(b.dataset.savez), delivery_fee: Number($('[name=delivery_fee]', tr).value),
        min_delay_minutes: Number($('[name=min_delay_minutes]', tr).value), active: $('[name=active]', tr).checked,
      });
      toast('Ville mise à jour');
    } catch (e) { toast(e.message, true); }
  }));
  $('#newz').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (!d.city_id) delete d.city_id;
    try { await api('POST', '/api/admin/zones', d); await loadCities(); toast('Ville ajoutée'); refresh(); } catch (err) { toast(err.message, true); }
  });
}

async function pageAdminDrivers() {
  const pageId = routeSeq;
  const [drivers, zones] = await Promise.all([api('GET', '/api/admin/drivers'), api('GET', '/api/admin/zones')]);
  const plan = state.me.plan;
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Livreurs</h1>
    <p class="muted">${drivers.filter((d) => d.active).length} / ${plan.maxDrivers ?? '∞'} livreur(s) actifs inclus dans votre offre.</p>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Nom</th><th>Contact</th><th>Ville</th><th>En cours</th><th>Livrées</th><th></th></tr></thead><tbody>
      ${drivers.map((d) => `<tr><td><b>${esc(d.name)}</b>${d.active ? '' : ' <span class="badge s-annulee">Inactif</span>'}</td>
        <td class="small">${esc(d.email)}<br>${esc(d.phone)}</td><td>${esc(d.city_name || 'Toutes')}</td><td>${d.active_orders}</td><td>${d.delivered}</td>
        <td><button class="btn sm" data-d="${d.id}" data-a="${d.active}">${d.active ? 'Désactiver' : 'Réactiver'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucun livreur.</td></tr>'}
    </tbody></table></div></div>
    <form class="card" id="newd" style="margin-top:16px"><h2>Ajouter un livreur</h2>
      <div class="row">
        <div class="field"><label>Nom</label><input name="name" required></div>
        <div class="field"><label>Téléphone</label><input name="phone" type="tel" required></div>
        <div class="field"><label>Ville</label><select name="city_id"><option value="">Toutes</option>${zones.map((z) => `<option value="${z.city_id}">${esc(z.name)}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Email (identifiant)</label><input name="email" type="email" required></div>
        <div class="field"><label>Mot de passe initial</label><input name="password" minlength="8" required></div>
      </div>
      <button class="btn primary">Créer le compte livreur</button>
    </form>`;
  $$('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('PATCH', `/api/admin/drivers/${b.dataset.d}`, { active: b.dataset.a !== '1' }); refresh(); } catch (e) { toast(e.message, true); }
  }));
  $('#newd').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (!d.city_id) delete d.city_id;
    try { await api('POST', '/api/admin/drivers', d); toast('Livreur créé'); refresh(); } catch (err) { toast(err.message, true); }
  });
}

async function pageAdminPlan() {
  const pageId = routeSeq;
  const plans = await api('GET', '/api/plans');
  const current = state.me.tenant.plan;
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Abonnement</h1><p class="muted">Changez d'offre à tout moment. La facturation est mensuelle.</p>
    <div class="grid g3">${plans.map((p) => `<div class="card plan ${p.id === current ? 'featured' : ''}">
      <h3>${esc(p.label)}</h3><div class="price">${money(p.price)}<span class="small muted"> /mois</span></div>
      <p class="muted">${p.maxCities ? `${p.maxCities} ville(s)` : 'Villes illimitées'} · ${p.maxDrivers ? `${p.maxDrivers} livreurs` : 'Livreurs illimités'}</p>
      ${p.id === current ? '<span class="badge s-livree">Offre actuelle</span>' : `<button class="btn" data-plan="${p.id}">Passer à ${esc(p.label)}</button>`}
    </div>`).join('')}</div>`;
  $$('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('PATCH', '/api/admin/plan', { plan: b.dataset.plan }); await loadMe(); toast('Offre mise à jour'); refresh(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Opérateur plateforme ----------
async function pagePlatform() {
  const pageId = routeSeq;
  const [tenants, plans] = await Promise.all([api('GET', '/api/platform/tenants'), api('GET', '/api/plans')]);
  const active = tenants.filter((t) => t.active);
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Plateforme FasoGaz</h1>
    <div class="grid g4">
      <div class="card kpi"><div class="v">${active.length}</div><div class="l">Distributeurs actifs</div></div>
      <div class="card kpi"><div class="v">${money(active.reduce((s, t) => s + t.mrr, 0))}</div><div class="l">Revenu mensuel (MRR)</div></div>
      <div class="card kpi"><div class="v">${tenants.reduce((s, t) => s + t.orders, 0)}</div><div class="l">Commandes totales</div></div>
      <div class="card kpi"><div class="v">${state.cities.filter((c) => c.providers > 0).length}</div><div class="l">Villes couvertes</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Distributeurs</h2><div class="table-wrap"><table><thead><tr><th>Entreprise</th><th>Offre</th><th>Villes</th><th>Livreurs</th><th>Commandes</th><th>Volume livré</th><th></th></tr></thead><tbody>
      ${tenants.map((t) => `<tr><td><b>${esc(t.name)}</b><br><span class="small muted">depuis le ${date(t.created_at).split(' ')[0]}</span></td>
        <td><select data-plan="${t.id}" style="max-width:150px">${plans.map((p) => `<option value="${p.id}" ${p.id === t.plan ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></td>
        <td>${t.cities}</td><td>${t.drivers}</td><td>${t.orders}</td><td>${money(t.gmv, t.currency)}</td>
        <td><button class="btn sm ${t.active ? 'danger' : 'ok'}" data-act="${t.id}" data-a="${t.active}">${t.active ? 'Suspendre' : 'Réactiver'}</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
  $$('[data-plan]').forEach((s) => s.addEventListener('change', async () => {
    await api('PATCH', `/api/platform/tenants/${s.dataset.plan}`, { plan: s.value }); toast('Offre modifiée'); refresh();
  }));
  $$('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    await api('PATCH', `/api/platform/tenants/${b.dataset.act}`, { active: b.dataset.a !== '1' }); await loadCities(); refresh();
  }));
}

// ---------- Client : demandes ----------
const REQ_STATUS = { ouverte: 'En attente', acceptee: 'Prise en charge', annulee: 'Annulée' };
const wantLabel = (r) => `${SERVICE[r.service][0]} ${SERVICE_LABEL[r.service]}${r.brand ? ` · ${esc(r.brand)}` : ''}${r.weight_kg ? ` ${String(r.weight_kg).replace('.', ',')} kg` : ''} × ${r.qty}`;

function requestCard(r) {
  const live = r.status === 'acceptee' && !['livree', 'annulee'].includes(r.order_status);
  return `<div class="card req ${r.status}">
    <div class="row between"><b>${wantLabel(r)}</b>
      <span class="badge s-${r.status === 'acceptee' && r.order_status ? esc(r.order_status) : esc(r.status)}">${esc(r.status === 'acceptee' && r.order_status_label ? r.order_status_label : REQ_STATUS[r.status])}</span></div>
    <div class="small muted">${esc(r.address)}, ${esc(r.city_name)} · ${ago(r.created_at)}</div>
    ${r.status === 'ouverte' ? `<p><span class="pulse"></span>Les distributeurs de ${esc(r.city_name)} ont reçu votre demande. Vous serez contacté dès que l'un d'eux la prend.</p>
      <button class="btn sm danger" data-cancel="${r.id}">Annuler la demande</button>` : ''}
    ${r.status === 'acceptee' ? `<p>✅ Prise en charge par <b>${esc(r.tenant_name)}</b>${r.order_total ? ` · ${money(r.order_total, r.currency)}` : ''}</p>
      ${r.driver_name ? `<p class="small">🛵 Livreur : <b>${esc(r.driver_name)}</b></p>` : ''}
      <div class="actions">
        ${r.tenant_phone ? `<a class="btn sm" href="tel:${esc(r.tenant_phone)}">📞 Appeler ${esc(r.tenant_name)}</a>` : ''}
        ${r.driver_phone && live ? `<a class="btn sm" href="tel:${esc(r.driver_phone)}">📞 Appeler le livreur</a>` : ''}
        <a class="btn sm primary" href="#/commande/${r.order_id}">Suivre la livraison</a>
      </div>` : ''}
  </div>`;
}

async function pageRequest(params) {
  const pageId = routeSeq;
  const role = state.me?.user.role;
  const draft = readStore('gf_req_draft') || {};
  const brands = await api('GET', '/api/brands');
  const cityId = params.get('ville') || draft.city_id || state.me?.user.city_id || '';
  let pos = draft.lat != null && draft.lat !== '' ? { lat: draft.lat, lng: draft.lng } : state.pos;
  const service = SERVICE[params.get('service')] ? params.get('service') : (draft.service || 'echange');
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `
    <div class="grid g2" style="align-items:start">
      <form class="card" id="rf">
        <h1>Faire une demande</h1>
        <p class="muted small">Votre demande est envoyée à tous les distributeurs de votre ville. Le premier qui l'accepte vous contacte et organise la livraison.</p>
        ${draft.address && role ? '<p class="badge s-en_attente">Votre demande est prête : vérifiez-la puis envoyez-la.</p>' : ''}
        <label>Que voulez-vous ?</label>
        <div class="choices">${Object.entries(SERVICE).map(([k, [ic, l, d]]) => `<label class="choice"><input type="radio" name="service" value="${k}" ${service === k ? 'checked' : ''}>
          <b>${ic} ${l}</b><span class="small muted">${d}</span></label>`).join('')}</div>
        <div class="row">
          <div class="field"><label for="rb">Marque</label><input id="rb" name="brand" list="brandlist" value="${esc(params.get('marque') || draft.brand || '')}" placeholder="Sodigaz, Oryx, Total…">
            <datalist id="brandlist">${brands.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
          <div class="field"><label for="rw">Taille</label><select id="rw" name="weight_kg"><option value="">Je ne sais pas</option>
            ${[3, 6, 12.5, 35].map((w) => `<option value="${w}" ${String(draft.weight_kg) === String(w) ? 'selected' : ''}>${String(w).replace('.', ',')} kg</option>`).join('')}</select></div>
          <div class="field" style="flex:0 1 90px"><label for="rq">Quantité</label><input id="rq" name="qty" type="number" min="1" max="20" value="${esc(draft.qty || 1)}"></div>
        </div>
        <div class="field"><label for="rc">Ville</label><select id="rc" name="city_id" required><option value="">Choisir…</option>${cityOptions(cityId, (c) => c.providers > 0)}</select></div>
        <div class="field"><label for="ra">Adresse (quartier, rue, point de repère)</label><textarea id="ra" name="address" rows="2" required minlength="5">${esc(draft.address || '')}</textarea></div>
        <div class="row between" style="margin-bottom:12px"><button type="button" class="btn sm" id="rgeo">📍 Ajouter ma position GPS</button><span class="small" id="rgeonote"></span></div>
        <div class="row">
          <div class="field"><label for="rp">Téléphone</label><input id="rp" name="phone" type="tel" value="${esc(draft.phone || state.me?.user.phone || '')}" required></div>
          <div class="field"><label for="rm">Paiement</label><select id="rm" name="payment_method">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${draft.payment_method === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="rn">Précisions (facultatif)</label><input id="rn" name="notes" value="${esc(draft.notes || '')}" placeholder="Ex. : portail bleu, demander Mme Ouédraogo"></div>
        <button class="btn primary" style="width:100%">Envoyer ma demande</button>
        ${role ? '' : '<p class="small muted">Il faudra vous connecter ou créer un compte (30 secondes) : votre demande sera conservée.</p>'}
      </form>
      <div><h2>Mes demandes</h2><div id="reqlist" class="stack">${role ? '' : '<div class="card empty">Connectez-vous pour suivre vos demandes.</div>'}</div></div>
    </div>`;

  const geoNote = () => { $('#rgeonote').textContent = pos ? '✓ Position GPS ajoutée' : 'Aide le distributeur le plus proche à vous trouver'; };
  geoNote();
  $('#rgeo').addEventListener('click', async () => {
    try { pos = await locate(); geoNote(); } catch (e) { toast(e.message, true); }
  });

  $('#rf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { ...formData(e.target), ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) };
    if (!role) {
      writeStore('gf_req_draft', data);
      toast('Connectez-vous ou créez un compte pour envoyer votre demande');
      location.hash = `#/connexion?tab=register&next=${encodeURIComponent('#/demande')}`;
      return;
    }
    try {
      const r = await api('POST', '/api/requests', data);
      writeStore('gf_req_draft', null);
      toast(`Demande envoyée aux distributeurs de ${r.city_name}`);
      e.target.reset();
      $('#ra').value = '';
      refreshList();
    } catch (err) { toast(err.message, true); }
  });

  async function refreshList() {
    clearTimeout(refreshTimer);
    if (!role || pageId !== routeSeq) return;
    const mine = await api('GET', '/api/requests');
    const box = $('#reqlist');
    if (!box || pageId !== routeSeq) return;
    box.innerHTML = mine.length ? mine.map(requestCard).join('') : `<div class="card">${emptyBox('Aucune demande pour le moment.')}</div>`;
    $$('[data-cancel]', box).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Annuler cette demande ?')) return;
      try { await api('POST', `/api/requests/${b.dataset.cancel}/cancel`); toast('Demande annulée'); refreshList(); } catch (err) { toast(err.message, true); }
    }));
    // Mise à jour automatique tant qu'une demande attend ou qu'une livraison est en cours.
    if (mine.some((r) => r.status === 'ouverte' || (r.status === 'acceptee' && !['livree', 'annulee'].includes(r.order_status)))) {
      refreshTimer = setTimeout(refreshList, 15000);
    }
  }
  refreshList();
}

// ---------- Distributeur : demandes des clients ----------
async function pageAdminRequests() {
  const pageId = routeSeq;
  const { open, accepted } = await api('GET', '/api/requests');
  const cur = state.me.tenant.currency;
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Demandes des clients</h1>
    <p class="muted">Demandes publiées dans vos villes ces dernières 48 h, les plus proches de vos points de vente en premier. Le premier distributeur qui accepte obtient la commande et les coordonnées du client.</p>
    <div class="stack stagger">${open.length ? open.map((r) => {
      const usable = r.options.filter((o) => o.stock >= r.qty);
      return `<div class="card req ouverte">
        <div class="row between"><b>${wantLabel(r)}</b><span class="small muted">${ago(r.created_at)}</span></div>
        <div>${esc(r.customer_name)} · ${esc(r.address)}, <b>${esc(r.city_name)}</b></div>
        <div class="small muted">${r.nearest_point ? `📍 À <b>${km(r.nearest_point.distance_km)}</b> de ${esc(r.nearest_point.name)}` : 'Position GPS non fournie'} · ${PAY[r.payment_method]}${r.notes ? ` · 📝 ${esc(r.notes)}` : ''}</div>
        ${usable.length ? `<form class="row" data-accept="${r.id}" style="margin-top:10px">
          <select name="offer_id" style="flex:1" aria-label="Produit proposé">${usable.map((o) => `<option value="${o.offer_id}">${o.match ? '✓ ' : ''}${esc(o.label)} — ${money(o.price * r.qty, cur)} (stock ${o.stock})</option>`).join('')}</select>
          <button class="btn primary">Prendre la demande</button></form>`
        : '<p class="small" style="color:var(--danger)">Aucun produit adapté en stock dans cette ville.</p>'}
      </div>`;
    }).join('') : `<div class="card">${emptyBox('Aucune demande en attente dans vos villes.<br>Cette page se met à jour toute seule.')}</div>`}</div>
    <h2 style="margin-top:24px">Demandes que vous avez prises</h2>
    <div class="card">${accepted.length ? `<div class="table-wrap"><table><thead><tr><th>Quand</th><th>Demande</th><th>Client</th><th>Commande</th></tr></thead><tbody>
      ${accepted.map((r) => `<tr class="click" data-id="${r.order_id}"><td class="small">${ago(r.created_at)}</td><td>${wantLabel(r)}</td>
        <td>${esc(r.customer_name)}<br><span class="small muted">${esc(r.phone)}</span></td>
        <td><b>${esc(r.order_ref || '')}</b><br>${r.order_status ? badge(r.order_status, r.order_status_label) : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Aucune pour le moment.</div>'}</div>`;
  bindRows();
  $$('[data-accept]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const order = await api('POST', `/api/requests/${f.dataset.accept}/accept`, formData(f));
      toast('Demande prise ! Assignez maintenant un livreur.');
      location.hash = `#/commande/${order.id}`;
    } catch (err) { toast(err.message, true); refresh(); }
  }));
  refreshTimer = setTimeout(refresh, 30000);
}

// ---------- Distributeur : points de vente ----------
async function pageAdminPoints() {
  const pageId = routeSeq;
  const [points, zones] = await Promise.all([api('GET', '/api/admin/points'), api('GET', '/api/admin/zones')]);
  if (pageId !== routeSeq) return; // page quittée entre-temps
  view.innerHTML = `<h1>Points de vente</h1>
    <p class="muted">Vos dépôts apparaissent dans la recherche des clients, avec les marques que vous vendez dans la ville, vos prix et la distance.</p>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Point</th><th>Ville</th><th class="hide-sm">Horaires</th><th class="hide-sm">GPS</th><th></th></tr></thead><tbody>
      ${points.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="badge s-annulee">Masqué</span>'}<br><span class="small muted">${esc(p.address)}${p.phone ? ` · ${esc(p.phone)}` : ''}</span></td>
        <td>${esc(p.city_name)}</td><td class="small hide-sm">${esc(p.hours || '—')}</td>
        <td class="small hide-sm"><a target="_blank" rel="noopener" href="${directions(p.lat, p.lng)}">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</a></td>
        <td class="row"><button class="btn sm" data-pt="${p.id}" data-a="${p.active}">${p.active ? 'Masquer' : 'Afficher'}</button>
          <button class="btn sm danger" data-del="${p.id}">Supprimer</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Aucun point de vente : ajoutez-en un pour apparaître dans la recherche.</td></tr>'}
    </tbody></table></div></div>
    <form class="card" id="newpt" style="margin-top:16px"><h2>Ajouter un point de vente</h2>
      ${zones.length ? '' : '<p>Ajoutez d\'abord une ville dans <a href="#/admin/zones">Villes</a>.</p>'}
      <div class="row">
        <div class="field"><label for="pc">Ville</label><select id="pc" name="city_id" required>${zones.map((z) => `<option value="${z.city_id}">${esc(z.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="pn">Nom</label><input id="pn" name="name" required placeholder="Dépôt Ouaga 2000"></div>
        <div class="field"><label for="pp">Téléphone</label><input id="pp" name="phone" type="tel"></div>
        <div class="field"><label for="ph">Horaires</label><input id="ph" name="hours" placeholder="7h – 21h"></div>
      </div>
      <div class="field"><label for="pa">Adresse</label><input id="pa" name="address" required placeholder="Quartier, rue, repère"></div>
      <p class="small muted">Cliquez sur la carte pour placer le point, ou utilisez votre position si vous êtes sur place.</p>
      <div id="pickmap" class="pickmap"></div>
      <div class="row">
        <div class="field"><label for="plat">Latitude</label><input id="plat" name="lat" type="number" step="any" required></div>
        <div class="field"><label for="plng">Longitude</label><input id="plng" name="lng" type="number" step="any" required></div>
        <button type="button" class="btn" id="pgeo" style="align-self:end;margin-bottom:12px">📍 Ma position</button>
      </div>
      <button class="btn primary">Ajouter le point de vente</button>
    </form>`;

  let pick = null;
  let map = null;
  const place = (lat, lng, pan = true) => {
    $('#plat').value = Math.round(lat * 1e5) / 1e5;
    $('#plng').value = Math.round(lng * 1e5) / 1e5;
    if (!map) return;
    if (pick) pick.setLatLng([lat, lng]); else pick = L.marker([lat, lng]).addTo(map);
    if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  };
  if (typeof window.L !== 'undefined') {
    map = L.map('pickmap').setView(BF_CENTER, 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    for (const p of points) L.circleMarker([p.lat, p.lng], { radius: 6, color: '#e8590c' }).addTo(map).bindTooltip(p.name);
    const centerOnCity = () => {
      const here = points.filter((p) => String(p.city_id) === $('#pc').value);
      if (here.length) map.fitBounds(here.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 14 });
      else if (state.pos) map.setView([state.pos.lat, state.pos.lng], 13);
    };
    centerOnCity();
    $('#pc').addEventListener('change', centerOnCity);
    map.on('click', (e) => place(e.latlng.lat, e.latlng.lng, false));
  } else {
    $('#pickmap').style.display = 'none';
  }
  $('#pgeo').addEventListener('click', async () => {
    try { const p = await locate(); place(p.lat, p.lng); } catch (e) { toast(e.message, true); }
  });
  $('#newpt').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/admin/points', formData(e.target)); toast('Point de vente ajouté'); refresh(); } catch (err) { toast(err.message, true); }
  });
  $$('[data-pt]').forEach((b) => b.addEventListener('click', async () => {
    await api('PATCH', `/api/admin/points/${b.dataset.pt}`, { active: b.dataset.a !== '1' }); refresh();
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Supprimer ce point de vente ?')) return;
    await api('DELETE', `/api/admin/points/${b.dataset.del}`); toast('Point supprimé'); refresh();
  }));
}

// ---------- Routeur ----------
async function loadMe() {
  state.me = state.token ? await api('GET', '/api/me').catch(() => null) : null;
  renderNav();
}
async function loadCities() { state.cities = await api('GET', '/api/cities'); }

/** Recharge la page courante sans transition (mises à jour automatiques, après une action). */
const refresh = () => route(true);

async function route(quiet = false) {
  clearTimeout(refreshTimer);
  routeSeq++;
  const seq = routeSeq;
  document.body.classList.toggle('menu-open', false);
  $('#burger')?.setAttribute('aria-expanded', 'false');
  if (!quiet) {
    view.className = 'container';
    view.innerHTML = SKELETON;
    window.scrollTo(0, 0);
  }
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const role = state.me?.user.role;
  renderNav();
  const guard = (...roles) => {
    if (!role) { location.hash = `#/connexion?next=${encodeURIComponent(location.hash)}`; return false; }
    if (roles.length && !roles.includes(role)) { location.hash = homeFor(role); return false; }
    return true;
  };
  window.leaveFlow?.();
  try {
    // Sur téléphone, l'accueil est le parcours pas-à-pas ; « #/carte » donne la recherche complète.
    const isPhone = window.matchMedia('(max-width: 820px)').matches;
    if (path === '/parcours' || (path === '/' && isPhone && (!role || role === 'customer'))) {
      return (!role || role === 'customer') ? await window.pageFlow() : (location.hash = homeFor(role));
    }
    if (path === '/carte') return (!role || role === 'customer') ? await pageSearch(params) : (location.hash = homeFor(role));
    if (path === '/') return (!role || role === 'customer') ? await pageSearch(params) : (location.hash = homeFor(role));
    if (path === '/demande') return (!role || role === 'customer') ? await pageRequest(params) : guard('customer');
    if (path === '/admin/demandes') return guard('admin') && await pageAdminRequests();
    if (path === '/admin/points') return guard('admin') && await pageAdminPoints();
    if (path === '/connexion') return pageLogin(params);
    if (path === '/devenir-distributeur') return await pageTenantSignup(params);
    if (path === '/commander') return (!role || role === 'customer') ? await pageOrder(params) : guard('customer');
    if (path === '/commandes') return guard('customer') && await pageMyOrders();
    if (path.startsWith('/commande/')) return guard() && await pageOrderDetail(path.split('/')[2]);
    if (path === '/livraisons') return guard('driver') && await pageDriver();
    if (path === '/admin') return guard('admin') && await pageAdminDashboard();
    if (path === '/admin/commandes') return guard('admin') && await pageAdminOrders(params);
    if (path === '/admin/catalogue') return guard('admin') && await pageAdminCatalog();
    if (path === '/admin/zones') return guard('admin') && await pageAdminZones();
    if (path === '/admin/livreurs') return guard('admin') && await pageAdminDrivers();
    if (path === '/admin/abonnement') return guard('admin') && await pageAdminPlan();
    if (path === '/plateforme') return guard('superadmin') && await pagePlatform();
    view.innerHTML = `<div class="card">${emptyBox('Page introuvable. <a href="#/">Retour à l’accueil</a>')}</div>`;
  } catch (e) {
    if (seq === routeSeq) view.innerHTML = `<div class="card">${emptyBox(esc(e.message))}</div>`;
  } finally {
    if (seq === routeSeq) { if (quiet) observeMotion(); else enterPage(); }
  }
}

window.addEventListener('hashchange', () => route());
$('#burger')?.addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  $('#burger').setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.toggle('menu-open', false); });
(async () => {
  await Promise.all([loadCities(), loadMe()]);
  route();
})();
