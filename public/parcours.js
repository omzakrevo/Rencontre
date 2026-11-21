'use strict';
/*
 * FasoGaz — application mobile (parcours pas-à-pas, « swipe ») :
 * présentation → ville → marque → bouteille → service → résultat → détails → confirmation,
 * plus « Mes commandes », « Suivi de commande » et « Connexion », dans le même design.
 * Utilise les utilitaires globaux de app.js ($, esc, api, state, money, locate, directions, km, toast, setSession, loadMe, logout, homeFor).
 */
(() => {
  const KEY = 'fg_flow';
  const INTRO_KEY = 'fg_intro_seen';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const STEPS = ['intro', 'city', 'brand', 'size', 'service', 'result', 'details', 'done'];
  const PROGRESS = ['city', 'brand', 'size', 'service', 'result', 'details'];

  const SERVICES = [
    { id: 'depot', icon: 'pin', title: 'Dépôt le plus proche', text: 'Je vais chercher mon gaz moi-même. Voir les dépôts sur la carte.' },
    { id: 'livraison', icon: 'truck', title: 'Me faire livrer', text: 'Un livreur m’apporte une bouteille pleine et reprend ma vide.' },
    { id: 'collecte', icon: 'refresh', title: 'Recharger ma bouteille', text: 'Un livreur récupère ma bouteille, la recharge et me la ramène.' },
    { id: 'achat', icon: 'plus', title: 'Acheter une bouteille neuve', text: 'Je n’ai pas de bouteille : j’en achète une, livrée chez moi.' },
  ];

  // ---------- Photos réelles des bouteilles (détourées, non déformées) ----------
  const PHOTO = { Sodigaz: 'sodigaz', Oryx: 'oryx-19kg', Total: 'total', TotalEnergies: 'total', Shell: 'shell' };
  const ORYX_SIZES = [3, 6, 9, 19, 48];
  const BRAND_TINT = { Sodigaz: '#1f5fc4', Oryx: '#d9261c', Total: '#f26a14', TotalEnergies: '#f26a14', Shell: '#1d63b8' };
  const tint = (b) => BRAND_TINT[b] || '#1859c9';
  function photoFor(brand, kg) {
    if (brand === 'Oryx' && kg) {
      // 12,5 kg a la forme haute (comme la 19 kg) ; en dessous, les formes trapues.
      const best = kg >= 11 && kg < 30 ? 19 : ORYX_SIZES.reduce((a, b) => (Math.abs(b - kg) < Math.abs(a - kg) ? b : a));
      return `/img/bouteilles/oryx-${best}kg.webp`;
    }
    return `/img/bouteilles/${PHOTO[brand] || 'sodigaz'}.webp`;
  }
  /** Marque et poids retrouvés dans un libellé (« 1 × Recharge 12,5 kg Oryx »). */
  const guessBottle = (text) => {
    const t = String(text || '');
    const brand = Object.keys(PHOTO).find((b) => t.toLowerCase().includes(b.toLowerCase())) || null;
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
    return [brand, m ? Number(m[1].replace(',', '.')) : null];
  };
  const bottleImg = (brand, kg, cls = '') => `<img class="fx-photo ${cls}" src="${photoFor(brand, kg)}"
    alt="Bouteille ${esc(brand || 'de gaz')}${kg ? ` ${String(kg).replace('.', ',')} kg` : ''}" decoding="async" draggable="false">`;

  // Pictogrammes d'interface (traits fins, pas d'émoticônes).
  const ICONS = {
    pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>',
    truck: '<path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
    plus: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    route: '<path d="M6 19a3 3 0 1 0 0-6h12a3 3 0 1 0 0-6H8"/><circle cx="6" cy="19" r="1"/><circle cx="8" cy="7" r="1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
    store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-5.3 2 3 3 0 0 1-5.4 0A3 3 0 0 1 4 11z"/><path d="M5 13v7h14v-7"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    check: '<path d="M5 12l5 5 9-9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  const ic = (name, size = 22) => `<svg class="fx-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const ORDER_STEPS = [
    ['en_attente', 'Commande reçue'], ['confirmee', 'Confirmée par le dépôt'], ['assignee', 'Livreur trouvé'],
    ['en_livraison', 'En route vers vous'], ['livree', 'Livrée'],
  ];
  const STATUS_TONE = { en_attente: 'wait', confirmee: 'info', assignee: 'info', en_livraison: 'go', livree: 'ok', annulee: 'off' };
  const REQ_LABEL = { ouverte: 'En attente d’un distributeur', acceptee: 'Prise en charge', annulee: 'Annulée' };

  let flow = null; // choix du parcours (persistés)
  let current = null; // écran affiché
  let stack = []; // historique des écrans pour « retour »
  let root = null;
  let busy = false;
  let trackTimer = null;
  let cache = { cityId: null, catalog: null, brands: null };
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

  const persist = () => save(KEY, flow);
  const city = () => state.cities.find((c) => c.id === flow.cityId);
  const shortDate = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function catalog() {
    if (cache.cityId !== flow.cityId || !cache.catalog) {
      const [cat, brands] = await Promise.all([
        api('GET', `/api/catalog?city_id=${flow.cityId}`),
        api('GET', `/api/brands?city_id=${flow.cityId}`),
      ]);
      cache = { cityId: flow.cityId, catalog: cat, brands };
    }
    return cache;
  }
  function matchingOffers(cat, kinds) {
    const out = [];
    for (const t of cat) {
      for (const o of t.offers) {
        if (!kinds.includes(o.kind)) continue;
        if (flow.brand && o.brand && o.brand !== flow.brand) continue;
        if (flow.weight && Number(o.weight_kg) !== Number(flow.weight)) continue;
        out.push({ ...o, tenant: t });
      }
    }
    return out.sort((a, b) => (b.in_stock - a.in_stock) || (a.price + a.tenant.delivery_fee) - (b.price + b.tenant.delivery_fee));
  }

  // ---------- Coquille de l'application ----------
  function shell() {
    document.body.classList.add('flow-mode');
    view.className = 'flow-view';
    view.innerHTML = `
      <div class="fx" id="fx">
        <div class="fx-bg" aria-hidden="true"><i></i><i></i><i></i></div>
        <header class="fx-head">
          <button class="fx-icon-btn" id="fx-back" type="button" aria-label="Retour">${ic('back')}</button>
          <div class="fx-progress" aria-hidden="true"><i id="fx-bar"></i></div>
          <button class="fx-icon-btn" id="fx-menu" type="button" aria-label="Menu" aria-haspopup="dialog">${ic('menu')}</button>
        </header>
        <div class="fx-stage" id="fx-stage" aria-live="polite"></div>
        <div class="fx-sheet" id="fx-sheet" hidden>
          <div class="fx-sheet-backdrop" data-close></div>
          <div class="fx-sheet-panel" role="dialog" aria-modal="true" aria-label="Menu">
            <span class="fx-sheet-grip" aria-hidden="true"></span>
            <div id="fx-sheet-body"></div>
          </div>
        </div>
      </div>`;
    root = $('#fx-stage');
    $('#fx-back').addEventListener('click', back);
    $('#fx-menu').addEventListener('click', openMenu);
    $('#fx-sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeMenu(); });
    bindSwipe($('#fx'));
    bindRipple($('#fx'));
  }

  function setChrome() {
    const i = PROGRESS.indexOf(current);
    const linear = STEPS.includes(current);
    const pct = current === 'done' ? 100 : i < 0 ? 0 : ((i + 1) / (PROGRESS.length + 1)) * 100;
    $('#fx-bar').style.width = `${pct}%`;
    const noBack = ['intro', 'done'].includes(current) || (!linear && !stack.length && current !== 'track');
    $('#fx-back').style.visibility = noBack && current !== 'orders' && current !== 'login' ? 'hidden' : 'visible';
    document.querySelector('.fx-head').classList.toggle('no-progress', current === 'intro' || !linear);
  }

  /** Affiche un écran avec une transition glissée (dir = 1 en avant, -1 en arrière). */
  async function show(step, dir = 1, arg) {
    if (busy) return;
    busy = true;
    clearInterval(trackTimer);
    if (current && current !== step && dir > 0) stack.push(current);
    current = step;
    if (STEPS.includes(step)) { flow.step = step; persist(); }
    if (arg !== undefined) flow.arg = arg;
    setChrome();
    const html = await RENDER[step](flow.arg).catch((e) => `<section class="fx-step"><div class="fx-empty"><p>${esc(e.message)}</p>
      <button class="fx-btn fx-btn-primary" type="button" data-retry>Réessayer</button></div></section>`);
    const old = root.firstElementChild;
    const tpl = document.createElement('div');
    tpl.innerHTML = html.trim();
    const next = tpl.firstElementChild;
    next.querySelectorAll('.fx-stagger > *').forEach((el, i) => el.style.setProperty('--i', i));
    next.querySelector('[data-retry]')?.addEventListener('click', () => { busy = false; current = null; show(step, 1, arg); });
    if (old && !reduced()) {
      old.classList.add(dir > 0 ? 'fx-out-left' : 'fx-out-right');
      next.classList.add(dir > 0 ? 'fx-in-right' : 'fx-in-left');
      root.appendChild(next);
      setTimeout(() => old.remove(), 380);
    } else {
      root.innerHTML = '';
      root.appendChild(next);
    }
    (BIND[step] || (() => {}))(next, flow.arg);
    next.querySelector('h1')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
    setTimeout(() => { busy = false; }, reduced() ? 0 : 240);
  }

  const go = (step, arg) => show(step, 1, arg);
  function back() {
    if (busy) return;
    if (stack.length) { show(stack.pop(), -1); return; }
    const prev = {
      city: 'intro', brand: 'city', size: 'brand', service: 'size', result: 'service',
      details: flow.service === 'collecte' ? 'service' : 'result',
      track: 'orders', orders: 'city', login: 'city',
    }[current];
    if (prev) show(prev, -1);
  }
  /** Sélection d'un choix : animation, puis passage automatique à l'étape suivante. */
  function pick(btn, apply, nextStep) {
    if (busy) return;
    btn.parentElement.querySelectorAll('.is-picked').forEach((b) => b.classList.remove('is-picked'));
    btn.classList.add('is-picked');
    navigator.vibrate?.(8);
    apply();
    persist();
    setTimeout(() => go(typeof nextStep === 'function' ? nextStep() : nextStep), reduced() ? 0 : 300);
  }

  // ---------- Gestes et effets ----------
  function bindSwipe(el) {
    let x0 = null; let y0 = 0; let t0 = 0;
    el.addEventListener('touchstart', (e) => {
      if (e.target.closest('.leaflet-container, input, textarea, select, .fx-slides, .fx-sheet')) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.7 || Date.now() - t0 > 700) return;
      if (dx > 0) back(); else forwardIfChosen();
    }, { passive: true });
  }
  function forwardIfChosen() {
    const nextOf = {
      city: flow.cityId && 'brand',
      brand: flow.brand !== undefined && 'size',
      size: flow.weight !== undefined && 'service',
      service: flow.service && (flow.service === 'collecte' ? 'details' : 'result'),
    }[current];
    if (nextOf) go(nextOf);
  }
  /** Onde de toucher sur les cartes et boutons. */
  function bindRipple(el) {
    el.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.fx-choice, .fx-btn, .fx-menu-item, .fx-order');
      if (!t || reduced() || t.disabled) return;
      const r = t.getBoundingClientRect();
      const s = document.createElement('span');
      s.className = 'fx-ripple';
      const size = Math.max(r.width, r.height) * 1.2;
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      t.appendChild(s);
      setTimeout(() => s.remove(), 650);
    });
  }
  /** Compteur animé (prix). */
  function countUp(el) {
    const target = Number(el.dataset.to) || 0;
    const fmt = (n) => money(Math.round(n), el.dataset.cur || 'FCFA');
    if (reduced()) { el.textContent = fmt(target); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / 700);
      el.textContent = fmt(target * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- Menu (feuille du bas) ----------
  function openMenu() {
    const me = state.me?.user;
    const items = [
      ['new', 'plus', 'Nouvelle commande', 'Ville, marque, bouteille…'],
      ['orders', 'list', 'Mes commandes', 'Suivre une livraison ou une demande'],
      installEvt ? ['install', 'download', 'Installer l’application', 'Sur l’écran d’accueil du téléphone'] : null,
      me ? ['logout', 'logout', 'Se déconnecter', esc(me.name)] : ['login', 'user', 'Se connecter', 'Retrouver mes commandes'],
      ['pro', 'store', 'Espace distributeur', 'Dépôts, livreurs, catalogue'],
    ].filter(Boolean);
    $('#fx-sheet-body').innerHTML = `
      <div class="fx-sheet-head"><img src="/icons/icon-192.png" alt="" width="40" height="40"><div><b>FasoGaz</b><span>${me ? `Bonjour ${esc(me.name.split(' ')[0])}` : 'Votre gaz, sans courir'}</span></div>
        <button class="fx-icon-btn" type="button" data-close aria-label="Fermer">${ic('close', 20)}</button></div>
      <div class="fx-menu fx-stagger">${items.map(([id, icon, title, sub]) => `
        <button class="fx-menu-item" type="button" data-menu="${id}">
          <span class="fx-menu-ic">${ic(icon, 20)}</span><span><b>${title}</b><small>${sub}</small></span>${ic('chevron', 18)}
        </button>`).join('')}</div>`;
    $$('#fx-sheet-body .fx-stagger > *').forEach((el, i) => el.style.setProperty('--i', i));
    const sheet = $('#fx-sheet');
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    $('#fx-sheet-body').onclick = async (e) => {
      const b = e.target.closest('[data-menu]');
      if (!b) return;
      const id = b.dataset.menu;
      closeMenu();
      if (id === 'new') { flow = { step: 'city', cityId: flow.cityId }; persist(); stack = []; go('city'); }
      if (id === 'orders') go('orders');
      if (id === 'login') go('login');
      if (id === 'pro') { flow.afterLogin = 'pro'; go('login'); }
      if (id === 'logout') { logout(false); toast('Vous êtes déconnecté.'); stack = []; go('city'); }
      if (id === 'install' && installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; }
    };
  }
  function closeMenu() {
    const sheet = $('#fx-sheet');
    sheet.classList.remove('open');
    setTimeout(() => { sheet.hidden = true; }, reduced() ? 0 : 320);
  }

  // ---------- Rendu des écrans ----------
  const head = (kicker, title, sub = '') => `
    <div class="fx-title">
      <span class="fx-kicker">${kicker}</span>
      <h1 tabindex="-1">${title}</h1>
      ${sub ? `<p class="fx-sub">${sub}</p>` : ''}
    </div>`;
  const chosen = () => {
    const bits = [city()?.name, flow.brand || (flow.brand === null ? 'Toutes marques' : null), flow.weight ? `${String(flow.weight).replace('.', ',')} kg` : null].filter(Boolean);
    return bits.length ? `<div class="fx-crumbs">${bits.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : '';
  };

  const RENDER = {
    async intro() {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
      return `
      <section class="fx-step fx-intro">
        <div class="fx-brand-big"><img src="/icons/icon-192.png" alt="" width="38" height="38"><span>FasoGaz</span></div>
        <div class="fx-slides" id="fx-slides">
          <article class="fx-slide">
            <div class="fx-art fx-art-bottles" data-par>
              <span class="fx-halo"></span>
              ${bottleImg('Oryx', 19, 'b1')}${bottleImg('Sodigaz', 12.5, 'b2')}${bottleImg('Total', null, 'b3')}${bottleImg('Shell', 6, 'b4')}
            </div>
            <h1 tabindex="-1">Votre gaz, <em>sans courir</em></h1>
            <p>Sodigaz, Oryx, Total, Shell : FasoGaz trouve votre gaz à Ouaga, Bobo, Banfora… au meilleur prix.</p>
          </article>
          <article class="fx-slide">
            <div class="fx-art fx-steps-art" data-par>
              ${['Votre ville', 'Votre marque', 'Votre bouteille', 'Dépôt, livraison ou recharge'].map((l, i) => `<span style="--i:${i}"><b>${i + 1}</b>${l}</span>`).join('')}
            </div>
            <h1>En <em>4 gestes</em></h1>
            <p>Faites glisser ou touchez votre choix : l’application avance toute seule.</p>
          </article>
          <article class="fx-slide">
            <div class="fx-art fx-art-photo" data-par>
              <figure class="fx-photo-card"><img src="/img/livreur-sodigaz.webp" alt="Un livreur charge des bouteilles de gaz Sodigaz sur sa moto" decoding="async">
                <figcaption class="fx-live"><i></i>Livreur en route · ≈ 25 min</figcaption></figure>
            </div>
            <h1>Livré <em>à la porte</em></h1>
            <p>Le livreur apporte la bouteille pleine, ou récupère la vôtre pour la recharger. Paiement à la livraison.</p>
          </article>
        </div>
        <div class="fx-dots" id="fx-dots">${[0, 1, 2].map((i) => `<button type="button" aria-label="Écran ${i + 1}" class="${i ? '' : 'on'}" data-dot="${i}"></button>`).join('')}</div>
        <div class="fx-actions">
          <button class="fx-btn fx-btn-primary fx-shine" id="fx-start" type="button"><span>Continuer</span></button>
          ${installEvt ? `<button class="fx-btn fx-btn-ghost" id="fx-install" type="button">${ic('download', 18)} Installer l’application</button>` : ''}
          ${isIos ? '<p class="fx-hint">Sur iPhone : touchez <b>Partager</b> puis <b>Sur l’écran d’accueil</b> pour installer FasoGaz.</p>' : ''}
        </div>
      </section>`;
    },

    async city() {
      const served = state.cities.filter((c) => c.providers > 0);
      const soon = state.cities.filter((c) => !c.providers);
      return `
      <section class="fx-step">
        ${head('Étape 1 sur 4', 'Dans quelle ville êtes-vous ?', 'On vous montre les distributeurs qui livrent chez vous.')}
        <div class="fx-grid fx-stagger">
          ${served.map((c) => `
            <button class="fx-choice fx-city ${c.id === flow.cityId ? 'is-picked' : ''}" type="button" data-city="${c.id}">
              <span class="fx-city-ic">${ic('pin', 20)}</span>
              <span class="fx-choice-main">${esc(c.name)}</span>
              <span class="fx-choice-sub">${c.providers} distributeur${c.providers > 1 ? 's' : ''}</span>
            </button>`).join('')}
        </div>
        ${soon.length ? `<p class="fx-soon">Bientôt : ${soon.map((c) => esc(c.name)).join(', ')}.</p>` : ''}
      </section>`;
    },

    async brand() {
      const { brands } = await catalog();
      return `
      <section class="fx-step">
        ${head('Étape 2 sur 4', 'Quelle marque de gaz ?', `Disponibles à ${esc(city()?.name || '')}.`)}
        <div class="fx-grid fx-stagger">
          ${[...brands, null].map((b) => `
            <button class="fx-choice fx-brand ${flow.brand === b ? 'is-picked' : ''}" type="button" data-brand="${esc(b ?? '')}" style="--c:${b ? tint(b) : '#1859c9'}">
              <span class="fx-brand-art">${b ? bottleImg(b, null) : `<span class="fx-brand-mix">${bottleImg('Oryx', 6)}${bottleImg('Sodigaz', 12.5)}${bottleImg('Shell', 6)}</span>`}</span>
              <span class="fx-choice-main">${b ? esc(b) : 'Peu importe'}</span>
              <span class="fx-choice-sub">${b ? 'Bouteille de la marque' : 'Le moins cher'}</span>
            </button>`).join('')}
        </div>
      </section>`;
    },

    async size() {
      const { catalog: cat } = await catalog();
      const weights = new Map(); // poids → { price, brand }
      for (const t of cat) {
        for (const o of t.offers) {
          if (!['recharge', 'bouteille'].includes(o.kind) || !o.weight_kg) continue;
          if (flow.brand && o.brand && o.brand !== flow.brand) continue;
          const w = Number(o.weight_kg);
          const cur = weights.get(w) || { price: null, brand: o.brand };
          if (o.kind === 'recharge' && (cur.price === null || o.price < cur.price)) { cur.price = o.price; cur.brand = o.brand; }
          weights.set(w, cur);
        }
      }
      const list = [...weights.entries()].sort((a, b) => a[0] - b[0]);
      return `
      <section class="fx-step">
        ${head('Étape 3 sur 4', 'Quelle bouteille ?', 'Choisissez la taille de votre bouteille.')}
        ${chosen()}
        ${list.length ? `<div class="fx-sizes fx-stagger">
          ${list.map(([w, info]) => `
            <button class="fx-choice fx-size ${Number(flow.weight) === w ? 'is-picked' : ''}" type="button" data-weight="${w}"
              style="--h:${Math.round(Math.max(92, Math.min(150, 62 + w * 4.4)))}px;--c:${tint(flow.brand || info.brand)}">
              <span class="fx-size-art">${bottleImg(flow.brand || info.brand, w)}</span>
              <span class="fx-choice-main">${String(w).replace('.', ',')} kg</span>
              <span class="fx-choice-sub">${info.price ? `recharge dès ${money(info.price)}` : 'bouteille neuve'}</span>
            </button>`).join('')}
        </div>` : '<div class="fx-empty"><p>Cette marque n’a pas encore de bouteille ici. Revenez en arrière pour choisir « Peu importe ».</p></div>'}
      </section>`;
    },

    async service() {
      return `
      <section class="fx-step">
        ${head('Étape 4 sur 4', 'Que voulez-vous faire ?')}
        ${chosen()}
        <div class="fx-list fx-stagger">
          ${SERVICES.map((s) => `
            <button class="fx-choice fx-service ${flow.service === s.id ? 'is-picked' : ''}" type="button" data-service="${s.id}">
              <span class="fx-service-ic">${ic(s.icon, 26)}</span>
              <span class="fx-service-txt"><span class="fx-choice-main">${s.title}</span><span class="fx-choice-sub">${s.text}</span></span>
            </button>`).join('')}
        </div>
      </section>`;
    },

    async result() {
      if (flow.service === 'depot') return resultDepot();
      const kinds = flow.service === 'achat' ? ['bouteille'] : ['recharge'];
      const { catalog: cat } = await catalog();
      let offers = matchingOffers(cat, kinds);
      let relaxed = false;
      if (!offers.length && flow.service === 'achat' && flow.weight) {
        const w = flow.weight; flow.weight = null; offers = matchingOffers(cat, kinds); flow.weight = w; relaxed = true;
      }
      return `
      <section class="fx-step">
        ${head(flow.service === 'achat' ? 'Bouteille neuve' : 'Livraison', 'Choisissez votre offre', 'Prix livraison comprise, du moins cher au plus cher.')}
        ${chosen()}
        ${relaxed && offers.length ? '<p class="fx-note">Pas de bouteille neuve à cette taille : voici les autres tailles disponibles.</p>' : ''}
        ${offers.length ? `<div class="fx-list fx-stagger">
          ${offers.map((o, i) => `
            <button class="fx-choice fx-offer ${o.in_stock ? '' : 'is-off'}" type="button" data-offer="${o.offer_id}" ${o.in_stock ? '' : 'disabled'}>
              <span class="fx-offer-thumb">${bottleImg(o.brand, o.weight_kg)}</span>
              <span class="fx-offer-body">
                <span class="fx-offer-top">
                  <span class="fx-choice-main">${esc(o.tenant.name)}</span>
                  <span class="fx-price">${money(o.price + o.tenant.delivery_fee, o.tenant.currency)}</span>
                </span>
                <span class="fx-choice-sub">${esc(o.brand ? `${o.brand} · ` : '')}${esc(o.name)}</span>
                <span class="fx-offer-meta">
                  ${i === 0 && o.in_stock ? '<span class="fx-tag-best">Meilleur prix</span>' : ''}
                  <span>Livraison ${money(o.tenant.delivery_fee, o.tenant.currency)}</span>
                  <span>${ic('clock', 12)} ≈ ${o.tenant.min_delay_minutes} min</span>
                  ${o.in_stock ? '' : '<span class="fx-tag-off">Épuisé</span>'}
                </span>
              </span>
            </button>`).join('')}
        </div>` : `<div class="fx-empty">
          <p>Aucune offre ne correspond encore à vos choix ici.</p>
          <button class="fx-btn fx-btn-primary" type="button" id="fx-ask">Envoyer une demande aux distributeurs</button>
        </div>`}
      </section>`;
    },

    async details() {
      const o = flow.offer;
      const isRequest = flow.service === 'collecte' || !o;
      const total = o ? o.price + o.delivery_fee : null;
      const me = state.me?.user;
      return `
      <section class="fx-step">
        ${head('Presque fini', isRequest ? 'Où récupérer votre bouteille ?' : 'Où vous livrer ?')}
        ${o ? `<div class="fx-summary">
          <span class="fx-summary-thumb">${bottleImg(o.brand, o.weight)}</span>
          <div><b>${esc(o.label)}</b><span>${esc(o.tenant_name)} · ≈ ${o.delay} min</span></div>
          <strong data-to="${total}" data-cur="${esc(o.currency)}">${money(total, o.currency)}</strong>
        </div>` : chosen()}
        <form class="fx-form fx-stagger" id="fx-form" novalidate>
          <div class="fx-field">
            <label for="fx-address">Adresse ou repère</label>
            <div class="fx-inline">
              <input id="fx-address" name="address" required minlength="5" maxlength="300" autocomplete="street-address"
                placeholder="Ex. Ouaga 2000, près de la pharmacie…" value="${esc(flow.address || '')}">
              <button class="fx-icon-btn fx-gps" type="button" id="fx-gps" aria-label="Utiliser ma position">${ic('gps', 20)}</button>
            </div>
            <span class="fx-help" id="fx-gps-state">${flow.lat ? 'Position GPS ajoutée' : 'Le GPS aide le livreur à vous trouver.'}</span>
          </div>
          <div class="fx-field">
            <label for="fx-phone">Téléphone</label>
            <input id="fx-phone" name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="70 00 00 00" value="${esc(flow.phone || me?.phone || '')}">
          </div>
          ${isRequest ? '' : `<div class="fx-field">
            <label>Quand ?</label>
            <div class="fx-seg" role="radiogroup">${Object.entries({ asap: 'Au plus vite', matin: 'Matin', apres_midi: 'Après-midi', soir: 'Soir' }).map(([k, v]) => `
              <label><input type="radio" name="slot" value="${k}" ${(flow.slot || 'asap') === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
          </div>`}
          <div class="fx-field">
            <label>Paiement</label>
            <div class="fx-seg" role="radiogroup">${Object.entries({ especes: 'Espèces', mobile_money: 'Mobile Money' }).map(([k, v]) => `
              <label><input type="radio" name="payment_method" value="${k}" ${(flow.payment || 'especes') === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
          </div>
          ${me ? '' : accountFields()}
          <p class="fx-error" id="fx-error" role="alert"></p>
          <button class="fx-btn fx-btn-primary fx-shine fx-submit" type="submit" id="fx-submit">
            <span>${isRequest ? 'Envoyer la demande' : `Commander · ${money(total, o.currency)}`}</span>
          </button>
        </form>
      </section>`;
    },

    async done() {
      const d = flow.doneInfo || {};
      return `
      <section class="fx-step fx-done">
        <div class="fx-burst" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg"></i>`).join('')}</div>
        <div class="fx-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-15"/></svg></div>
        <h1 tabindex="-1">${d.order ? 'Commande envoyée !' : 'Demande envoyée !'}</h1>
        <p class="fx-sub">${d.order
    ? `Référence <b>${esc(d.ref)}</b>. Le dépôt confirme, puis un livreur arrive.`
    : 'Les distributeurs de votre ville reçoivent votre demande. Vous serez appelé pour la confirmer.'}</p>
        <div class="fx-actions">
          <button class="fx-btn fx-btn-primary fx-shine" type="button" id="fx-follow"><span>Suivre ${d.order ? 'ma commande' : 'ma demande'}</span></button>
          <button class="fx-btn fx-btn-ghost" type="button" id="fx-again">Nouvelle commande</button>
        </div>
      </section>`;
    },

    async login() {
      const pro = flow.afterLogin === 'pro';
      return `
      <section class="fx-step">
        ${head(pro ? 'Espace distributeur' : 'Mon compte', pro ? 'Connexion distributeur' : 'Retrouvez vos commandes', pro ? '' : 'Connectez-vous ou créez votre compte en 30 secondes.')}
        <form class="fx-form fx-stagger" id="fx-login" novalidate>
          ${pro ? '<input type="hidden" name="acct" value="login">' : `<div class="fx-seg fx-seg-sm" role="tablist">
            <label><input type="radio" name="acct" value="login" checked><span>J’ai un compte</span></label>
            <label><input type="radio" name="acct" value="new"><span>Nouveau client</span></label>
          </div>`}
          <div class="fx-field" data-acct="new" hidden><label for="fx-lname">Votre nom</label><input id="fx-lname" name="name" autocomplete="name" maxlength="80"></div>
          <div class="fx-field" data-acct="new" hidden><label for="fx-lphone">Téléphone</label><input id="fx-lphone" name="phone" type="tel" inputmode="tel" autocomplete="tel"></div>
          <div class="fx-field"><label for="fx-lemail">E-mail</label><input id="fx-lemail" name="email" type="email" autocomplete="email" required></div>
          <div class="fx-field"><label for="fx-lpass">Mot de passe</label><input id="fx-lpass" name="password" type="password" autocomplete="current-password" required minlength="8"></div>
          <p class="fx-error" id="fx-lerror" role="alert"></p>
          <button class="fx-btn fx-btn-primary fx-shine" type="submit" id="fx-lsubmit"><span>Continuer</span></button>
        </form>
      </section>`;
    },

    async orders() {
      if (!state.me) { flow.afterLogin = 'orders'; return RENDER.login(); }
      const [orders, requests] = await Promise.all([api('GET', '/api/orders'), api('GET', '/api/requests')]);
      const openReq = requests.filter((r) => r.status !== 'acceptee' || !r.order_id);
      return `
      <section class="fx-step">
        ${head('Mon compte', 'Mes commandes', orders.length || openReq.length ? 'Touchez une commande pour la suivre.' : '')}
        ${!orders.length && !openReq.length ? `<div class="fx-empty"><p>Vous n’avez pas encore de commande.</p>
          <button class="fx-btn fx-btn-primary fx-shine" type="button" id="fx-first"><span>Commander du gaz</span></button></div>` : ''}
        <div class="fx-list fx-stagger">
          ${openReq.map((r) => `
            <div class="fx-order is-req">
              <span class="fx-order-thumb">${bottleImg(r.brand, r.weight_kg)}</span>
              <span class="fx-order-body">
                <b>${esc(r.service_label || 'Demande')}</b>
                <small>${esc([r.brand, r.weight_kg ? `${String(r.weight_kg).replace('.', ',')} kg` : ''].filter(Boolean).join(' · ') || r.city_name)} · ${shortDate(r.created_at)}</small>
                <span class="fx-pill tone-${r.status === 'annulee' ? 'off' : 'wait'}">${esc(REQ_LABEL[r.status] || r.status)}</span>
              </span>
            </div>`).join('')}
          ${orders.map((o) => `
            <button class="fx-order" type="button" data-track="${o.id}">
              <span class="fx-order-thumb">${bottleImg(...guessBottle(o.summary))}</span>
              <span class="fx-order-body">
                <b>${esc(o.tenant_name)}</b>
                <small>${esc(o.ref)} · ${shortDate(o.created_at)}</small>
                <span class="fx-pill tone-${STATUS_TONE[o.status] || 'info'}">${esc(o.status_label || o.status)}</span>
              </span>
              <span class="fx-order-end"><strong>${money(o.total, o.currency)}</strong>${ic('chevron', 18)}</span>
            </button>`).join('')}
        </div>
      </section>`;
    },

    async track(id) {
      if (!state.me) { flow.afterLogin = 'orders'; return RENDER.login(); }
      const o = await api('GET', `/api/orders/${Number(id)}`);
      const idx = ORDER_STEPS.findIndex(([s]) => s === o.status);
      const cancelled = o.status === 'annulee';
      const pct = cancelled ? 0 : (Math.max(0, idx) / (ORDER_STEPS.length - 1)) * 100;
      const [brand, kg] = guessBottle(o.items?.[0]?.product_name);
      return `
      <section class="fx-step fx-track" data-status="${esc(o.status)}">
        ${head(esc(o.ref), cancelled ? 'Commande annulée' : o.status === 'livree' ? 'Commande livrée' : 'Suivi de la commande', esc(o.tenant_name))}
        ${!cancelled && o.status !== 'livree' ? `<figure class="fx-track-photo"><img src="/img/livreur-sodigaz.webp" alt="" decoding="async">
          <figcaption class="fx-live"><i></i>${esc(ORDER_STEPS[Math.max(0, idx)][1])}</figcaption></figure>` : ''}
        ${cancelled ? '' : `<ol class="fx-timeline" style="--pn:${(pct / 100).toFixed(3)}">
          ${ORDER_STEPS.map(([s, label], i) => `<li class="${i < idx ? 'is-done' : i === idx ? 'is-now' : ''}"><i>${i <= idx ? ic('check', 14) : ''}</i><span>${label}</span></li>`).join('')}
        </ol>`}
        ${o.driver_name ? `<div class="fx-driver"><span class="fx-menu-ic">${ic('user', 20)}</span><div><b>${esc(o.driver_name)}</b><small>Votre livreur</small></div>
          ${o.driver_phone ? `<a class="fx-btn fx-btn-primary fx-btn-sm" href="tel:${esc(o.driver_phone)}">${ic('phone', 18)} Appeler</a>` : ''}</div>` : ''}
        <div class="fx-receipt">
          ${o.items.map((it) => `<div><span class="fx-receipt-thumb">${bottleImg(...guessBottle(it.product_name || `${brand} ${kg}kg`))}</span><span>${it.qty} × ${esc(it.product_name)}</span><b>${money(it.unit_price * it.qty, o.currency)}</b></div>`).join('')}
          <div><span></span><span>Livraison</span><b>${money(o.delivery_fee, o.currency)}</b></div>
          <div class="is-total"><span></span><span>Total</span><b>${money(o.total, o.currency)}</b></div>
          <p class="fx-help">${esc(o.address)}</p>
        </div>
        ${['en_attente', 'confirmee'].includes(o.status) ? '<button class="fx-btn fx-btn-ghost fx-danger" type="button" id="fx-cancel">Annuler la commande</button>' : ''}
      </section>`;
    },
  };

  const accountFields = () => `<div class="fx-account">
    <div class="fx-seg fx-seg-sm" role="tablist">
      <label><input type="radio" name="acct" value="new" checked><span>Nouveau client</span></label>
      <label><input type="radio" name="acct" value="login"><span>J’ai un compte</span></label>
    </div>
    <div class="fx-field" data-acct="new"><label for="fx-name">Votre nom</label><input id="fx-name" name="name" autocomplete="name" maxlength="80"></div>
    <div class="fx-field"><label for="fx-email">E-mail</label><input id="fx-email" name="email" type="email" autocomplete="email"></div>
    <div class="fx-field"><label for="fx-pass">Mot de passe</label><input id="fx-pass" name="password" type="password" autocomplete="new-password" minlength="8" placeholder="8 caractères minimum"></div>
  </div>`;

  async function resultDepot() {
    const q = [flow.brand, flow.weight ? `${flow.weight}` : ''].filter(Boolean).join(' ');
    const pos = state.pos;
    const params = new URLSearchParams({ city_id: flow.cityId, q });
    if (pos) { params.set('lat', pos.lat); params.set('lng', pos.lng); }
    const data = await api('GET', `/api/search?${params}`);
    flow.depots = data.results;
    return `
    <section class="fx-step fx-depot">
      ${head('Dépôts', pos ? 'Les dépôts près de vous' : `Les dépôts à ${esc(city()?.name || '')}`)}
      ${chosen()}
      ${pos ? '' : `<button class="fx-btn fx-btn-ghost fx-locate" type="button" id="fx-locate">${ic('gps', 18)} Trier du plus proche au plus loin</button>`}
      <div class="fx-map" id="fx-map"></div>
      ${data.results.length ? `<div class="fx-list fx-stagger">
        ${data.results.slice(0, 15).map((p) => `
          <article class="fx-depot-card ${p.available ? '' : 'is-off'}" data-depot="${p.id}">
            <div class="fx-offer-top">
              <span class="fx-choice-main">${esc(p.name)}</span>
              ${p.distance_km != null ? `<span class="fx-dist">${km(p.distance_km)}</span>` : ''}
            </div>
            <span class="fx-choice-sub">${esc(p.tenant_name)} · ${esc(p.address || p.city_name)}</span>
            <div class="fx-offer-meta">${p.products.slice(0, 3).map((o) => `<span>${esc(o.brand || '')} ${String(o.weight_kg || '').replace('.', ',')} kg · ${money(o.price, p.currency)}</span>`).join('')}
              ${p.available ? '' : '<span class="fx-tag-off">Rupture</span>'}</div>
            <div class="fx-depot-actions">
              <a class="fx-btn fx-btn-primary fx-btn-sm" href="${directions(p.lat, p.lng, `${p.name} ${p.city_name}`)}" target="_blank" rel="noopener">${ic('route', 18)} Itinéraire</a>
              ${p.phone ? `<a class="fx-btn fx-btn-ghost fx-btn-sm" href="tel:${esc(p.phone)}">${ic('phone', 18)} Appeler</a>` : ''}
            </div>
          </article>`).join('')}
      </div>` : '<div class="fx-empty"><p>Aucun dépôt ne correspond encore à vos choix dans cette ville.</p></div>'}
    </section>`;
  }

  // ---------- Interactions par écran ----------
  const BIND = {
    intro(el) {
      const track = $('#fx-slides', el);
      const dots = [...el.querySelectorAll('[data-dot]')];
      const slides = [...el.querySelectorAll('.fx-slide')];
      const idx = () => Math.round(track.scrollLeft / track.clientWidth);
      const parallax = () => {
        if (reduced()) return;
        slides.forEach((s, i) => {
          const off = (track.scrollLeft - i * track.clientWidth) / track.clientWidth; // -1 … 1
          const art = s.querySelector('[data-par]');
          if (art) art.style.transform = `translateX(${off * 38}%) scale(${1 - Math.min(0.12, Math.abs(off) * 0.12)})`;
          s.style.opacity = String(Math.max(0, 1 - Math.abs(off) * 1.1));
        });
      };
      track.addEventListener('scroll', () => {
        const i = idx();
        dots.forEach((d, j) => d.classList.toggle('on', i === j));
        $('#fx-start span', el).textContent = i === dots.length - 1 ? 'Commencer' : 'Continuer';
        parallax();
      }, { passive: true });
      dots.forEach((d) => d.addEventListener('click', () => track.scrollTo({ left: track.clientWidth * Number(d.dataset.dot), behavior: 'smooth' })));
      $('#fx-start', el).addEventListener('click', () => {
        const i = idx();
        if (i < dots.length - 1) track.scrollTo({ left: track.clientWidth * (i + 1), behavior: reduced() ? 'auto' : 'smooth' });
        else { save(INTRO_KEY, true); go('city'); }
      });
      $('#fx-install', el)?.addEventListener('click', async () => {
        installEvt.prompt();
        await installEvt.userChoice.catch(() => {});
        installEvt = null;
        $('#fx-install', el)?.remove();
      });
    },
    city(el) {
      el.querySelectorAll('[data-city]').forEach((b) => b.addEventListener('click', () => pick(b, () => {
        const id = Number(b.dataset.city);
        if (id !== flow.cityId) { flow.brand = undefined; flow.weight = undefined; }
        flow.cityId = id;
      }, 'brand')));
    },
    brand(el) {
      el.querySelectorAll('[data-brand]').forEach((b) => b.addEventListener('click', () => pick(b, () => {
        flow.brand = b.dataset.brand || null;
        flow.weight = undefined;
      }, 'size')));
    },
    size(el) {
      el.querySelectorAll('[data-weight]').forEach((b) => b.addEventListener('click', () => pick(b, () => {
        flow.weight = Number(b.dataset.weight);
      }, 'service')));
    },
    service(el) {
      el.querySelectorAll('[data-service]').forEach((b) => b.addEventListener('click', () => pick(b, () => {
        flow.service = b.dataset.service;
        flow.offer = null;
      }, () => (flow.service === 'collecte' ? 'details' : 'result'))));
    },
    result(el) {
      if (flow.service === 'depot') return bindDepot(el);
      el.querySelectorAll('[data-offer]').forEach((b) => b.addEventListener('click', () => pick(b, () => {
        const id = Number(b.dataset.offer);
        for (const t of cache.catalog) {
          const o = t.offers.find((x) => x.offer_id === id);
          if (o) {
            flow.offer = {
              offer_id: id, tenant_id: t.tenant_id, tenant_name: t.name, price: o.price, delivery_fee: t.delivery_fee,
              currency: t.currency, delay: t.min_delay_minutes, label: `${o.brand ? `${o.brand} · ` : ''}${o.name}`,
              brand: o.brand, weight: o.weight_kg,
            };
          }
        }
      }, 'details')));
      $('#fx-ask', el)?.addEventListener('click', () => { flow.offer = null; persist(); go('details'); });
    },
    details(el) {
      const form = $('#fx-form', el);
      const sum = el.querySelector('.fx-summary strong[data-to]');
      if (sum) countUp(sum);
      $('#fx-gps', el).addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('is-loading');
        try {
          const p = await locate();
          flow.lat = p.lat; flow.lng = p.lng; persist();
          $('#fx-gps-state', el).textContent = 'Position GPS ajoutée';
          btn.classList.add('is-ok');
        } catch (err) { $('#fx-gps-state', el).textContent = err.message; }
        btn.classList.remove('is-loading');
      });
      bindAccountSwitch(form);
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(form, el); });
    },
    done(el) {
      $('#fx-again', el).addEventListener('click', () => {
        flow = { step: 'city', cityId: flow.cityId };
        persist();
        stack = [];
        show('city', -1);
      });
      $('#fx-follow', el).addEventListener('click', () => {
        const d = flow.doneInfo || {};
        current = null; // « retour » depuis le suivi mène à « Mes commandes », pas à la confirmation
        stack = d.order ? ['orders'] : [];
        if (d.order) go('track', d.id); else go('orders');
      });
    },
    login(el) {
      const form = el.querySelector('#fx-login') || el.querySelector('#fx-form');
      if (!form || form.id !== 'fx-login') return;
      bindAccountSwitch(form, 'login');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(form).entries());
        const err = $('#fx-lerror', el);
        const btn = $('#fx-lsubmit', el);
        err.textContent = '';
        btn.classList.add('is-loading'); btn.disabled = true;
        try {
          const data = f.acct === 'new'
            ? await api('POST', '/api/auth/register', { name: f.name, phone: f.phone, email: f.email, password: f.password, city_id: flow.cityId })
            : await api('POST', '/api/auth/login', { email: f.email, password: f.password });
          setSession(data);
          await loadMe();
          const role = state.me?.user.role;
          if (role && role !== 'customer') { location.hash = homeFor(role); return; }
          const next = flow.afterLogin && flow.afterLogin !== 'pro' ? flow.afterLogin : 'orders';
          flow.afterLogin = null;
          stack = [];
          busy = false;
          current = null;
          go(next);
        } catch (ex) { err.textContent = ex.message; }
        btn.classList.remove('is-loading'); btn.disabled = false;
      });
    },
    orders(el) {
      if (el.querySelector('#fx-login')) return BIND.login(el);
      $('#fx-first', el)?.addEventListener('click', () => { stack = []; go('city'); });
      el.querySelectorAll('[data-track]').forEach((b) => b.addEventListener('click', () => go('track', Number(b.dataset.track))));
    },
    track(el, id) {
      if (el.querySelector('#fx-login')) return BIND.login(el);
      $('#fx-cancel', el)?.addEventListener('click', async (e) => {
        if (!confirm('Annuler cette commande ?')) return;
        e.currentTarget.disabled = true;
        try {
          await api('POST', `/api/orders/${Number(id)}/status`, { status: 'annulee' });
          toast('Commande annulée.');
          busy = false; current = null; show('track', 1, id);
        } catch (ex) { toast(ex.message, true); e.currentTarget.disabled = false; }
      });
      // Actualisation automatique tant que la commande est en cours.
      const status = el.dataset.status;
      if (!['livree', 'annulee'].includes(status)) {
        trackTimer = setInterval(async () => {
          if (current !== 'track' || document.hidden) return;
          try {
            const o = await api('GET', `/api/orders/${Number(id)}`);
            if (o.status !== status) { busy = false; show('track', 1, id); navigator.vibrate?.([10, 30, 10]); }
          } catch { /* réseau : on réessaie au prochain tour */ }
        }, 15000);
      }
    },
  };

  function bindAccountSwitch(form, defaultMode = 'new') {
    const radios = form.querySelectorAll('input[name="acct"]');
    const sync = () => {
      const isNew = (form.acct?.value || defaultMode) === 'new';
      form.querySelectorAll('[data-acct="new"]').forEach((f) => { f.hidden = !isNew; });
      const pass = form.querySelector('input[name="password"]');
      if (pass) pass.autocomplete = isNew ? 'new-password' : 'current-password';
    };
    radios.forEach((r) => r.addEventListener('change', sync));
    sync();
  }

  function bindDepot(el) {
    $('#fx-locate', el)?.addEventListener('click', async () => {
      try { await locate(); busy = false; current = null; show('result', 1); } catch (e) { toast(e.message, true); }
    });
    const mapEl = $('#fx-map', el);
    const pts = (flow.depots || []).filter((p) => p.lat != null);
    if (!window.L || !pts.length) { mapEl.remove(); return; }
    setTimeout(() => {
      const map = L.map(mapEl, { zoomControl: false, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      const bounds = [];
      pts.forEach((p, i) => {
        const m = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: `fx-marker ${p.available ? '' : 'is-off'}`, html: `<span style="animation-delay:${i * 90}ms"></span>`, iconSize: [28, 28], iconAnchor: [14, 28] }),
        }).addTo(map);
        m.on('click', () => {
          const card = el.querySelector(`[data-depot="${p.id}"]`);
          card?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
          card?.classList.add('is-flash'); setTimeout(() => card?.classList.remove('is-flash'), 900);
        });
        bounds.push([p.lat, p.lng]);
      });
      if (state.pos) {
        L.marker([state.pos.lat, state.pos.lng], { icon: L.divIcon({ className: 'fx-me', html: '<span></span>', iconSize: [18, 18] }) }).addTo(map);
        bounds.push([state.pos.lat, state.pos.lng]);
      }
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    }, reduced() ? 0 : 360);
  }

  async function submit(form, el) {
    const err = $('#fx-error', el);
    const btn = $('#fx-submit', el);
    err.textContent = '';
    const f = Object.fromEntries(new FormData(form).entries());
    flow.address = f.address; flow.phone = f.phone; flow.slot = f.slot; flow.payment = f.payment_method;
    persist();
    if ((f.address || '').trim().length < 5) { err.textContent = 'Indiquez une adresse ou un repère (5 caractères minimum).'; form.address.focus(); return; }
    if ((f.phone || '').trim().length < 6) { err.textContent = 'Indiquez votre numéro de téléphone.'; form.phone.focus(); return; }
    btn.disabled = true;
    btn.classList.add('is-loading');
    try {
      if (!state.me) {
        const creds = { email: f.email, password: f.password };
        const data = f.acct === 'login'
          ? await api('POST', '/api/auth/login', creds)
          : await api('POST', '/api/auth/register', { ...creds, name: f.name, phone: f.phone, city_id: flow.cityId });
        setSession(data);
        await loadMe();
        if (state.me?.user.role !== 'customer') throw new Error('Ce compte n’est pas un compte client.');
      }
      const common = { city_id: flow.cityId, address: f.address, phone: f.phone, lat: flow.lat ?? null, lng: flow.lng ?? null, payment_method: f.payment_method || 'especes' };
      if (flow.offer) {
        const o = await api('POST', '/api/orders', {
          ...common, tenant_id: flow.offer.tenant_id, slot: f.slot || 'asap', items: [{ offer_id: flow.offer.offer_id, qty: 1 }],
        });
        flow.doneInfo = { order: true, id: o.id, ref: o.ref };
      } else {
        const service = flow.service === 'achat' ? 'achat' : flow.service === 'livraison' ? 'echange' : 'collecte';
        const r = await api('POST', '/api/requests', { ...common, service, brand: flow.brand || '', weight_kg: flow.weight || '', qty: 1 });
        flow.doneInfo = { order: false, id: r.id };
      }
      navigator.vibrate?.([10, 40, 20]);
      busy = false;
      go('done');
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
    btn.classList.remove('is-loading');
  }

  // ---------- Point d'entrée (appelé par le routeur de app.js) ----------
  /** start : écran à ouvrir (« orders », « track », « login ») ; sinon on reprend le parcours. */
  window.pageFlow = async function pageFlow(start, arg) {
    const saved = load(KEY, null);
    flow = saved && saved.step && saved.step !== 'done' ? saved : { step: 'intro' };
    if (!load(INTRO_KEY, false)) flow.step = 'intro';
    else if (flow.step === 'intro') flow.step = 'city';
    if (flow.cityId && !state.cities.some((c) => c.id === flow.cityId)) flow = { step: 'city' };
    if (['result', 'details'].includes(flow.step) && !flow.service) flow.step = flow.cityId ? 'service' : 'city';
    if (flow.step === 'details' && flow.service !== 'collecte' && !flow.offer && flow.service !== 'achat') flow.step = 'result';
    if (!STEPS.includes(flow.step)) flow.step = 'city';
    shell();
    busy = false;
    current = null;
    stack = [];
    if (start === 'orders' || start === 'login' || start === 'track') {
      if (start === 'track' && flow.step !== 'intro') stack = ['orders'];
      await show(start, 1, arg);
    } else {
      await show(flow.step, 1);
    }
  };
  window.leaveFlow = () => { clearInterval(trackTimer); document.body.classList.remove('flow-mode'); };
})();
