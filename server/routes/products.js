// ─── Product routes (raw posts + heatmap + stats) ────────────────────────────
const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

// GET /api/products — list raw posts with optional filters
router.get('/', async (req, res) => {
  try {
    const { category, type, city, transaction_type, limit = 5000 } = req.query;
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

// GET /api/products/download — download last 100 raw posts as JSON file
router.get('/download', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM products
      ORDER BY created_at DESC
      LIMIT 100
    `);
    
    const data = {
      exported_at: new Date().toISOString(),
      count: result.rows.length,
      posts: result.rows
    };
    
    const filename = `posts_export_${new Date().toISOString().split('T')[0]}.json`;
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/download-raw — download raw WhatsApp messages with filters
// Query params: limit (default 500, max 50000), group_id, group_name, is_real_estate, from, to, page, format
router.get('/download-raw', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 50000);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        id, whatsapp_message_id, sender, sender_phone,
        group_id, group_name, text, is_real_estate,
        classification_status, classification_confidence,
        segment_count, source_mode, parser_version,
        created_at
      FROM raw_messages WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (req.query.group_id) { query += ` AND group_id = $${idx++}`; params.push(req.query.group_id); }
    if (req.query.group_name) { query += ` AND group_name ILIKE $${idx++}`; params.push(`%${req.query.group_name}%`); }
    if (req.query.is_real_estate !== undefined) {
      query += ` AND is_real_estate = $${idx++}`;
      params.push(req.query.is_real_estate === 'true');
    }
    if (req.query.from) { query += ` AND created_at >= $${idx++}`; params.push(req.query.from); }
    if (req.query.to) { query += ` AND created_at <= $${idx++}`; params.push(req.query.to); }

    // Count total for pagination metadata
    const countResult = await pool.query(
      query.replace(/SELECT[\s\S]+?FROM/, 'SELECT COUNT(*) as total FROM'),
      params
    );
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Streaming NDJSON for large exports
    if (req.query.format === 'ndjson') {
      const filename = `raw_messages_export_${new Date().toISOString().split('T')[0]}.ndjson`;
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      for (const row of result.rows) {
        res.write(JSON.stringify(row) + '\n');
      }
      return res.end();
    }

    const data = {
      exported_at: new Date().toISOString(),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      count: result.rows.length,
      messages: result.rows,
    };

    const filename = `raw_messages_export_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/products/backfill-raw - fill raw_messages from existing products
router.post('/backfill-raw', async (req, res) => {
  try {
    const result = await pool.query(`
      INSERT INTO raw_messages (whatsapp_message_id, sender, group_id, group_name, text, is_real_estate, source_mode, processed_at, created_at)
      SELECT 
        p.whatsapp_message_id,
        p.sender,
        p.group_id,
        p.group_name,
        p.description,
        TRUE,
        'backfill',
        p.created_at,
        p.created_at
      FROM products p
      LEFT JOIN raw_messages r ON p.whatsapp_message_id = r.whatsapp_message_id
      WHERE r.id IS NULL AND p.whatsapp_message_id IS NOT NULL
      ON CONFLICT (whatsapp_message_id) DO NOTHING
    `);
    
    res.json({ 
      success: true, 
      inserted: result.rowCount,
      message: `Backfilled ${result.rowCount} messages to raw_messages table`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/raw-groups — list all groups that have raw messages stored
router.get('/raw-groups', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        group_id,
        group_name,
        COUNT(*) as message_count,
        COUNT(*) FILTER (WHERE is_real_estate = true) as real_estate_count,
        MIN(created_at) as first_message,
        MAX(created_at) as last_message
      FROM raw_messages
      GROUP BY group_id, group_name
      ORDER BY message_count DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/raw-stats — overview of raw message classification
router.get('/raw-stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_real_estate = true) as real_estate,
        COUNT(*) FILTER (WHERE is_real_estate = false) as not_real_estate,
        COUNT(*) FILTER (WHERE classification_status = 'accepted') as accepted,
        COUNT(*) FILTER (WHERE classification_status = 'needs_review') as needs_review,
        COUNT(*) FILTER (WHERE classification_status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE classification_status = 'pending' OR classification_status IS NULL) as pending,
        AVG(classification_confidence) FILTER (WHERE classification_confidence IS NOT NULL) as avg_confidence,
        COUNT(DISTINCT group_id) as group_count
      FROM raw_messages
    `);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
