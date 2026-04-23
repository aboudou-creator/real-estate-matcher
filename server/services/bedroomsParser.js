// ─── Bedrooms + area + phone extraction ─────────────────────────────────────

function parseBedrooms(text) {
  if (!text) return null;

  // F2 / T3 — total rooms, subtract one for living room
  let m = text.match(/\b[FT](\d)\b/i);
  if (m) {
    const total = parseInt(m[1], 10);
    return total > 1 ? total - 1 : 1;
  }

  // "2 chambres" / "02 chambre" / "deux chambres"
  m = text.match(/(\d+)\s*(?:chambres?|ch\b)/i);
  if (m) return parseInt(m[1], 10);

  const words = { une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
  for (const [w, v] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\s+chambres?\\b`, 'i').test(text)) return v;
  }

  // "3 pièces" means 2 bedrooms (living room counted)
  m = text.match(/(\d+)\s*(?:pi[èe]ces?)/i);
  if (m) {
    const total = parseInt(m[1], 10);
    return total > 1 ? total - 1 : 1;
  }
  return null;
}

function parseArea(text) {
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m\s*[²2]|m[eè]tres?\s*carr[ée]s?)/i);
  if (m) return parseFloat(m[1].replace(',', '.'));
  return null;
}

function parsePhone(text) {
  if (!text) return null;
  const m = text.match(/(\+?221[\s.-]?)?(7[0-9][\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/);
  if (!m) return null;
  const raw = m[0].replace(/[\s.-]/g, '');
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('221')) return '+' + raw;
  return '+221' + raw;
}

module.exports = { parseBedrooms, parseArea, parsePhone };
