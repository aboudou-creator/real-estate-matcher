// Developed by Solution Makers
// Real Estate Extractor - optimized for Senegal real estate WhatsApp parsing
// ─── French / Senegal real estate text extraction ────────────────────────────
// Parses WhatsApp messages to detect real estate posts and extract structured
// information: type (offer/demand), category, transaction type, price, location,
// bedrooms, area, and contact phone.

const SENEGAL_CITIES = [
  'Dakar', 'Thiès', 'Thies', 'Saint-Louis', 'Mbour', 'Touba', 'Ziguinchor',
  'Kaolack', 'Tambacounda', 'Diamniadio', 'Saly', 'Lac Rose', 'Rufisque',
  'Pikine', 'Guédiawaye', 'Keur Massar', 'Bargny', 'Somone', 'Ngaparou',
  'Popenguine', 'Joal', 'Fatick', 'Kolda', 'Sédhiou', 'Sеdhiou', 'Kédougou',
  'Matam', 'Louga', 'Diourbel', 'Richard Toll', 'Mbao', 'Pout', 'Sébikotane',
];

const DAKAR_NEIGHBORHOODS = [
  // Centre Dakar
  'Plateau', 'Fann', 'Point E', 'Mermoz', 'Mermoz-Sacré-Cœur', 'Fenêtre Mermoz',
  'Sacré-Cœur', 'Sacré-Coeur', 'Sacre Coeur',
  // Nord Dakar (numbered variants first semantically via sorted matching)
  'Sacré-Cœur 1', 'Sacré-Coeur 1', 'Sacré-Cœur 2', 'Sacré-Coeur 2',
  'Sacré-Cœur 3', 'Sacré-Coeur 3',
  'Parcelles Assainies', 'Grand Yoff', 'Liberté', 'Liberte',
  'HLM', 'Sicap', 'Nord Foire',
  // Ouest Dakar
  'Almadies', 'Ngor', 'Yoff', 'Ouakam', 'Mamelles',
  // Est Dakar
  'Keur Gorgui', 'Cité Keur Gorgui', 'Virage', 'Ouest Foire',
  // Other Dakar
  'Médina', 'Medina', 'Grand Dakar', 'Hann', 'Bel Air', 'Colobane',
  'Cambérène', 'Camberene', 'Dieuppeul', 'Derklé', 'Derkle',
  'Gibraltar', 'Centenaire', 'Amitié', 'Amitie',
  "Patte d'Oie", 'Castors',
  // Thiès neighborhoods
  'Thiès Nord', 'Thies Nord', 'Thiès Sud', 'Thies Sud',
  'Cité Malick Sy', 'Cite Malick Sy', 'Grand Thiès', 'Grand Thies',
];

