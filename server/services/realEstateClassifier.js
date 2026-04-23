// ─── Real-estate classifier (spec §5) ──────────────────────────────────────
// Decides whether a text is a real-estate post or non-real-estate noise.
// Uses a weighted positive/negative scoring system — replaces the old
// classifier.js which conflated real-estate detection with segment splitting.

const POSITIVE_RE = [
  // Strong category terms
  { w: 3, code: 'pos_category',   p: [
    /\bappart(?:ement)?s?\b/i, /\bstudios?\b/i, /\b[FT][1-6]\b/,
    /\bchambres?\b/i, /\bvillas?\b/i, /\bmaisons?\b/i, /\bimmeubles?\b/i,
    /\bterrains?\b/i, /\bduplex\b/i, /\btriplex\b/i,
    /\bplateaux?\s+de\s+bureau/i, /\bbureaux?\b/i, /\bmagasins?\b/i, /\bboutiques?\b/i,
    /\blocal\s+commercial\b/i, /\bentrepôts?\b/i, /\bdépôts?\b/i, /\bhangars?\b/i,
    /\bcolocations?\b/i, /\bcoloc\b/i,
  ]},
  // Transaction terms
  { w: 3, code: 'pos_transaction', p: [
    /\bà\s*louer\b/i, /\ba\s*louer\b/i, /\bà\s*vendre\b/i, /\ba\s*vendre\b/i,
    /\ben\s*vente\b/i, /\bdisponibles?\b/i, /\bdispo\b/i,
    /\bje\s*cherche\b/i, /\bcherche\b/i, /\brecherche\b/i, /\ba\s*la\s*recherche\b/i,
    /\bbesoin\s+d['’]\s*un\b/i,
    /\bloyer\b/i, /\blocation\b/i, /\bbail\b/i,
  ]},
  // Property attributes
  { w: 2, code: 'pos_attr_structure', p: [
    /\bsalons?\b/i, /\bcuisines?\b/i,
    /\btoilettes?\b/i, /\bdouches?\b/i, /\bsalle\s+de\s+bain/i,
    /\bbalcons?\b/i, /\bterrasses?\b/i,
    /\bétages?\b/i, /\betages?\b/i, /\bniveaux?\b/i, /\brdc\b/i, /\brez[- ]de[- ]chauss/i,
    /\bgarages?\b/i, /\bparkings?\b/i, /\bpiscines?\b/i, /\bjardins?\b/i,
  ]},
  // Price / unit context
  { w: 2, code: 'pos_price', p: [
    /\b\d+\s*(?:fcfa|cfa)\b/i, /\bprix\b/i, /\btarif\b/i,
    /\b\d+\s*m\s*[²2]\b/i, /\b\d{1,3}(?:[.\s]\d{3}){1,}\b/,
    /\b\d+\s*(?:mil|mille|milles|million|millions|M)\b/i,
    /\bconditions?\b/i, /\bcaution\b/i,
  ]},
  // Real estate vocabulary
  { w: 2, code: 'pos_vocab', p: [
    /\bimmobili[eè]re?\b/i, /\blogements?\b/i, /\bhabitat\b/i,
    /\bpropri[ée]t[ée]\b/i, /\btitre\s+foncier\b/i, /\bbail\b/i,
  ]},
  // Contact (only weak positive — also common in spam)
  { w: 1, code: 'pos_contact', p: [
    /\bcontact(?:ez)?\b/i, /\bwhatsapp\b/i, /\btel[:\.\s]/i,
  ]},
];

const NEGATIVE_RE = [
  // Vehicles
  { w: -4, code: 'neg_vehicle',   p: [/\bvoitures?\b/i, /\bv[ée]hicules?\b/i, /\bmotos?\b/i, /\bcamions?\b/i, /\btoyota\b/i, /\bmercedes\b/i, /\bhyundai\b/i, /\bmarque\b/i] },
  // Food / agriculture / livestock
  { w: -4, code: 'neg_food',      p: [/\bpoulets?\b/i, /\bviande\b/i, /\bpoissons?\b/i, /\briz\b/i, /\btraiteurs?\b/i, /\brestaurants?\b/i, /\bpizza\b/i, /\blait\b/i, /\beau\s+min[ée]rale\b/i, /\blégumes?\b/i] },
  { w: -4, code: 'neg_pastry',    p: [/\bgâteau[x]?\b/i, /\bgateau[x]?\b/i, /\bpâtisserie\b/i, /\bpatisserie\b/i] },
  // Clothing / fashion / cosmetics
  { w: -4, code: 'neg_clothing',  p: [/\brobes?\b/i, /\bthioup\b/i, /\bboubous?\b/i, /\bchaussures?\b/i, /\bsneakers?\b/i, /\bbaskets?\b/i, /\bcollections?\b/i] },
  { w: -3, code: 'neg_cosmetics', p: [/\bparfums?\b/i, /\bcr[èe]mes?\b/i, /\bcosm[ée]tiques?\b/i, /\bperruques?\b/i, /\bm[èe]ches?\b/i, /\btissages?\b/i, /\bmakeup\b/i, /\bmaquillage\b/i] },
  { w: -3, code: 'neg_jewelry',   p: [/\bbijoux?\b/i, /\bcolliers?\b/i, /\bbracelets?\b/i, /\bboucles?\s+d['’]?oreille/i] },
  // Electronics
  { w: -4, code: 'neg_electronics', p: [/\btéléphones?\b/i, /\btelephones?\b/i, /\biphone\b/i, /\bsamsung\b/i, /\bordinateurs?\b/i, /\blaptops?\b/i, /\btablettes?\b/i] },
  // Jobs / training
  { w: -5, code: 'neg_job',       p: [/\bemploi\b/i, /\brecrutements?\b/i, /\boffre\s+d['’]?emploi\b/i, /\bcandidature\b/i] },
  { w: -3, code: 'neg_training',  p: [/\bformations?\b/i, /\bcours\b/i, /\bstages?\b/i, /\bateliers?\b/i, /\bs[ée]minaires?\b/i] },
  // Services / cleaning
  { w: -3, code: 'neg_service',   p: [/\bservice\s+(?:de\s+)?nettoyage\b/i, /\bfemme\s+de\s+ménage\b/i, /\bménag[èe]re\b/i, /\bjardinier\b/i] },
  // Wholesale / commerce not property
  { w: -2, code: 'neg_wholesale', p: [/\ben\s*gros\b/i, /\bbouteilles?\b/i, /\bsachets?\b/i, /\bcartons?\b/i] },
  // Generic spam / promo
  { w: -2, code: 'neg_promo',     p: [/\bpromotions?\b/i, /\bsoldes?\b/i, /\blivraisons?\b/i, /\bcommandez?\b/i] },
  // Furniture
  { w: -2, code: 'neg_furniture', p: [/\bcanap[ée]s?\b/i, /\bmatelas\b/i, /\blits?\b(?!\s*(?:\d|grande?s?))/i, /\bfauteuils?\b/i] },
];

const ACCEPT_THRESHOLD = 3;     // min positive score to be a real-estate post
const HARD_REJECT_BELOW = -1;   // if score goes this negative → non-real-estate

function collectScore(text, rules) {
  const hits = [];
  let total = 0;
  for (const rule of rules) {
    for (const p of rule.p) {
      if (p.test(text)) {
        hits.push(rule.code);
        total += rule.w;
        break;
      }
    }
  }
  return { hits, total };
}

/**
 * Classify whether the text is a real-estate post.
 * @returns {{
 *   isRealEstate: boolean,
 *   score: number,
 *   positive_hits: string[],
 *   negative_hits: string[],
 *   reasons: string[]
 * }}
 */
function classifyRealEstate(text) {
  if (!text || text.trim().length < 15) {
    return { isRealEstate: false, score: 0, positive_hits: [], negative_hits: [], reasons: ['too_short'] };
  }

  const pos = collectScore(text, POSITIVE_RE);
  const neg = collectScore(text, NEGATIVE_RE);
  const score = pos.total + neg.total;

  // Hard reject: strong negative signal + few positive → spam
  if (neg.total <= -4 && pos.total < 5) {
    return {
      isRealEstate: false,
      score,
      positive_hits: pos.hits,
      negative_hits: neg.hits,
      reasons: ['hard_reject_negative', ...neg.hits],
    };
  }

  const isRealEstate = score >= ACCEPT_THRESHOLD;
  return {
    isRealEstate,
    score,
    positive_hits: pos.hits,
    negative_hits: neg.hits,
    reasons: isRealEstate ? pos.hits : ['score_below_threshold'],
  };
}

module.exports = { classifyRealEstate };
