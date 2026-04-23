// ─── Raw cluster routes (debug + ingestion inspection) ─────────────────────
const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

// GET /api/clusters — list clusters with filters
router.get('/', async (req, res) => {
  try {
    const {
      is_real_estate, type, has_listing, limit = 200, offset = 0
    } = req.query;

    const clauses = [];
    const params = [];
    let i = 1;

    if (is_real_estate !== undefined) {
      clauses.push(`c.is_real_estate = $${i++}`);
      params.push(is_real_estate === 'true');
    }
    if (type) {
      clauses.push(`c.type_final = $${i++}`);
      params.push(type);
    }
    if (has_listing === 'true') {
      clauses.push('l.id IS NOT NULL');
    } else if (has_listing === 'false') {
      clauses.push('l.id IS NULL');
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
      SELECT
        c.*,
        l.id AS listing_id,
        l.title AS listing_title,
        l.category AS listing_category,
        l.price_amount,
        l.price_kind,
        l.neighborhood AS listing_neighborhood,
        l.city AS listing_city
      FROM raw_clusters c
      LEFT JOIN listings l ON l.cluster_id = c.id
      ${whereSql}
      ORDER BY c.first_posted_at DESC NULLS LAST, c.id DESC
      LIMIT $${i++} OFFSET $${i}
    `;
    params.push(parseInt(limit), parseInt(offset));
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clusters/:id — full cluster with raw messages + listing + matches
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cluster = await pool.query('SELECT * FROM raw_clusters WHERE id = $1', [id]);
    if (cluster.rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const raws = await pool.query(
      `SELECT id, whatsapp_message_id, sender, sender_phone, group_id, group_name,
              text, source_mode, created_at
       FROM raw_messages WHERE cluster_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    const listing = await pool.query('SELECT * FROM listings WHERE cluster_id = $1', [id]);

    let matches = [];
    if (listing.rows.length > 0) {
      const lid = listing.rows[0].id;
      const isOffer = listing.rows[0].type === 'offer';
      const col = isOffer ? 'offer_listing_id' : 'demand_listing_id';
      const otherCol = isOffer ? 'demand_listing_id' : 'offer_listing_id';
      const mq = await pool.query(
        `SELECT m.id, m.score, m.breakdown, m.reasons, m.created_at,
                l2.id AS other_listing_id, l2.title AS other_title,
                l2.category AS other_category, l2.neighborhood AS other_neighborhood,
                l2.price_amount AS other_price_amount, l2.type AS other_type,
                l2.phone AS other_phone
         FROM match_links m
         JOIN listings l2 ON l2.id = m.${otherCol}
         WHERE m.${col} = $1
         ORDER BY m.score DESC`,
        [lid]
      );
      matches = mq.rows;
    }

    res.json({
      cluster: cluster.rows[0],
      raw_messages: raws.rows,
      listing: listing.rows[0] || null,
      matches,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clusters/stats — aggregate counts
router.get('/stats/overview', async (_req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total_clusters,
        COUNT(*) FILTER (WHERE is_real_estate = true) AS real_estate_clusters,
        COUNT(*) FILTER (WHERE is_real_estate = false) AS non_real_estate_clusters,
        COUNT(*) FILTER (WHERE type_final = 'offer') AS offers,
        COUNT(*) FILTER (WHERE type_final = 'demand') AS demands,
        COUNT(*) FILTER (WHERE type_final = 'ambiguous') AS ambiguous,
        COUNT(*) FILTER (WHERE jsonb_array_length(conflict_flags) > 0) AS with_conflicts,
        SUM(duplicate_count_exact_raw) AS total_raw_messages
      FROM raw_clusters
    `);
    const listings = await pool.query(`SELECT COUNT(*) AS count FROM listings`);
    const matches = await pool.query(`SELECT COUNT(*) AS count FROM match_links`);
    res.json({
      ...stats.rows[0],
      listings: parseInt(listings.rows[0].count),
      match_links: parseInt(matches.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