const LOCATION_ALIASES = [
  { pattern: /\bparcelle\s+fadia\b/i, neighborhood: 'Parcelles Assainies', city: 'Dakar' },
  { pattern: /\bparcelles?\s+assain(?:ie|ies)\b/i, neighborhood: 'Parcelles Assainies', city: 'Dakar' },
  { pattern: /\bparcelles?\b/i, neighborhood: 'Parcelles Assainies', city: 'Dakar' },
  { pattern: /\bpatte\s*d['’]?oie(?:\s+builders?)?\b/i, neighborhood: "Patte d'Oie", city: 'Dakar' },
  { pattern: /\bpoint\s*e\b/i, neighborhood: 'Point E', city: 'Dakar' },
  { pattern: /\bsacre\s*coeur\s*([123])\b/i, aliasBuilder: m => ({ neighborhood: `Sacré-Cœur ${m[1]}`, city: 'Dakar' }) },
  { pattern: /\bsacr[ée]\s*[- ]?c(?:oe|œ)ur\s*([123])\b/i, aliasBuilder: m => ({ neighborhood: `Sacré-Cœur ${m[1]}`, city: 'Dakar' }) },
];

const CATEGORY_ORDER = ['colocation', 'agricultural_ground', 'house', 'apartment', 'room', 'ground'];

const ROOM_FALSE_POSITIVE_PATTERNS = [
  /\bchambre\s+salon\b/i,
  /\b(?:deux|trois|quatre|cinq|six|\d{1,2}|0\d)\s+chambres?\b/i,
  /\b[FT]\d\b/i,
  /\bstudio\b/i,
  /\bappart(?:ement)?\b/i,
  /\bniveau\b/i,
  /\bcoloc(?:ation|ataire)?\b/i,
];

const GROUND_CONTEXT_EXCLUSIONS = [
  /\bparcelle\s+fadia\b/i,
  /\bparcelles?\s+assain(?:ie|ies)\b/i,
];

// ─── Zone mapping ─────────────────────────────────────────────────────────────
const NEIGHBORHOOD_ZONE_MAP = {
  // Centre Dakar
  'Plateau': 'Centre Dakar',
  'Fann': 'Centre Dakar',
  'Point E': 'Centre Dakar',
  'Mermoz': 'Centre Dakar',
  'Mermoz-Sacré-Cœur': 'Centre Dakar',
  'Fenêtre Mermoz': 'Centre Dakar',
  'Sacré-Cœur': 'Centre Dakar',
  'Sacré-Coeur': 'Centre Dakar',
  'Sacre Coeur': 'Centre Dakar',
  // Nord Dakar
  'Sacré-Cœur 1': 'Nord Dakar',
  'Sacré-Coeur 1': 'Nord Dakar',
  'Sacré-Cœur 2': 'Nord Dakar',
  'Sacré-Coeur 2': 'Nord Dakar',
  'Sacré-Cœur 3': 'Nord Dakar',
  'Sacré-Coeur 3': 'Nord Dakar',
  'Parcelles Assainies': 'Nord Dakar',
  'Grand Yoff': 'Nord Dakar',
  'Liberté': 'Nord Dakar',
  'Liberte': 'Nord Dakar',
  'HLM': 'Nord Dakar',
  'Sicap': 'Nord Dakar',
  'Nord Foire': 'Nord Dakar',
  // Ouest Dakar
  'Almadies': 'Ouest Dakar',
  'Ngor': 'Ouest Dakar',
  'Yoff': 'Ouest Dakar',
  'Ouakam': 'Ouest Dakar',
  'Mamelles': 'Ouest Dakar',
  // Est Dakar
  'Keur Gorgui': 'Est Dakar',
  'Cité Keur Gorgui': 'Est Dakar',
  'Virage': 'Est Dakar',
  'Ouest Foire': 'Est Dakar',
  // Thiès Centre
  'Thiès Nord': 'Thiès Centre',
  'Thies Nord': 'Thiès Centre',
  'Thiès Sud': 'Thiès Centre',
  'Thies Sud': 'Thiès Centre',
  'Cité Malick Sy': 'Thiès Centre',
  'Cite Malick Sy': 'Thiès Centre',
  'Grand Thiès': 'Thiès Centre',
  'Grand Thies': 'Thiès Centre',
};

function normalizeText(input) {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’]/g, "'")
    .replace(/œ/g, 'oe');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSortedNeighborhoods() {
  return [...DAKAR_NEIGHBORHOODS].sort((a, b) => b.length - a.length);
}

function inferZone(neighborhood, city) {
  const normalizedNeighborhood = normalizeText(neighborhood).toLowerCase();
  if (normalizedNeighborhood && /sacr[e]?[\s-]*coeur\s*[123]\b/i.test(normalizedNeighborhood)) {
    return 'Nord Dakar';
  }

  if (neighborhood) {
    const key = Object.keys(NEIGHBORHOOD_ZONE_MAP).find(
      k => normalizeText(k).toLowerCase() === normalizedNeighborhood
    );
    if (key) return NEIGHBORHOOD_ZONE_MAP[key];
  }

  if (city) {
    if (/rufisque/i.test(city)) return 'Périphérie';
    if (/diamniadio/i.test(city)) return 'Périphérie';
    if (/lac\s*rose/i.test(city)) return 'Périphérie';
    if (/sébi|sebi/i.test(city)) return 'Périphérie';
    if (/thi[eè]s/i.test(city)) return 'Thiès Centre';
    if (/pout/i.test(city)) return 'Thiès Extension';
    if (/mbour/i.test(city)) return 'Thiès Extension';
  }

  return null;
}

// ─── Pattern definitions ─────────────────────────────────────────────────────
const OFFER_PATTERNS = [
  /\bà\s*vendre\b/i, /\ba\s*vendre\b/i, /\ben\s*vente\b/i,
  /\bje\s*vends?\b/i, /\bon\s*vend\b/i, /\bvends?\b/i,
  /\bà\s*louer\b/i, /\ba\s*louer\b/i, /\bje\s*loue\b/i,
  /\bdisponible\b/i, /\boffre\b/i, /\bpropose\b/i,
  /\bcède\b/i, /\bcede\b/i, /\bmet\s+en\s+vente\b/i,
];

const DEMAND_PATTERNS = [
  /\bje\s*cherche\b/i, /\bcherche\b/i, /\brecherche\b/i,
  /\bbesoin\b/i, /\bdemande\b/i, /\bje\s*demande\b/i,
  /\blooking\s*for\b/i, /\bje\s*veux\b/i,
  /\bqui\s+(a|connai[tî])\b/i,
];

const CATEGORY_PATTERNS = {
  apartment: [
    /\bappart(?:ement)?\b/i, /\bstudio\b/i,
    /\bF[1-6]\b/i, /\bT[1-6]\b/i,
    /\bpieces?\b/i, /\bpièces?\b/i,
    /\bchambre\s+salon\b/i, /\bniveau\b/i,
    /\bdeux\s+chambre/i, /\btrois\s+chambre/i, /\bquatre\s+chambre/i,
    /\b02\s+chambre/i, /\b03\s+chambre/i, /\b04\s+chambre/i,
  ],
  room: [
    /\bchambre\b/i, /\broom\b/i,
  ],
  house: [
    /\bmaison\b/i, /\bvilla\b/i, /\brésidence\b/i, /\bresidence\b/i,
    /\bpavillon\b/i, /\bduplex\b/i, /\btriplex\b/i,
  ],
  ground: [
    /\bterrain\b/i, /\bparcelle\b/i, /\blot\b/i,
  ],
  agricultural_ground: [
    /\bterrain\s+agricole\b/i, /\bchamp\b/i,
    /\bferme\b/i, /\bexploitation\b/i, /\bterre\s+agricole\b/i,
  ],
  colocation: [
    /\bcolocation\b/i, /\bcoloc\b/i, /\bco[-\s]?loc\b/i, /\bco\s+location\b/i,
    /\bcolocataire\b/i, /\bcolacatrice\b/i, /\bpartage\s+d'appart\b/i, /\bpartage\s+appart\b/i,
    /\broommate\b/i, /\bje\s+cherche\s+un\s+coloc\b/i,
    /\bpropose\s+coloc\b/i, /\boffre\s+coloc\b/i,
  ],
};

const SALE_PATTERNS = [
  /\bvente\b/i, /\bvendre\b/i, /\bacheter\b/i, /\bachat\b/i,
  /\bachète\b/i, /\bachete\b/i, /\bà\s*vendre\b/i, /\ba\s*vendre\b/i,
];

const RENT_PATTERNS = [
  /\blouer\b/i, /\blocation\b/i, /\bloyer\b/i, /\bbail\b/i,
  /\b\/\s*mois\b/i, /\bpar\s*mois\b/i, /\bmensuel\b/i,
  /\bà\s*louer\b/i, /\ba\s*louer\b/i,
];

// ─── Price extraction ────────────────────────────────────────────────────────
function extractPrice(text) {
  const normalized = normalizeText(text);

  let m = normalized.match(/(\d+(?:[.,]\d+)?)\s*millions?\b/i);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1_000_000);

  m = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:M|mill|mil)\b/i);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1_000_000);

  m = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:K|mille)\b/i);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1_000);

  m = normalized.match(/\b(\d{1,3}(?:[.\s]\d{3})+)\s*(?:FCFA|CFA|F|francs?)?\b/i);
  if (m) return parseInt(m[1].replace(/[\s.]/g, ''), 10);

  m = normalized.match(/\b(\d{4,9})\s*(?:FCFA|CFA|F)\b/i);
  if (m) return parseInt(m[1], 10);

  m = normalized.match(/(?:prix|loyer|tarif|cout|montant|budget|vente|vend|loue|location|disponible|a\s*louer|a\s*vendre|bail)\s*[:=-]?\s*(\d{5,9})\b/i);
  if (m) return parseInt(m[1], 10);

  const candidates = [...normalized.matchAll(/\b(\d{5,9})\b/g)].map(match => ({
    raw: match[1],
    index: match.index ?? -1,
  }));

  for (const candidate of candidates) {
    const value = parseInt(candidate.raw, 10);
    const before = normalized.slice(Math.max(0, candidate.index - 12), candidate.index);
    const after = normalized.slice(candidate.index + candidate.raw.length, candidate.index + candidate.raw.length + 12);

    if (/\+?221\s*$/.test(before) || /^\s*\d{2}\s*\d{2}/.test(after)) continue;
    if (/^\s*m(?:2|²)?\b/i.test(after)) continue;
    if (value >= 25000 && value <= 999999999) return value;
  }

  return null;
}

