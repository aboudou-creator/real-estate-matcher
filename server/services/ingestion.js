// ─── Ingestion orchestrator (spec §2 pipeline order) ────────────────────────
// Pipeline:
//   1. insert raw_message + find-or-create cluster (exactDedup)
//   2. if NEW cluster (representative) → classify + extract + match
//   3. if EXISTING cluster → just update cluster metadata; exit
//
// This file is the only place that writes to raw_clusters / listings /
// match_links. Routes consume, not mutate.

const { pool } = require('../db/postgres');
const { findOrCreateCluster } = require('./exactDedup');
const { classifyRealEstate } = require('./realEstateClassifier');
const { scoreType } = require('./typeScorer');
const { parsePrice } = require('./priceParser');
const { parseCategory, inferTransactionType, CATEGORY_LABELS } = require('./categoryParser');
const { parseLocation, parseAllLocations } = require('./locationParser');
const { parseBedrooms, parseArea, parsePhone } = require('./bedroomsParser');
const { findMatchesForListing } = require('./matcher');

const PARSER_VERSION = '3.0.0';

/**
 * Ingest a single raw WhatsApp message through the full pipeline.
 * Called from whatsapp.js (live), local-runner.js, and history sync.
 *
 * @returns {Promise<{
 *   rawMessageId: number|null,
 *   clusterId: number|null,
 *   isNewCluster: boolean,
 *   isRealEstate: boolean|null,
 *   listingId: number|null,
 *   matchCount: number,
 *   duplicateCount: number
 * }>}
 */
