// ─── Exact raw-text deduplication ───────────────────────────────────────────
// Given an incoming raw WhatsApp message, find or create its cluster.
// Later arrivals only update cluster metadata — the representative row never
// changes once it has been classified.

const { pool } = require('../db/postgres');
const { normalizeRawText, exactDedupHash } = require('./normalize');

/**
 * Insert the raw message row and attach it to a cluster (creating the cluster
 * if this is the first time we see this normalized text).
 *
 * @param {Object} msg
 * @param {string} msg.whatsappMessageId
 * @param {string} msg.sender
 * @param {string|null} msg.senderPhone
 * @param {string} msg.groupId
 * @param {string} msg.groupName
 * @param {string} msg.text              - raw text
 * @param {Date}   [msg.createdAt]       - original posting time (history sync)
 * @param {string} [msg.sourceMode]      - 'live' | 'history' | 'import'
 * @param {Object} [client]              - optional pg client for txn reuse
 *
 * @returns {Promise<{
 *   rawMessageId: number,
 *   clusterId: number,
 *   isNewCluster: boolean,       // true only for the representative
 *   duplicateCount: number,
 *   distinctSenderCount: number
 * }|null>}  null when the whatsapp_message_id was already ingested.
 */
async function findOrCreateCluster(msg, client = null) {
  const c = client || await pool.connect();
  const ownsClient = !client;
  try {
    if (ownsClient) await c.query('BEGIN');

    const normalized = normalizeRawText(msg.text);
    if (!normalized || normalized.length < 1) {
      if (ownsClient) await c.query('ROLLBACK');
      return null;
    }
    const hash = exactDedupHash(msg.text);
    const createdAt = msg.createdAt ? new Date(msg.createdAt) : new Date();
    const sender = msg.sender || 'Unknown';
    const senderPhone = msg.senderPhone || null;
    const groupId = msg.groupId || null;

    // 1. Reject if this whatsapp_message_id was already ingested
    if (msg.whatsappMessageId) {
      const dup = await c.query(
        'SELECT id FROM raw_messages WHERE whatsapp_message_id = $1',
        [msg.whatsappMessageId]
      );
      if (dup.rows.length > 0) {
        if (ownsClient) await c.query('ROLLBACK');
        return null;
      }
    }

    // 2. Find existing cluster by hash
    const existing = await c.query(
      'SELECT * FROM raw_clusters WHERE exact_hash = $1 FOR UPDATE',
      [hash]
    );

    let clusterId;
    let isNewCluster;
    let duplicateCount;
    let distinctSenderCount;

    if (existing.rows.length === 0) {
      // 3a. NEW cluster — insert
      const ins = await c.query(
        `INSERT INTO raw_clusters (
           exact_hash, representative_text,
           duplicate_count_exact_raw, distinct_sender_count_exact_raw,
           first_posted_at, first_sender, first_sender_phone,
           all_senders_in_order, all_group_ids, all_raw_message_ids
         ) VALUES (
           $1, $2, 1, 1, $3, $4, $5,
           $6::jsonb, $7::jsonb, '[]'::jsonb
         ) RETURNING id`,
        [
          hash,
          normalized,
          createdAt,
          sender,
          senderPhone,
          JSON.stringify([{ sender, phone: senderPhone, at: createdAt.toISOString(), group_id: groupId }]),
          JSON.stringify(groupId ? [groupId] : []),
        ]
      );
      clusterId = ins.rows[0].id;
      isNewCluster = true;
      duplicateCount = 1;
      distinctSenderCount = 1;
    } else {
      // 3b. EXISTING cluster — append
      const row = existing.rows[0];
      clusterId = row.id;
      const senders = Array.isArray(row.all_senders_in_order) ? row.all_senders_in_order : [];
      const groups = Array.isArray(row.all_group_ids) ? row.all_group_ids : [];
      senders.push({ sender, phone: senderPhone, at: createdAt.toISOString(), group_id: groupId });
      if (groupId && !groups.includes(groupId)) groups.push(groupId);

      const distinctSenderKeys = new Set(senders.map(s => s.phone || s.sender || 'anon'));

      // If this message is earlier than first_posted_at, rotate the representative
      const earlier = row.first_posted_at && createdAt < new Date(row.first_posted_at);

      if (earlier) {
        await c.query(
          `UPDATE raw_clusters SET
             duplicate_count_exact_raw = duplicate_count_exact_raw + 1,
             distinct_sender_count_exact_raw = $2,
             first_posted_at = $3,
             first_sender = $4,
             first_sender_phone = $5,
             all_senders_in_order = $6::jsonb,
             all_group_ids = $7::jsonb,
             updated_at = NOW()
           WHERE id = $1`,
          [
            clusterId,
            distinctSenderKeys.size,
            createdAt,
            sender,
            senderPhone,
            JSON.stringify(senders.sort((a, b) => new Date(a.at) - new Date(b.at))),
            JSON.stringify(groups),
          ]
        );
      } else {
        await c.query(
          `UPDATE raw_clusters SET
             duplicate_count_exact_raw = duplicate_count_exact_raw + 1,
             distinct_sender_count_exact_raw = $2,
             all_senders_in_order = $3::jsonb,
             all_group_ids = $4::jsonb,
             updated_at = NOW()
           WHERE id = $1`,
          [
            clusterId,
            distinctSenderKeys.size,
            JSON.stringify(senders.sort((a, b) => new Date(a.at) - new Date(b.at))),
            JSON.stringify(groups),
          ]
        );
      }

      isNewCluster = false;
      duplicateCount = (row.duplicate_count_exact_raw || 1) + 1;
      distinctSenderCount = distinctSenderKeys.size;
    }

    // 4. Insert raw_messages row (after cluster exists so FK is satisfied)
    const rawIns = await c.query(
      `INSERT INTO raw_messages (
         whatsapp_message_id, cluster_id, sender, sender_phone,
         group_id, group_name, text, source_mode, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (whatsapp_message_id) DO NOTHING
       RETURNING id`,
      [
        msg.whatsappMessageId || null,
        clusterId,
        sender,
        senderPhone,
        groupId,
        msg.groupName || null,
        msg.text,
        msg.sourceMode || 'live',
        createdAt,
      ]
    );

    if (rawIns.rows.length === 0) {
      // Race condition — another insert won. Abort.
      if (ownsClient) await c.query('ROLLBACK');
      return null;
    }
    const rawMessageId = rawIns.rows[0].id;

    // 5. Update all_raw_message_ids + representative_raw_message_id if new/earlier
    if (isNewCluster) {
      await c.query(
        `UPDATE raw_clusters SET
           representative_raw_message_id = $1::int,
           all_raw_message_ids = jsonb_build_array($1::int)
         WHERE id = $2`,
        [rawMessageId, clusterId]
      );
    } else {
      // Append this id to all_raw_message_ids
      await c.query(
        `UPDATE raw_clusters SET
           all_raw_message_ids = COALESCE(all_raw_message_ids, '[]'::jsonb) || to_jsonb($1::int)
         WHERE id = $2`,
        [rawMessageId, clusterId]
      );
      // If this message is now the earliest, rotate representative pointer
      const check = await c.query(
        `SELECT representative_raw_message_id, first_posted_at FROM raw_clusters WHERE id = $1`,
        [clusterId]
      );
      const row = check.rows[0];
      if (row && (!row.representative_raw_message_id || createdAt <= new Date(row.first_posted_at))) {
        await c.query(
          'UPDATE raw_clusters SET representative_raw_message_id = $1 WHERE id = $2',
          [rawMessageId, clusterId]
        );
      }
    }

    if (ownsClient) await c.query('COMMIT');

    return { rawMessageId, clusterId, isNewCluster, duplicateCount, distinctSenderCount };
  } catch (err) {
    if (ownsClient) await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownsClient) c.release();
  }
}

module.exports = { findOrCreateCluster };