// ─── Bedrooms extraction ─────────────────────────────────────────────────────
function extractBedrooms(text) {
  let m = text.match(/\b[FT](\d)\b/i);
  if (m) {
    const totalRooms = parseInt(m[1], 10);
    return totalRooms > 1 ? totalRooms - 1 : 1;
  }

  m = text.match(/(\d+)\s*(?:chambres?|ch\b)/i);
  if (m) return parseInt(m[1], 10);

  m = text.match(/(\d+)\s*(?:pièces?|pieces?)/i);
  if (m) {
    const totalRooms = parseInt(m[1], 10);
    return totalRooms > 1 ? totalRooms - 1 : 1;
  }

  return null;
}

// ─── Area extraction ─────────────────────────────────────────────────────────
function extractArea(text) {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m[²2]|mètres?\s*carr[ée]s?|metres?\s*carres?)/i);
  if (m) return parseFloat(m[1].replace(',', '.'));
  return null;
}

// ─── Phone extraction ────────────────────────────────────────────────────────
function extractPhone(text) {
  const m = text.match(/(?:\+?221[\s.-]?)?(7[0-9][\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/);
  if (m) return m[0].replace(/[\s.-]/g, '').replace(/^(?!\+)221/, '+221');
  return null;
}

function resolveAliasLocation(normalizedText) {
  for (const alias of LOCATION_ALIASES) {
    const match = normalizedText.match(alias.pattern);
    if (match) return alias.aliasBuilder ? alias.aliasBuilder(match) : alias;
  }
  return null;
}

// ─── Location extraction ─────────────────────────────────────────────────────
function extractLocation(text) {
  let city = null;
  let neighborhood = null;
  const normalized = normalizeText(text);

  const aliasLocation = resolveAliasLocation(normalized);
  if (aliasLocation) {
    neighborhood = aliasLocation.neighborhood || null;
    city = aliasLocation.city || null;
  }

  if (!neighborhood) {
    for (const n of getSortedNeighborhoods()) {
      const normalizedNeighborhood = normalizeText(n);
      if (new RegExp(`\\b${escapeRegex(normalizedNeighborhood)}\\b`, 'i').test(normalized)) {
        neighborhood = n;
        city = city || (/thi[eè]s/i.test(n) ? 'Thiès' : 'Dakar');
        break;
      }
    }
  }

  for (const c of SENEGAL_CITIES) {
    const normalizedCity = normalizeText(c);
    if (new RegExp(`\\b${escapeRegex(normalizedCity)}\\b`, 'i').test(normalized)) {
      city = c;
      break;
    }
  }

  if (!city && !neighborhood) {
    const m = text.match(/(?:à|a|situé\s+à|situe\s+a|dans)\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)?)/);
    if (m) neighborhood = m[1].trim();
  }

  if (!city) city = 'Dakar?';

  const zone = inferZone(neighborhood, city);
  return { city, neighborhood, zone };
}

