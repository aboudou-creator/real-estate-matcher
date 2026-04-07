// ─── PostgreSQL-based offer/demand matching ──────────────────────────────────
// When a new real_product is created, find matching products of the opposite type.

const { pool } = require('../db/postgres');

/**
 * Calculate a match score between two real products.
 */
function calculateMatchScore(rp1, rp2) {
  let score = 0;
  let factors = 0;

  // Same category is a prerequisite (already filtered in query)
  score += 0.15;
  factors += 0.15;

  // Same transaction type
  if (rp1.transaction_type === rp2.transaction_type) {
    score += 0.10;
  }
  factors += 0.10;

  // Price matching (within 25% range)
  if (rp1.price && rp2.price) {
    const p1 = parseFloat(rp1.price);
    const p2 = parseFloat(rp2.price);
    const priceDiff = Math.abs(p1 - p2) / Math.max(p1, p2);
    if (priceDiff <= 0.25) {
      score += (1 - priceDiff) * 0.30;
    }
    factors += 0.30;
  }

  // Location matching — supports multi-location OR for demands
  // A demand may have preferred_locations: [{city, neighborhood, zone}, ...]
  // An offer matches if it fits ANY of the demand's preferred locations
  const demandRP = rp1.type === 'demand' ? rp1 : rp2.type === 'demand' ? rp2 : null;
  const offerRP = rp1.type === 'offer' ? rp1 : rp2.type === 'offer' ? rp2 : null;

  let prefLocs = null;
  if (demandRP && demandRP.preferred_locations) {
    try {
      prefLocs = typeof demandRP.preferred_locations === 'string'
        ? JSON.parse(demandRP.preferred_locations)
        : demandRP.preferred_locations;
    } catch (_) {}
  }

  if (prefLocs && prefLocs.length > 0 && offerRP) {
    // OR-matching: best location score among all preferred locations
    let bestLocScore = 0;
    for (const loc of prefLocs) {
      let locScore = 0;
      if (loc.city && offerRP.city && loc.city.toLowerCase() === offerRP.city.toLowerCase()) {
        locScore = 0.15;
        if (loc.neighborhood && offerRP.neighborhood &&
            loc.neighborhood.toLowerCase() === offerRP.neighborhood.toLowerCase()) {
          locScore = 0.20;
        }
      }
      if (locScore > bestLocScore) bestLocScore = locScore;
    }
    score += bestLocScore;
    factors += 0.20;
  } else if (rp1.city && rp2.city) {
    if (rp1.city === rp2.city) {
      score += 0.15;
      // Bonus for same neighborhood
      if (rp1.neighborhood && rp2.neighborhood && rp1.neighborhood === rp2.neighborhood) {
        score += 0.05;
      }
    }
    factors += 0.20;
  }

  // Bedrooms matching
  if (rp1.bedrooms != null && rp2.bedrooms != null) {
    const diff = Math.abs(rp1.bedrooms - rp2.bedrooms);
    if (diff === 0) score += 0.15;
    else if (diff === 1) score += 0.08;
    factors += 0.15;
  }

  // Area matching (within 20%)
  if (rp1.area && rp2.area) {
    const a1 = parseFloat(rp1.area);
    const a2 = parseFloat(rp2.area);
    const areaDiff = Math.abs(a1 - a2) / Math.max(a1, a2);
    if (areaDiff <= 0.20) {
      score += (1 - areaDiff) * 0.10;
    }
    factors += 0.10;
  }

  return factors > 0 ? parseFloat((score / factors).toFixed(3)) : 0;
}

/**
 * Find and insert matches for a newly created real_product.
 * Only matches with opposite type (offer ↔ demand).
 * Returns array of new match rows.
 */
async function findMatchesForProduct(realProductId) {
  const rpResult = await pool.query('SELECT * FROM real_products WHERE id = $1', [realProductId]);
  if (rpResult.rows.length === 0) return [];

  const rp = rpResult.rows[0];
  const oppositeType = rp.type === 'offer' ? 'demand' : 'offer';

  // Find candidates: opposite type, same category, same transaction type
  const candidates = await pool.query(
    `SELECT * FROM real_products
     WHERE type = $1 AND category = $2 AND transaction_type = $3 AND id != $4`,
    [oppositeType, rp.category, rp.transaction_type, realProductId]
  );

  const newMatches = [];
  for (const candidate of candidates.rows) {
    const score = calculateMatchScore(rp, candidate);

    if (score >= 0.70) {
      // Check if match already exists
      const existing = await pool.query(
        `SELECT id FROM matches
         WHERE (product1_id = $1 AND product2_id = $2) OR (product1_id = $2 AND product2_id = $1)`,
        [realProductId, candidate.id]
      );

      if (existing.rows.length === 0) {
        const matchType = score >= 0.75 ? 'excellent' : score >= 0.5 ? 'good' : 'partial';
        const result = await pool.query(
          `INSERT INTO matches (product1_id, product2_id, score, match_type)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [realProductId, candidate.id, score, matchType]
        );
        newMatches.push(result.rows[0]);
      }
    }
  }

  return newMatches;
}

module.exports = { findMatchesForProduct, calculateMatchScore };
