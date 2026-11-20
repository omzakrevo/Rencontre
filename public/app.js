'use strict';
/* GazFlow — interface web (SPA sans framework, routage par hash). */

const state = {
  token: localStorage.getItem('gf_token'),
  me: null,
  cities: [],
  cart: { tenantId: null, cityId: null, items: {} }, // items: { offer_id: qty }
};
let refreshTimer = null;

// ---------- Utilitaires ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur = 'FCFA') => `${Number(n || 0).toLocaleString('fr-FR')} ${esc(cur)}`;
const date = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const view = $('#view');

const KIND = { recharge: 'Recharge', bouteille: 'Bouteille neuve', accessoire: 'Accessoire' };
const PAY = { especes: 'Espèces à la livraison', mobile_money: 'Mobile Money', carte: 'Carte bancaire' };
const PAY_STATUS = { en_attente: 'Non payé', paye: 'Payé', rembourse: 'Remboursé' };
const SLOT = { asap: 'Dès que possible', matin: 'Matin (8h–12h)', apres_midi: 'Après-midi (12h–17h)', soir: 'Soir (17h–21h)' };
const FLOW = ['en_attente', 'confirmee', 'assignee', 'en_livraison', 'livree'];
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
const cityOptions = (selected, filter = () => true) => state.cities.filter(filter)
  .map((c) => `<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}>${esc(c.name)} — ${esc(c.country)}</option>`).join('');

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
  return { superadmin: '#/plateforme', admin: '#/admin', driver: '#/livraisons', customer: '#/commander' }[role] || '#/';
}

// ---------- Navigation ----------
function renderNav() {
  const u = state.me?.user;
  const links = {
    guest: [['#/commander', 'Commander'], ['#/devenir-distributeur', 'Devenir distributeur'], ['#/connexion', 'Connexion']],
    customer: [['#/commander', 'Commander'], ['#/commandes', 'Mes commandes']],
    admin: [['#/admin', 'Tableau de bord'], ['#/admin/commandes', 'Commandes'], ['#/admin/catalogue', 'Catalogue'],
      ['#/admin/zones', 'Villes'], ['#/admin/livreurs', 'Livreurs'], ['#/admin/abonnement', 'Abonnement']],
    driver: [['#/livraisons', 'Mes livraisons']],
    superadmin: [['#/plateforme', 'Distributeurs']],
  }[u ? u.role : 'guest'];
  const cur = location.hash || '#/';
  $('#nav').innerHTML = links.map(([href, label]) => `<a href="${href}" class="${cur === href ? 'active' : ''}">${label}</a>`).join('')
    + (u ? `<span class="who hide-sm">${esc(u.name)} · ${ROLE[u.role]}</span><button id="logout">Déconnexion</button>` : '');
  $('#logout')?.addEventListener('click', () => logout());
}

