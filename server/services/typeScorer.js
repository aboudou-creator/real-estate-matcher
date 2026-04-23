// ─── Offer / Demand scorer (spec §6, §7, §8) ────────────────────────────────
// Replaces the old flat-keyword OFFER_PATTERNS/DEMAND_PATTERNS approach with
// an explicit weighted scorer and conflict detection.
//
// Critical rule (§7): a post with `profil recherché` / `locataire recherché` /
// `client recherché` must NOT be flipped to demand just because it contains
// "recherché". Those are false positives when surrounded by offer structure.

const THRESHOLD = 3;    // min score to be considered a side
const GAP       = 2;    // winner must exceed the other by this many points

// ─── OFFER signals (§6A) ───────────────────────────────────────────────────
const OFFER_SIGNALS = [
  { code: 'offer_a_louer',        weight: 5, patterns: [/\bà\s*louer\b/i, /\ba\s*louer\b/i] },
  { code: 'offer_a_vendre',       weight: 5, patterns: [/\bà\s*vendre\b/i, /\ba\s*vendre\b/i, /\ben\s*vente\b/i] },
  { code: 'offer_disponible',     weight: 4, patterns: [/\bdisponibles?\b/i, /\bdispo\b/i] },
  { code: 'offer_loyer',          weight: 4, patterns: [/\bloyer\b/i, /\bbail\b/i] },
  { code: 'offer_prix',           weight: 3, patterns: [/\bprix\b/i, /\btarif\b/i] },
  { code: 'offer_conditions',     weight: 3, patterns: [/\bconditions?\b/i] },
  { code: 'offer_contact',        weight: 3, patterns: [/\bcontact(?:ez)?\b/i, /\bwhatsapp\b/i, /\btel[:\.\s]/i, /\btelephone\b/i, /\btéléphone\b/i] },
  { code: 'offer_visite',         weight: 2, patterns: [/\bvisite[rz]?\b/i, /\bpossible\s+de\s+visiter\b/i] },
  { code: 'offer_prend',          weight: 3, patterns: [/\bprend\s+(?:étrangers?|etrangers?|filles?|hommes?|familles?)\b/i] },
  { code: 'offer_client_solvable',weight: 3, patterns: [/\bclient(?:e)?\s+solvable\b/i] },
  { code: 'offer_je_vends',       weight: 5, patterns: [/\bje\s*vends?\b/i, /\bon\s*vend\b/i] },
  { code: 'offer_je_loue',        weight: 5, patterns: [/\bje\s*loue\b/i, /\bje\s*propose\b/i] },
  { code: 'offer_offre',          weight: 3, patterns: [/\boffre\b/i, /\bpropose\b/i, /\bc[èe]de\b/i] },
];

// ─── DEMAND signals (§6B) ──────────────────────────────────────────────────
// `suppressedByFalsePositive: true` means the signal is IGNORED when any
// false-positive phrase (profil recherché, etc.) matches. This is the
// mechanism that fixes the §7 bug.
const DEMAND_SIGNALS = [
  { code: 'demand_je_cherche',           weight: 6, patterns: [/\bje\s*cherche\b/i] },
  { code: 'demand_a_la_recherche',       weight: 6, patterns: [/\bà\s*la\s*recherche\s+d['’\s]/i, /\ba\s*la\s*recherche\s+d['’\s]/i] },
  { code: 'demand_besoin',               weight: 5, patterns: [/\bbesoin\s+d['’]\s*un(?:e)?\b/i, /\bai\s+besoin\s+d['’]/i] },
  { code: 'demand_cherche_category',     weight: 7, patterns: [/\bcherche\s+(?:un[e]?\s+)?(?:studio|chambre|appart(?:ement)?|villa|maison|colocation|bureau|magasin|terrain)\b/i] },
  { code: 'demand_recherche_category',   weight: 7, patterns: [/\brecherche\s+(?:un[e]?\s+)?(?:studio|chambre|appart(?:ement)?|villa|maison|colocation|bureau|magasin|terrain)\b/i] },
  { code: 'demand_client_pret',          weight: 6, patterns: [/\bclient(?:e)?\s+prêt[ée]?\s+à\s+finalis/i, /\bclient(?:e)?\s+prete?\s+à\s+finalis/i] },
  { code: 'demand_mon_budget',           weight: 4, patterns: [/\bmon\s+budget\b/i, /\bnotre\s+budget\b/i] },
  { code: 'demand_je_veux',              weight: 4, patterns: [/\bje\s*veux\s+(?:un[e]?\s+)?(?:studio|chambre|appart|villa|maison|terrain)/i] },
  // Generic (ambiguous) — suppressed when a false-positive phrase is present.
  // [eé] covers recherche/recherché/recherchée, (?!\w) handles accented ending
  { code: 'demand_recherche_generic',    weight: 5, patterns: [/\brecherch[eé]e?s?(?!\w)/i, /\brecherches?(?!\w)/i], suppressedByFalsePositive: true },
  { code: 'demand_cherche_generic',      weight: 4, patterns: [/\bcherche(?!\w)/i, /\bcherch[eé]e?s?(?!\w)/i], suppressedByFalsePositive: true },
];

