// ─── Category parser (spec §10) ─────────────────────────────────────────────
// Categories: apartment | room | house | ground | agricultural_ground |
//             colocation | office | shop
//
// Uses an explicit priority order so that ambiguous terms like "chambre" in
// "chambre salon" resolve to apartment (not room).

const PRIORITY = [
  'colocation',
  'commercial_office', 'commercial_shop',
  'agricultural_ground',
  'house',
  'apartment',
  'room',
  'ground',
];

const PATTERNS = {
  // colocation/coloc — check first because "coloc" often appears alongside "chambre"
  colocation: [
    /\bcoloc(?:ation|ataire)?\b/i,
    /\bco[-\s]?loc(?:ation)?\b/i,
    /\bcolacatrice\b/i,
    /\bpartage\s+(?:d['’])?appart/i,
    /\broommate\b/i,
  ],
  // Offices (plateaux de bureau, bureau)
  commercial_office: [
    /\bbureaux?\b/i,
    /\bplateaux?\s+de\s+bureau/i,
    /\bespace\s+bureau\b/i,
    /\bshow\s*room\b/i,
  ],
  // Shops / magasins / boutiques
  commercial_shop: [
    /\bmagasins?\b/i,
    /\bboutiques?\b/i,
    /\blocal\s+commercial\b/i,
    /\blocaux\s+commerci/i,
    /\bentrepôts?\b/i, /\bentrepots?\b/i,
    /\bhangars?\b/i,
    /\bdépôts?\b/i, /\bdepots?\b/i,
  ],
  agricultural_ground: [
    /\bterrain\s+agricole\b/i,
    /\bterre\s+agricole\b/i,
    /\bchamps?\b/i,
    /\bfermes?\b/i,
    /\bexploitations?\b/i,
  ],
  house: [
    /\bmaisons?\b/i,
    /\bvillas?\b/i,
    /\brésidences?\b/i, /\bresidences?\b/i,
    /\bpavillons?\b/i,
    /\bduplex\b/i, /\btriplex\b/i,
    /\bimmeubles?\b/i,
  ],
  apartment: [
    /\bappart(?:ement)?s?\b/i,
    /\bstudios?\b/i,
    /\bmini\s+studios?\b/i,
    /\b[FT][1-6]\b/,
    /\bpi[èe]ces?\b/i,
    /\bchambres?\s+salon\b/i,
    /\bniveaux?\b/i,
    /\b(?:deux|trois|quatre|cinq|\d|02|03|04|05)\s+chambres?\b/i,
  ],
  room: [
    /\bchambres?\b/i,
    /\brooms?\b/i,
  ],
  ground: [
    /\bterrains?\b/i,
    /\blots?\b/i,
    // "parcelle" is intentionally NOT here because it's usually neighborhood "Parcelles"
  ],
};

// Normalization: "commercial_office"/"commercial_shop" → split into office/shop
// matching spec §10. We keep internal keys separate just to avoid collisions.
const INTERNAL_TO_PUBLIC = {
  commercial_office: 'office',
  commercial_shop: 'shop',
};

function parseCategory(text) {
  if (!text) return { category: null, reasons: [] };

  // Earliest-occurrence wins — the subject noun is usually mentioned first.
  // e.g. "Je cherche une maison avec magasins au rdc" → house (maison first),
  // not shop (magasins mentioned as a secondary feature).
  //
  // Ties on position are broken by PRIORITY (more specific patterns first).
  let best = null;
  for (let i = 0; i < PRIORITY.length; i++) {
    const key = PRIORITY[i];
    for (const p of PATTERNS[key]) {
      const m = text.match(p);
      if (!m) continue;
      const position = m.index;
      if (
        best === null ||
        position < best.position ||
        (position === best.position && i < best.priorityIdx)
      ) {
        best = {
          key,
          publicKey: INTERNAL_TO_PUBLIC[key] || key,
          position,
          priorityIdx: i,
          patternSrc: p.source,
        };
      }
    }
  }

  if (!best) return { category: null, reasons: ['no_category_match'] };
  return {
    category: best.publicKey,
    reasons: [`cat_${best.key}_hit@${best.position}:${best.patternSrc.slice(0, 30)}`],
  };
}

// Helper used by the extractor to label listings
const CATEGORY_LABELS = {
  apartment: 'Appartement',
  room: 'Chambre',
  house: 'Maison',
  ground: 'Terrain',
  agricultural_ground: 'Terrain agricole',
  colocation: 'Colocation',
  office: 'Bureau',
  shop: 'Local commercial',
};

function inferTransactionType(text) {
  if (!text) return null;
  // JS \b only breaks on [A-Za-z0-9_] — accented letters like "à" don't trigger
  // word boundaries, so we flatten them before regex testing.
  const t = text.replace(/[àâä]/gi, 'a').replace(/[éèêë]/gi, 'e');
  if (/\ba\s*vendre\b|\ben\s*vente\b|\bje\s*vends?\b|\bvente\b|\bacheter\b/i.test(t)) return 'sale';
  if (/\ba\s*louer\b|\bje\s*loue\b|\bloyer\b|\blocation\b|\bbail\b|\bmensuel\b|\/\s*mois\b|\bpar\s+mois\b/i.test(t)) return 'rent';
  return null;
}

module.exports = { parseCategory, inferTransactionType, CATEGORY_LABELS };