// ─── Real estate general keywords (for posts without explicit category) ──────
const REAL_ESTATE_KEYWORDS = [
  /\bimmobili[eè]re?\b/i, /\blogement\b/i, /\bhabitat\b/i,
  /\bloyer\b/i, /\bbail\b/i, /\bpropri[ée]t[ée]\b/i,
  /\bm[²2]\b/i, /\bmètres?\s*carr/i, /\bFCFA\b/i, /\bCFA\b/i,
  /\bétage\b/i, /\betage\b/i, /\bsalon\b/i, /\bcuisine\b/i,
  /\btoilette\b/i, /\bdouche\b/i, /\bgarage\b/i, /\bbalcon\b/i,
  /\bterrasse\b/i, /\bpiscine\b/i, /\bjardin\b/i,
];

function inferTransactionFromPrice(price) {
  if (!price) return 'sale';
  if (price <= 2_000_000) return 'rent';
  if (price >= 5_000_000) return 'sale';
  return 'sale';
}

function inferCategoryFromPrice(price) {
  if (!price) return 'apartment';
  if (price >= 20_000_000) return 'house';
  if (price >= 5_000_000) return 'apartment';
  if (price <= 100_000) return 'room';
  return 'apartment';
}

function looksLikeNeighborhoodAfterParcelle(text) {
  const normalized = normalizeText(text);
  if (GROUND_CONTEXT_EXCLUSIONS.some(p => p.test(normalized))) return true;
  return LOCATION_ALIASES.some(alias => /parcelle/.test(alias.pattern.source) && alias.pattern.test(normalized));
}

function detectCategory(text) {
  const normalized = normalizeText(text);

  for (const category of CATEGORY_ORDER) {
    if (category === 'ground' && looksLikeNeighborhoodAfterParcelle(normalized)) continue;
    if (category === 'room' && ROOM_FALSE_POSITIVE_PATTERNS.some(p => p.test(normalized))) continue;
    if (category === 'ground' && /\bterrain\s+agricole\b/i.test(normalized)) continue;

    if (CATEGORY_PATTERNS[category].some(pattern => pattern.test(text))) {
      return category;
    }
  }

  return null;
}

