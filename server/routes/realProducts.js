// ─── Real products (deduplicated) with linked raw posts ──────────────────────
const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

// GET /api/real-products — deduplicated products with linked raw posts
router.get('/', async (req, res) => {
  try {
    const { category, type, city, transaction_type } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (category) { where += ` AND rp.category = $${idx++}`; params.push(category); }
    if (type) { where += ` AND rp.type = $${idx++}`; params.push(type); }
    if (city) { where += ` AND rp.city = $${idx++}`; params.push(city); }
    if (transaction_type) { where += ` AND rp.transaction_type = $${idx++}`; params.push(transaction_type); }

    const result = await pool.query(`
      SELECT
        rp.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', p.id, 'title', p.title, 'description', p.description,
              'sender', p.sender, 'phone', p.phone, 'price', p.price,
              'location', p.location, 'city', p.city, 'neighborhood', p.neighborhood,
              'area', p.area, 'is_duplicate', p.is_duplicate, 'created_at', p.created_at
            ) ORDER BY p.is_duplicate ASC, p.created_at ASC
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) as linked_posts
      FROM real_products rp
      LEFT JOIN products p ON p.real_product_id = rp.id
      ${where}
      GROUP BY rp.id
      ORDER BY rp.post_count DESC, rp.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
