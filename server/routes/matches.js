// ─── Match link routes ──────────────────────────────────────────────────────
// Offer ↔ Demand pairs with weighted breakdown + reasons.
// Grouped views: by-demand (one demand → N offers), by-offer (one offer → N demands).

const express = require('express');
const router = express.Router();
const { pool } = require('../db/postgres');

const LISTING_SELECT = `
  l.id, l.title, l.category, l.transaction_type, l.type,
  l.price_amount, l.price_kind, l.conditions_months,
  l.city, l.neighborhood, l.zone, l.bedrooms, l.area, l.phone,
  l.preferred_locations, l.created_at,
  c.duplicate_count_exact_raw, c.distinct_sender_count_exact_raw,
  c.first_sender, c.first_sender_phone, c.first_posted_at,
  c.all_senders_in_order, c.all_group_ids,
  c.offer_score, c.demand_score, c.type_confidence, c.conflict_flags,
  c.type_reason_summary, c.representative_text
`;

// GET /api/matches — flat list of pairs with both sides joined
router.get('/', async (req, res) => {
  try {
    const { min_score = 50, limit = 500 } = req.query;
    const r = await pool.query(
      `SELECT m.id AS match_id, m.score, m.breakdown, m.reasons, m.created_at AS matched_at,
              ${LISTING_SELECT.replace(/\bl\./g, 'lo.').replace(/\bc\./g, 'co.')} AS _offer_dummy
       FROM match_links m
       JOIN listings lo ON lo.id = m.offer_listing_id
       JOIN raw_clusters co ON co.id = lo.cluster_id
       JOIN listings ld ON ld.id = m.demand_listing_id
       JOIN raw_clusters cd ON cd.id = ld.cluster_id
       WHERE m.score >= $1
       ORDER BY m.score DESC LIMIT $2`,
      [parseInt(min_score), parseInt(limit)]
    );
    // Replace with a two-query approach for clean column names
    const detailed = await pool.query(
      `SELECT m.id AS match_id, m.score, m.breakdown, m.reasons, m.created_at AS matched_at,
              lo.id AS offer_id, lo.title AS offer_title, lo.category AS offer_category,
              lo.transaction_type AS offer_tx, lo.price_amount AS offer_price,
              lo.price_kind AS offer_price_kind, lo.city AS offer_city,
              lo.neighborhood AS offer_neighborhood, lo.zone AS offer_zone,
              lo.bedrooms AS offer_bedrooms, lo.phone AS offer_phone,
              co.first_sender AS offer_first_sender,
              co.first_sender_phone AS offer_first_phone,
              co.duplicate_count_exact_raw AS offer_duplicate_count,
              co.distinct_sender_count_exact_raw AS offer_distinct_senders,
              co.first_posted_at AS offer_first_posted_at,
              co.all_senders_in_order AS offer_all_senders,
              co.representative_text AS offer_text,
              ld.id AS demand_id, ld.title AS demand_title, ld.category AS demand_category,
              ld.transaction_type AS demand_tx, ld.price_amount AS demand_price,
              ld.city AS demand_city, ld.neighborhood AS demand_neighborhood,
              ld.zone AS demand_zone, ld.bedrooms AS demand_bedrooms, ld.phone AS demand_phone,
              ld.preferred_locations AS demand_preferred_locations,
              cd.first_sender AS demand_first_sender,
              cd.first_sender_phone AS demand_first_phone,
              cd.duplicate_count_exact_raw AS demand_duplicate_count,
              cd.distinct_sender_count_exact_raw AS demand_distinct_senders,
              cd.first_posted_at AS demand_first_posted_at,
              cd.all_senders_in_order AS demand_all_senders,
              cd.representative_text AS demand_text
       FROM match_links m
       JOIN listings lo ON lo.id = m.offer_listing_id
       JOIN raw_clusters co ON co.id = lo.cluster_id
       JOIN listings ld ON ld.id = m.demand_listing_id
       JOIN raw_clusters cd ON cd.id = ld.cluster_id
       WHERE m.score >= $1
       ORDER BY m.score DESC LIMIT $2`,
      [parseInt(min_score), parseInt(limit)]
    );
    res.json(detailed.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/matches/count — total count of pairs at a given min_score
router.get('/count', async (req, res) => {
  try {
    const minScore = parseInt(req.query.min_score || '50', 10);
    const r = await pool.query(
      'SELECT COUNT(*) AS n FROM match_links WHERE score >= $1',
      [minScore]
    );
    res.json({ count: parseInt(r.rows[0].n, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/matches/by-demand — each demand with its matched offers
router.get('/by-demand', async (req, res) => {
  try {
    const { min_score = 50 } = req.query;
    const demands = await pool.query(
      `SELECT l.*, c.first_sender, c.first_sender_phone, c.duplicate_count_exact_raw,
              c.distinct_sender_count_exact_raw, c.representative_text,
              c.conflict_flags, c.offer_score, c.demand_score, c.type_confidence
       FROM listings l JOIN raw_clusters c ON c.id = l.cluster_id
       WHERE l.type = 'demand'
       ORDER BY c.first_posted_at DESC NULLS LAST`
    );

    const offers = await pool.query(
      `SELECT m.id AS match_id, m.demand_listing_id, m.score, m.breakdown, m.reasons,
              lo.*, co.first_sender, co.first_sender_phone,
              co.duplicate_count_exact_raw, co.distinct_sender_count_exact_raw,
              co.representative_text, co.conflict_flags, co.type_confidence
       FROM match_links m
       JOIN listings lo ON lo.id = m.offer_listing_id
       JOIN raw_clusters co ON co.id = lo.cluster_id
       WHERE m.score >= $1
       ORDER BY m.score DESC`,
      [parseInt(min_score)]
    );

    const byDemand = new Map();
    for (const d of demands.rows) byDemand.set(d.id, { demand: d, offers: [] });
    for (const o of offers.rows) {
      const bucket = byDemand.get(o.demand_listing_id);
      if (bucket) bucket.offers.push(o);
    }
    const out = [...byDemand.values()].map(b => ({
      demand: b.demand,
      offers: b.offers,
      offer_count: b.offers.length,
      best_score: b.offers.length ? Math.max(...b.offers.map(o => o.score)) : 0,
    })).filter(b => b.offer_count > 0);

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/matches/by-offer
router.get('/by-offer', async (req, res) => {
  try {
    const { min_score = 50 } = req.query;
    const offersRes = await pool.query(
      `SELECT l.*, c.first_sender, c.first_sender_phone, c.duplicate_count_exact_raw,
              c.distinct_sender_count_exact_raw, c.representative_text,
              c.conflict_flags, c.offer_score, c.demand_score, c.type_confidence
       FROM listings l JOIN raw_clusters c ON c.id = l.cluster_id
       WHERE l.type = 'offer'
       ORDER BY c.first_posted_at DESC NULLS LAST`
    );

    const demands = await pool.query(
      `SELECT m.id AS match_id, m.offer_listing_id, m.score, m.breakdown, m.reasons,
              ld.*, cd.first_sender, cd.first_sender_phone,
              cd.duplicate_count_exact_raw, cd.distinct_sender_count_exact_raw,
              cd.representative_text, cd.conflict_flags, cd.type_confidence
       FROM match_links m
       JOIN listings ld ON ld.id = m.demand_listing_id
       JOIN raw_clusters cd ON cd.id = ld.cluster_id
       WHERE m.score >= $1
       ORDER BY m.score DESC`,
      [parseInt(min_score)]
    );

    const byOffer = new Map();
    for (const o of offersRes.rows) byOffer.set(o.id, { offer: o, demands: [] });
    for (const d of demands.rows) {
      const bucket = byOffer.get(d.offer_listing_id);
      if (bucket) bucket.demands.push(d);
    }
    const out = [...byOffer.values()].map(b => ({
      offer: b.offer,
      demands: b.demands,
      demand_count: b.demands.length,
      best_score: b.demands.length ? Math.max(...b.demands.map(d => d.score)) : 0,
    })).filter(b => b.demand_count > 0);

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