// ─── DEMAND false positives (§6C, §7) ──────────────────────────────────────
// When any of these match, generic "cherche" / "recherche" signals are
// suppressed and a conflict flag is raised.
// NOTE: trailing (?!\w) instead of \b because JS \w is ASCII-only and \b
// fails between accented chars (é) and punctuation.
const FALSE_POSITIVE_PATTERNS = [
  { code: 'fp_profil_recherche',    pattern: /\bprofils?\s+recherch[ée]?e?s?(?!\w)/i },
  { code: 'fp_client_recherche',    pattern: /\bclient(?:e)?s?\s+recherch[ée]?e?s?(?!\w)/i },
  { code: 'fp_locataire_recherche', pattern: /\blocataires?\s+recherch[ée]?e?s?(?!\w)/i },
  { code: 'fp_candidat_recherche',  pattern: /\bcandidat(?:e)?s?\s+recherch[ée]?e?s?(?!\w)/i },
  { code: 'fp_preference',          pattern: /\bpr[ée]f[ée]rence(?!\w)/i },
  { code: 'fp_prend_demographic',   pattern: /\bprend\s+(?:étrangers?|etrangers?|filles?|hommes?|familles?)\b/i },
  { code: 'fp_client_solvable',     pattern: /\bclient(?:e)?s?\s+solvables?\b/i },
];

// ─── Listing structure signals (§6D) ───────────────────────────────────────
const LISTING_SIGNALS = [
  { code: 'list_chambre',   pattern: /\bchambres?\b/i },
  { code: 'list_studio',    pattern: /\bstudios?\b/i },
  { code: 'list_appart',    pattern: /\bappart(?:ement)?s?\b/i },
  { code: 'list_villa',     pattern: /\bvillas?\b/i },
  { code: 'list_maison',    pattern: /\bmaisons?\b/i },
  { code: 'list_immeuble',  pattern: /\bimmeubles?\b/i },
  { code: 'list_terrain',   pattern: /\bterrains?\b/i },
  { code: 'list_magasin',   pattern: /\bmagasins?\b|\bboutiques?\b|\blocal\s+commercial\b/i },
  { code: 'list_bureau',    pattern: /\bbureaux?\b|\bplateaux?\s+de\s+bureau/i },
  { code: 'list_cuisine',   pattern: /\bcuisines?\b/i },
  { code: 'list_toilet',    pattern: /\btoilettes?\b|\bdouches?\b|\bsalle\s+de\s+bain/i },
  { code: 'list_balcon',    pattern: /\bbalcons?\b|\bterrasses?\b/i },
  { code: 'list_etage',     pattern: /\bétages?\b|\betages?\b|\brdc\b|\brez[- ]de[- ]chauss[ée]e\b|\bniveau\b/i },
  { code: 'list_f_notation',pattern: /\b[FT][1-6]\b/ },
  { code: 'list_m2',        pattern: /\b\d+\s*m\s*[²2]\b/i },
];

function collectHits(text, signals) {
  const hits = [];
  for (const sig of signals) {
    const pats = sig.patterns || [sig.pattern];
    for (const p of pats) {
      if (p.test(text)) {
        hits.push({ code: sig.code, weight: sig.weight || 1, suppressedByFalsePositive: !!sig.suppressedByFalsePositive });
        break;
      }
    }
  }
  return hits;
}

/**
 * Score a text for offer vs demand.
 * @returns {{
 *   offer_score: number,
 *   demand_score: number,
 *   offer_signal_hits: string[],
 *   demand_signal_hits: string[],
 *   demand_false_positive_hits: string[],
 *   listing_signal_hits: string[],
 *   conflict_flags: string[],
 *   type_final: 'offer'|'demand'|'ambiguous',
 *   type_confidence: number,
 *   type_reason_summary: string
 * }}
 */
