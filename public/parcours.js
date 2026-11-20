'use strict';
/*
 * FasoGaz — parcours mobile pas-à-pas (« swipe ») :
 * présentation → ville → marque → bouteille → service → résultat → détails → confirmation.
 * Utilise les utilitaires globaux de app.js ($, esc, api, state, money, locate, directions, km, toast, setSession, loadMe).
 */
(() => {
  const KEY = 'fg_flow';
  const INTRO_KEY = 'fg_intro_seen';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Ordre des étapes ; « result » et « details » dépendent du service choisi.
  const STEPS = ['intro', 'city', 'brand', 'size', 'service', 'result', 'details', 'done'];
  const PROGRESS = ['city', 'brand', 'size', 'service', 'result', 'details'];

  const SERVICES = [
    { id: 'depot', icon: 'pin', title: 'Dépôt le plus proche', text: 'Je vais chercher mon gaz moi-même. Voir les dépôts sur la carte.' },
    { id: 'livraison', icon: 'truck', title: 'Me faire livrer', text: 'Un livreur m’apporte une bouteille pleine et reprend ma vide.' },
    { id: 'collecte', icon: 'refresh', title: 'Recharger ma bouteille', text: 'Un livreur récupère ma bouteille, la recharge et me la ramène.' },
    { id: 'achat', icon: 'plus', title: 'Acheter une bouteille neuve', text: 'Je n’ai pas de bouteille : j’en achète une, livrée chez moi.' },
  ];
  // Couleurs réelles des bouteilles au Burkina : Oryx rouge, Total orange, Sodigaz et Shell bleues.
  const BRAND_COLORS = { Sodigaz: '#1f5fc4', Oryx: '#d9261c', Total: '#f26a14', TotalEnergies: '#f26a14', Shell: '#1d63b8' };
  const brandColor = (b) => (b ? BRAND_COLORS[b] || '#64748b' : '#94a3b8');

  const ICONS = {
    pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>',
    truck: '<path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
    plus: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    route: '<path d="M6 19a3 3 0 1 0 0-6h12a3 3 0 1 0 0-6H8"/><circle cx="6" cy="19" r="1"/><circle cx="8" cy="7" r="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  };
  const ic = (name, size = 22) => `<svg class="fx-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  let bottleSeq = 0;
  /**
   * Bouteille de gaz dessinée comme les vraies : collerette avec poignées, robinet, corps arrondi,
   * cerclage, socle ajouré et nom de la marque. Les petites bouteilles sont trapues, les grandes élancées.
   */
  const bottleSvg = (kg, color = '#f25c05', label = '') => {
    const w = Number(kg) || 12.5;
    const id = `fxb${++bottleSeq}`;
    const bodyH = Math.max(46, Math.min(96, 30 + w * 3.4)); // hauteur du corps
    const bodyW = w <= 6 ? 58 : w <= 15 ? 52 : 46; // les grandes bouteilles sont plus fines
    const x = (80 - bodyW) / 2;
    const footY = 124;
    const bodyTop = footY - 8 - bodyH;
    const collarTop = bodyTop - 18;
    const r = Math.min(bodyW / 2.4, 22);
    const txt = label ? label.toUpperCase().slice(0, 8) : '';
    return `<svg class="fx-bottle" viewBox="0 0 80 132" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" x2="1">
          <stop offset="0" stop-color="${color}"/><stop offset=".28" stop-color="${color}"/>
          <stop offset=".42" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="${color}"/>
          <stop offset="1" stop-color="#000" stop-opacity=".25"/>
        </linearGradient>
      </defs>
      <ellipse cx="40" cy="128" rx="${bodyW / 2 + 4}" ry="3.5" fill="currentColor" opacity=".14"/>
      <!-- collerette de protection avec ses deux ouvertures (poignées) -->
      <path d="M${x + 10} ${bodyTop + 4} V${collarTop + 3} a3 3 0 0 1 3 -3 H${80 - x - 13} a3 3 0 0 1 3 3 V${bodyTop + 4}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round"/>
      <rect x="${x + 16}" y="${collarTop + 5}" width="${bodyW - 32}" height="7" rx="2" fill="${color}" opacity=".55"/>
      <!-- robinet -->
      <rect x="36.5" y="${collarTop + 6}" width="7" height="${bodyTop - collarTop - 4}" rx="1.5" fill="#8a6a2b"/>
      <rect x="33" y="${collarTop + 4}" width="14" height="4" rx="2" fill="#6b5320"/>
      <!-- corps -->
      <rect x="${x}" y="${bodyTop}" width="${bodyW}" height="${bodyH}" rx="${r}" fill="url(#${id})"/>
      <path d="M${x + 2} ${bodyTop + bodyH * 0.5} H${80 - x - 2}" stroke="#000" stroke-opacity=".18" stroke-width="1.2"/>
      ${txt ? `<text x="40" y="${bodyTop + bodyH * 0.42}" text-anchor="middle" font-family="Plus Jakarta Sans, system-ui, sans-serif"
        font-weight="800" font-size="${Math.min(9, (bodyW - 8) / (txt.length * 0.62))}" fill="#fff" letter-spacing=".3">${esc(txt)}</text>` : ''}
      <!-- socle ajouré -->
      <path d="M${x + 4} ${footY - 9} H${80 - x - 4} L${80 - x - 2} ${footY} H${x + 2} Z" fill="${color}"/>
      <rect x="${x + 9}" y="${footY - 6}" width="7" height="3" rx="1.5" fill="#000" opacity=".25"/>
      <rect x="${80 - x - 16}" y="${footY - 6}" width="7" height="3" rx="1.5" fill="#000" opacity=".25"/>
      <path d="M${x + 4} ${footY - 9} H${80 - x - 4}" stroke="#000" stroke-opacity=".2" stroke-width="1.5"/>
    </svg>`;
  };

  let flow = null; // { step, cityId, brand, weight, service, offer, tenant, ... }
  let root = null;
  let busy = false;
  let cache = { cityId: null, catalog: null, brands: null };
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

  const persist = () => save(KEY, flow);
  const city = () => state.cities.find((c) => c.id === flow.cityId);

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
  /** Offres du catalogue correspondant aux choix (marque, poids, type). */
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

  // ---------- Coquille ----------
  function shell() {
    document.body.classList.add('flow-mode');
    view.className = 'flow-view';
    view.innerHTML = `
      <div class="fx" id="fx">
        <header class="fx-head">
          <button class="fx-icon-btn" id="fx-back" type="button" aria-label="Étape précédente">${ic('back')}</button>
          <div class="fx-progress" aria-hidden="true"><i id="fx-bar"></i></div>
          <a class="fx-icon-btn" id="fx-menu" href="#/carte" aria-label="Voir le site complet">${ic('list')}</a>
        </header>
        <div class="fx-stage" id="fx-stage" aria-live="polite"></div>
      </div>`;
    root = $('#fx-stage');
    $('#fx-back').addEventListener('click', back);
    $('#fx-menu').setAttribute('href', state.me ? '#/commandes' : '#/carte');
    $('#fx-menu').setAttribute('aria-label', state.me ? 'Mes commandes' : 'Voir le site complet');
    bindSwipe($('#fx'));
  }

  function setProgress() {
    const i = PROGRESS.indexOf(flow.step);
    const pct = flow.step === 'done' ? 100 : i < 0 ? 0 : ((i + 1) / (PROGRESS.length + 1)) * 100;
    $('#fx-bar').style.width = `${pct}%`;
    $('#fx-back').style.visibility = ['intro', 'done'].includes(flow.step) ? 'hidden' : 'visible';
    document.querySelector('.fx-head').classList.toggle('on-intro', flow.step === 'intro');
  }

  /** Affiche une étape avec une transition glissée (dir = 1 en avant, -1 en arrière). */
  async function show(step, dir = 1) {
    if (busy) return;
    busy = true;
    flow.step = step;
    persist();
    setProgress();
    const html = await RENDER[step]().catch((e) => `<section class="fx-step"><div class="fx-empty"><p>${esc(e.message)}</p>
      <button class="fx-btn" type="button" onclick="location.reload()">Réessayer</button></div></section>`);
    const old = root.firstElementChild;
    const tpl = document.createElement('div');
    tpl.innerHTML = html.trim();
    const next = tpl.firstElementChild;
    next.querySelectorAll('.fx-stagger > *').forEach((el, i) => el.style.setProperty('--i', i));
    if (old && !reduced()) {
      old.classList.add(dir > 0 ? 'fx-out-left' : 'fx-out-right');
      next.classList.add(dir > 0 ? 'fx-in-right' : 'fx-in-left');
      root.appendChild(next);
      setTimeout(() => old.remove(), 380);
    } else {
      root.innerHTML = '';
      root.appendChild(next);
    }
    (BIND[step] || (() => {}))(next);
    next.querySelector('h1')?.focus({ preventScroll: true });
    root.scrollTop = 0;
    setTimeout(() => { busy = false; }, reduced() ? 0 : 260);
  }

  const go = (step) => show(step, 1);
  function back() {
    const prev = {
      city: 'intro', brand: 'city', size: 'brand', service: 'size', result: 'service',
      details: flow.service === 'collecte' ? 'service' : 'result',
    }[flow.step];
    if (prev) show(prev, -1);
  }
  /** Sélection d'un choix : petite animation, puis passage automatique à l'étape suivante. */
  function pick(btn, apply, nextStep) {
    if (busy) return;
    btn.parentElement.querySelectorAll('.is-picked').forEach((b) => b.classList.remove('is-picked'));
    btn.classList.add('is-picked');
    navigator.vibrate?.(8);
    apply();
    persist();
    setTimeout(() => go(typeof nextStep === 'function' ? nextStep() : nextStep), reduced() ? 0 : 280);
  }

  // ---------- Glisser (swipe) ----------
  function bindSwipe(el) {
    let x0 = null; let y0 = 0; let t0 = 0;
    el.addEventListener('touchstart', (e) => {
      if (e.target.closest('.leaflet-container, input, textarea, select, .fx-slides')) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.7 || Date.now() - t0 > 700) return;
      if (dx > 0) back();
      else forwardIfChosen();
    }, { passive: true });
  }
  function forwardIfChosen() {
    const nextOf = {
      city: flow.cityId && 'brand',
      brand: flow.brand !== undefined && 'size',
      size: flow.weight !== undefined && 'service',
      service: flow.service && (flow.service === 'collecte' ? 'details' : 'result'),
    }[flow.step];
    if (nextOf) go(nextOf);
  }

  // ---------- Rendu des étapes ----------
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
      const slides = [
        { art: 'fire', title: 'Votre gaz, <em>sans courir</em>', text: 'FasoGaz trouve votre gaz à Ouaga, Bobo, Banfora… au meilleur prix, près de chez vous.' },
        { art: 'steps', title: 'En <em>4 gestes</em>', text: 'Votre ville, votre marque, votre bouteille, puis vous choisissez : dépôt, livraison ou recharge.' },
        { art: 'bike', title: 'Livré <em>à la porte</em>', text: 'Un livreur apporte la bouteille pleine, ou récupère la vôtre pour la recharger. Vous payez à la livraison.' },
      ];
      return `
      <section class="fx-step fx-intro">
        <div class="fx-brand-big"><img src="/icons/icon-192.png" alt="" width="36" height="36"><span>FasoGaz</span></div>
        <div class="fx-slides" id="fx-slides">
          ${slides.map((s, i) => `
          <article class="fx-slide" data-i="${i}">
            <div class="fx-art fx-art-${s.art}">${introArt(s.art)}</div>
            <h1 ${i === 0 ? 'tabindex="-1"' : ''}>${s.title}</h1>
            <p>${s.text}</p>
          </article>`).join('')}
        </div>
        <div class="fx-dots" id="fx-dots">${slides.map((_, i) => `<button type="button" aria-label="Diapositive ${i + 1}" class="${i ? '' : 'on'}" data-dot="${i}"></button>`).join('')}</div>
        <div class="fx-actions">
          <button class="fx-btn fx-btn-primary" id="fx-start" type="button">Continuer</button>
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
            <button class="fx-choice ${c.id === flow.cityId ? 'is-picked' : ''}" type="button" data-city="${c.id}">
              <span class="fx-choice-main">${esc(c.name)}</span>
              <span class="fx-choice-sub">${c.providers} distributeur${c.providers > 1 ? 's' : ''}</span>
            </button>`).join('')}
        </div>
        ${soon.length ? `<p class="fx-soon">Bientôt : ${soon.map((c) => esc(c.name)).join(', ')}.</p>` : ''}
      </section>`;
    },

    async brand() {
      const { brands } = await catalog();
      const list = [...brands, null];
      return `
      <section class="fx-step">
        ${head('Étape 2 sur 4', 'Quelle marque de gaz ?', `Disponibles à ${esc(city()?.name || '')}.`)}
        <div class="fx-grid fx-stagger">
          ${list.map((b) => `
            <button class="fx-choice fx-brand ${flow.brand === b ? 'is-picked' : ''}" type="button" data-brand="${esc(b ?? '')}" style="--c:${brandColor(b)}">
              <span class="fx-brand-art">${b ? bottleSvg(12.5, brandColor(b), b)
    : `<span class="fx-brand-mix">${bottleSvg(6, BRAND_COLORS.Oryx)}${bottleSvg(12.5, BRAND_COLORS.Sodigaz)}${bottleSvg(6, BRAND_COLORS.Total)}</span>`}</span>
              <span class="fx-choice-main">${b ? esc(b) : 'Peu importe'}</span>
              <span class="fx-choice-sub">${b ? 'Bouteille de la marque' : 'Le moins cher'}</span>
            </button>`).join('')}
        </div>
      </section>`;
    },

    async size() {
      const { catalog: cat } = await catalog();
      const weights = new Map();
      for (const t of cat) {
        for (const o of t.offers) {
          if (!['recharge', 'bouteille'].includes(o.kind) || !o.weight_kg) continue;
          if (flow.brand && o.brand && o.brand !== flow.brand) continue;
          const w = Number(o.weight_kg);
          const p = weights.get(w);
          if (o.kind === 'recharge' && (!p || o.price < p)) weights.set(w, o.price);
          else if (!weights.has(w)) weights.set(w, null);
        }
      }
      const list = [...weights.entries()].sort((a, b) => a[0] - b[0]);
      const color = flow.brand ? brandColor(flow.brand) : '#f25c05';
      const label = flow.brand || '';
      return `
      <section class="fx-step">
        ${head('Étape 3 sur 4', 'Quelle bouteille ?', 'Choisissez la taille de votre bouteille.')}
        ${chosen()}
        ${list.length ? `<div class="fx-sizes fx-stagger">
          ${list.map(([w, price]) => `
            <button class="fx-choice fx-size ${Number(flow.weight) === w ? 'is-picked' : ''}" type="button" data-weight="${w}">
              ${bottleSvg(w, color, label)}
              <span class="fx-choice-main">${String(w).replace('.', ',')} kg</span>
              <span class="fx-choice-sub">${price ? `recharge dès ${money(price)}` : 'bouteille neuve'}</span>
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
        // Pas de bouteille neuve à ce poids : on montre les autres tailles.
        const w = flow.weight; flow.weight = null; offers = matchingOffers(cat, kinds); flow.weight = w; relaxed = true;
      }
      return `
      <section class="fx-step">
        ${head(flow.service === 'achat' ? 'Bouteille neuve' : 'Livraison', 'Choisissez votre offre', 'Prix livraison comprise, du moins cher au plus cher.')}
        ${chosen()}
        ${relaxed && offers.length ? '<p class="fx-note">Pas de bouteille neuve à cette taille : voici les autres tailles disponibles.</p>' : ''}
        ${offers.length ? `<div class="fx-list fx-stagger">
          ${offers.map((o) => `
            <button class="fx-choice fx-offer ${o.in_stock ? '' : 'is-off'}" type="button" data-offer="${o.offer_id}" ${o.in_stock ? '' : 'disabled'}>
              <span class="fx-offer-top">
                <span class="fx-choice-main">${esc(o.tenant.name)}</span>
                <span class="fx-price">${money(o.price + o.tenant.delivery_fee, o.tenant.currency)}</span>
              </span>
              <span class="fx-choice-sub">${esc(o.brand ? `${o.brand} · ` : '')}${esc(o.name)}</span>
              <span class="fx-offer-meta">
                <span>Gaz ${money(o.price, o.tenant.currency)}</span>
                <span>Livraison ${money(o.tenant.delivery_fee, o.tenant.currency)}</span>
                <span>≈ ${o.tenant.min_delay_minutes} min</span>
                ${o.in_stock ? '' : '<span class="fx-tag-off">Épuisé</span>'}
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
          <div><b>${esc(o.label)}</b><span>${esc(o.tenant_name)} · ≈ ${o.delay} min</span></div>
          <strong>${money(total, o.currency)}</strong>
        </div>` : chosen()}
        <form class="fx-form fx-stagger" id="fx-form" novalidate>
          <div class="fx-field">
            <label for="fx-address">Adresse ou repère</label>
            <div class="fx-inline">
              <input id="fx-address" name="address" required minlength="5" maxlength="300" autocomplete="street-address"
                placeholder="Ex. Ouaga 2000, près de la pharmacie…" value="${esc(flow.address || '')}">
              <button class="fx-icon-btn fx-gps" type="button" id="fx-gps" aria-label="Utiliser ma position">${ic('gps', 20)}</button>
            </div>
            <span class="fx-help" id="fx-gps-state">${flow.lat ? 'Position GPS ajoutée ✓' : 'Le GPS aide le livreur à vous trouver.'}</span>
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
          ${me ? '' : `<div class="fx-account">
            <div class="fx-seg fx-seg-sm" role="tablist">
              <label><input type="radio" name="acct" value="new" checked><span>Nouveau client</span></label>
              <label><input type="radio" name="acct" value="login"><span>J’ai un compte</span></label>
            </div>
            <div class="fx-field" data-acct="new"><label for="fx-name">Votre nom</label><input id="fx-name" name="name" autocomplete="name" maxlength="80"></div>
            <div class="fx-field"><label for="fx-email">E-mail</label><input id="fx-email" name="email" type="email" autocomplete="email"></div>
            <div class="fx-field"><label for="fx-pass">Mot de passe</label><input id="fx-pass" name="password" type="password" autocomplete="new-password" minlength="8" placeholder="8 caractères minimum"></div>
          </div>`}
          <p class="fx-error" id="fx-error" role="alert"></p>
          <button class="fx-btn fx-btn-primary fx-submit" type="submit" id="fx-submit">
            <span>${isRequest ? 'Envoyer la demande' : `Commander · ${money(total, o.currency)}`}</span>
          </button>
        </form>
      </section>`;
    },

    async done() {
      const d = flow.doneInfo || {};
      return `
      <section class="fx-step fx-done">
        <div class="fx-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-15"/></svg></div>
        <h1 tabindex="-1">${d.order ? 'Commande envoyée !' : 'Demande envoyée !'}</h1>
        <p class="fx-sub">${d.order
    ? `Référence <b>${esc(d.ref)}</b>. Le distributeur confirme et un livreur arrive.`
    : 'Les distributeurs de votre ville reçoivent votre demande. Vous serez appelé pour la confirmer.'}</p>
        <div class="fx-actions">
          <a class="fx-btn fx-btn-primary" href="${d.order ? `#/commande/${d.id}` : '#/demande'}">Suivre ${d.order ? 'ma commande' : 'ma demande'}</a>
          <button class="fx-btn fx-btn-ghost" type="button" id="fx-again">Nouvelle commande</button>
        </div>
      </section>`;
    },
  };

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

  function introArt(kind) {
    if (kind === 'fire') {
      return `<svg viewBox="0 0 200 160" aria-hidden="true">
        <circle class="fx-pulse" cx="100" cy="88" r="62" fill="var(--primary-soft)"/>
        <g class="fx-float">${bottleSvg(12.5).replace('<svg class="fx-bottle" viewBox="0 0 80 132" aria-hidden="true">', '<svg x="60" y="20" width="80" height="132" viewBox="0 0 80 132">')}</g>
        <g class="fx-flame" transform="translate(150 40)"><path d="M0 -26 C 14 -8 20 4 14 16 C 8 28 -8 28 -14 16 C -20 4 -12 -6 0 -26 Z" fill="url(#fxg)"/></g>
        <defs><linearGradient id="fxg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd166"/><stop offset="1" stop-color="#f25c05"/></linearGradient></defs>
      </svg>`;
    }
    if (kind === 'steps') {
      const labels = ['Ville', 'Marque', 'Bouteille', 'Service'];
      return `<div class="fx-steps-art">${labels.map((l, i) => `<span style="--i:${i}"><b>${i + 1}</b>${l}</span>`).join('')}</div>`;
    }
    return `<svg viewBox="0 0 220 150" aria-hidden="true">
      <path class="fx-road" d="M0 128 H220" stroke="var(--border)" stroke-width="4" stroke-dasharray="14 10"/>
      <g class="fx-ride">
        <circle cx="70" cy="118" r="14" fill="none" stroke="var(--text)" stroke-width="5"/>
        <circle cx="150" cy="118" r="14" fill="none" stroke="var(--text)" stroke-width="5"/>
        <path d="M70 118 L96 86 H132 L150 118" fill="none" stroke="var(--primary)" stroke-width="7" stroke-linejoin="round"/>
        <rect x="58" y="58" width="36" height="34" rx="8" fill="var(--primary)"/>
        <circle cx="118" cy="52" r="10" fill="var(--text)"/>
        <path d="M118 62 L128 86" stroke="var(--text)" stroke-width="7" stroke-linecap="round"/>
      </g>
    </svg>`;
  }

  // ---------- Interactions par étape ----------
  const BIND = {
    intro(el) {
      const track = $('#fx-slides', el);
      const dots = [...el.querySelectorAll('[data-dot]')];
      const idx = () => Math.round(track.scrollLeft / track.clientWidth);
      track.addEventListener('scroll', () => {
        const i = idx();
        dots.forEach((d, j) => d.classList.toggle('on', i === j));
        $('#fx-start', el).textContent = i === dots.length - 1 ? 'Commencer' : 'Continuer';
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
            };
          }
        }
      }, 'details')));
      $('#fx-ask', el)?.addEventListener('click', () => { flow.offer = null; persist(); go('details'); });
    },
    details(el) {
      const form = $('#fx-form', el);
      $('#fx-gps', el).addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('is-loading');
        try {
          const p = await locate();
          flow.lat = p.lat; flow.lng = p.lng; persist();
          $('#fx-gps-state', el).textContent = 'Position GPS ajoutée ✓';
          btn.classList.add('is-ok');
        } catch (err) { $('#fx-gps-state', el).textContent = err.message; }
        btn.classList.remove('is-loading');
      });
      form.querySelectorAll('input[name="acct"]').forEach((r) => r.addEventListener('change', () => {
        const isNew = form.acct.value === 'new';
        form.querySelector('[data-acct="new"]').hidden = !isNew;
        $('#fx-pass', el).autocomplete = isNew ? 'new-password' : 'current-password';
      }));
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(form, el); });
    },
    done(el) {
      $('#fx-again', el).addEventListener('click', () => {
        flow = { step: 'city', cityId: flow.cityId };
        persist();
        show('city', -1);
      });
    },
  };

  function bindDepot(el) {
    $('#fx-locate', el)?.addEventListener('click', async () => {
      try { await locate(); busy = false; show('result', 1); } catch (e) { toast(e.message, true); }
    });
    const mapEl = $('#fx-map', el);
    const pts = (flow.depots || []).filter((p) => p.lat != null);
    if (!window.L || !pts.length) { mapEl.remove(); return; }
    setTimeout(() => {
      const map = L.map(mapEl, { zoomControl: false, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      const bounds = [];
      pts.forEach((p) => {
        const m = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: `fx-marker ${p.available ? '' : 'is-off'}`, html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] }),
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
      go('done');
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
    btn.classList.remove('is-loading');
  }

  // ---------- Point d'entrée (appelé par le routeur de app.js) ----------
  window.pageFlow = async function pageFlow() {
    const saved = load(KEY, null);
    flow = saved && saved.step && saved.step !== 'done' ? saved : { step: 'intro' };
    if (!load(INTRO_KEY, false)) flow.step = 'intro';
    else if (flow.step === 'intro') flow.step = 'city';
    if (flow.cityId && !state.cities.some((c) => c.id === flow.cityId)) flow = { step: 'city' };
    // Une étape qui dépend d'un choix absent repart au bon endroit.
    if (['result', 'details'].includes(flow.step) && !flow.service) flow.step = flow.cityId ? 'service' : 'city';
    if (flow.step === 'details' && flow.service !== 'collecte' && !flow.offer && flow.service !== 'achat') flow.step = 'result';
    shell();
    busy = false;
    await show(flow.step, 1);
  };
  window.leaveFlow = () => document.body.classList.remove('flow-mode');
})();