async function ingestMessage(msg) {
  const result = {
    rawMessageId: null,
    clusterId: null,
    isNewCluster: false,
    isRealEstate: null,
    listingId: null,
    matchCount: 0,
    duplicateCount: 0,
  };

  // 1. Exact dedup + raw insert
  const cluster = await findOrCreateCluster(msg);
  if (!cluster) return result;

  result.rawMessageId = cluster.rawMessageId;
  result.clusterId = cluster.clusterId;
  result.isNewCluster = cluster.isNewCluster;
  result.duplicateCount = cluster.duplicateCount;

  if (msg.emit) {
    msg.emit('raw_message', {
      raw_message_id: cluster.rawMessageId,
      cluster_id: cluster.clusterId,
      is_new_cluster: cluster.isNewCluster,
      duplicate_count: cluster.duplicateCount,
      sender: msg.sender,
      sender_phone: msg.senderPhone,
      group_name: msg.groupName,
    });
  }

  // 2. Metadata-only updates for existing clusters
  if (!cluster.isNewCluster) {
    if (msg.emit) {
      msg.emit('cluster_updated', {
        cluster_id: cluster.clusterId,
        duplicate_count: cluster.duplicateCount,
        distinct_sender_count: cluster.distinctSenderCount,
      });
    }
    return result;
  }

  // 3. NEW cluster — classify + extract. Use the stored representative text
  // (normalized). Fall back to the original text if lookup fails.
  let text = msg.text;
  try {
    const r = await pool.query(
      'SELECT representative_text FROM raw_clusters WHERE id = $1',
      [cluster.clusterId]
    );
    if (r.rows[0]?.representative_text) text = r.rows[0].representative_text;
  } catch (_) {}

  const rec = classifyRealEstate(text);

  await pool.query(
    `UPDATE raw_clusters SET
       is_real_estate = $2,
       real_estate_score = $3,
       real_estate_reasons = $4::jsonb,
       parser_version = $5,
       updated_at = NOW()
     WHERE id = $1`,
    [
      cluster.clusterId,
      rec.isRealEstate,
      rec.score,
      JSON.stringify({
        positive_hits: rec.positive_hits,
        negative_hits: rec.negative_hits,
        reasons: rec.reasons,
      }),
      PARSER_VERSION,
    ]
  );

  result.isRealEstate = rec.isRealEstate;

  if (!rec.isRealEstate) return result;

  // 4. Offer/demand scoring
  const typeRes = scoreType(text);
  await pool.query(
    `UPDATE raw_clusters SET
       type_final = $2,
       type_confidence = $3,
       offer_score = $4,
       demand_score = $5,
       offer_signal_hits = $6::jsonb,
       demand_signal_hits = $7::jsonb,
       demand_false_positive_hits = $8::jsonb,
       listing_signal_hits = $9::jsonb,
       conflict_flags = $10::jsonb,
       type_reason_summary = $11
     WHERE id = $1`,
    [
      cluster.clusterId,
      typeRes.type_final,
      typeRes.type_confidence,
      typeRes.offer_score,
      typeRes.demand_score,
      JSON.stringify(typeRes.offer_signal_hits),
      JSON.stringify(typeRes.demand_signal_hits),
      JSON.stringify(typeRes.demand_false_positive_hits),
      JSON.stringify(typeRes.listing_signal_hits),
      JSON.stringify(typeRes.conflict_flags),
      typeRes.type_reason_summary,
    ]
  );

  if (typeRes.type_final === 'ambiguous') return result;

  // 5. Extract listing fields
  const categoryRes = parseCategory(text);
  const priceRes = parsePrice(text);
  const locRes = parseLocation(text);
  const bedrooms = parseBedrooms(text);
  const area = parseArea(text);
  const phone = parsePhone(text) || msg.senderPhone || null;

  let transaction = inferTransactionType(text);
  if (!transaction) {
    if (priceRes.price_kind === 'monthly_rent') transaction = 'rent';
    else if (priceRes.price_kind === 'total_sale') transaction = 'sale';
    else transaction = priceRes.price_amount && priceRes.price_amount < 2_000_000 ? 'rent' : 'sale';
  }

  if (!categoryRes.category) return result; // no clear category → skip listing

  // Preferred locations for demands
  let preferredLocations = null;
  if (typeRes.type_final === 'demand') {
    const all = parseAllLocations(text);
    if (all.length > 1) preferredLocations = all;
  }

  const bedroomLabel = bedrooms ? ` F${bedrooms + 1}` : '';
  const locLabel = locRes.neighborhood ? ` – ${locRes.neighborhood}` : locRes.city ? ` – ${locRes.city}` : '';
  const title = `${CATEGORY_LABELS[categoryRes.category] || categoryRes.category}${bedroomLabel}${locLabel}`;

  // 6. Insert listing (idempotent on cluster_id)
  const ins = await pool.query(
    `INSERT INTO listings (
       cluster_id, title, category, transaction_type, type,
       price_amount, currency, price_kind, conditions_months,
       raw_price_match, price_confidence, price_reason,
       city, neighborhood, zone, location_confidence, preferred_locations,
       bedrooms, area, phone, parser_version
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21
     )
     ON CONFLICT (cluster_id) DO UPDATE SET
       title = EXCLUDED.title,
       category = EXCLUDED.category,
       transaction_type = EXCLUDED.transaction_type,
       type = EXCLUDED.type,
       price_amount = EXCLUDED.price_amount,
       price_kind = EXCLUDED.price_kind,
       conditions_months = EXCLUDED.conditions_months,
       raw_price_match = EXCLUDED.raw_price_match,
       price_confidence = EXCLUDED.price_confidence,
       price_reason = EXCLUDED.price_reason,
       city = EXCLUDED.city,
       neighborhood = EXCLUDED.neighborhood,
       zone = EXCLUDED.zone,
       location_confidence = EXCLUDED.location_confidence,
       preferred_locations = EXCLUDED.preferred_locations,
       bedrooms = EXCLUDED.bedrooms,
       area = EXCLUDED.area,
       phone = EXCLUDED.phone,
       parser_version = EXCLUDED.parser_version
     RETURNING id`,
    [
      cluster.clusterId,
      title,
      categoryRes.category,
      transaction,
      typeRes.type_final,
      priceRes.price_amount,
      priceRes.currency,
      priceRes.price_kind,
      priceRes.conditions_months,
      priceRes.raw_price_match,
      priceRes.price_confidence,
      priceRes.price_reason,
      locRes.city,
      locRes.neighborhood,
      locRes.zone,
      locRes.confidence,
      preferredLocations ? JSON.stringify(preferredLocations) : null,
      bedrooms,
      area,
      phone,
      PARSER_VERSION,
    ]
  );

  result.listingId = ins.rows[0].id;

  // 7. Match against counterparts
  const matches = await findMatchesForListing(result.listingId, 50);
  result.matchCount = matches.length;

  if (msg.emit) {
    msg.emit('listing_created', {
      listing_id: result.listingId,
      cluster_id: cluster.clusterId,
      type: typeRes.type_final,
      category: categoryRes.category,
      title,
      match_count: matches.length,
    });
    for (const m of matches) msg.emit('match_created', m);
  }

  return result;
}

module.exports = { ingestMessage, PARSER_VERSION };
