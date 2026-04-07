// ─── Precision-First Real Estate Classifier ─────────────────────────────────
// Scores WhatsApp message segments for real-estate relevance using weighted
// positive and negative evidence. Designed to minimize false positives.
//
// PARSER_VERSION is bumped whenever scoring logic changes so stored results
// can be traced back to the algorithm that produced them.

const PARSER_VERSION = '2.0.0';

// ─── Positive evidence patterns (each has a weight) ─────────────────────────

const POSITIVE_EVIDENCE = [
  // Strong category terms
  { patterns: [/\bappart(?:ement)?\b/i], weight: 0.25, code: 'cat_apartment' },
  { patterns: [/\bstudio\b/i], weight: 0.25, code: 'cat_studio' },
  { patterns: [/\b[FT][1-6]\b/], weight: 0.25, code: 'cat_f_notation' },
  { patterns: [/\bmaison\b/i, /\bvilla\b/i], weight: 0.25, code: 'cat_house' },
  { patterns: [/\bterrain\b/i], weight: 0.20, code: 'cat_terrain' },
  { patterns: [/\bduplex\b/i, /\btriplex\b/i], weight: 0.25, code: 'cat_duplex' },
  { patterns: [/\brésidence\b/i, /\bresidence\b/i, /\bpavillon\b/i], weight: 0.22, code: 'cat_residence' },
  { patterns: [/\bcoloc(?:ation|ataire)?\b/i, /\bco[-\s]?loc(?:ation)?\b/i], weight: 0.20, code: 'cat_colocation' },
  { patterns: [/\bterrain\s+agricole\b/i, /\bterre\s+agricole\b/i, /\bchamp\b/i, /\bferme\b/i], weight: 0.22, code: 'cat_agri' },
  { patterns: [/\bmagasin\b/i, /\bboutique\b/i, /\blocal\s+commercial\b/i, /\bbureau[x]?\b/i, /\bentrepôt\b/i, /\bentrepot\b/i, /\bhangar\b/i, /\bdépôt\b/i, /\bdepot\b/i], weight: 0.25, code: 'cat_commercial' },

  // Transaction terms
  { patterns: [/\bà\s*louer\b/i, /\ba\s*louer\b/i], weight: 0.20, code: 'tx_a_louer' },
  { patterns: [/\bà\s*vendre\b/i, /\ba\s*vendre\b/i, /\ben\s*vente\b/i], weight: 0.20, code: 'tx_a_vendre' },
  { patterns: [/\bdisponible\b/i], weight: 0.10, code: 'tx_disponible' },
  { patterns: [/\bje\s*cherche\b/i, /\bcherche\b/i, /\brecherche\b/i, /\bbesoin\b/i], weight: 0.15, code: 'tx_cherche' },
  { patterns: [/\bloyer\b/i, /\bbail\b/i], weight: 0.15, code: 'tx_loyer' },
  { patterns: [/\blocation\b/i], weight: 0.10, code: 'tx_location' },

  // Property attributes (medium weight)
  { patterns: [/\bchambre\s+salon\b/i], weight: 0.18, code: 'attr_chambre_salon' },
  { patterns: [/\b(?:deux|trois|quatre|cinq|2|3|4|5|02|03|04|05)\s+chambre/i], weight: 0.18, code: 'attr_multi_chambre' },
  { patterns: [/\bsalon\b/i], weight: 0.08, code: 'attr_salon' },
  { patterns: [/\bcuisine\b/i], weight: 0.08, code: 'attr_cuisine' },
  { patterns: [/\btoilette\b/i, /\bdouche\b/i], weight: 0.10, code: 'attr_toilet' },
  { patterns: [/\bétage\b/i, /\betage\b/i, /\bniveau\b/i], weight: 0.10, code: 'attr_etage' },
  { patterns: [/\bbalcon\b/i, /\bterrasse\b/i], weight: 0.08, code: 'attr_balcon' },
  { patterns: [/\bgarage\b/i], weight: 0.08, code: 'attr_garage' },
  { patterns: [/\bpiscine\b/i, /\bjardin\b/i], weight: 0.06, code: 'attr_outdoor' },
  { patterns: [/\bm[²2]\b/i, /\bmètres?\s*carr/i], weight: 0.12, code: 'attr_area' },

  // Price evidence (context-dependent, moderate weight)
  { patterns: [/\b\d{2,3}\s*(?:mill?|millions?)\b/i], weight: 0.15, code: 'price_millions' },
  { patterns: [/\b\d{4,9}\s*(?:FCFA|CFA|F)\b/i], weight: 0.15, code: 'price_cfa' },
  { patterns: [/\b\d{1,3}(?:[.\s]\d{3})+\b/], weight: 0.10, code: 'price_formatted' },

  // Real estate vocabulary
  { patterns: [/\bimmobili[eè]re?\b/i], weight: 0.15, code: 'vocab_immo' },
  { patterns: [/\blogement\b/i, /\bhabitat\b/i], weight: 0.10, code: 'vocab_logement' },
  { patterns: [/\bpropri[ée]t[ée]\b/i], weight: 0.10, code: 'vocab_propriete' },
];

