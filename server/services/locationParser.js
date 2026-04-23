// ─── Location parser (spec §11) ─────────────────────────────────────────────
// Recognizes Dakar / Thiès / major Senegal places. Returns raw, normalized,
// zone, confidence, and (for demand posts) all alternate locations.

const { normalizeForMatching } = require('./normalize');

const SENEGAL_CITIES = [
  'Dakar', 'Thiès', 'Thies', 'Saint-Louis', 'Mbour', 'Touba', 'Ziguinchor',
  'Kaolack', 'Tambacounda', 'Diamniadio', 'Saly', 'Lac Rose', 'Rufisque',
  'Pikine', 'Guédiawaye', 'Keur Massar', 'Bargny', 'Somone', 'Ngaparou',
  'Popenguine', 'Joal', 'Fatick', 'Kolda', 'Sédhiou', 'Kédougou', 'Matam',
  'Louga', 'Diourbel', 'Richard Toll', 'Mbao', 'Pout', 'Sébikotane',
  'Bambilor',
];

const DAKAR_NEIGHBORHOODS = [
  // Centre
  'Plateau', 'Fann', 'Point E', 'Mermoz', 'Mermoz-Sacré-Cœur', 'Fenêtre Mermoz',
  'Sacré-Cœur', 'Sacré-Coeur', 'Sacre Coeur', 'Sacré-Cœur 1', 'Sacré-Cœur 2', 'Sacré-Cœur 3',
  'Médina', 'Medina', 'Fass', 'Colobane', 'Dieuppeul', 'Derklé', 'Gibraltar', 'Centenaire',
  'Amitié', 'Castors',
  // Nord
  'Parcelles Assainies', 'Grand Yoff', 'Liberté', 'Liberté 1', 'Liberté 2', 'Liberté 3',
  'Liberté 4', 'Liberté 5', 'Liberté 6',
  'HLM', 'Sicap', 'Sicap Foire', 'Sicap Liberté', 'Sicap Amitié',
  'Nord Foire', 'Maristes', 'Cambérène', 'Camberene', 'Hann', 'Bel Air',
  // Ouest
  'Almadies', 'Ngor', 'Yoff', 'Ouakam', 'Mamelles', 'Ouest Foire',
  // Est
  'Keur Gorgui', 'Cité Keur Gorgui', 'Virage', "Patte d'Oie",
  // Thiès
  'Thiès Nord', 'Thiès Sud', 'Cité Malick Sy', 'Grand Thiès',
];

