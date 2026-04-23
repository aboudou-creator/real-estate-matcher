// ─── Listing routes (structured real-estate posts) ─────────────────────────
// A listing is the structured output extracted from a single real-estate
// cluster. One row per cluster (UNIQUE FK).

const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

// GET /api/listings — filterable list
router.get('/', async (req, res) => {
  try {
    const {
      type, category, transaction_type, city, neighborhood,
      min_price, max_price, bedrooms, has_match,
      limit = 500, offset = 0,
    } = req.query;

    const clauses = [];
    const params = [];
    let i = 1;

    if (type) { clauses.push(`l.type = $${i++}`); params.push(type); }
    if (category) { clauses.push(`l.category = $${i++}`); params.push(category); }
    if (transaction_type) { clauses.push(`l.transaction_type = $${i++}`); params.push(transaction_type); }
    if (city) { clauses.push(`l.city ILIKE $${i++}`); params.push(`%${city}%`); }
    if (neighborhood) { clauses.push(`l.neighborhood ILIKE $${i++}`); params.push(`%${neighborhood}%`); }
    if (min_price) { clauses.push(`l.price_amount >= $${i++}`); params.push(parseFloat(min_price)); }
    if (max_price) { clauses.push(`l.price_amount <= $${i++}`); params.push(parseFloat(max_price)); }
    if (bedrooms) { clauses.push(`l.bedrooms = $${i++}`); params.push(parseInt(bedrooms)); }
    if (has_match === 'true') {
      clauses.push(`EXISTS (SELECT 1 FROM match_links m WHERE m.offer_listing_id = l.id OR m.demand_listing_id = l.id)`);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
      SELECT
        l.*,
        c.duplicate_count_exact_raw,
        c.distinct_sender_count_exact_raw,
        c.first_sender,
        c.first_sender_phone,
        c.first_posted_at,
        c.all_senders_in_order,
        c.all_group_ids,
        c.offer_score,
        c.demand_score,
        c.type_confidence,
        c.conflict_flags,
        c.type_reason_summary,
        c.representative_text,
        (SELECT COUNT(*) FROM match_links m
           WHERE (l.type = 'offer' AND m.offer_listing_id = l.id)
              OR (l.type = 'demand' AND m.demand_listing_id = l.id)
        ) AS match_count
      FROM listings l
      JOIN raw_clusters c ON c.id = l.cluster_id
      ${whereSql}
      ORDER BY c.first_posted_at DESC NULLS LAST, l.id DESC
      LIMIT $${i++} OFFSET $${i}
    `;
    params.push(parseInt(limit), parseInt(offset));
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/listings/:id — full listing with cluster + matches
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ls = await pool.query(
      `SELECT l.*, c.*, l.id AS listing_id, c.id AS cluster_id
       FROM listings l JOIN raw_clusters c ON c.id = l.cluster_id
       WHERE l.id = $1`,
      [id]
    );
    if (ls.rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const isOffer = ls.rows[0].type === 'offer';
    const col = isOffer ? 'offer_listing_id' : 'demand_listing_id';
    const otherCol = isOffer ? 'demand_listing_id' : 'offer_listing_id';
    const mq = await pool.query(
      `SELECT m.id, m.score, m.breakdown, m.reasons,
              l2.id AS other_id, l2.title AS other_title, l2.category AS other_category,
              l2.city AS other_city, l2.neighborhood AS other_neighborhood,
              l2.price_amount AS other_price, l2.type AS other_type, l2.phone AS other_phone,
              c2.first_sender AS other_first_sender, c2.first_sender_phone AS other_first_phone,
              c2.duplicate_count_exact_raw AS other_duplicate_count
       FROM match_links m
       JOIN listings l2 ON l2.id = m.${otherCol}
       JOIN raw_clusters c2 ON c2.id = l2.cluster_id
       WHERE m.${col} = $1
       ORDER BY m.score DESC`,
      [id]
    );
    res.json({ listing: ls.rows[0], matches: mq.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
