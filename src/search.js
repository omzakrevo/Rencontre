'use strict';

/** Minuscules, sans accents ni ponctuation. */
const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9,.]+/g, ' ').trim();

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Un mot de la recherche correspond-il à un mot du texte ?
 * Préfixe exact (« tot » → « total »), ou une faute tolérée dès 3 lettres (« ori » → « oryx »),
 * deux fautes dès 7 lettres. Les nombres (poids) doivent correspondre exactement : « 12 » → « 12,5 ».
 */
function wordMatches(term, word) {
  if (word.startsWith(term)) return true;
  if (/^\d/.test(term)) return word.replace(',', '.').startsWith(term.replace(',', '.'));
  if (term.length < 3) return false;
  const budget = term.length >= 7 ? 2 : 1;
  const prefix = word.slice(0, term.length);
  return levenshtein(term, prefix) <= budget || levenshtein(term, word) <= budget;
}

/** Tous les mots de la requête doivent se retrouver dans le texte (marque, nom, poids…). */
const STOP_WORDS = new Set(['gaz', 'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'kg', 'svp', 'pour', 'en']);

function matches(query, text) {
  const terms = normalize(query).split(' ').filter((t) => t && !STOP_WORDS.has(t));
  if (!terms.length) return true;
  const words = normalize(text).split(' ').filter(Boolean);
  return terms.every((t) => words.some((w) => wordMatches(t, w)));
}

/** Distance en km entre deux coordonnées GPS (formule de haversine). */
function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

module.exports = { normalize, matches, distanceKm, levenshtein };
