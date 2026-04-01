// ─── PostgreSQL-based duplicate detection ────────────────────────────────────
// When a new raw post arrives, check if it matches an existing real_product.
// If so, link it as a duplicate; otherwise, create a new real_product.

const { pool } = require('../db/postgres');

/**
 * Find a matching real_product for an incoming post.
 * Criteria: same category, same transaction_type, same city,
 * similar price (≤10%), same bedrooms (if applicable).
 * Returns the real_product row or null.
 */
async function findMatchingRealProduct(post) {
  const conditions = ['rp.category = $1', 'rp.transaction_type = $2', 'rp.type = $3'];
  const params = [post.category, post.transaction_type, post.type];
  let idx = 4;

  if (post.city) {
    conditions.push(`rp.city = $${idx++}`);
    params.push(post.city);
  }

  if (post.bedrooms != null) {
    conditions.push(`rp.bedrooms = $${idx++}`);
    params.push(post.bedrooms);
  }

  const where = conditions.join(' AND ');
  const result = await pool.query(
    `SELECT * FROM real_products rp WHERE ${where} ORDER BY created_at DESC`,
    params
  );

  if (result.rows.length === 0) return null;

  // Among candidates, find the one with closest price
  for (const rp of result.rows) {
    if (post.price && rp.price) {
      const priceDiff = Math.abs(post.price - parseFloat(rp.price)) / Math.max(post.price, parseFloat(rp.price));
      if (priceDiff <= 0.10) return rp; // ≤10% price difference → same product
    } else if (!post.price && !rp.price) {
      return rp; // both have no price, other criteria match
    }
  }

  return null;
}

/**
 * Process a new raw post: find or create a real_product, insert the raw post,
 * and update duplicate links.
 * Returns { rawPost, realProduct, isDuplicate }
 */
async function processNewPost(postData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check if this WhatsApp message was already processed
    if (postData.whatsapp_message_id) {
      const existing = await client.query(
        'SELECT id FROM products WHERE whatsapp_message_id = $1',
        [postData.whatsapp_message_id]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return null; // already processed
      }
    }

    // 2. Find matching real_product
    const matchingRP = await findMatchingRealProduct(postData);
    let realProductId;
    let isDuplicate = false;

    if (matchingRP) {
      // Link to existing real_product
      realProductId = matchingRP.id;
      isDuplicate = true;

      // Increment post_count
      await client.query(
        'UPDATE real_products SET post_count = post_count + 1 WHERE id = $1',
        [realProductId]
      );
    } else {
      // Create new real_product
      const rpResult = await client.query(
        `INSERT INTO real_products (
          title, type, category, transaction_type,
          price, currency, city, neighborhood, zone,
          latitude, longitude, bedrooms, bathrooms, area, post_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1)
        RETURNING id`,
        [
          postData.title, postData.type, postData.category, postData.transaction_type,
          postData.price, postData.currency || 'XOF', postData.city, postData.neighborhood,
          postData.zone || null,
          postData.latitude, postData.longitude, postData.bedrooms, postData.bathrooms, postData.area,
        ]
      );
      realProductId = rpResult.rows[0].id;
    }

    // 3. Insert raw post
    const postResult = await client.query(
      `INSERT INTO products (
        real_product_id, title, description, type, category, transaction_type,
        price, currency, location, city, neighborhood,
        latitude, longitude, bedrooms, bathrooms, area,
        sender, phone, whatsapp_message_id, group_id, group_name, is_duplicate
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *`,
      [
        realProductId,
        postData.title, postData.description, postData.type, postData.category, postData.transaction_type,
        postData.price, postData.currency || 'XOF',
        postData.neighborhood && postData.city ? `${postData.neighborhood}, ${postData.city}` : postData.city || postData.neighborhood || null,
        postData.city, postData.neighborhood,
        postData.latitude, postData.longitude, postData.bedrooms, postData.bathrooms, postData.area,
        postData.sender, postData.phone, postData.whatsapp_message_id, postData.group_id,
        postData.group_name || null,
        isDuplicate,
      ]
    );

    // 4. If duplicate, insert into duplicates table
    if (isDuplicate) {
      // Find the original (first) post for this real_product
      const origPost = await client.query(
        'SELECT id FROM products WHERE real_product_id = $1 AND is_duplicate = false ORDER BY created_at ASC LIMIT 1',
        [realProductId]
      );
      if (origPost.rows.length > 0) {
        await client.query(
          'INSERT INTO duplicates (original_id, duplicate_id, similarity) VALUES ($1, $2, $3)',
          [origPost.rows[0].id, postResult.rows[0].id, 0.9]
        );
      }
    }

    await client.query('COMMIT');

    return {
      rawPost: postResult.rows[0],
      realProductId,
      isDuplicate,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { findMatchingRealProduct, processNewPost };
