// ─── Match & duplicate routes ────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

// GET /api/matches — matches between real products
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        m.id as _id, m.score, m.match_type, m.created_at as "createdAt",
        json_build_object(
          '_id', rp1.id, 'price', rp1.price,
          'location', COALESCE(rp1.neighborhood || ', ', '') || rp1.city,
          'category', rp1.category, 'type', rp1.type,
          'title', rp1.title, 'city', rp1.city,
          'neighborhood', rp1.neighborhood,
          'bedrooms', rp1.bedrooms, 'area', rp1.area,
          'transaction_type', rp1.transaction_type,
          'post_count', rp1.post_count,
          'phone',       (SELECT p1.phone       FROM products p1 WHERE p1.real_product_id = rp1.id AND p1.phone       IS NOT NULL LIMIT 1),
          'description', (SELECT p1.description FROM products p1 WHERE p1.real_product_id = rp1.id LIMIT 1),
          'sender',      (SELECT p1.sender      FROM products p1 WHERE p1.real_product_id = rp1.id LIMIT 1),
          'group_name',  (SELECT p1.group_name  FROM products p1 WHERE p1.real_product_id = rp1.id LIMIT 1),
          'created_at',  rp1.created_at,
          'zone',        rp1.zone
        ) as post1,
        json_build_object(
          '_id', rp2.id, 'price', rp2.price,
          'location', COALESCE(rp2.neighborhood || ', ', '') || rp2.city,
          'category', rp2.category, 'type', rp2.type,
          'title', rp2.title, 'city', rp2.city,
          'neighborhood', rp2.neighborhood,
          'bedrooms', rp2.bedrooms, 'area', rp2.area,
          'transaction_type', rp2.transaction_type,
          'post_count', rp2.post_count,
          'phone',       (SELECT p2.phone       FROM products p2 WHERE p2.real_product_id = rp2.id AND p2.phone       IS NOT NULL LIMIT 1),
          'description', (SELECT p2.description FROM products p2 WHERE p2.real_product_id = rp2.id LIMIT 1),
          'sender',      (SELECT p2.sender      FROM products p2 WHERE p2.real_product_id = rp2.id LIMIT 1),
          'group_name',  (SELECT p2.group_name  FROM products p2 WHERE p2.real_product_id = rp2.id LIMIT 1),
          'created_at',  rp2.created_at,
          'zone',        rp2.zone
        ) as post2
      FROM matches m
      JOIN real_products rp1 ON m.product1_id = rp1.id
      JOIN real_products rp2 ON m.product2_id = rp2.id
      ORDER BY m.score DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/duplicates — duplicate links between raw posts
router.get('/duplicates', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.id, d.similarity, d.created_at,
        json_build_object(
          'id', p1.id, 'title', p1.title, 'description', p1.description,
          'sender', p1.sender, 'price', p1.price, 'location', p1.location,
          'category', p1.category, 'city', p1.city
        ) as original,
        json_build_object(
          'id', p2.id, 'title', p2.title, 'description', p2.description,
          'sender', p2.sender, 'price', p2.price, 'location', p2.location,
          'category', p2.category, 'city', p2.city
        ) as duplicate
      FROM duplicates d
      JOIN products p1 ON d.original_id = p1.id
      JOIN products p2 ON d.duplicate_id = p2.id
      ORDER BY d.similarity DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