const CATEGORY_LABELS = {
  apartment: 'Appartement',
  room: 'Chambre',
  house: 'Maison',
  ground: 'Terrain',
  agricultural_ground: 'Terrain agricole',
  colocation: 'Colocation',
};

// ─── Single-segment extraction ───────────────────────────────────────────────
function extractSingle(text, fallbackPhone) {
  if (!text || text.length < 10) return null;

  let isOffer = OFFER_PATTERNS.some(p => p.test(text));
  let isDemand = DEMAND_PATTERNS.some(p => p.test(text));

  let category = detectCategory(text);
  const price = extractPrice(text);

  const hasRealEstateWords = REAL_ESTATE_KEYWORDS.some(p => p.test(text));
  const bedrooms = extractBedrooms(text);
  const area = extractArea(text);
  const hasBedrooms = bedrooms !== null;
  const hasArea = area !== null;

  if (!category) {
    if ((isOffer || isDemand) && (hasRealEstateWords || hasBedrooms || hasArea) && price) {
      category = inferCategoryFromPrice(price);
    }
  }

  const isSale = SALE_PATTERNS.some(p => p.test(text));
  const isRent = RENT_PATTERNS.some(p => p.test(text));

  const resolvedLocation = extractLocation(text);
  const hasListingShape = Boolean(
    category &&
    (
      price ||
      hasBedrooms ||
      hasArea ||
      hasRealEstateWords ||
      resolvedLocation.neighborhood ||
      resolvedLocation.city !== 'Dakar?'
    )
  );

  if (!isOffer && !isDemand && hasListingShape) {
    isOffer = true;
  }

  if (!isOffer && !isDemand) return null;
  if (!category) return null;

  let transactionType;
  if (isRent && !isSale) transactionType = 'rent';
  else if (isSale && !isRent) transactionType = 'sale';
  else if (isRent && isSale) transactionType = 'rent';
  else transactionType = inferTransactionFromPrice(price);

  const phone = extractPhone(text) || fallbackPhone;
  const { city, neighborhood, zone } = resolvedLocation;

  const bedroomLabel = bedrooms ? ` F${bedrooms}` : '';
  const locationLabel = neighborhood ? ` - ${neighborhood}` : city ? ` - ${city}` : '';
  const title = `${CATEGORY_LABELS[category] || category}${bedroomLabel}${locationLabel}`;

  let type;
  if (isOffer && !isDemand) type = 'offer';
  else if (isDemand && !isOffer) type = 'demand';
  else {
    const offerIdx = Math.min(...OFFER_PATTERNS.map(p => {
      const m = text.search(p);
      return m >= 0 ? m : Infinity;
    }));
    const demandIdx = Math.min(...DEMAND_PATTERNS.map(p => {
      const m = text.search(p);
      return m >= 0 ? m : Infinity;
    }));
    type = offerIdx <= demandIdx ? 'offer' : 'demand';
  }

  return {
    isRealEstatePost: true,
    type,
    category,
    transactionType,
    price,
    bedrooms,
    area,
    phone,
    city,
    neighborhood,
    zone,
    title,
    description: text.substring(0, 500),
  };
}

// test

// ─── Segment splitter ────────────────────────────────────────────────────────
function splitIntoSegments(text) {
  const numberedSplit = text
    .split(/(?:^|\n)\s*(?:\d+[.)\-]|[•●▪\-]\s)/m)
    .filter(s => s.trim().length > 15);

  if (numberedSplit.length > 1) return numberedSplit.map(s => s.trim());

  const doubleLF = text.split(/\n\s*\n/).filter(s => s.trim().length > 15);
  if (doubleLF.length > 1) return doubleLF.map(s => s.trim());

  return [text.trim()];
}

// ─── Main extraction function ────────────────────────────────────────────────
function extractRealEstateInfo(text) {
  if (!text || text.length < 10) return { isRealEstatePost: false };

  const wholeSingle = extractSingle(text, null);
  const segments = splitIntoSegments(text);

  if (segments.length > 1) {
    const sharedPhone = extractPhone(text);
    const results = [];

    for (const segment of segments) {
      const result = extractSingle(segment, sharedPhone);
      if (result) results.push(result);
    }

    if (results.length > 1) {
      return { isRealEstatePost: true, multiple: true, products: results };
    }
  }

  if (wholeSingle) return wholeSingle;
  return { isRealEstatePost: false };
}

module.exports = {
  extractRealEstateInfo,
  SENEGAL_CITIES,
  DAKAR_NEIGHBORHOODS,
};