function scoreType(text) {
  const empty = {
    offer_score: 0, demand_score: 0,
    offer_signal_hits: [], demand_signal_hits: [],
    demand_false_positive_hits: [], listing_signal_hits: [],
    conflict_flags: [],
    type_final: 'ambiguous',
    type_confidence: 0,
    type_reason_summary: 'empty',
  };
  if (!text || typeof text !== 'string' || text.trim().length < 5) return empty;

  // 1. False positives (must be computed BEFORE demand scoring)
  const fpHits = [];
  for (const fp of FALSE_POSITIVE_PATTERNS) {
    if (fp.pattern.test(text)) fpHits.push(fp.code);
  }
  const hasFalsePositive = fpHits.length > 0;

  // 2. Offer score
  const offerHits = collectHits(text, OFFER_SIGNALS);
  const offer_score = offerHits.reduce((a, h) => a + h.weight, 0);

  // 3. Demand score (suppressing generic signals when FP present)
  const demandHitsRaw = collectHits(text, DEMAND_SIGNALS);
  const demandHits = demandHitsRaw.filter(h => !(h.suppressedByFalsePositive && hasFalsePositive));
  const demand_score = demandHits.reduce((a, h) => a + h.weight, 0);

  // 4. Listing structure
  const listingHits = collectHits(text, LISTING_SIGNALS);
  const listing_count = listingHits.length;

  // 5. Conflict detection (§7)
  const conflict_flags = [];
  // Any demand signal that got suppressed by a false positive is always a conflict,
  // worth exposing in the debug drawer so humans can see the near-miss.
  if (demandHitsRaw.length > demandHits.length) {
    conflict_flags.push('demand_signal_suppressed_by_fp');
  }
  let type_final;
  let type_reason_summary;

  // Normal decision (§8)
  if (offer_score >= THRESHOLD && offer_score > demand_score + GAP) {
    type_final = 'offer';
    type_reason_summary = `offer_score=${offer_score} > demand_score=${demand_score}+${GAP}`;
  } else if (demand_score >= THRESHOLD && demand_score > offer_score + GAP) {
    type_final = 'demand';
    type_reason_summary = `demand_score=${demand_score} > offer_score=${offer_score}+${GAP}`;
  } else {
    type_final = 'ambiguous';
    type_reason_summary = `offer=${offer_score}, demand=${demand_score} (no clear winner)`;
  }

  // §7 Conflict override — force offer when FP + strong offer structure
  if (
    hasFalsePositive &&
    offer_score >= 4 &&
    listing_count >= 2 &&
    type_final !== 'offer'
  ) {
    conflict_flags.push('demand_fp_in_offer_context');
    type_final = 'offer';
    type_reason_summary = `forced offer: FP=${fpHits.join(',')} + offer_score=${offer_score} + listing=${listing_count}`;
  }

  // Additional flag: ambiguous with conflicting signals
  if (type_final === 'ambiguous' && offer_score > 0 && demand_score > 0) {
    conflict_flags.push('mixed_offer_demand_signals');
  }

  // Bias to offer when listing anatomy is strong and no demand verbs exist
  if (type_final === 'ambiguous' && listing_count >= 3 && demand_score === 0 && offer_score >= 2) {
    type_final = 'offer';
    type_reason_summary = `listing anatomy bias (listing=${listing_count}, offer=${offer_score})`;
  }

  // Confidence: normalized margin
  const margin = Math.abs(offer_score - demand_score);
  const type_confidence = type_final === 'ambiguous'
    ? 0
    : Math.min(1, margin / 10);

  return {
    offer_score,
    demand_score,
    offer_signal_hits: offerHits.map(h => h.code),
    demand_signal_hits: demandHits.map(h => h.code),
    demand_false_positive_hits: fpHits,
    listing_signal_hits: listingHits.map(h => h.code),
    conflict_flags,
    type_final,
    type_confidence: parseFloat(type_confidence.toFixed(2)),
    type_reason_summary,
  };
}

module.exports = { scoreType, OFFER_SIGNALS, DEMAND_SIGNALS, FALSE_POSITIVE_PATTERNS, LISTING_SIGNALS };