// ─── Negative evidence patterns (reduce score) ─────────────────────────────

const NEGATIVE_EVIDENCE = [
  // Commerce / retail / catalog language
  { patterns: [/\blivraison\b/i, /\bcommande[rz]?\b/i, /\bcommand\b/i], weight: -0.30, code: 'neg_commerce' },
  { patterns: [/\ben\s*gros\b/i, /\ben\s*détail\b/i, /\ben\s*detail\b/i], weight: -0.30, code: 'neg_wholesale' },
  { patterns: [/\bpromotion\b/i, /\bpromo\b/i, /\bsolde[s]?\b/i], weight: -0.25, code: 'neg_promo' },
  { patterns: [/\bboutique\s+en\s+ligne\b/i, /\bshop\b/i], weight: -0.15, code: 'neg_shop' },

  // Clothing / fashion / cosmetics
  { patterns: [/\brobe[s]?\b/i, /\bthioup\b/i, /\bboubou\b/i], weight: -0.30, code: 'neg_clothing' },
  { patterns: [/\bchaussure[s]?\b/i, /\bsneaker[s]?\b/i, /\bbasket[s]?\b/i], weight: -0.30, code: 'neg_shoes' },
  { patterns: [/\bparfum[s]?\b/i, /\bcrème[s]?\b/i, /\bcreme[s]?\b/i, /\bcosmétique\b/i], weight: -0.25, code: 'neg_cosmetics' },
  { patterns: [/\bbijou[x]?\b/i, /\bcollier[s]?\b/i, /\bbracelet[s]?\b/i, /\bboucle[s]?\s+d'oreille/i], weight: -0.30, code: 'neg_jewelry' },
  { patterns: [/\bperruque[s]?\b/i, /\bmèche[s]?\b/i, /\bmeche[s]?\b/i, /\btissage\b/i], weight: -0.25, code: 'neg_hair' },
  { patterns: [/\bsac[s]?\s+(?:à\s+)?main\b/i, /\bsac[s]?\s+de\s+voyage\b/i], weight: -0.20, code: 'neg_bags' },

  // Food / catering
  { patterns: [/\brestaurant\b/i, /\btraiteur\b/i, /\bcatering\b/i], weight: -0.20, code: 'neg_food' },
  { patterns: [/\bpoulet\b/i, /\bviande\b/i, /\bpoisson\b/i, /\briz\b/i], weight: -0.25, code: 'neg_groceries' },
  { patterns: [/\bgâteau[x]?\b/i, /\bgateau[x]?\b/i, /\bpâtisserie\b/i], weight: -0.20, code: 'neg_pastry' },

  // Electronics / gadgets / vehicles
  { patterns: [/\btéléphone[s]?\b/i, /\btelephone[s]?\b/i, /\biphone\b/i, /\bsamsung\b/i], weight: -0.25, code: 'neg_phone' },
  { patterns: [/\bordinateur\b/i, /\blaptop\b/i, /\btablette\b/i], weight: -0.25, code: 'neg_computer' },
  { patterns: [/\bvoiture[s]?\b/i, /\bvéhicule\b/i, /\bvehicule\b/i, /\bmoto\b/i], weight: -0.30, code: 'neg_vehicle' },

  // Services / jobs
  { patterns: [/\bemploi\b/i, /\brecrutement\b/i, /\boffre\s+d'emploi\b/i], weight: -0.35, code: 'neg_job' },
  { patterns: [/\bformation\b/i, /\bcours\b/i, /\bstage\b/i], weight: -0.20, code: 'neg_training' },

  // Generic spam / low-value signals
  { patterns: [/\bappel(?:er|ez)\s+(?:au|le|vite)\b/i], weight: -0.10, code: 'neg_call_action' },
  { patterns: [/\b(?:whatsapp|telegram|inbox)\b/i], weight: -0.05, code: 'neg_social' },

  // Very short messages with only price-like numbers (likely not listings)
  { patterns: [/^[^a-zA-ZÀ-ÿ]{0,5}\d{5,}\s*$/], weight: -0.40, code: 'neg_numbers_only' },
];

// ─── Minimum confidence threshold ───────────────────────────────────────────
const ACCEPT_THRESHOLD = 0.45;     // high-precision: require solid evidence
const REVIEW_THRESHOLD = 0.30;     // between review and accept = needs_review

// ─── Segment splitter ───────────────────────────────────────────────────────
// Improved segmentation that handles WhatsApp formatting conventions

function splitIntoSegments(text) {
  if (!text || text.length < 15) return [{ text: text || '', index: 0 }];

  // Strategy 1: Numbered list items (1. / 1) / 1- / • / ● / ▪ / -)
  const numberedParts = text
    .split(/(?:^|\n)\s*(?:\d+[.)\-]|[•●▪★⭐🔴🟢🔵⚡🏠🏘️]\s*)/m)
    .filter(s => s.trim().length > 15);
  if (numberedParts.length > 1) {
    return numberedParts.map((s, i) => ({ text: s.trim(), index: i }));
  }

  // Strategy 2: Double newlines
  const doubleNL = text.split(/\n\s*\n/).filter(s => s.trim().length > 15);
  if (doubleNL.length > 1) {
    return doubleNL.map((s, i) => ({ text: s.trim(), index: i }));
  }

  // Strategy 3: Separator lines (─── / === / *** / --- with at least 3 chars)
  const sepParts = text.split(/\n\s*[─═━\-=*]{3,}\s*\n/).filter(s => s.trim().length > 15);
  if (sepParts.length > 1) {
    return sepParts.map((s, i) => ({ text: s.trim(), index: i }));
  }

  // Strategy 4: Repeated transaction-keyword anchors on separate lines
  // e.g. lines starting with "À louer", "À vendre", "Cherche", "Disponible"
  const anchorRe = /^(?:à\s*(?:louer|vendre)|a\s*(?:louer|vendre)|cherche|disponible|besoin|offre|propose|je\s*(?:cherche|vends?|loue))\b/im;
  const lines = text.split('\n');
  const anchorIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (anchorRe.test(lines[i].trim())) anchorIndices.push(i);
  }
  if (anchorIndices.length > 1) {
    const segments = [];
    for (let k = 0; k < anchorIndices.length; k++) {
      const start = anchorIndices[k];
      const end = k + 1 < anchorIndices.length ? anchorIndices[k + 1] : lines.length;
      const block = lines.slice(start, end).join('\n').trim();
      if (block.length > 15) segments.push({ text: block, index: k });
    }
    if (segments.length > 1) return segments;
  }

  // Strategy 5: Emoji bullet separators (lines starting with housing/marker emojis)
  const emojiAnchorRe = /^[🏠🏘️🏡🏢🔑🏗️📍📌🔴🟢🔵⚡➡️▶️✅❌💰🏠]\s*/;
  const emojiIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (emojiAnchorRe.test(lines[i].trim())) emojiIndices.push(i);
  }
  if (emojiIndices.length > 1) {
    const segments = [];
    for (let k = 0; k < emojiIndices.length; k++) {
      const start = emojiIndices[k];
      const end = k + 1 < emojiIndices.length ? emojiIndices[k + 1] : lines.length;
      const block = lines.slice(start, end).join('\n').trim();
      if (block.length > 15) segments.push({ text: block, index: k });
    }
    if (segments.length > 1) return segments;
  }

  return [{ text: text.trim(), index: 0 }];
}

// ─── Score a single text segment ────────────────────────────────────────────

function scoreSegment(text) {
  let totalScore = 0;
  const reasons = [];

  // Positive evidence
  for (const evidence of POSITIVE_EVIDENCE) {
    for (const pattern of evidence.patterns) {
      if (pattern.test(text)) {
        totalScore += evidence.weight;
        reasons.push(evidence.code);
        break; // only count each evidence group once
      }
    }
  }

  // Negative evidence
  for (const evidence of NEGATIVE_EVIDENCE) {
    for (const pattern of evidence.patterns) {
      if (pattern.test(text)) {
        totalScore += evidence.weight; // weight is already negative
        reasons.push(evidence.code);
        break;
      }
    }
  }

  // Structural bonus: if text has both a category term AND a transaction term, boost
  const hasCategoryTerm = reasons.some(r => r.startsWith('cat_'));
  const hasTransactionTerm = reasons.some(r => r.startsWith('tx_'));
  const hasAttributeTerm = reasons.some(r => r.startsWith('attr_'));
  const hasPriceTerm = reasons.some(r => r.startsWith('price_'));

  if (hasCategoryTerm && hasTransactionTerm) {
    totalScore += 0.10;
    reasons.push('bonus_cat_tx');
  }
  if (hasCategoryTerm && hasAttributeTerm) {
    totalScore += 0.05;
    reasons.push('bonus_cat_attr');
  }
  if (hasCategoryTerm && hasPriceTerm) {
    totalScore += 0.05;
    reasons.push('bonus_cat_price');
  }

  // Penalty for very short texts (under 30 chars) — likely incomplete
  if (text.length < 30) {
    totalScore -= 0.15;
    reasons.push('penalty_short');
  }

  // Clamp to [0, 1]
  const confidence = Math.max(0, Math.min(1, totalScore));

  let status;
  if (confidence >= ACCEPT_THRESHOLD) {
    status = 'accepted';
  } else if (confidence >= REVIEW_THRESHOLD) {
    status = 'needs_review';
  } else {
    status = 'rejected';
  }

  return {
    confidence: parseFloat(confidence.toFixed(3)),
    status,
    reasons,
    isRealEstate: status === 'accepted',
  };
}

// ─── Classify a full message ────────────────────────────────────────────────
// Returns: { segments, acceptedSegments, overallStatus, parserVersion }

function classifyMessage(text) {
  if (!text || text.length < 10) {
    return {
      segments: [],
      acceptedSegments: [],
      overallStatus: 'rejected',
      overallConfidence: 0,
      parserVersion: PARSER_VERSION,
    };
  }

  const rawSegments = splitIntoSegments(text);
  const segments = rawSegments.map((seg, idx) => {
    const score = scoreSegment(seg.text);
    return {
      index: idx,
      text: seg.text,
      ...score,
    };
  });

  const acceptedSegments = segments.filter(s => s.isRealEstate);

  // Overall status: if any segment is accepted, the message contains real estate
  let overallStatus = 'rejected';
  let overallConfidence = 0;
  if (acceptedSegments.length > 0) {
    overallStatus = 'accepted';
    overallConfidence = Math.max(...acceptedSegments.map(s => s.confidence));
  } else if (segments.some(s => s.status === 'needs_review')) {
    overallStatus = 'needs_review';
    overallConfidence = Math.max(...segments.map(s => s.confidence));
  }

  return {
    segments,
    acceptedSegments,
    overallStatus,
    overallConfidence: parseFloat(overallConfidence.toFixed(3)),
    segmentCount: segments.length,
    parserVersion: PARSER_VERSION,
  };
}

module.exports = {
  classifyMessage,
  scoreSegment,
  splitIntoSegments,
  PARSER_VERSION,
  ACCEPT_THRESHOLD,
  REVIEW_THRESHOLD,
};
