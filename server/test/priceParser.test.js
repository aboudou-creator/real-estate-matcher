// ─── Tests for priceParser.js (spec §9) ─────────────────────────────────────
// Critical rule: "mil" / "mille" / "milles" = ×1000 (NOT millions) in SN context.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrice } = require('../services/priceParser');

function amount(text) { return parsePrice(text).price_amount; }
function kind(text)   { return parsePrice(text).price_kind; }
function cond(text)   { return parsePrice(text).conditions_months; }

// ─── Formatted prices with separators (§9A) ─────────────────────────────────
test('6.500.000FCFA → 6 500 000', () => {
  assert.equal(amount('6.500.000FCFA'), 6_500_000);
});

test('220 000 000 FCFA → 220 000 000', () => {
  assert.equal(amount('220 000 000 FCFA'), 220_000_000);
});

test('500.000 FCFA / mois → 500 000 monthly_rent', () => {
  const r = parsePrice('500.000 FCFA / mois');
  assert.equal(r.price_amount, 500_000);
  assert.equal(r.price_kind, 'monthly_rent');
});

// ─── Million / millions (§9A + §9B distinction) ─────────────────────────────
test('1million → 1 000 000', () => {
  assert.equal(amount('Villa à vendre 1million'), 1_000_000);
});

test('60 millions → 60 000 000', () => {
  assert.equal(amount('Terrain 60 millions CFA'), 60_000_000);
});

// ─── mil / mille / milles = ×1000 (CRITICAL §9B) ────────────────────────────
test('80mil → 80 000 (NOT 80 million)', () => {
  assert.equal(amount('Studio 80mil'), 80_000);
});

test('125 milles → 125 000 (NOT 125 million)', () => {
  assert.equal(amount('Chambre à 125 milles'), 125_000);
});

test('250milles → 250 000', () => {
  assert.equal(amount('Studio disponible à 250milles'), 250_000);
});

test('155mil /3 → 155 000 with conditions=3', () => {
  const r = parsePrice('Studio à louer à ouakam Prix 155mil /3');
  assert.equal(r.price_amount, 155_000);
  assert.equal(r.conditions_months, 3);
});

test('175milles ×4 → 175 000 with conditions=4', () => {
  const r = parsePrice('175milles ×4');
  assert.equal(r.price_amount, 175_000);
  assert.equal(r.conditions_months, 4);
});

// ─── Bare numeric + CFA suffix (§9A) ───────────────────────────────────────
test('130000f → 130 000', () => {
  assert.equal(amount('mini studio à 130000f séparé'), 130_000);
});

test('275000 → 275 000 (bare)', () => {
  assert.equal(amount('Chambre dispo 275000'), 275_000);
});

// ─── per m² detection (§9A) ────────────────────────────────────────────────
test('12 000 FCFA/m² → per_m2', () => {
  const r = parsePrice('Terrain 12 000 FCFA/m²');
  assert.equal(r.price_amount, 12_000);
  assert.equal(r.price_kind, 'per_m2');
});

test('1.800 000 fr CFA le m2 → per_m2', () => {
  const r = parsePrice('Vente 1.800 000 fr CFA le m2');
  assert.equal(r.price_amount, 1_800_000);
  assert.equal(r.price_kind, 'per_m2');
});

test('1.500.000f par M2 → per_m2', () => {
  const r = parsePrice('Lot 500m2 à 1.500.000f par M2');
  assert.equal(r.price_amount, 1_500_000);
  assert.equal(r.price_kind, 'per_m2');
});

// ─── Conditions x3 / x 4 mois (§9E) ────────────────────────────────────────
test('500.000 x3 → conditions_months=3', () => {
  assert.equal(cond('loyer 500.000 x3'), 3);
});

test('130000 x 4 mois → conditions_months=4', () => {
  assert.equal(cond('studio 130000 x 4 mois'), 4);
});

test('conditions do NOT multiply price (155mil/3 ≠ 465 000)', () => {
  const r = parsePrice('155mil /3');
  assert.equal(r.price_amount, 155_000); // must NOT be 465000
  assert.equal(r.conditions_months, 3);
});

// ─── Real-world offer snippet ───────────────────────────────────────────────
test('OUEST FOIRE appartement 225.000fcfa/mois → 225 000 monthly_rent', () => {
  const r = parsePrice('OUEST FOIRE Un appartement 2 chambres salon loyer 225.000fcfa/mois');
  assert.equal(r.price_amount, 225_000);
  assert.equal(r.price_kind, 'monthly_rent');
});

// ─── No price present ───────────────────────────────────────────────────────
test('text without numbers → null', () => {
  const r = parsePrice('Studio à louer');
  assert.equal(r.price_amount, null);
});

test('phone number alone must NOT be parsed as price', () => {
  const r = parsePrice('Contact +221 77 123 45 67');
  assert.ok(r.price_amount == null || r.price_confidence < 0.5);
});

test('bare 9-digit Senegal mobile (77xxxxxxx) must NOT be parsed as price', () => {
  assert.equal(amount('Appel 779230282 pour chambre'), null);
});

test('bare 9-digit Senegal mobile (78xxxxxxx) must NOT be parsed as price', () => {
  assert.equal(amount('Chambre à louer. Contact: 781234567'), null);
});

test('formatted 9-digit phone "789 230 282" must NOT be parsed as price', () => {
  assert.equal(amount('Chambre cherche. Prix 789 230 282'), null);
});

test('"TEL: 789230282" — phone context keyword blocks bare match', () => {
  assert.equal(amount('Cherche 1 chambre + toilettes    TEL: 789230282'), null);
});

test('price wins over trailing phone: "85.000.000 CFA contact 771234567" → 85M', () => {
  assert.equal(amount('Villa 85.000.000 CFA contact 771234567'), 85_000_000);
});

test('real price "45 000 000" (landline-like prefix 45) still parses as price', () => {
  // 45 is not a Senegal phone prefix, so this is safely a price.
  assert.equal(amount('Maison 3 chambres à vendre à 45 000 000'), 45_000_000);
});

test('explicit millions override accidental phone-looking prefix', () => {
  // "789 millions" hits MILLION_REGEX before FORMATTED — safe.
  assert.equal(amount('Villa de prestige 789 millions'), 789_000_000);
});
