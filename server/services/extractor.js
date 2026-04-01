// ─── French / Senegal real estate text extraction ────────────────────────────
// Parses WhatsApp messages to detect real estate posts and extract structured
// information: type (offer/demand), category, transaction type, price, location,
// bedrooms, area, and contact phone.

const SENEGAL_CITIES = [
  'Dakar', 'Thiès', 'Saint-Louis', 'Mbour', 'Touba', 'Ziguinchor',
  'Kaolack', 'Tambacounda', 'Diamniadio', 'Saly', 'Lac Rose', 'Rufisque',
  'Pikine', 'Guédiawaye', 'Keur Massar', 'Bargny', 'Somone', 'Ngaparou',
  'Popenguine', 'Joal', 'Fatick', 'Kolda', 'Sédhiou', 'Kédougou',
  'Matam', 'Louga', 'Diourbel', 'Richard Toll', 'Mbao', 'Pout',
];

const DAKAR_NEIGHBORHOODS = [
  'Almadies', 'Plateau', 'Mermoz', 'Sacré-Cœur', 'Sacré-Coeur', 'Sacre Coeur',
  'Ouakam', 'Ngor', 'Fann', 'Médina', 'Medina', 'Grand Dakar',
  'Parcelles Assainies', 'HLM', 'Sicap', 'Liberté', 'Liberte',
  'Point E', 'Yoff', 'Mamelles', 'Hann', 'Bel Air', 'Colobane',
  'Grand Yoff', 'Cambérène', 'Camberene', 'Dieuppeul', 'Derklé', 'Derkle',
  'Gibraltar', 'Centenaire', 'Amitié', 'Amitie', 'Cité Keur Gorgui',
  'Mermoz-Sacré-Cœur', 'Nord Foire', 'Virage', 'Ouest Foire',
  'Patte d\'Oie', 'Castors', 'Fenêtre Mermoz',
];

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
// Handles: "85 000 000 FCFA", "85.000.000 CFA", "85M", "85 millions", "850K"
function extractPrice(text) {
  // "XX millions" or "XXM"
  let m = text.match(/(\d+(?:[.,]\d+)?)\s*millions?\b/i);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1_000_000);

  m = text.match(/(\d+(?:[.,]\d+)?)\s*M\b/);
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
  // "F3", "T4" etc → number of rooms
  let m = text.match(/\b[FT](\d)\b/);
  if (m) return parseInt(m[1], 10);

  // "3 chambres", "4 ch", "2 pièces"
  m = text.match(/(\d+)\s*(?:chambres?|ch\b|pièces?|pieces?|rooms?)/i);
  if (m) return parseInt(m[1], 10);

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

  // Default to Dakar if no location found
  if (!city) city = 'Dakar';

  return { city, neighborhood };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Main extraction function ────────────────────────────────────────────────
function extractRealEstateInfo(text) {
  if (!text || text.length < 10) return { isRealEstatePost: false };

  // Detect offer or demand
  const isOffer = OFFER_PATTERNS.some(p => p.test(text));
  const isDemand = DEMAND_PATTERNS.some(p => p.test(text));
  if (!isOffer && !isDemand) return { isRealEstatePost: false };

  // Detect category (check agricultural_ground before ground since it's more specific)
  let category = null;
  for (const cat of ['agricultural_ground', 'ground', 'house', 'room', 'apartment']) {
    if (CATEGORY_PATTERNS[cat].some(p => p.test(text))) {
      category = cat;
      break;
    }
  }
  if (!category) return { isRealEstatePost: false };

  // Transaction type
  const isSale = SALE_PATTERNS.some(p => p.test(text));
  const isRent = RENT_PATTERNS.some(p => p.test(text));
  const transactionType = isRent ? 'rent' : isSale ? 'sale' : 'sale'; // default to sale

  // Extract fields
  const price = extractPrice(text);
  const bedrooms = extractBedrooms(text);
  const area = extractArea(text);
  const phone = extractPhone(text);
  const { city, neighborhood } = extractLocation(text);

  // Build a title from extracted info
  const categoryLabels = {
    apartment: 'Appartement',
    room: 'Chambre',
    house: 'Maison',
    ground: 'Terrain',
    agricultural_ground: 'Terrain agricole',
  };
  const bedroomLabel = bedrooms ? ` F${bedrooms}` : '';
  const locationLabel = neighborhood ? ` - ${neighborhood}` : city ? ` - ${city}` : '';
  const title = `${categoryLabels[category]}${bedroomLabel}${locationLabel}`;

  // Determine type: if both detected, use strongest signal
  let type;
  if (isOffer && !isDemand) type = 'offer';
  else if (isDemand && !isOffer) type = 'demand';
  else {
    // Both matched — check which appears first in the text
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
    title,
    description: text.substring(0, 500),
  };
}

module.exports = { extractRealEstateInfo, SENEGAL_CITIES, DAKAR_NEIGHBORHOODS };
