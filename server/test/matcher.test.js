// ─── Tests for matcher.js (spec §12, weights 35/20/20/20/5) ────────────────

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreMatch } = require('../services/matcher');

function L(overrides = {}) {
  return {
    id: 1, type: 'offer', category: 'apartment', transaction_type: 'rent',
    price_amount: 200_000, price_kind: 'monthly_rent',
    city: 'Dakar', neighborhood: 'Mermoz', zone: 'Centre Dakar',
    bedrooms: 2, area: null, preferred_locations: null,
    ...overrides,
  };
}

test('perfect match: same category+tx+neighborhood+price+bedrooms → 100', () => {
  const offer  = L({ type: 'offer' });
  const demand = L({ type: 'demand' });
  const r = scoreMatch(offer, demand);
  assert.equal(r.score, 100);
  assert.equal(r.breakdown.category, 35);
  assert.equal(r.breakdown.transaction, 20);
  assert.equal(r.breakdown.location, 20);
  assert.equal(r.breakdown.price, 20);
  assert.equal(r.breakdown.bedrooms, 5);
});

test('different category → category=0 (score drops by 35)', () => {
  const offer  = L({ type: 'offer', category: 'apartment' });
  const demand = L({ type: 'demand', category: 'house' });
  const r = scoreMatch(offer, demand);
  assert.equal(r.breakdown.category, 0);
  assert.equal(r.score, 65);
});

test('different transaction → transaction=0', () => {
  const offer  = L({ type: 'offer', transaction_type: 'sale' });
  const demand = L({ type: 'demand', transaction_type: 'rent' });
  const r = scoreMatch(offer, demand);
  assert.equal(r.breakdown.transaction, 0);
});

test('same zone but different neighborhood → partial location credit', () => {
  const offer  = L({ neighborhood: 'Mermoz', zone: 'Centre Dakar' });
  const demand = L({ neighborhood: 'Plateau', zone: 'Centre Dakar' });
  const r = scoreMatch(offer, demand);
  assert.ok(r.breakdown.location > 0 && r.breakdown.location < 20);
});

test('different city → location=0', () => {
  const offer  = L({ city: 'Dakar', neighborhood: 'Mermoz', zone: 'Centre Dakar' });
  const demand = L({ city: 'Thiès', neighborhood: null, zone: 'Thiès Centre' });
  const r = scoreMatch(offer, demand);
  assert.equal(r.breakdown.location, 0);
});

test('price proximity: within 10% → full 20 points', () => {
  const offer  = L({ price_amount: 200_000 });
  const demand = L({ price_amount: 210_000 });
  const r = scoreMatch(offer, demand);
  assert.equal(r.breakdown.price, 20);
});

test('price proximity: 25% diff → partial', () => {
  const offer  = L({ price_amount: 200_000 });
  const demand = L({ price_amount: 250_000 });
  const r = scoreMatch(offer, demand);
  assert.ok(r.breakdown.price > 0 && r.breakdown.price < 20);
});

test('price proximity: 60% diff → 0 (too far)', () => {
  const offer  = L({ price_amount: 200_000 });
  const demand = L({ price_amount: 500_000 });
  const r = scoreMatch(offer, demand);
  assert.equal(r.breakdown.price, 0);
});

test('bedrooms exact → 5; one off → partial; null → 0', () => {
  assert.equal(scoreMatch(L({ bedrooms: 2 }), L({ bedrooms: 2 })).breakdown.bedrooms, 5);
  const partial = scoreMatch(L({ bedrooms: 2 }), L({ bedrooms: 3 })).breakdown.bedrooms;
  assert.ok(partial > 0 && partial < 5);
  assert.equal(scoreMatch(L({ bedrooms: null }), L({ bedrooms: 2 })).breakdown.bedrooms, 0);
});

test('demand with preferred_locations — offer in any preferred neighborhood matches', () => {
  const offer  = L({ type: 'offer', neighborhood: 'Ouakam', zone: 'Ouest Dakar' });
  const demand = L({
    type: 'demand',
    neighborhood: null,
    zone: null,
    preferred_locations: [
      { neighborhood: 'Plateau', zone: 'Centre Dakar' },
      { neighborhood: 'Ouakam',  zone: 'Ouest Dakar' },
    ],
  });
  const r = scoreMatch(offer, demand);
  assert.equal(r.breakdown.location, 20);
});

test('reasons[] lists every contributing axis', () => {
  const offer  = L({ type: 'offer' });
  const demand = L({ type: 'demand' });
  const r = scoreMatch(offer, demand);
  assert.ok(r.reasons.length >= 4);
  assert.ok(r.reasons.some(s => /category/i.test(s)));
  assert.ok(r.reasons.some(s => /location|neighborhood|zone/i.test(s)));
});