// ---------- Pages publiques ----------
async function pageHome() {
  const plans = await api('GET', '/api/plans');
  const served = state.cities.filter((c) => c.providers > 0);
  view.innerHTML = `
    <section class="hero">
      <h1>Votre gaz livré chez vous, <span style="color:var(--primary)">en moins d'une heure</span></h1>
      <p>Choisissez votre ville, comparez les distributeurs, commandez votre recharge ou bouteille et suivez la livraison en temps réel.</p>
      <form class="picker" id="pick">
        <select name="city" required aria-label="Votre ville"><option value="">Choisir votre ville…</option>${cityOptions(null, (c) => c.providers > 0)}</select>
        <button class="btn primary">Commander</button>
      </form>
      <p class="small muted" style="margin-top:12px">${served.length} villes desservies : ${served.map((c) => esc(c.name)).join(', ')}</p>
    </section>
    <section class="grid g3 features">
      <div class="card feature"><div class="ic">🏙️</div><h3>Multi-villes</h3><p class="muted">Chaque distributeur gère ses villes, ses prix, ses frais de livraison et son stock localement.</p></div>
      <div class="card feature"><div class="ic">🛵</div><h3>Livreurs connectés</h3><p class="muted">Assignation des courses, suivi des statuts et paiement à la livraison ou Mobile Money.</p></div>
      <div class="card feature"><div class="ic">📊</div><h3>Pilotage</h3><p class="muted">Tableau de bord : chiffre d'affaires par ville, commandes en cours, alertes de stock bas.</p></div>
    </section>
    <section>
      <h2 style="text-align:center">Vous êtes distributeur de gaz ?</h2>
      <p class="muted" style="text-align:center">Digitalisez vos ventes avec un abonnement mensuel. Sans engagement.</p>
      <div class="grid g3">${plans.map((p) => `
        <div class="card plan ${p.id === 'pro' ? 'featured' : ''}">
          <h3>${esc(p.label)}</h3>
          <div class="price">${money(p.price)}<span class="small muted"> /mois</span></div>
          <p class="muted">${p.maxCities ? `${p.maxCities} ville(s)` : 'Villes illimitées'} · ${p.maxDrivers ? `${p.maxDrivers} livreurs` : 'Livreurs illimités'}</p>
          <a class="btn ${p.id === 'pro' ? 'primary' : ''}" href="#/devenir-distributeur?plan=${p.id}">Choisir</a>
        </div>`).join('')}
      </div>
    </section>`;
  $('#pick').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/commander?ville=${formData(e.target).city}`;
  });
}

const DEMO = `<div class="demo">Comptes de démonstration (mot de passe <b>demo1234</b>) :<br>
  ${['client@demo.app', 'admin@gazexpress.ci', 'livreur@gazexpress.ci', 'super@gazflow.app'].map((e) => `<code data-demo="${e}">${e}</code>`).join(' · ')}</div>`;

function pageLogin(params) {
  const tab = params.get('tab') || 'login';
  view.innerHTML = `
    <div class="card auth">
      <div class="tabs"><button data-tab="login" class="${tab === 'login' ? 'on' : ''}">Connexion</button><button data-tab="register" class="${tab === 'register' ? 'on' : ''}">Créer un compte client</button></div>
      ${tab === 'login' ? `
        <form id="f">
          <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
          <div class="field"><label>Mot de passe</label><input name="password" type="password" required autocomplete="current-password"></div>
          <button class="btn primary" style="width:100%">Se connecter</button>
        </form>
        <p></p>${DEMO}` : `
        <form id="f">
          <div class="field"><label>Nom complet</label><input name="name" required></div>
          <div class="field"><label>Téléphone</label><input name="phone" type="tel" required placeholder="+225 07 00 00 00 00"></div>
          <div class="field"><label>Ville</label><select name="city_id">${cityOptions(null)}</select></div>
          <div class="field"><label>Email</label><input name="email" type="email" required></div>
          <div class="field"><label>Mot de passe (8 caractères min.)</label><input name="password" type="password" minlength="8" required></div>
          <button class="btn primary" style="width:100%">Créer mon compte</button>
        </form>`}
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
  const plans = await api('GET', '/api/plans');
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
  const u = state.me?.user;
  const cityId = params.get('ville') || state.cart.cityId || u?.city_id || '';
  view.innerHTML = `
    <div class="row between"><h1>Commander du gaz</h1>
      <select id="city" style="max-width:320px" aria-label="Ville"><option value="">Choisir une ville…</option>${cityOptions(cityId)}</select>
    </div>
    <div id="catalog" class="stack"></div>`;
  $('#city').addEventListener('change', (e) => { location.hash = `#/commander?ville=${e.target.value}`; });
  if (!cityId) { $('#catalog').innerHTML = '<div class="card empty">Sélectionnez votre ville pour voir les distributeurs disponibles.</div>'; return; }

  if (String(state.cart.cityId) !== String(cityId)) state.cart = { tenantId: null, cityId, items: {} };
  const providers = await api('GET', `/api/catalog?city_id=${cityId}`);
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
  if (!orders.length) return '<div class="empty">Aucune commande pour le moment.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Réf.</th><th>Date</th>${showTenant ? '<th>Distributeur</th>' : ''}${showCustomer ? '<th>Client</th>' : ''}
    <th>Ville</th><th class="hide-sm">Articles</th><th>Total</th><th>Statut</th>${showCustomer ? '<th class="hide-sm">Livreur</th>' : ''}</tr></thead><tbody>
    ${orders.map((o) => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.ref)}</b></td><td class="small">${date(o.created_at)}</td>
      ${showTenant ? `<td>${esc(o.tenant_name)}</td>` : ''}${showCustomer ? `<td>${esc(o.customer_name)}<br><span class="small muted">${esc(o.phone)}</span></td>` : ''}
      <td>${esc(o.city_name)}</td><td class="small hide-sm">${esc(o.summary)}</td><td class="price">${money(o.total, o.currency)}</td>
      <td>${badge(o.status, o.status_label)}<br>${payBadge(o.payment_status)}</td>
      ${showCustomer ? `<td class="small hide-sm">${esc(o.driver_name || '—')}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}
const bindRows = () => $$('tr[data-id]').forEach((r) => r.addEventListener('click', () => { location.hash = `#/commande/${r.dataset.id}`; }));

async function pageMyOrders() {
  const orders = await api('GET', '/api/orders');
  view.innerHTML = `<div class="row between"><h1>Mes commandes</h1><a class="btn primary" href="#/commander">Nouvelle commande</a></div>
    <div class="card">${ordersTable(orders, { showTenant: true })}</div>`;
  bindRows();
}

// ---------- Détail d'une commande (tous rôles) ----------
async function pageOrderDetail(id) {
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
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.address}, ${o.city_name}`)}`;

  view.innerHTML = `
    <a href="javascript:history.back()" class="small">← Retour</a>
    <div class="row between"><h1>Commande ${esc(o.ref)}</h1><div class="row">${badge(o.status, o.status_label)} ${payBadge(o.payment_status)}</div></div>
    ${step >= 0 ? `<div class="steps">${FLOW.map((_, i) => `<div class="${i <= step ? 'on' : ''}"></div>`).join('')}</div>` : ''}
    <div class="grid g2">
      <div class="card stack">
        <div><h3>Livraison</h3>
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
  $$('[data-status]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.status === 'annulee' && !confirm('Annuler cette commande ?')) return;
    try { await api('POST', `/api/orders/${o.id}/status`, { status: b.dataset.status }); toast('Statut mis à jour'); route(); } catch (e) { toast(e.message, true); }
  }));
  $('#assign')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', `/api/orders/${o.id}/assign`, formData(e.target)); toast('Livreur assigné'); route(); } catch (err) { toast(err.message, true); }
  });
  $('#paid')?.addEventListener('click', async () => { await api('POST', `/api/orders/${o.id}/paid`); toast('Paiement enregistré'); route(); });
  if (['en_attente', 'confirmee', 'assignee', 'en_livraison'].includes(o.status)) refreshTimer = setTimeout(route, 30000);
}

// ---------- Livreur ----------
async function pageDriver() {
  const orders = await api('GET', '/api/orders');
  const open = orders.filter((o) => ['assignee', 'en_livraison'].includes(o.status));
  const done = orders.filter((o) => !['assignee', 'en_livraison'].includes(o.status));
  view.innerHTML = `<h1>Mes livraisons</h1>
    <div class="stack">${open.length ? open.map((o) => `
      <div class="card"><div class="row between"><b>${esc(o.ref)}</b>${badge(o.status, o.status_label)}</div>
        <div>${esc(o.address)}, ${esc(o.city_name)}</div>
        <div class="small muted">${esc(o.summary)} · ${money(o.total, o.currency)} · ${PAY[o.payment_method]} · ${SLOT[o.slot]}</div>
        <div class="row" style="margin-top:10px">
          <a class="btn sm" href="tel:${esc(o.phone)}">📞 ${esc(o.customer_name)}</a>
          <a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.address}, ${o.city_name}`)}">🗺️ Itinéraire</a>
          ${o.status === 'assignee' ? `<button class="btn sm primary" data-go="${o.id}" data-s="en_livraison">Démarrer</button>` : `<button class="btn sm ok" data-go="${o.id}" data-s="livree">Livrée ✓</button>`}
          <a class="btn sm" href="#/commande/${o.id}">Détails</a>
        </div></div>`).join('') : '<div class="card empty">Aucune livraison en attente. 🎉</div>'}
      <div class="card"><h2>Historique</h2>${ordersTable(done)}</div>
    </div>`;
  bindRows();
  $$('[data-go]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('POST', `/api/orders/${b.dataset.go}/status`, { status: b.dataset.s }); toast('Statut mis à jour'); route(); } catch (e) { toast(e.message, true); }
  }));
  refreshTimer = setTimeout(route, 20000);
}

