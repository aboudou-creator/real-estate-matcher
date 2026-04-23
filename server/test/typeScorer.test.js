// ─── Tests for typeScorer.js (spec §6, §7, §8, §17) ────────────────────────
// Critical: "profil recherché" must NOT flip a listing to demand.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreType } = require('../services/typeScorer');

// ─── §17 Valid offers ──────────────────────────────────────────────────────

test('offer: Studio à louer à Ouakam Prix 155mil/3', () => {
  const r = scoreType('Studio à louer à ouakam. Prix 155mil /3. Contact +221 77 123 45 67');
  assert.equal(r.type_final, 'offer');
  assert.ok(r.offer_score >= r.demand_score + 2);
});

test('offer: mini studio disponible à HLM grand yoof 130000f', () => {
  const r = scoreType('Un mini studio disponible à HLM grand yoof côté Yacine à 130000f séparé');
  assert.equal(r.type_final, 'offer');
});

test('offer: OUEST FOIRE appartement 2 chambres loyer 225.000fcfa/mois', () => {
  const r = scoreType('OUEST FOIRE Un appartement 2 chambres salon disponible, loyer 225.000fcfa/mois');
  assert.equal(r.type_final, 'offer');
});

test('offer WITH false-positive: MINI STUDIOS DISPONIBLES Profil recherché Contact WhatsApp', () => {
  const text = 'MINI STUDIOS DISPONIBLES à Ouakam. Prix 130.000 / 160.000 / 120.000. Conditions x3. Profil recherché: fille sérieuse. Contact WhatsApp +221 77 123 45 67';
  const r = scoreType(text);
  assert.equal(r.type_final, 'offer', `expected offer, got ${r.type_final}. reason=${r.type_reason_summary}`);
  assert.ok(r.demand_false_positive_hits.length > 0, 'should record the FP');
  assert.ok(
    r.conflict_flags.includes('demand_fp_in_offer_context') ||
    r.conflict_flags.length > 0,
    'should log a conflict flag when FP appears inside offer structure'
  );
});

// ─── §17 Valid demands ─────────────────────────────────────────────────────

test('demand: A la recherche d\'une villa r+1 ou r+2 vers la Sicap', () => {
  const r = scoreType("A la recherche d'une villa r+1 ou r+2 vers la Sicap");
  assert.equal(r.type_final, 'demand');
});

test('demand: je cherche un studio à Ouakam', () => {
  const r = scoreType('je cherche un studio à Ouakam');
  assert.equal(r.type_final, 'demand');
});

test('demand: cliente prête à finaliser', () => {
  const r = scoreType('Ma cliente prête à finaliser pour un appartement F3. Mon budget 2 millions.');
  assert.equal(r.type_final, 'demand');
});

test('demand: besoin d\'un appartement', () => {
  const r = scoreType("J'ai besoin d'un appartement 3 chambres à Mermoz");
  assert.equal(r.type_final, 'demand');
});

// ─── §17 False-demand triggers that must NOT become demand ─────────────────

test('FP: "profil recherché" alone inside offer → stays offer', () => {
  const r = scoreType('Studio à louer à Plateau. Profil recherché: fille sérieuse. Prix 150000');
  assert.notEqual(r.type_final, 'demand');
});

test('FP: "locataire recherché" inside listing → stays offer', () => {
  const r = scoreType('Appartement disponible à Mermoz. Loyer 300000. Locataire recherché: solvable.');
  assert.notEqual(r.type_final, 'demand');
});

test('FP: "client solvable" is offer-supporting, not demand', () => {
  const r = scoreType('Studio dispo 130000f. Client solvable bienvenu.');
  assert.notEqual(r.type_final, 'demand');
});

test('FP: "prend étrangers" is offer, not demand', () => {
  const r = scoreType('Chambre à louer à Ouakam. Prend étrangers. 80mil.');
  assert.equal(r.type_final, 'offer');
});

test('FP: "préférence fille" does not flip offer to demand', () => {
  const r = scoreType('Studio à louer à Médina. Préférence fille. 120000 FCFA/mois');
  assert.notEqual(r.type_final, 'demand');
});

// ─── Ambiguous / edge cases ─────────────────────────────────────────────────

test('empty text → ambiguous', () => {
  const r = scoreType('');
  assert.equal(r.type_final, 'ambiguous');
});

test('exposes all debug fields', () => {
  const r = scoreType('Studio à louer. Prix 150000');
  assert.ok('offer_score' in r);
  assert.ok('demand_score' in r);
  assert.ok('offer_signal_hits' in r);
  assert.ok('demand_signal_hits' in r);
  assert.ok('demand_false_positive_hits' in r);
  assert.ok('listing_signal_hits' in r);
  assert.ok('conflict_flags' in r);
  assert.ok('type_reason_summary' in r);
});
