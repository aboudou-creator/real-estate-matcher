// ─── Product routes (raw posts + heatmap + stats) ────────────────────────────
const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

// GET /api/products — list raw posts with optional filters
router.get('/', async (req, res) => {
  try {
    const { category, type, city, transaction_type, limit = 500 } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];
    let idx = 1;

    if (category) { query += ` AND category = $${idx++}`; params.push(category); }
    if (type) { query += ` AND type = $${idx++}`; params.push(type); }
    if (city) { query += ` AND city = $${idx++}`; params.push(city); }
    if (transaction_type) { query += ` AND transaction_type = $${idx++}`; params.push(transaction_type); }

    query += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/heatmap — lat/lng points for map
router.get('/heatmap', async (req, res) => {
  try {
    const { category } = req.query;
    let query = 'SELECT latitude, longitude, category, price, city, neighborhood FROM products WHERE latitude IS NOT NULL AND longitude IS NOT NULL';
    const params = [];

    if (category) {
      query += ' AND category = $1';
      params.push(category);
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/stats — aggregate stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE type = 'offer') as offers,
        COUNT(*) FILTER (WHERE type = 'demand') as demands,
        COUNT(*) FILTER (WHERE category = 'apartment') as apartments,
        COUNT(*) FILTER (WHERE category = 'house') as houses,
        COUNT(*) FILTER (WHERE category = 'ground') as grounds,
        COUNT(*) FILTER (WHERE transaction_type = 'sale') as sales,
        COUNT(*) FILTER (WHERE transaction_type = 'rent') as rentals
      FROM products
    `);
    const cities = await pool.query(`
      SELECT city, COUNT(*) as count FROM products GROUP BY city ORDER BY count DESC
    `);
    res.json({ ...stats.rows[0], cities: cities.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