// Aliases: user typos / local spellings → canonical name
const ALIASES = [
  { pattern: /\bparcelle\s+fadia\b/i,              neighborhood: 'Parcelles Assainies', city: 'Dakar' },
  { pattern: /\bparcelles?\s+assain(?:ie|ies)?\b/i, neighborhood: 'Parcelles Assainies', city: 'Dakar' },
  { pattern: /\bpatte\s*d['’]?oie(?:\s+builders?)?\b/i, neighborhood: "Patte d'Oie", city: 'Dakar' },
  { pattern: /\bpoint\s*e\b/i,                      neighborhood: 'Point E', city: 'Dakar' },
  { pattern: /\bhlm\s*grand\s*yoff?\b/i,            neighborhood: 'HLM Grand Yoff', city: 'Dakar' },
  { pattern: /\bgrand\s*yoof?\b/i,                  neighborhood: 'Grand Yoff', city: 'Dakar' },
  { pattern: /\bsacre\s*coeur\s*([123])\b/i,        build: m => ({ neighborhood: `Sacré-Cœur ${m[1]}`, city: 'Dakar' }) },
  { pattern: /\bsacr[ée]\s*[- ]?c(?:oe|œ)ur\s*([123])\b/i, build: m => ({ neighborhood: `Sacré-Cœur ${m[1]}`, city: 'Dakar' }) },
  { pattern: /\blibert[ée]\s*([1-6])\b/i,           build: m => ({ neighborhood: `Liberté ${m[1]}`, city: 'Dakar' }) },
];

const NEIGHBORHOOD_ZONE_MAP = {
  // Centre
  'Plateau': 'Centre Dakar', 'Fann': 'Centre Dakar', 'Point E': 'Centre Dakar',
  'Mermoz': 'Centre Dakar', 'Sacré-Cœur': 'Centre Dakar',
  'Médina': 'Centre Dakar', 'Medina': 'Centre Dakar', 'Fass': 'Centre Dakar',
  // Nord
  'Sacré-Cœur 1': 'Nord Dakar', 'Sacré-Cœur 2': 'Nord Dakar', 'Sacré-Cœur 3': 'Nord Dakar',
  'Parcelles Assainies': 'Nord Dakar', 'Grand Yoff': 'Nord Dakar', 'HLM Grand Yoff': 'Nord Dakar',
  'Liberté': 'Nord Dakar', 'Liberté 1': 'Nord Dakar', 'Liberté 2': 'Nord Dakar',
  'Liberté 3': 'Nord Dakar', 'Liberté 4': 'Nord Dakar', 'Liberté 5': 'Nord Dakar', 'Liberté 6': 'Nord Dakar',
  'HLM': 'Nord Dakar', 'Sicap': 'Nord Dakar', 'Sicap Foire': 'Nord Dakar',
  'Nord Foire': 'Nord Dakar', 'Maristes': 'Nord Dakar',
  // Ouest
  'Almadies': 'Ouest Dakar', 'Ngor': 'Ouest Dakar', 'Yoff': 'Ouest Dakar',
  'Ouakam': 'Ouest Dakar', 'Mamelles': 'Ouest Dakar', 'Ouest Foire': 'Ouest Dakar',
  // Est
  'Keur Gorgui': 'Est Dakar', "Patte d'Oie": 'Est Dakar', 'Virage': 'Est Dakar',
  // Thiès
  'Thiès Nord': 'Thiès Centre', 'Thiès Sud': 'Thiès Centre', 'Cité Malick Sy': 'Thiès Centre',
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferZone(neighborhood, city) {
  if (neighborhood) {
    const normN = normalizeForMatching(neighborhood);
    const key = Object.keys(NEIGHBORHOOD_ZONE_MAP).find(k => normalizeForMatching(k) === normN);
    if (key) return NEIGHBORHOOD_ZONE_MAP[key];
  }
  if (city) {
    const c = normalizeForMatching(city);
    if (/rufisque|diamniadio|lac\s*rose|sebikotane/.test(c)) return 'Périphérie';
    if (/thies/.test(c)) return 'Thiès Centre';
    if (/pout|mbour/.test(c)) return 'Thiès Extension';
    if (/dakar/.test(c)) return 'Centre Dakar';
  }
  return null;
}

function matchAlias(text) {
  for (const alias of ALIASES) {
    const m = text.match(alias.pattern);
    if (m) {
      const built = alias.build ? alias.build(m) : { neighborhood: alias.neighborhood, city: alias.city };
      return { ...built, confidence: 0.95, reason: 'alias' };
    }
  }
  return null;
}

function matchNeighborhood(text) {
  // Longest-first so "Sacré-Cœur 1" beats "Sacré-Cœur"
  const sorted = [...DAKAR_NEIGHBORHOODS].sort((a, b) => b.length - a.length);
  const normText = normalizeForMatching(text);
  for (const n of sorted) {
    const normN = normalizeForMatching(n);
    const re = new RegExp(`\\b${escapeRegex(normN)}\\b`, 'i');
    if (re.test(normText)) {
      return { neighborhood: n, city: /thi[eè]s/i.test(n) ? 'Thiès' : 'Dakar', confidence: 0.85, reason: 'neighborhood' };
    }
  }
  return null;
}

function matchCity(text) {
  const normText = normalizeForMatching(text);
  for (const c of SENEGAL_CITIES) {
    const normC = normalizeForMatching(c);
    const re = new RegExp(`\\b${escapeRegex(normC)}\\b`, 'i');
    if (re.test(normText)) return { city: c, neighborhood: null, confidence: 0.7, reason: 'city' };
  }
  return null;
}

/**
 * Parse the primary location from a text.
 * @returns {{
 *   city: string|null,
 *   neighborhood: string|null,
 *   zone: string|null,
 *   raw: string|null,
 *   confidence: number,
 *   reasons: string[]
 * }}
 */
function parseLocation(text) {
  if (!text) return { city: null, neighborhood: null, zone: null, raw: null, confidence: 0, reasons: [] };
  const alias = matchAlias(text);
  const nbhd  = alias || matchNeighborhood(text);
  const city  = matchCity(text);

  const neighborhood = nbhd?.neighborhood || null;
  const resolvedCity = nbhd?.city || city?.city || null;
  const zone = inferZone(neighborhood, resolvedCity);
  const confidence = Math.max(nbhd?.confidence || 0, city?.confidence || 0);
  const reasons = [nbhd?.reason, city?.reason].filter(Boolean);

  return {
    city: resolvedCity,
    neighborhood,
    zone,
    raw: neighborhood || resolvedCity || null,
    confidence,
    reasons,
  };
}

/**
 * Find every location mentioned in the text (used for demand posts that list
 * multiple preferences). Returns a deduplicated list.
 */
function parseAllLocations(text) {
  if (!text) return [];
  const found = [];
  const seen = new Set();

  // Aliases
  for (const alias of ALIASES) {
    const m = text.match(alias.pattern);
    if (m) {
      const built = alias.build ? alias.build(m) : { neighborhood: alias.neighborhood, city: alias.city };
      const key = (built.neighborhood || built.city || '').toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        found.push({ ...built, zone: inferZone(built.neighborhood, built.city) });
      }
    }
  }

  // Known neighborhoods
  const normText = normalizeForMatching(text);
  const sortedN = [...DAKAR_NEIGHBORHOODS].sort((a, b) => b.length - a.length);
  for (const n of sortedN) {
    const normN = normalizeForMatching(n);
    const re = new RegExp(`\\b${escapeRegex(normN)}\\b`, 'i');
    if (re.test(normText) && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      const city = /thi[eè]s/i.test(n) ? 'Thiès' : 'Dakar';
      found.push({ neighborhood: n, city, zone: inferZone(n, city) });
    }
  }

  // Cities without a neighborhood
  for (const c of SENEGAL_CITIES) {
    if (seen.has(c.toLowerCase())) continue;
    const normC = normalizeForMatching(c);
    const re = new RegExp(`\\b${escapeRegex(normC)}\\b`, 'i');
    if (re.test(normText)) {
      seen.add(c.toLowerCase());
      found.push({ neighborhood: null, city: c, zone: inferZone(null, c) });
    }
  }

  return found;
}

module.exports = {
  parseLocation,
  parseAllLocations,
  inferZone,
  SENEGAL_CITIES,
  DAKAR_NEIGHBORHOODS,
};
