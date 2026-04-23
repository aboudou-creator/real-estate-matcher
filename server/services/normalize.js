// ─── Text normalization utilities ───────────────────────────────────────────
// All helpers here are deterministic and side-effect-free. They are used for
// (a) exact raw-text dedup and (b) looser normalization for matching / regex.

const crypto = require('crypto');

/**
 * Normalize raw WhatsApp text for exact-dedup hashing.
 * Rules (per spec §3):
 *   - unicode NFC
 *   - CRLF / CR → LF
 *   - trim leading/trailing whitespace
 *   - collapse runs of spaces/tabs (NOT newlines — we keep line structure)
 *   - otherwise keep the text intact (accents, punctuation, case)
 */
function normalizeRawText(input) {
  if (input == null) return '';
  let s = String(input).normalize('NFC');
  s = s.replace(/\r\n?/g, '\n');
  // Collapse horizontal whitespace runs
  s = s.replace(/[ \t\u00A0\u2000-\u200B]+/g, ' ');
  // Strip trailing spaces on each line
  s = s.split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n');
  // Collapse triple+ newlines to double
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * Compute the exact-dedup hash for a raw text.
 * Two raw messages with identical `normalizeRawText` output share a hash.
 */
function exactDedupHash(input) {
  const normalized = normalizeRawText(input);
  return crypto.createHash('sha1').update(normalized, 'utf8').digest('hex');
}

/**
 * Looser normalization used by the classifiers / parsers. Lowercases, strips
 * diacritics, collapses whitespace — everything needed to write regexes that
 * survive accent / case variants.
 */
function normalizeForMatching(input) {
  if (input == null) return '';
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  normalizeRawText,
  exactDedupHash,
  normalizeForMatching,
};
