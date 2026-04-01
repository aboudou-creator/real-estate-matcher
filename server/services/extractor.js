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
  // Nord Dakar (Sacré-Cœur 1-3 must be checked BEFORE plain Sacré-Cœur)
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
  'Patte d\'Oie', 'Castors',
  // Thiès neighborhoods
  'Thiès Nord', 'Thies Nord', 'Thiès Sud', 'Thies Sud',
  'Cité Malick Sy', 'Cite Malick Sy', 'Grand Thiès', 'Grand Thies',
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

function inferZone(neighborhood, city) {
  // Sacré-Cœur with number → Nord Dakar (check before plain lookup)
  if (neighborhood && /sacr[eé][-\s]*c[o\u0153]eur\s*[123]/i.test(neighborhood)) {
    return 'Nord Dakar';
  }
  if (neighborhood) {
    // Exact match (case-insensitive)
    const key = Object.keys(NEIGHBORHOOD_ZONE_MAP).find(
      k => k.toLowerCase() === neighborhood.toLowerCase()
    );
    if (key) return NEIGHBORHOOD_ZONE_MAP[key];
  }
  // City-based fallback
  if (city) {
    if (/rufisque/i.test(city))    return 'Périphérie';
    if (/diamniadio/i.test(city))  return 'Périphérie';
    if (/lac\s*rose/i.test(city))  return 'Périphérie';
    if (/sébi|sebi/i.test(city))   return 'Périphérie';
    if (/thi[eè]s/i.test(city))    return 'Thiès Centre';
    if (/pout/i.test(city))        return 'Thiès Extension';
    if (/mbour/i.test(city))       return 'Thiès Extension';
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
    /\bF[1-6]\b/, /\bT[1-6]\b/,
    /\bpieces?\b/i, /\bpièces?\b/i,
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
// Handles: "85 000 000 FCFA", "85.000.000 CFA", "85M", "85 millions", "850K", "150mill"
function extractPrice(text) {
  // "XX millions" or "XXM"
  let m = text.match(/(\d+(?:[.,]\d+)?)\s*millions?\b/i);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1_000_000);

  // "XXM" or "XXmill" or "XXmil" shorthand
  m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:M|mill|mil)\b/i);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1_000_000);

  // "XXK" or "XX mille"
  m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:K|mille)\b/i);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1_000);

  // "85 000 000" or "85.000.000" followed by optional FCFA/CFA/F
  m = text.match(/(\d{1,3}(?:[.\s]\d{3})+)\s*(?:FCFA|CFA|F|francs?)?\b/i);
  if (m) return parseInt(m[1].replace(/[\s.]/g, ''), 10);

  // Plain number followed by FCFA/CFA
  m = text.match(/(\d{4,})\s*(?:FCFA|CFA|F)\b/i);
  if (m) return parseInt(m[1], 10);

  return null;
}

