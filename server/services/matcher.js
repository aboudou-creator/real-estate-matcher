// ─── Offer ↔ Demand matcher (spec §12) ─────────────────────────────────────
// Weighted scoring:  category 35  +  transaction 20  +  location 20  +
//                    price 20  +  bedrooms 5   = 100
//
// Only runs on real-estate listings with type_final ∈ {offer, demand}.

const { pool } = require('../db/postgres');

const WEIGHTS = {
  category: 35,
  transaction: 20,
  location: 20,
  price: 20,
  bedrooms: 5,
};

// ─── Axis scorers ──────────────────────────────────────────────────────────

function scoreCategory(a, b) {
  if (!a.category || !b.category) return 0;
  if (a.category === b.category) return WEIGHTS.category;
  // Soft cross-match for semantically close categories
  const pairs = [
    ['room', 'colocation'],
    ['office', 'shop'],
  ];
  for (const [x, y] of pairs) {
    if ((a.category === x && b.category === y) || (a.category === y && b.category === x)) {
      return Math.round(WEIGHTS.category * 0.4);
    }
  }
  return 0;
}

function scoreTransaction(a, b) {
  if (!a.transaction_type || !b.transaction_type) return 0;
  return a.transaction_type === b.transaction_type ? WEIGHTS.transaction : 0;
}

function locationCandidates(listing) {
  const out = [];
  if (listing.neighborhood || listing.city || listing.zone) {
    out.push({
      neighborhood: listing.neighborhood || null,
      city: listing.city || null,
      zone: listing.zone || null,
    });
  }
  if (Array.isArray(listing.preferred_locations)) {
    for (const pl of listing.preferred_locations) {
      if (pl && (pl.neighborhood || pl.city || pl.zone)) out.push(pl);
    }
  }
  return out;
}

function scoreLocationPair(a, b) {
  if (a.neighborhood && b.neighborhood &&
      a.neighborhood.toLowerCase() === b.neighborhood.toLowerCase()) return WEIGHTS.location;
  if (a.zone && b.zone && a.zone === b.zone) return Math.round(WEIGHTS.location * 0.6);
  if (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) return Math.round(WEIGHTS.location * 0.3);
  return 0;
}

function scoreLocation(a, b) {
  const A = locationCandidates(a);
  const B = locationCandidates(b);
  if (A.length === 0 || B.length === 0) return 0;
  let best = 0;
  for (const ac of A) for (const bc of B) {
    best = Math.max(best, scoreLocationPair(ac, bc));
    if (best === WEIGHTS.location) return best;
  }
  return best;
}

function scorePrice(a, b) {
  const pa = a.price_amount;
  const pb = b.price_amount;
  if (pa == null || pb == null || pa === 0 || pb === 0) return 0;
  const diff = Math.abs(pa - pb) / Math.max(pa, pb);
  if (diff <= 0.10) return WEIGHTS.price;
  if (diff <= 0.20) return Math.round(WEIGHTS.price * 0.75);
  if (diff <= 0.30) return Math.round(WEIGHTS.price * 0.5);
  if (diff <= 0.50) return Math.round(WEIGHTS.price * 0.25);
  return 0;
}

function scoreBedrooms(a, b) {
  if (a.bedrooms == null || b.bedrooms == null) return 0;
  if (a.bedrooms === b.bedrooms) return WEIGHTS.bedrooms;
  if (Math.abs(a.bedrooms - b.bedrooms) === 1) return Math.round(WEIGHTS.bedrooms * 0.5);
  return 0;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Score a potential match between two listings (offer and demand).
 * Returns score 0-100 plus a per-axis breakdown and human-readable reasons.
 */
function scoreMatch(a, b) {
  const breakdown = {
    category:    scoreCategory(a, b),
    transaction: scoreTransaction(a, b),
    location:    scoreLocation(a, b),
    price:       scorePrice(a, b),
    bedrooms:    scoreBedrooms(a, b),
  };
  const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  const reasons = [];
  if (breakdown.category === WEIGHTS.category) reasons.push('same category');
  else if (breakdown.category > 0)             reasons.push('related category');

  if (breakdown.transaction === WEIGHTS.transaction) reasons.push('same transaction');

  if (breakdown.location === WEIGHTS.location)       reasons.push('same neighborhood');
  else if (breakdown.location >= WEIGHTS.location * 0.6) reasons.push('same zone');
  else if (breakdown.location > 0)                   reasons.push('same city');

  if (breakdown.price === WEIGHTS.price)             reasons.push('price within 10%');
  else if (breakdown.price >= WEIGHTS.price * 0.75)  reasons.push('price within 20%');
  else if (breakdown.price > 0)                      reasons.push('price within 50%');

  if (breakdown.bedrooms === WEIGHTS.bedrooms)       reasons.push('same bedrooms');
  else if (breakdown.bedrooms > 0)                   reasons.push('±1 bedroom');

  return { score, breakdown, reasons };
}

/**
 * Find all possible matches for a newly-created listing and persist the ones
 * that clear the threshold into `match_links`.
 */
async function findMatchesForListing(listingId, minScore = 50) {
  const { rows } = await pool.query('SELECT * FROM listings WHERE id = $1', [listingId]);
  if (rows.length === 0) return [];
  const listing = rows[0];

  // Only real-estate offers/demands participate in matching
  if (!listing.type || !['offer', 'demand'].includes(listing.type)) return [];

  const counterpart = listing.type === 'offer' ? 'demand' : 'offer';
  const candidates = await pool.query(
    `SELECT * FROM listings WHERE type = $1 AND transaction_type = $2`,
    [counterpart, listing.transaction_type]
  );

  const matches = [];
  for (const cand of candidates.rows) {
    const a = listing.type === 'offer' ? listing : cand;
    const b = listing.type === 'offer' ? cand    : listing;
    const { score, breakdown, reasons } = scoreMatch(a, b);
    if (score < minScore) continue;
    try {
      const ins = await pool.query(
        `INSERT INTO match_links (offer_listing_id, demand_listing_id, score, breakdown, reasons)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (offer_listing_id, demand_listing_id) DO UPDATE
           SET score = EXCLUDED.score,
               breakdown = EXCLUDED.breakdown,
               reasons = EXCLUDED.reasons
         RETURNING *`,
        [a.id, b.id, score, JSON.stringify(breakdown), JSON.stringify(reasons)]
      );
      matches.push(ins.rows[0]);
    } catch (_) { /* skip dup collisions */ }
  }
  return matches;
}

module.exports = { scoreMatch, findMatchesForListing, WEIGHTS };