// ---------- Distributeur ----------
async function pageAdminDashboard() {
  const s = await api('GET', '/api/admin/stats');
  const cur = s.tenant.currency;
  view.innerHTML = `
    <div class="row between"><h1>${esc(s.tenant.name)}</h1><span class="muted">Offre ${esc(s.plan.label)}</span></div>
    <div class="grid g4">
      <div class="card kpi"><div class="v">${money(s.totals.revenue, cur)}</div><div class="l">Chiffre d'affaires livré</div></div>
      <div class="card kpi"><div class="v">${s.totals.orders || 0}</div><div class="l">Commandes</div></div>
      <div class="card kpi"><div class="v">${s.totals.open || 0}</div><div class="l">En cours</div></div>
      <div class="card kpi"><div class="v">${s.totals.delivered || 0}</div><div class="l">Livrées</div></div>
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
  const status = params.get('statut') || '';
  const orders = await api('GET', `/api/orders${status ? `?status=${status}` : ''}`);
  const tabs = [['', 'Toutes'], ['en_attente', 'En attente'], ['confirmee', 'Confirmées'], ['assignee', 'Assignées'], ['en_livraison', 'En livraison'], ['livree', 'Livrées'], ['annulee', 'Annulées']];
  view.innerHTML = `<h1>Commandes</h1>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${k === status ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
    <div class="card">${ordersTable(orders, { showCustomer: true })}</div>`;
  $$('[data-st]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/admin/commandes${b.dataset.st ? `?statut=${b.dataset.st}` : ''}`; }));
  bindRows();
  refreshTimer = setTimeout(route, 20000);
}