// ─── Bedrooms extraction ─────────────────────────────────────────────────────
function extractBedrooms(text) {
  // "F3", "T4" etc → number of rooms MINUS 1 for living room = bedrooms
  // F2 = 1 bedroom (2 rooms total: 1 bedroom + 1 living room)
  // F3 = 2 bedrooms, F4 = 3 bedrooms, etc.
  let m = text.match(/\b[FT](\d)\b/);
  if (m) {
    const totalRooms = parseInt(m[1], 10);
    return totalRooms > 1 ? totalRooms - 1 : 1;
  }

  // "3 chambres", "4 ch", "2 pièces" → explicit bedroom count
  m = text.match(/(\d+)\s*(?:chambres?|ch\b)/i);
  if (m) return parseInt(m[1], 10);

  // "2 pièces" → subtract 1 for living room
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
  // +221 7X XXX XX XX or 7X XXX XX XX or 77.123.45.67
  const m = text.match(/(?:\+?221[\s.-]?)?(7[0-9][\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/);
  if (m) return m[0].replace(/[\s.-]/g, '').replace(/^(?!\+)221/, '+221');
  return null;
}

// ─── Location extraction ─────────────────────────────────────────────────────
function extractLocation(text) {
  let city = null;
  let neighborhood = null;

  // Check neighborhoods first (they're more specific)
  for (const n of DAKAR_NEIGHBORHOODS) {
    if (new RegExp(`\\b${escapeRegex(n)}\\b`, 'i').test(text)) {
      neighborhood = n;
      city = 'Dakar';
      break;
    }
  }

  // Check cities
  for (const c of SENEGAL_CITIES) {
    if (new RegExp(`\\b${escapeRegex(c)}\\b`, 'i').test(text)) {
      city = c;
      break;
    }
  }

  // Fallback: "à [Location]" or "situé à [Location]"
  if (!city && !neighborhood) {
    const m = text.match(/(?:à|a|situé\s+à|situe\s+a|dans)\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)?)/);
    if (m) {
      const loc = m[1].trim();
      // Check if it looks like a place name (capitalized)
      if (loc.length > 2) neighborhood = loc;
    }
  }

  // Default to Dakar? if no location found
  if (!city) city = 'Dakar?';

  const zone = inferZone(neighborhood, city);
  return { city, neighborhood, zone };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// ─── Price-based transaction type inference ──────────────────────────────────
// Senegal market heuristics (XOF):
//   Rent: typically < 2,000,000 FCFA/month
//   Sale: typically > 5,000,000 FCFA
function inferTransactionFromPrice(price) {
  if (!price) return 'sale'; // default
  if (price <= 2_000_000) return 'rent';
  if (price >= 5_000_000) return 'sale';
  return 'sale'; // ambiguous range defaults to sale
}

// ─── Category inference from price ───────────────────────────────────────────
function inferCategoryFromPrice(price) {
  if (!price) return 'apartment'; // default
  if (price >= 20_000_000) return 'house'; // likely villa / house sale
  if (price >= 5_000_000) return 'apartment'; // apartment sale or expensive rent
  if (price <= 100_000) return 'room'; // cheap → room
  return 'apartment'; // default mid-range
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

  // Detect offer or demand
  const isOffer = OFFER_PATTERNS.some(p => p.test(text));
  const isDemand = DEMAND_PATTERNS.some(p => p.test(text));

  // Detect category
  let category = null;
  for (const cat of ['agricultural_ground', 'ground', 'house', 'colocation', 'room', 'apartment']) {
    if (CATEGORY_PATTERNS[cat].some(p => p.test(text))) {
      category = cat;
      break;
    }
  }

  const price = extractPrice(text);

  // If no category, check if the text has real estate keywords + price → infer
  if (!category) {
    const hasRealEstateWords = REAL_ESTATE_KEYWORDS.some(p => p.test(text));
    const hasBedrooms = extractBedrooms(text) !== null;
    const hasArea = extractArea(text) !== null;
    if ((isOffer || isDemand) && (hasRealEstateWords || hasBedrooms || hasArea) && price) {
      category = inferCategoryFromPrice(price);
    }
  }

  // Must have offer/demand signal AND a category to be valid
  if (!isOffer && !isDemand) return null;
  if (!category) return null;

  // Transaction type: explicit patterns first, then infer from price
  const isSale = SALE_PATTERNS.some(p => p.test(text));
  const isRent = RENT_PATTERNS.some(p => p.test(text));
  let transactionType;
  if (isRent && !isSale) transactionType = 'rent';
  else if (isSale && !isRent) transactionType = 'sale';
  else if (isRent && isSale) transactionType = isRent ? 'rent' : 'sale';
  else transactionType = inferTransactionFromPrice(price);

  const bedrooms = extractBedrooms(text);
  const area = extractArea(text);
  const phone = extractPhone(text) || fallbackPhone;
  const { city, neighborhood, zone } = extractLocation(text);

  const bedroomLabel = bedrooms ? ` F${bedrooms}` : '';
  const locationLabel = neighborhood ? ` - ${neighborhood}` : city ? ` - ${city}` : '';
  const title = `${CATEGORY_LABELS[category] || category}${bedroomLabel}${locationLabel}`;

  // Determine type
  let type;
  if (isOffer && !isDemand) type = 'offer';
  else if (isDemand && !isOffer) type = 'demand';
  else {
    const offerIdx = Math.min(...OFFER_PATTERNS.map(p => { const m = text.search(p); return m >= 0 ? m : Infinity; }));
    const demandIdx = Math.min(...DEMAND_PATTERNS.map(p => { const m = text.search(p); return m >= 0 ? m : Infinity; }));
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

// ─── Segment splitter ────────────────────────────────────────────────────────
// Splits a multi-listing post into individual segments
function splitIntoSegments(text) {
  // Split on numbered items: "1.", "2)", "1-", etc.
  const numberedSplit = text.split(/(?:^|\n)\s*(?:\d+[.)\-]|[•●▪\-]\s)/m).filter(s => s.trim().length > 15);
  if (numberedSplit.length > 1) return numberedSplit.map(s => s.trim());

  // Split on double newlines
  const doubleLF = text.split(/\n\s*\n/).filter(s => s.trim().length > 15);
  if (doubleLF.length > 1) return doubleLF.map(s => s.trim());

  // No split — return whole text
  return [text.trim()];
}

// ─── Main extraction function (returns array) ────────────────────────────────
function extractRealEstateInfo(text) {
  if (!text || text.length < 10) return { isRealEstatePost: false };

  // First try the whole text as a single product
  const wholeSingle = extractSingle(text, null);

  // Try splitting into segments
  const segments = splitIntoSegments(text);

  if (segments.length > 1) {
    // Extract a shared phone from the full text as fallback
    const sharedPhone = extractPhone(text);
    const results = [];
    for (const seg of segments) {
      const result = extractSingle(seg, sharedPhone);
      if (result) results.push(result);
    }
    if (results.length > 1) {
      // Multi-product post
      return { isRealEstatePost: true, multiple: true, products: results };
    }
  }

  // Single product or no products
  if (wholeSingle) return wholeSingle;
  return { isRealEstatePost: false };
}

module.exports = { extractRealEstateInfo, SENEGAL_CITIES, DAKAR_NEIGHBORHOODS };
