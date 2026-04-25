// ─── Raw WhatsApp messages (debug / Posts tab) ─────────────────────────────
// Returns every raw_message joined with its cluster status + listing (if any).
// Unlike /api/listings (1 row per cluster), this returns 1 row per WhatsApp
// message — including duplicates, non-real-estate rejects, and unclassified.

const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

// GET /api/raw-messages
// Query params:
//   limit       (default 500, max 5000)
//   offset      (default 0)
//   q           free-text search on raw_messages.text (ILIKE %q%)
//   status      'classified' | 'rejected' | 'pending' | 'all' (default all)
//   source_mode 'live' | 'history' | 'import'
//   order       'newest' | 'oldest' (default newest)
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 5000);
    const offset = parseInt(req.query.offset || '0', 10);
    const q = (req.query.q || '').trim();
    const status = req.query.status || 'all';
    const sourceMode = req.query.source_mode;
    const order = req.query.order === 'oldest' ? 'ASC' : 'DESC';

    const clauses = [];
    const params = [];
    let i = 1;

    if (q) {
      clauses.push(`rm.text ILIKE $${i++}`);
      params.push(`%${q}%`);
    }
    if (sourceMode) {
      clauses.push(`rm.source_mode = $${i++}`);
      params.push(sourceMode);
    }
    if (status === 'classified') {
      clauses.push('l.id IS NOT NULL');
    } else if (status === 'rejected') {
      clauses.push('c.is_real_estate = false');
    } else if (status === 'pending') {
      clauses.push('c.is_real_estate IS NULL');
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
      SELECT
        rm.id,
        rm.whatsapp_message_id,
        rm.sender,
        rm.sender_phone,
        rm.group_id,
        rm.group_name,
        rm.text,
        rm.source_mode,
        rm.created_at,
        rm.cluster_id,
        c.is_real_estate        AS cluster_is_real_estate,
        c.type_final            AS cluster_type,
        c.duplicate_count_exact_raw AS cluster_duplicate_count,
        c.distinct_sender_count_exact_raw AS cluster_distinct_senders,
        c.representative_raw_message_id,
        l.id                    AS listing_id,
        l.title                 AS listing_title,
        l.category              AS listing_category,
        l.transaction_type      AS listing_transaction,
        l.price_amount          AS listing_price,
        l.city                  AS listing_city,
        l.neighborhood          AS listing_neighborhood,
        l.zone                  AS listing_zone,
        l.bedrooms              AS listing_bedrooms
      FROM raw_messages rm
      LEFT JOIN raw_clusters c ON c.id = rm.cluster_id
      LEFT JOIN listings    l ON l.cluster_id = rm.cluster_id
      ${whereSql}
      ORDER BY rm.created_at ${order} NULLS LAST, rm.id ${order}
      LIMIT $${i++} OFFSET $${i}
    `;
    params.push(limit, offset);

    const r = await pool.query(sql, params);

    // Post-process: add a status string per row for the frontend.
    const rows = r.rows.map(row => ({
      ...row,
      is_representative: row.id === row.representative_raw_message_id,
      status:
        row.listing_id ? 'classified'
        : row.cluster_is_real_estate === false ? 'rejected'
        : row.cluster_is_real_estate === true ? 'real_estate_no_listing'
        : 'pending',
    }));

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/raw-messages/count — total count for pagination
router.get('/count', async (_req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) AS n FROM raw_messages');
    res.json({ count: parseInt(r.rows[0].n, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
