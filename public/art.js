'use strict';
/*
 * GazFlow — illustrations SVG animées (motion design).
 * Dessinées à la main, sans dépendance ni droits d'auteur. Les animations sont en CSS (styles.css, section « Art »)
 * et sont désactivées automatiquement si l'utilisateur a demandé à réduire les animations.
 */
(function () {
  const FLAME = 'M0 -14 C 6 -6 10 -2 8 5 C 6 11 -6 11 -8 5 C -10 -1 -4 -4 0 -14 Z';

  const defs = `
    <defs>
      <linearGradient id="gf-bottle" x1="0" x2="1">
        <stop offset="0" stop-color="#c2410c"/><stop offset=".35" stop-color="#ff8a3d"/>
        <stop offset=".6" stop-color="#f25c05"/><stop offset="1" stop-color="#b8400a"/>
      </linearGradient>
      <linearGradient id="gf-bottle-grey" x1="0" x2="1">
        <stop offset="0" stop-color="#64748b"/><stop offset=".4" stop-color="#cbd5e1"/><stop offset="1" stop-color="#64748b"/>
      </linearGradient>
      <linearGradient id="gf-flame" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#f25c05"/><stop offset="1" stop-color="#ffd166"/>
      </linearGradient>
      <radialGradient id="gf-glow"><stop offset="0" stop-color="#ff7a18" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a18" stop-opacity="0"/></radialGradient>
      <linearGradient id="gf-card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16325a"/><stop offset="1" stop-color="#0e223f"/></linearGradient>
    </defs>`;

  /** Petite flamme (logo). */
  const flame = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><g class="a-flicker">
    <path d="${FLAME}" fill="url(#gf-flame)"/><path d="M0 -4 C 3 0 4 2 3 5 C 2 8 -2 8 -3 5 C -4 2 -2 0 0 -4 Z" fill="#fff4d6"/></g></g>`;

  /** Bouteille de gaz (repère local : 100 × 150, origine en haut à gauche). */
  const bottle = (x, y, s = 1, { grey = false, cls = '' } = {}) => `
    <g transform="translate(${x} ${y}) scale(${s})"><g class="${cls}">
      <ellipse cx="50" cy="150" rx="40" ry="6" fill="#000" opacity=".18"/>
      <path d="M28 6 h44 a6 6 0 0 1 6 6 v20 h-11 v-13 h-34 v13 h-11 v-20 a6 6 0 0 1 6 -6z" fill="${grey ? '#94a3b8' : '#9a3412'}"/>
      <rect x="43" y="14" width="14" height="16" rx="3" fill="#475569"/>
      <rect x="8" y="30" width="84" height="110" rx="32" fill="url(#${grey ? 'gf-bottle-grey' : 'gf-bottle'})"/>
      <rect x="17" y="134" width="66" height="12" rx="4" fill="${grey ? '#64748b' : '#9a3412'}"/>
      <rect x="8" y="78" width="84" height="26" fill="#fff" opacity="${grey ? '.5' : '.92'}"/>
      ${grey ? '' : flame(50, 93, .9)}
      <rect x="20" y="42" width="9" height="84" rx="4.5" fill="#fff" opacity=".28"/>
    </g></g>`;

  /** Scooter de livraison avec bouteille (repère local : centre bas des roues). */
  const scooter = (cls = '') => `
    <g class="${cls}">
      <g class="a-bob">
        <rect x="-38" y="-52" width="20" height="26" rx="7" fill="url(#gf-bottle)"/>
        <rect x="-38" y="-42" width="20" height="6" fill="#fff" opacity=".9"/>
        <rect x="-31" y="-58" width="6" height="7" rx="1.5" fill="#475569"/>
        <path d="M-34 -14 Q -32 -30 -12 -30 L 6 -30 L 15 -14 L 32 -14 Q 37 -14 35 -8 L -36 -8 Z" fill="#f25c05"/>
        <path d="M18 -14 L 11 -42 L 21 -44" fill="none" stroke="#1e293b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M-8 -30 L 0 -52" stroke="#1d4ed8" stroke-width="10" stroke-linecap="round"/>
        <path d="M-1 -48 L 16 -42" stroke="#1d4ed8" stroke-width="5" stroke-linecap="round"/>
        <circle cx="3" cy="-60" r="8" fill="#ffb703"/><path d="M-5 -60 a8 8 0 0 1 16 0z" fill="#f25c05"/>
      </g>
      <g transform="translate(-23 -8)"><circle r="10" fill="#1e293b"/><g class="a-spin"><circle r="5" fill="#cbd5e1"/><rect x="-1" y="-9" width="2" height="18" fill="#94a3b8"/></g></g>
      <g transform="translate(25 -8)"><circle r="10" fill="#1e293b"/><g class="a-spin"><circle r="5" fill="#cbd5e1"/><rect x="-1" y="-9" width="2" height="18" fill="#94a3b8"/></g></g>
    </g>`;

  /** Épingle de carte. */
  const pin = (x, y, color, cls = '', delay = 0) => `
    <g transform="translate(${x} ${y})"><g class="${cls}" style="animation-delay:${delay}s">
      <path d="M0 0 C -10 -12 -12 -18 -12 -22 a12 12 0 0 1 24 0 c0 4 -2 10 -12 22z" fill="${color}"/>
      <circle cy="-22" r="5" fill="#fff"/></g></g>`;

  const house = (x, y) => `<g transform="translate(${x} ${y})">
    <circle r="26" fill="#3b82f6" opacity=".25" class="a-ping"/>
    <path d="M-16 4 L 0 -12 L 16 4 V 18 H -16 Z" fill="#e2e8f0"/><path d="M-20 6 L 0 -16 L 20 6" fill="none" stroke="#f25c05" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="-5" y="6" width="10" height="12" rx="2" fill="#1d4ed8"/></g>`;

  const notif = (x, y, w, icon, title, sub, cls) => `
    <g transform="translate(${x} ${y})"><g class="${cls}">
      <rect width="${w}" height="56" rx="16" fill="#fff"/>
      ${icon}
      <text x="58" y="25" font-size="14" font-weight="800" fill="#0f172a">${title}</text>
      <text x="58" y="43" font-size="12" fill="#64748b">${sub}</text>
    </g></g>`;

  const check = '<circle cx="29" cy="28" r="16" fill="#16a34a"/><path d="M21 28 l6 6 l11 -12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  const scooterIcon = '<circle cx="29" cy="28" r="16" fill="#fff1e8"/><g transform="translate(29 37) scale(.38)">' + scooter() + '</g>';

  const Art = {};

  /** Scène principale de l'accueil : carte, trajet, scooter, bouteille, notifications. */
  Art.hero = () => `
    <svg class="art art-hero" viewBox="0 0 560 470" role="img" aria-label="Un livreur à scooter apporte une bouteille de gaz du dépôt jusqu'à la maison du client" font-family="inherit">
      ${defs}
      <circle cx="300" cy="235" r="230" fill="url(#gf-glow)" class="a-breathe"/>
      <g class="a-float-slow">
        <rect x="40" y="60" width="400" height="300" rx="30" fill="url(#gf-card)" stroke="#ffffff" stroke-opacity=".08"/>
        <g stroke="#21426e" stroke-width="12" stroke-linecap="round" fill="none">
          <path d="M60 160 H420"/><path d="M60 270 H420"/><path d="M160 80 V340"/><path d="M330 80 V340"/><path d="M70 340 L 260 120"/>
        </g>
        <ellipse cx="250" cy="310" rx="44" ry="26" fill="#1f5a45" opacity=".8"/>
        <path d="M40 300 Q 90 290 120 330 L 120 360 H 70 Q 40 360 40 330 Z" fill="#1b4a78" opacity=".9"/>
        <path id="gf-route" d="M110 290 C 170 290 165 200 235 200 S 330 130 380 118" fill="none" stroke="#ffb703" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12" class="a-dash"/>
        ${pin(205, 120, '#22c55e', 'a-drop', 0.2)}
        ${pin(300, 300, '#22c55e', 'a-drop', 0.5)}
        ${pin(405, 255, '#94a3b8', 'a-drop', 0.8)}
        ${pin(80, 185, '#22c55e', 'a-drop', 1.1)}
        <g transform="translate(110 290)"><circle r="22" fill="#f25c05" opacity=".25" class="a-ping"/><circle r="15" fill="#f25c05"/>${flame(0, 2, .8)}</g>
        ${house(380, 112)}
        <g class="a-ride"><g transform="scale(.62)">${scooter()}</g>
          <animateMotion dur="7s" repeatCount="indefinite" rotate="auto" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines=".45 0 .55 1"><mpath href="#gf-route"/></animateMotion>
        </g>
      </g>
      <g class="a-float">${bottle(420, 220, 1.12)}</g>
      ${notif(14, 10, 236, check, 'Demande prise en charge', 'Faso Gaz · à l’instant', 'a-pop a-pop-1')}
      ${notif(232, 392, 214, scooterIcon, 'Livreur à 600 m', 'Arrivée dans 6 min', 'a-pop a-pop-2')}
      <g transform="translate(520 150)"><path class="a-spark" d="M0 -10 L 3 -3 L 10 0 L 3 3 L 0 10 L -3 3 L -10 0 L -3 -3 Z" fill="#ffd166"/></g>
      <g transform="translate(30 420)"><path class="a-spark a-spark-2" d="M0 -8 L 2 -2 L 8 0 L 2 2 L 0 8 L -2 2 L -8 0 L -2 -2 Z" fill="#ffd166"/></g>
    </svg>`;

  /** Étape 1 : taper sa marque, les points apparaissent. */
  Art.stepSearch = () => `
    <svg class="art" viewBox="0 0 220 160" role="img" aria-label="Recherche de la marque Oryx sur le téléphone, les points de vente apparaissent">
      ${defs}
      <rect x="62" y="6" width="96" height="150" rx="16" class="ill-device"/>
      <rect x="70" y="18" width="80" height="20" rx="10" class="ill-soft"/>
      <text x="80" y="32" font-size="11" font-weight="700" class="ill-text">
        <tspan class="a-type a-type-1">O</tspan><tspan class="a-type a-type-2">r</tspan><tspan class="a-type a-type-3">y</tspan><tspan class="a-type a-type-4">x</tspan></text>
      <rect x="108" y="23" width="2" height="11" fill="#f25c05" class="a-caret"/>
      <rect x="70" y="46" width="80" height="62" rx="10" fill="#dbeafe" opacity=".7"/>
      <path d="M70 80 H150 M100 46 V108" stroke="#fff" stroke-width="5"/>
      ${pin(88, 72, '#16a34a', 'a-drop', 0.9)}${pin(128, 96, '#16a34a', 'a-drop', 1.2)}${pin(138, 64, '#f25c05', 'a-drop', 1.5)}
      <rect x="70" y="116" width="80" height="14" rx="7" class="ill-soft"/><rect x="74" y="120" width="40" height="6" rx="3" fill="#16a34a" opacity=".7"/>
      <rect x="70" y="134" width="80" height="14" rx="7" class="ill-soft"/><rect x="74" y="138" width="54" height="6" rx="3" fill="#16a34a" opacity=".45"/>
      <g class="a-float">${bottle(168, 70, .32)}</g>
      ${flame(30, 60, 1.4)}
    </svg>`;

  /** Étape 2 : la demande part vers les dépôts proches. */
  Art.stepRequest = () => {
    const depot = (x, y, win) => `<g transform="translate(${x} ${y})">
      <rect x="-20" y="-16" width="40" height="30" rx="6" class="ill-device"/><path d="M-24 -14 L 0 -30 L 24 -14" fill="none" stroke="#f25c05" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="-6" y="0" width="12" height="14" rx="2" class="ill-soft"/>
      ${win ? '<g class="a-win"><circle cx="18" cy="-18" r="10" fill="#16a34a"/><path d="M13 -18 l4 4 l7 -8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>' : ''}</g>`;
    return `
    <svg class="art" viewBox="0 0 220 160" role="img" aria-label="La demande est envoyée aux dépôts proches, l'un d'eux l'accepte">
      ${defs}
      <circle cx="110" cy="84" r="20" fill="none" stroke="#f25c05" stroke-width="2" class="a-wave"/>
      <circle cx="110" cy="84" r="20" fill="none" stroke="#f25c05" stroke-width="2" class="a-wave a-wave-2"/>
      <circle cx="110" cy="84" r="20" fill="none" stroke="#f25c05" stroke-width="2" class="a-wave a-wave-3"/>
      <g transform="translate(110 84)"><circle r="26" fill="#f25c05"/>
        <path d="M-12 -8 h24 a5 5 0 0 1 5 5 v10 a5 5 0 0 1 -5 5 h-14 l-8 7 v-7 h-2 a5 5 0 0 1 -5 -5 v-10 a5 5 0 0 1 5 -5z" fill="#fff"/>
        <path d="M-6 0 h12 M-6 5 h8" stroke="#f25c05" stroke-width="2.5" stroke-linecap="round"/></g>
      ${depot(34, 40, false)}${depot(190, 44, true)}${depot(40, 136, false)}${depot(186, 134, false)}
    </svg>`;
  };

  /** Étape 3 : le livreur arrive (route qui défile). */
  Art.stepDelivery = () => `
    <svg class="art" viewBox="0 0 220 160" role="img" aria-label="Le livreur roule vers vous avec la bouteille">
      ${defs}
      <clipPath id="gf-road-clip"><rect x="0" y="0" width="220" height="160" rx="14"/></clipPath>
      <g clip-path="url(#gf-road-clip)">
        <g class="a-scroll-slow" opacity=".55">
          ${[0, 220].map((o) => `<g transform="translate(${o} 0)"><rect x="8" y="44" width="28" height="70" rx="3" class="ill-soft"/><rect x="44" y="24" width="34" height="90" rx="3" class="ill-soft"/>
          <rect x="88" y="58" width="26" height="56" rx="3" class="ill-soft"/><rect x="124" y="36" width="40" height="78" rx="3" class="ill-soft"/><rect x="174" y="62" width="30" height="52" rx="3" class="ill-soft"/></g>`).join('')}
        </g>
        <rect x="0" y="114" width="220" height="46" fill="#334155"/>
        <g class="a-scroll">${[0, 220].map((o) => `<g transform="translate(${o} 0)">${[0, 55, 110, 165].map((x) => `<rect x="${x + 10}" y="134" width="30" height="5" rx="2.5" fill="#fbbf24"/>`).join('')}</g>`).join('')}</g>
        <g class="a-speed" stroke="#f25c05" stroke-width="3" stroke-linecap="round"><path d="M30 86 h22"/><path d="M20 98 h30"/><path d="M36 74 h14"/></g>
        <g transform="translate(112 126)">${scooter()}</g>
      </g>
    </svg>`;

  Art.serviceEchange = () => `
    <svg class="art" viewBox="0 0 160 110" role="img" aria-label="Une bouteille vide échangée contre une pleine">
      ${defs}
      <g class="a-float">${bottle(14, 18, .55, { grey: true })}</g>
      <g class="a-float a-float-late">${bottle(92, 18, .55)}</g>
      <g transform="translate(80 54)"><g class="a-rotate"><path d="M-14 -6 a15 15 0 0 1 26 -4" fill="none" stroke="#f25c05" stroke-width="4" stroke-linecap="round"/>
        <path d="M14 -16 l-1 7 l-7 -1" fill="none" stroke="#f25c05" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14 6 a15 15 0 0 1 -26 4" fill="none" stroke="#16a34a" stroke-width="4" stroke-linecap="round"/>
        <path d="M-14 16 l1 -7 l7 1" fill="none" stroke="#16a34a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    </svg>`;

  Art.serviceCollecte = () => `
    <svg class="art" viewBox="0 0 160 110" role="img" aria-label="Le livreur vient chercher la bouteille et la ramène pleine">
      ${defs}
      <path d="M10 98 H150" class="ill-line" stroke-width="3" stroke-dasharray="6 8"/>
      <g class="a-shuttle"><g transform="translate(60 96) scale(.85)">${scooter()}</g></g>
      <g transform="translate(128 20)"><circle r="16" fill="#16a34a" class="a-breathe"/><path d="M0 8 V -8 M-7 -1 L 0 -8 L 7 -1" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>
    </svg>`;

  Art.serviceNeuve = () => `
    <svg class="art" viewBox="0 0 160 110" role="img" aria-label="Une bouteille neuve qui brille">
      ${defs}
      <circle cx="80" cy="58" r="44" fill="url(#gf-glow)" class="a-breathe"/>
      <g class="a-float">${bottle(52, 14, .6)}</g>
      ${[[30, 30, 0], [126, 40, .6], [118, 92, 1.2], [36, 86, 1.8]].map(([x, y, d]) => `<g transform="translate(${x} ${y})"><path class="a-twinkle" style="animation-delay:${d}s" d="M0 -9 L 2.5 -2.5 L 9 0 L 2.5 2.5 L 0 9 L -2.5 2.5 L -9 0 L -2.5 -2.5 Z" fill="#ffb703"/></g>`).join('')}
    </svg>`;

  /** Tableau de bord distributeur (barres qui poussent, nouvelle demande qui arrive). */
  Art.dashboard = () => `
    <svg class="art art-dash" viewBox="0 0 380 260" role="img" aria-label="Tableau de bord du distributeur : ventes par ville et nouvelle demande">
      ${defs}
      <rect x="10" y="10" width="360" height="236" rx="20" fill="#0f2442" stroke="#ffffff" stroke-opacity=".1"/>
      <circle cx="32" cy="32" r="5" fill="#ef4444"/><circle cx="48" cy="32" r="5" fill="#f59e0b"/><circle cx="64" cy="32" r="5" fill="#22c55e"/>
      ${[[30, 'CA livré', '1,2 M'], [140, 'Commandes', '248'], [250, 'Demandes', '12']].map(([x, l, v]) => `
        <rect x="${x}" y="52" width="100" height="56" rx="12" fill="#16325a"/>
        <text x="${x + 12}" y="74" font-size="11" fill="#94a3b8">${l}</text><text x="${x + 12}" y="98" font-size="20" font-weight="800" fill="#fff">${v}</text>`).join('')}
      <g transform="translate(30 228)">
        ${[46, 78, 58, 104, 88, 120, 96].map((h, i) => `<rect x="${i * 46}" y="${-h}" width="28" height="${h}" rx="6" fill="${i === 5 ? '#f25c05' : '#2c5282'}" class="a-grow" style="animation-delay:${i * 0.08}s"/>`).join('')}
      </g>
      <g transform="translate(150 118)"><g class="a-pop a-pop-1">
        <rect width="210" height="52" rx="14" fill="#fff"/><circle cx="26" cy="26" r="14" fill="#fff1e8"/>${flame(26, 28, .8)}
        <text x="48" y="23" font-size="12.5" font-weight="800" fill="#0f172a">Nouvelle demande · Oryx</text>
        <text x="48" y="40" font-size="11" fill="#64748b">À 600 m de votre dépôt</text></g></g>
    </svg>`;

  /** État vide : bouteille et loupe. */
  Art.empty = () => `
    <svg class="art art-empty" viewBox="0 0 160 120" role="img" aria-label="Rien pour le moment">
      ${defs}
      <ellipse cx="80" cy="108" rx="54" ry="8" class="ill-soft"/>
      <g class="a-float">${bottle(48, 4, .62, { grey: true })}</g>
      <g transform="translate(116 62)"><g class="a-wiggle"><circle r="16" fill="none" stroke="#f25c05" stroke-width="5"/><path d="M11 11 L 24 24" stroke="#f25c05" stroke-width="7" stroke-linecap="round"/></g></g>
    </svg>`;

  /** Mini scooter pour le suivi de commande. */
  Art.miniScooter = () => `<svg class="art" viewBox="-44 -70 88 74" aria-hidden="true">${defs}${scooter()}</svg>`;

  Art.logo = () => `<svg class="logo-svg" viewBox="-16 -18 32 32" aria-hidden="true">${defs}${flame(0, 0, 1.25)}</svg>`;


  /* ---------- Bouteille « studio » (cartes de services, style application) ---------- */
  const STUDIO = {
    orange: ['#9a3412', '#ff9a52', '#f25c05', '#a83a08', '#c2410c'],
    blue: ['#1e3a8a', '#7cb6ff', '#2563eb', '#1e3a8a', '#1d4ed8'],
    green: ['#14532d', '#6ee7a0', '#16a34a', '#14532d', '#15803d'],
  };
  Art.bottleStudio = (color = 'orange') => {
    const [d1, light, mid, d2, guard] = STUDIO[color] || STUDIO.orange;
    const id = `gf-studio-${color}`;
    return `
    <svg class="art bottle-studio" viewBox="0 0 200 232" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${d1}"/><stop offset=".32" stop-color="${light}"/>
          <stop offset=".62" stop-color="${mid}"/><stop offset="1" stop-color="${d2}"/></linearGradient>
        <radialGradient id="${id}-sh"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      </defs>
      <ellipse cx="100" cy="222" rx="76" ry="10" fill="url(#${id}-sh)"/>
      <g class="a-float">
        <rect x="84" y="26" width="32" height="22" rx="5" fill="#ef4444"/><circle cx="80" cy="38" r="8" fill="#334155"/>
        <path fill-rule="evenodd" fill="${guard}" d="M66 8 h68 a18 18 0 0 1 18 18 v40 h-104 v-40 a18 18 0 0 1 18 -18z
          M76 20 h48 a8 8 0 0 1 8 8 v12 a8 8 0 0 1 -8 8 h-48 a8 8 0 0 1 -8 -8 v-12 a8 8 0 0 1 8 -8z"/>
        <rect x="30" y="58" width="140" height="152" rx="58" fill="url(#${id})"/>
        <path d="M100 118 C 116 136 126 146 122 166 C 118 184 82 184 78 166 C 74 148 90 140 100 118 Z" fill="#fff" opacity=".22"/>
        <rect x="50" y="80" width="13" height="110" rx="6.5" fill="#fff" opacity=".32"/>
        <rect x="46" y="202" width="108" height="16" rx="6" fill="${guard}"/>
      </g>
    </svg>`;
  };

  /* ---------- Icônes au trait (interface application) ---------- */
  const ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    cart: '<path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    flame: '<path d="M12 3c2 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.2-3.8 2.5-5 .3 1.5 1 2.5 2 3 0-3 .3-5.5.5-8z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };
  Art.icon = (name, size = 20) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  window.Art = Art;
}());
