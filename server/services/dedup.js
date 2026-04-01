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

  // Require same neighborhood to prevent false duplicates across different areas
  if (post.neighborhood) {
    conditions.push(`rp.neighborhood = $${idx++}`);
    params.push(post.neighborhood);
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
    const rpPrice = rp.price ? parseFloat(rp.price) : null;
    const postPrice = post.price;

    // Both have prices - must be within 10%
    if (postPrice && rpPrice) {
      const priceDiff = Math.abs(postPrice - rpPrice) / Math.max(postPrice, rpPrice);
      if (priceDiff <= 0.10) return rp;
    }
    // One has price, other doesn't - don't match (likely different properties)
    else if ((postPrice && !rpPrice) || (!postPrice && rpPrice)) {
      continue;
    }
    // Neither has price - only match if same neighborhood confirmed
    else if (!postPrice && !rpPrice) {
      // Additional text similarity check for posts without prices
      if (post.title && rp.title) {
        const similarity = calculateTextSimilarity(post.title, rp.title);
        if (similarity >= 0.7) return rp;
      }
    }
  }

  return null;
}

/**
 * Calculate simple text similarity between two strings (0-1)
 */
function calculateTextSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().replace(/[^\w\s]/g, '');
  const s2 = str2.toLowerCase().replace(/[^\w\s]/g, '');
  const words1 = new Set(s1.split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(s2.split(/\s+/).filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;
  const intersection = [...words1].filter(w => words2.has(w));
  return intersection.length / Math.max(words1.size, words2.size);
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
