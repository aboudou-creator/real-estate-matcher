// ─── Price parser — Senegal WhatsApp real-estate conventions ────────────────
// Critical rule (§9B):  "mil" / "mille" / "milles" == ×1000  (NOT millions)
//                       "million" / "millions" / standalone "M" == ×1 000 000
//
// Priority (§9C): formatted-with-separators → millions → mil → cfa-suffix →
// bare-numeric. Conditions (x3 / /3 / 3 mois) are parsed independently and
// MUST NOT multiply the price amount.

const EMPTY = {
  raw_price_match: null,
  price_amount: null,
  currency: 'XOF',
  price_kind: 'unknown',
  conditions_months: null,
  price_confidence: 0,
  price_reason: null,
};

// ─── Context detectors ─────────────────────────────────────────────────────
// Use (?!\w) instead of \b at end because ² is not a word char.
const PER_M2_REGEX     = /(?:\/|\bpar\s+|\ble\s+)\s*m\s*[²2](?!\w)/i;
const MONTHLY_REGEX    = /\/\s*mois\b|\bpar\s+mois\b|\bmensuel|\bloyer\b|\bà\s*louer\b|\ba\s*louer\b/i;
const SALE_REGEX       = /\bà\s*vendre\b|\ba\s*vendre\b|\ben\s*vente\b|\bje\s*vends?\b|\bvente\b/i;

// Conditions (months of rent deposit / caution): x3, ×4, /3, "3 mois"
// Negative lookahead excludes "/m²" and variants from being misread as "/number"
const CONDITION_REGEX  = /(?:[x×]\s*(\d{1,2})(?!\d)|\/\s*(\d{1,2})(?!\s*m\s*[²2])(?!\d)|(\d{1,2})\s*mois\b)/i;

// ─── Amount patterns (priority order) ─────────────────────────────────────
// Formatted: groups of 3 digits separated by . or space.  Accept trailing
// non-digit (so "6.500.000FCFA" parses) via negative lookahead for digit.
const FORMATTED_REGEX  = /\b\d{1,3}(?:[.\s\u00A0]\d{3}){1,}(?!\d)/;
const MILLION_REGEX    = /(\d+(?:[.,]\d+)?)\s*(?:millions?|M)\b/i;
const MIL_REGEX        = /(\d+(?:[.,]\d+)?)\s*(?:milles|mille|mil)\b(?!ions?\b)/i;
const CFA_SUFFIX_REGEX = /\b(\d{4,9})\s*(?:fcfa|cfa|frs?|francs?|f)\b/i;
const BARE_REGEX       = /\b(\d{5,9})\b/;

// ─── Phone guard — prevent phone numbers being read as prices ─────────────
// Senegal phone numbers are always 9 digits with one of these prefixes:
//   mobile : 70 / 75 / 76 / 77 / 78       landline : 33
// So any 9-digit group starting with those prefixes is almost certainly a phone.
function isPhoneContext(text, index, length) {
  const match = text.slice(index, index + length);
  const digits = match.replace(/[^\d]/g, '');

  // The match itself IS a Senegal phone number (9 digits w/ known prefix)
  if (/^(?:7[05678]|33)\d{7}$/.test(digits)) return true;

  const before = text.slice(Math.max(0, index - 20), index);
  const after  = text.slice(index + length, index + length + 12);

  // International Senegal prefix immediately before
  if (/\+?221[\s.-]?$/.test(before)) return true;

  // Explicit phone-context keyword immediately before
  if (/(?:\btel|\bt[ée]l|\bt[ée]l[ée]phone|\bcontact|\bappel|\bwhatsapp|\binbox|\binfoline|\bappelez)\s*[:.-]?\s*$/i.test(before)) {
    return true;
  }

  // "77 12 34 56" style phone immediately after a short group
  if (/^\s*[\s.-]?\d{2}\s*\d{2}/.test(after) && /^[0-9]/.test(text[index])) {
    if (length <= 4) return true;
  }

  return false;
}

/**
 * Parse a price from free-form text.
 * @returns {{
 *   raw_price_match: string|null,
 *   price_amount: number|null,
 *   currency: string,
 *   price_kind: 'monthly_rent'|'total_sale'|'per_m2'|'unknown',
 *   conditions_months: number|null,
 *   price_confidence: number,
 *   price_reason: string|null
 * }}
 */
function parsePrice(text) {
  if (!text || typeof text !== 'string') return { ...EMPTY };

  // Normalize non-breaking spaces so spacing regexes work uniformly
  const norm = text.replace(/\u00A0/g, ' ');

  // ─── Conditions detection (independent of price amount) ─────────────
  let conditionsMonths = null;
  const condMatch = norm.match(CONDITION_REGEX);
  if (condMatch) {
    const n = parseInt(condMatch[1] || condMatch[2] || condMatch[3], 10);
    if (n >= 2 && n <= 12) conditionsMonths = n;
  }

  // ─── Amount extraction ──────────────────────────────────────────────
  let amount = null;
  let rawMatch = null;
  let reason = null;
  let confidence = 0.8;

  // 1. Formatted ("6.500.000" / "220 000 000" / "1.800 000")
  const fm = norm.match(FORMATTED_REGEX);
  if (fm && !isPhoneContext(norm, fm.index, fm[0].length)) {
    const digits = fm[0].replace(/[.\s\u00A0]/g, '');
    amount = parseInt(digits, 10);
    rawMatch = fm[0];
    reason = 'formatted';
    confidence = 0.9;
  }

  // 2. millions / M word
  if (amount === null) {
    const m = norm.match(MILLION_REGEX);
    if (m) {
      amount = Math.round(parseFloat(m[1].replace(',', '.')) * 1_000_000);
      rawMatch = m[0];
      reason = 'million_word';
      confidence = 0.9;
    }
  }

  // 3. mil / mille / milles (×1000)
  if (amount === null) {
    const m = norm.match(MIL_REGEX);
    if (m) {
      amount = Math.round(parseFloat(m[1].replace(',', '.')) * 1_000);
      rawMatch = m[0];
      reason = 'mil_thousand';
      confidence = 0.9;
    }
  }

  // 4. CFA suffix ("130000f", "275000 FCFA")
  if (amount === null) {
    const m = norm.match(CFA_SUFFIX_REGEX);
    if (m) {
      amount = parseInt(m[1], 10);
      rawMatch = m[0];
      reason = 'cfa_suffix';
      confidence = 0.85;
    }
  }

  // 5. Bare numeric (5-9 digits, conservative)
  if (amount === null) {
    const m = norm.match(BARE_REGEX);
    if (m && !isPhoneContext(norm, m.index, m[0].length)) {
      amount = parseInt(m[1], 10);
      rawMatch = m[0];
      reason = 'bare';
      confidence = 0.55;
    }
  }

  if (amount == null) return { ...EMPTY, conditions_months: conditionsMonths };

  // ─── price_kind inference ────────────────────────────────────────────
  let kind;
  if (PER_M2_REGEX.test(norm)) {
    kind = 'per_m2';
  } else if (MONTHLY_REGEX.test(norm)) {
    kind = 'monthly_rent';
  } else if (SALE_REGEX.test(norm)) {
    kind = 'total_sale';
  } else if (amount < 2_000_000) {
    kind = 'monthly_rent';
  } else if (amount >= 5_000_000) {
    kind = 'total_sale';
  } else {
    kind = 'unknown';
  }

  return {
    raw_price_match: rawMatch,
    price_amount: amount,
    currency: 'XOF',
    price_kind: kind,
    conditions_months: conditionsMonths,
    price_confidence: confidence,
    price_reason: reason,
  };
}

module.exports = { parsePrice };
