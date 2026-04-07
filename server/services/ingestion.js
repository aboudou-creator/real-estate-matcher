// ─── Shared Ingestion Pipeline ──────────────────────────────────────────────
// Centralizes raw message capture, classification, extraction, and downstream
// processing. Used by both whatsapp.js (Fly.io) and local-runner.js.

const { pool } = require('../db/postgres');
const { classifyMessage, PARSER_VERSION } = require('./classifier');
const { extractRealEstateInfo } = require('./extractor');
const { processNewPost } = require('./dedup');
const { findMatchesForProduct } = require('./matcher');

/**
 * Save a raw WhatsApp message to the database before any classification.
 * Returns the raw_messages row id, or null if it was a duplicate message.
 */
async function saveRawMessage({ whatsappMessageId, sender, senderPhone, groupId, groupName, text, sourceMode }) {
  try {
    const result = await pool.query(
      `INSERT INTO raw_messages
        (whatsapp_message_id, sender, sender_phone, group_id, group_name, text, is_real_estate, source_mode, parser_version, classification_status, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8, 'pending', NOW())
       ON CONFLICT (whatsapp_message_id) DO NOTHING
       RETURNING id`,
      [whatsappMessageId, sender, senderPhone, groupId, groupName, text, sourceMode || 'live', PARSER_VERSION]
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    console.error('Error saving raw message:', err.message);
    return null;
  }
}

/**
 * Classify a raw message, save segments, and update the raw_messages row.
 * Returns the classification result.
 */
async function classifyAndSaveSegments(rawMessageId, text) {
  const classification = classifyMessage(text);

  // Update raw_messages with classification results
  try {
    await pool.query(
      `UPDATE raw_messages SET
        is_real_estate = $1,
        classification_status = $2,
        classification_confidence = $3,
        classification_reasons = $4,
        segment_count = $5,
        parser_version = $6
       WHERE id = $7`,
      [
        classification.overallStatus === 'accepted',
        classification.overallStatus,
        classification.overallConfidence,
        classification.segments.map(s => s.reasons.join(',')).join(';'),
        classification.segmentCount,
        PARSER_VERSION,
        rawMessageId,
      ]
    );
  } catch (err) {
    console.error('Error updating raw message classification:', err.message);
  }

  // Save individual segments
  for (const seg of classification.segments) {
    try {
      await pool.query(
        `INSERT INTO raw_message_segments
          (raw_message_id, segment_index, text, is_real_estate, confidence, reason_codes, parser_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          rawMessageId,
          seg.index,
          seg.text,
          seg.isRealEstate,
          seg.confidence,
          seg.reasons.join(','),
          PARSER_VERSION,
        ]
      );
    } catch (err) {
      // Ignore segment insert errors (e.g. duplicates on reprocess)
    }
  }

  return classification;
}

/**
 * Extract structured real estate data from accepted segments and run
 * through dedup/matching pipeline.
 *
 * @param {Object} opts
 * @param {Object} opts.classification - Result from classifyAndSaveSegments
 * @param {string} opts.fullText - Original full message text
 * @param {number|null} opts.rawMessageId - raw_messages row id
 * @param {string} opts.sender - WhatsApp sender name
 * @param {string} opts.groupId - WhatsApp group JID
 * @param {string} opts.groupName - WhatsApp group name
 * @param {string} opts.whatsappMessageId - WhatsApp message key id
 * @param {Function|null} opts.emit - Socket.IO emit function (optional)
 * @param {Function|null} opts.getFullRealProduct - function to fetch full RP (optional)
 *
 * @returns {Array} Array of { rawPost, realProductId, isDuplicate } results
 */
async function extractAndProcess(opts) {
  const {
    classification,
    fullText,
    rawMessageId,
    sender,
    groupId,
    groupName,
    whatsappMessageId,
    emit,
    getFullRealProduct,
  } = opts;

  if (classification.overallStatus !== 'accepted') return [];

  const results = [];

  // Use the existing extractor on each accepted segment individually
  for (let i = 0; i < classification.acceptedSegments.length; i++) {
    const seg = classification.acceptedSegments[i];
    const extracted = extractRealEstateInfo(seg.text);

    // The extractor may still reject if it can't build a structured post
    if (!extracted.isRealEstatePost) continue;

    // Handle multiple products from one segment (extractor's own multi-split)
    const products = extracted.multiple ? extracted.products : [extracted];

    for (let j = 0; j < products.length; j++) {
      const item = products[j];
      const segIdx = classification.acceptedSegments.length > 1 ? `_s${i}` : '';
      const prodIdx = products.length > 1 ? `_${j}` : '';
      const msgId = `${whatsappMessageId}${segIdx}${prodIdx}`;

      const postData = {
        title: item.title,
        description: item.description,
        type: item.type,
        category: item.category,
        transaction_type: item.transactionType,
        price: item.price,
        currency: 'XOF',
        city: item.city,
        neighborhood: item.neighborhood,
        zone: item.zone || null,
        latitude: null,
        longitude: null,
        bedrooms: item.bedrooms,
        bathrooms: null,
        area: item.area,
        sender: sender,
        phone: item.phone,
        whatsapp_message_id: msgId,
        group_id: groupId,
        group_name: groupName,
        preferred_locations: item.preferred_locations || null,
        confidence: seg.confidence,
        reason_codes: seg.reasons.join(','),
        raw_message_id: rawMessageId,
      };

      try {
        const result = await processNewPost(postData);
        if (!result) continue;

        const { rawPost, realProductId, isDuplicate } = result;
        results.push({ rawPost, realProductId, isDuplicate });

        let newMatches = [];
        if (!isDuplicate) {
          newMatches = await findMatchesForProduct(realProductId);
        }

        // Emit events if Socket.IO is available
        if (emit && getFullRealProduct) {
          const fullRP = await getFullRealProduct(realProductId);
          if (fullRP) {
            emit(isDuplicate ? 'realProductUpdated' : 'newRealProduct', fullRP);
          }
          emit('newPost', rawPost);
          if (isDuplicate) {
            emit('duplicateDetected', { rawPost, realProductId });
          }
          for (const match of newMatches) {
            emit('newMatch', match);
            const [rpA, rpB] = await Promise.all([
              getFullRealProduct(match.post1?._id || match.product1_id),
              getFullRealProduct(match.post2?._id || match.product2_id),
            ]);
            if (rpA) emit('realProductUpdated', rpA);
            if (rpB) emit('realProductUpdated', rpB);
          }
        }

        const label = isDuplicate ? `Duplicate (#${realProductId})` : `New #${realProductId}`;
        const matchLabel = newMatches.length > 0 ? ` + ${newMatches.length} match(es)` : '';
        console.log(`   → [seg${i}:${j}] ${item.title}: ${label}${matchLabel} (conf: ${seg.confidence})`);

      } catch (err) {
        console.error(`   ✗ Error processing seg${i}:${j}: ${err.message}`);
      }
    }
  }

  // Update segments with extracted data
  for (const seg of classification.acceptedSegments) {
    try {
      const extracted = extractRealEstateInfo(seg.text);
      if (extracted.isRealEstatePost) {
        await pool.query(
          `UPDATE raw_message_segments SET extracted_data = $1 WHERE raw_message_id = $2 AND segment_index = $3`,
          [JSON.stringify(extracted), rawMessageId, seg.index]
        );
      }
    } catch (_) {}
  }

  return results;
}

/**
 * Full ingestion pipeline: save raw → classify → extract → process.
 * This is the single entry point for both whatsapp.js and local-runner.js.
 */
async function ingestMessage({ whatsappMessageId, sender, senderPhone, groupId, groupName, text, sourceMode, emit, getFullRealProduct }) {
  // 1. Save raw message
  const rawMessageId = await saveRawMessage({
    whatsappMessageId,
    sender,
    senderPhone,
    groupId,
    groupName,
    text,
    sourceMode,
  });

  // rawMessageId is null if message was already saved (duplicate wa message id)
  if (!rawMessageId) return null;

  // 2. Classify
  const classification = await classifyAndSaveSegments(rawMessageId, text);

  if (classification.overallStatus === 'rejected') {
    return { rawMessageId, classification, products: [] };
  }

  // 3. Extract and process accepted segments
  const products = await extractAndProcess({
    classification,
    fullText: text,
    rawMessageId,
    sender,
    groupId,
    groupName,
    whatsappMessageId,
    emit,
    getFullRealProduct,
  });

  const acceptedCount = classification.acceptedSegments.length;
  if (acceptedCount > 0) {
    console.log(`📨 ${acceptedCount} segment(s) accepted from ${sender} (conf: ${classification.overallConfidence}, segments: ${classification.segmentCount})`);
  }

  return { rawMessageId, classification, products };
}

module.exports = {
  ingestMessage,
  saveRawMessage,
  classifyAndSaveSegments,
  extractAndProcess,
};
