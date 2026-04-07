// ─── Match & duplicate routes ────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

// Helper: build a real_product JSON object for match queries
const rpJson = (alias, pAlias) => `
  json_build_object(
    '_id', ${alias}.id, 'price', ${alias}.price,
    'location', COALESCE(${alias}.neighborhood || ', ', '') || ${alias}.city,
    'category', ${alias}.category, 'type', ${alias}.type,
    'title', ${alias}.title, 'city', ${alias}.city,
    'neighborhood', ${alias}.neighborhood,
    'bedrooms', ${alias}.bedrooms, 'area', ${alias}.area,
    'transaction_type', ${alias}.transaction_type,
    'post_count', ${alias}.post_count,
    'preferred_locations', ${alias}.preferred_locations,
    'phone',       (SELECT ${pAlias}.phone       FROM products ${pAlias} WHERE ${pAlias}.real_product_id = ${alias}.id AND ${pAlias}.phone IS NOT NULL LIMIT 1),
    'description', (SELECT ${pAlias}.description FROM products ${pAlias} WHERE ${pAlias}.real_product_id = ${alias}.id LIMIT 1),
    'sender',      (SELECT ${pAlias}.sender      FROM products ${pAlias} WHERE ${pAlias}.real_product_id = ${alias}.id LIMIT 1),
    'group_name',  (SELECT ${pAlias}.group_name  FROM products ${pAlias} WHERE ${pAlias}.real_product_id = ${alias}.id LIMIT 1),
    'created_at',  ${alias}.created_at,
    'zone',        ${alias}.zone
  )`;

// GET /api/matches — all match pairs (existing behavior)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        m.id as _id, m.score, m.match_type, m.created_at as "createdAt",
        ${rpJson('rp1', 'p1')} as post1,
        ${rpJson('rp2', 'p2')} as post2
      FROM matches m
      JOIN real_products rp1 ON m.product1_id = rp1.id
      JOIN real_products rp2 ON m.product2_id = rp2.id
      ORDER BY m.score DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/matches/by-demands — each demand with its matching offers (>= minScore, default 0.75)
router.get('/by-demands', async (req, res) => {
  try {
    const minScore = parseFloat(req.query.min_score) || 0.75;
    const result = await pool.query(`
      SELECT
        m.id as match_id, m.score,
        ${rpJson('rd', 'pd')} as demand,
        ${rpJson('ro', 'po')} as offer
      FROM matches m
      JOIN real_products rd ON (
        (m.product1_id = rd.id AND rd.type = 'demand') OR
        (m.product2_id = rd.id AND rd.type = 'demand')
      )
      JOIN real_products ro ON (
        (m.product1_id = ro.id AND ro.type = 'offer') OR
        (m.product2_id = ro.id AND ro.type = 'offer')
      )
      WHERE m.score >= $1
      ORDER BY m.score DESC
    `, [minScore]);

    // Group by demand _id
    const grouped = {};
    for (const row of result.rows) {
      const dId = row.demand._id;
      if (!grouped[dId]) {
        grouped[dId] = { demand: row.demand, offers: [] };
      }
      grouped[dId].offers.push({ match_id: row.match_id, score: row.score, offer: row.offer });
    }
    // Sort offers within each demand by score desc
    const items = Object.values(grouped).map(g => {
      g.offers.sort((a, b) => b.score - a.score);
      g.offer_count = g.offers.length;
      g.best_score = g.offers[0]?.score || 0;
      return g;
    });
    items.sort((a, b) => b.best_score - a.best_score);
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/matches/by-offers — each offer with its matching demands (>= minScore, default 0.75)
router.get('/by-offers', async (req, res) => {
  try {
    const minScore = parseFloat(req.query.min_score) || 0.75;
    const result = await pool.query(`
      SELECT
        m.id as match_id, m.score,
        ${rpJson('ro', 'po')} as offer,
        ${rpJson('rd', 'pd')} as demand
      FROM matches m
      JOIN real_products ro ON (
        (m.product1_id = ro.id AND ro.type = 'offer') OR
        (m.product2_id = ro.id AND ro.type = 'offer')
      )
      JOIN real_products rd ON (
        (m.product1_id = rd.id AND rd.type = 'demand') OR
        (m.product2_id = rd.id AND rd.type = 'demand')
      )
      WHERE m.score >= $1
      ORDER BY m.score DESC
    `, [minScore]);

    // Group by offer _id
    const grouped = {};
    for (const row of result.rows) {
      const oId = row.offer._id;
      if (!grouped[oId]) {
        grouped[oId] = { offer: row.offer, demands: [] };
      }
      grouped[oId].demands.push({ match_id: row.match_id, score: row.score, demand: row.demand });
    }
    const items = Object.values(grouped).map(g => {
      g.demands.sort((a, b) => b.score - a.score);
      g.demand_count = g.demands.length;
      g.best_score = g.demands[0]?.score || 0;
      return g;
    });
    items.sort((a, b) => b.best_score - a.best_score);
    res.json(items);
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
