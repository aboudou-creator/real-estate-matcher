// Unit tests for categoryParser (spec §10)

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCategory, inferTransactionType } = require('../services/categoryParser');

// ─── Straightforward cases ────────────────────────────────────────────────

test('apartment: "Appartement à Ouakam"', () => {
  assert.equal(parseCategory('Appartement à Ouakam').category, 'apartment');
});

test('apartment: "Studio meublé à Point E"', () => {
  assert.equal(parseCategory('Studio meublé à Point E').category, 'apartment');
});

test('apartment: "F3 à louer"', () => {
  assert.equal(parseCategory('F3 à louer à Mermoz').category, 'apartment');
});

test('apartment: "3 pièces à Sacré Cœur"', () => {
  assert.equal(parseCategory('3 pièces à Sacré Cœur').category, 'apartment');
});

test('house: "Maison à vendre à Yoff"', () => {
  assert.equal(parseCategory('Maison à vendre à Yoff').category, 'house');
});

test('house: "Villa R+1 à Almadies"', () => {
  assert.equal(parseCategory('Villa R+1 à Almadies').category, 'house');
});

test('house: "Duplex meublé à Ngor"', () => {
  assert.equal(parseCategory('Duplex meublé à Ngor').category, 'house');
});

test('room: "Chambre à louer chez particulier"', () => {
  assert.equal(parseCategory('Chambre à louer chez particulier').category, 'room');
});

test('ground: "Terrain 300 m² à Diamniadio"', () => {
  assert.equal(parseCategory('Terrain 300 m² à Diamniadio').category, 'ground');
});

test('agricultural_ground: "Terrain agricole à Thiès"', () => {
  assert.equal(parseCategory('Terrain agricole à Thiès').category, 'agricultural_ground');
});

test('colocation: "Cherche colocataire à Mermoz"', () => {
  assert.equal(parseCategory('Cherche colocataire à Mermoz').category, 'colocation');
});

test('shop: "Magasin à louer au Plateau"', () => {
  assert.equal(parseCategory('Magasin à louer au Plateau').category, 'shop');
});

test('office: "Plateaux de bureau à Mermoz"', () => {
  assert.equal(parseCategory('Plateaux de bureau à Mermoz').category, 'office');
});

// ─── Position-based disambiguation ────────────────────────────────────────

test('house wins over shop when "maison" precedes "magasins"', () => {
  const txt =
    'Un client cherche une maison à sicap keur massar budget 25 millions ' +
    'bien placé avec magasins au rdc';
  assert.equal(parseCategory(txt).category, 'house');
});

test('shop wins over house when "magasin" precedes "maison"', () => {
  const txt = 'A louer magasin bien placé, à côté d une maison familiale';
  assert.equal(parseCategory(txt).category, 'shop');
});

test('apartment wins when "appartement" mentioned with "chambres" count later', () => {
  assert.equal(
    parseCategory('Appartement F4 avec 3 chambres à Mermoz').category,
    'apartment'
  );
});

test('house wins over apartment-bedroom-count when "maison" mentioned first', () => {
  assert.equal(
    parseCategory('Maison 5 chambres à Almadies').category,
    'house'
  );
});

test('colocation wins over apartment when mentioned first', () => {
  assert.equal(
    parseCategory('Colocation dans appartement meublé à Mermoz').category,
    'colocation'
  );
});

test('"chambre salon" resolves to apartment (priority tiebreaker at pos 0)', () => {
  // room's /\bchambres?\b/ and apartment's /\bchambres?\s+salon\b/ both match at 0
  // apartment has higher priority (index 5) than room (index 6)
  assert.equal(parseCategory('Chambre salon à Ouakam').category, 'apartment');
});

test('"3 chambres" at start resolves to apartment via count pattern', () => {
  assert.equal(parseCategory('3 chambres salon à Mermoz').category, 'apartment');
});

test('bare "chambres" resolves to room', () => {
  assert.equal(parseCategory('Belles chambres indépendantes').category, 'room');
});

// ─── Negative / edge cases ────────────────────────────────────────────────

test('empty text → null category', () => {
  assert.equal(parseCategory('').category, null);
  assert.equal(parseCategory(null).category, null);
});

test('non-real-estate text → null category', () => {
  assert.equal(parseCategory('Bonjour, comment ça va?').category, null);
});

test('"parcelle" alone is NOT classified as ground (ambiguous with neighborhood)', () => {
  const r = parseCategory('Bien situé à Parcelles Assainies');
  assert.equal(r.category, null);
});

// ─── inferTransactionType ─────────────────────────────────────────────────

test('transaction: "à vendre" → sale', () => {
  assert.equal(inferTransactionType('Maison à vendre à Yoff'), 'sale');
});

test('transaction: "à louer" → rent', () => {
  assert.equal(inferTransactionType('Studio à louer à Mermoz'), 'rent');
});

test('transaction: "loyer 150 000 / mois" → rent', () => {
  assert.equal(inferTransactionType('Appartement, loyer 150 000 / mois'), 'rent');
});

test('transaction: "vente" → sale', () => {
  assert.equal(inferTransactionType('Vente terrain 300 m²'), 'sale');
});

test('transaction: no signal → null', () => {
  assert.equal(inferTransactionType('Belle maison avec jardin'), null);
});