async function pageAdminCatalog() {
  const [products, zones] = await Promise.all([api('GET', '/api/admin/products'), api('GET', '/api/admin/zones')]);
  const cur = state.me.tenant.currency;
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
    await api('PATCH', `/api/admin/products/${b.dataset.toggle}`, { active: b.dataset.active !== '1' }); route();
  }));
  $('#newp').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/admin/products', formData(e.target)); toast('Produit ajouté'); route(); } catch (err) { toast(err.message, true); }
  });
}

async function pageAdminZones() {
  const zones = await api('GET', '/api/admin/zones');
  const plan = state.me.plan;
  const cur = state.me.tenant.currency;
  const taken = new Set(zones.map((z) => z.city_id));
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
    try { await api('POST', '/api/admin/zones', d); await loadCities(); toast('Ville ajoutée'); route(); } catch (err) { toast(err.message, true); }
  });
}

async function pageAdminDrivers() {
  const [drivers, zones] = await Promise.all([api('GET', '/api/admin/drivers'), api('GET', '/api/admin/zones')]);
  const plan = state.me.plan;
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
    try { await api('PATCH', `/api/admin/drivers/${b.dataset.d}`, { active: b.dataset.a !== '1' }); route(); } catch (e) { toast(e.message, true); }
  }));
  $('#newd').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (!d.city_id) delete d.city_id;
    try { await api('POST', '/api/admin/drivers', d); toast('Livreur créé'); route(); } catch (err) { toast(err.message, true); }
  });
}

async function pageAdminPlan() {
  const plans = await api('GET', '/api/plans');
  const current = state.me.tenant.plan;
  view.innerHTML = `<h1>Abonnement</h1><p class="muted">Changez d'offre à tout moment. La facturation est mensuelle.</p>
    <div class="grid g3">${plans.map((p) => `<div class="card plan ${p.id === current ? 'featured' : ''}">
      <h3>${esc(p.label)}</h3><div class="price">${money(p.price)}<span class="small muted"> /mois</span></div>
      <p class="muted">${p.maxCities ? `${p.maxCities} ville(s)` : 'Villes illimitées'} · ${p.maxDrivers ? `${p.maxDrivers} livreurs` : 'Livreurs illimités'}</p>
      ${p.id === current ? '<span class="badge s-livree">Offre actuelle</span>' : `<button class="btn" data-plan="${p.id}">Passer à ${esc(p.label)}</button>`}
    </div>`).join('')}</div>`;
  $$('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('PATCH', '/api/admin/plan', { plan: b.dataset.plan }); await loadMe(); toast('Offre mise à jour'); route(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Opérateur plateforme ----------
async function pagePlatform() {
  const [tenants, plans] = await Promise.all([api('GET', '/api/platform/tenants'), api('GET', '/api/plans')]);
  const active = tenants.filter((t) => t.active);
  view.innerHTML = `<h1>Plateforme GazFlow</h1>
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
    await api('PATCH', `/api/platform/tenants/${s.dataset.plan}`, { plan: s.value }); toast('Offre modifiée'); route();
  }));
  $$('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    await api('PATCH', `/api/platform/tenants/${b.dataset.act}`, { active: b.dataset.a !== '1' }); await loadCities(); route();
  }));
}

// ---------- Routeur ----------
async function loadMe() {
  state.me = state.token ? await api('GET', '/api/me').catch(() => null) : null;
  renderNav();
}
async function loadCities() { state.cities = await api('GET', '/api/cities'); }

async function route() {
  clearTimeout(refreshTimer);
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const role = state.me?.user.role;
  renderNav();
  const guard = (...roles) => {
    if (!role) { location.hash = `#/connexion?next=${encodeURIComponent(location.hash)}`; return false; }
    if (roles.length && !roles.includes(role)) { location.hash = homeFor(role); return false; }
    return true;
  };
  try {
    if (path === '/') return role ? (location.hash = homeFor(role)) : await pageHome();
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
    view.innerHTML = '<div class="card empty">Page introuvable. <a href="#/">Accueil</a></div>';
  } catch (e) {
    view.innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
(async () => {
  await Promise.all([loadCities(), loadMe()]);
  route();
})();
