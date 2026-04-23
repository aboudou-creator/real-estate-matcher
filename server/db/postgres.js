const { Pool } = require('pg');

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      user: process.env.PG_USER || process.env.USER,
      host: process.env.PG_HOST || 'localhost',
      database: process.env.PG_DATABASE || 'real_estate_matcher',
      password: process.env.PG_PASSWORD || '',
      port: process.env.PG_PORT || 5432,
    };

const pool = new Pool(poolConfig);

// ─── Schema v3 — dedup-first pipeline ───────────────────────────────────────
// On first boot of this version we DROP the legacy v2 tables (products,
// real_products, matches, duplicates, raw_message_segments) and rebuild from
// scratch per the new plan (user confirmed "flush & rebuild").

const SCHEMA_VERSION = '3.0.0';

async function initDB() {
  const client = await pool.connect();
  try {
    // 1. Schema version tracker
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    const versionRow = await client.query(
      `SELECT value FROM schema_meta WHERE key = 'schema_version'`
    );
    const currentVersion = versionRow.rows[0]?.value || null;

    if (currentVersion !== SCHEMA_VERSION) {
      console.log(`PostgreSQL: migrating ${currentVersion || 'legacy'} → ${SCHEMA_VERSION} (drop + rebuild)`);

      // Drop legacy + previous v3 tables (CASCADE handles FK dependencies)
      await client.query(`
        DROP TABLE IF EXISTS match_links CASCADE;
        DROP TABLE IF EXISTS matches CASCADE;
        DROP TABLE IF EXISTS duplicates CASCADE;
        DROP TABLE IF EXISTS listings CASCADE;
        DROP TABLE IF EXISTS products CASCADE;
        DROP TABLE IF EXISTS real_products CASCADE;
        DROP TABLE IF EXISTS raw_message_segments CASCADE;
        DROP TABLE IF EXISTS raw_messages CASCADE;
        DROP TABLE IF EXISTS raw_clusters CASCADE;
      `);

      // 2. raw_clusters — one row per unique normalized raw text
      await client.query(`
        CREATE TABLE raw_clusters (
          id SERIAL PRIMARY KEY,
          exact_hash CHAR(40) UNIQUE NOT NULL,
          representative_raw_message_id INTEGER,
          representative_text TEXT NOT NULL,
          duplicate_count_exact_raw INTEGER NOT NULL DEFAULT 1,
          distinct_sender_count_exact_raw INTEGER NOT NULL DEFAULT 1,
          first_posted_at TIMESTAMP WITH TIME ZONE,
          first_sender VARCHAR(255),
          first_sender_phone VARCHAR(50),
          all_senders_in_order JSONB NOT NULL DEFAULT '[]'::jsonb,
          all_group_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          all_raw_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          is_real_estate BOOLEAN,
          real_estate_score DOUBLE PRECISION,
          real_estate_reasons JSONB,
          type_final VARCHAR(20),
          type_confidence DOUBLE PRECISION,
          offer_score DOUBLE PRECISION,
          demand_score DOUBLE PRECISION,
          offer_signal_hits JSONB,
          demand_signal_hits JSONB,
          demand_false_positive_hits JSONB,
          listing_signal_hits JSONB,
          conflict_flags JSONB,
          type_reason_summary TEXT,
          parser_version VARCHAR(20),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX idx_raw_clusters_type ON raw_clusters(type_final);
        CREATE INDEX idx_raw_clusters_is_re ON raw_clusters(is_real_estate);
        CREATE INDEX idx_raw_clusters_first_posted ON raw_clusters(first_posted_at DESC);
      `);

      // 3. raw_messages — every WhatsApp event, points at its cluster
      await client.query(`
        CREATE TABLE raw_messages (
          id SERIAL PRIMARY KEY,
          whatsapp_message_id VARCHAR(255) UNIQUE,
          cluster_id INTEGER REFERENCES raw_clusters(id) ON DELETE CASCADE,
          sender VARCHAR(255),
          sender_phone VARCHAR(50),
          group_id VARCHAR(255),
          group_name VARCHAR(255),
          text TEXT NOT NULL,
          source_mode VARCHAR(30) DEFAULT 'live',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX idx_raw_messages_cluster ON raw_messages(cluster_id);
        CREATE INDEX idx_raw_messages_created ON raw_messages(created_at DESC);
        CREATE INDEX idx_raw_messages_group ON raw_messages(group_id);
      `);

      // 4. listings — structured output of the extractor (one per real-estate cluster)
      await client.query(`
        CREATE TABLE listings (
          id SERIAL PRIMARY KEY,
          cluster_id INTEGER UNIQUE REFERENCES raw_clusters(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          category VARCHAR(30) NOT NULL,
          transaction_type VARCHAR(10) NOT NULL,
          type VARCHAR(20) NOT NULL,
          price_amount NUMERIC(15, 2),
          currency VARCHAR(10) DEFAULT 'XOF',
          price_kind VARCHAR(20),
          conditions_months INTEGER,
          raw_price_match TEXT,
          price_confidence DOUBLE PRECISION,
          price_reason TEXT,
          city VARCHAR(100),
          neighborhood VARCHAR(150),
          zone VARCHAR(100),
          location_confidence DOUBLE PRECISION,
          preferred_locations JSONB,
          bedrooms INTEGER,
          area NUMERIC(10, 2),
          phone VARCHAR(50),
          parser_version VARCHAR(20),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX idx_listings_type ON listings(type);
        CREATE INDEX idx_listings_category ON listings(category);
        CREATE INDEX idx_listings_tx ON listings(transaction_type);
        CREATE INDEX idx_listings_city ON listings(city);
        CREATE INDEX idx_listings_neighborhood ON listings(neighborhood);
      `);

      // 5. match_links — offer ↔ demand pairs with weighted breakdown
      await client.query(`
        CREATE TABLE match_links (
          id SERIAL PRIMARY KEY,
          offer_listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          demand_listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          score DOUBLE PRECISION NOT NULL,
          breakdown JSONB NOT NULL,
          reasons JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE (offer_listing_id, demand_listing_id)
        );
        CREATE INDEX idx_match_links_score ON match_links(score DESC);
        CREATE INDEX idx_match_links_offer ON match_links(offer_listing_id);
        CREATE INDEX idx_match_links_demand ON match_links(demand_listing_id);
      `);

      await client.query(
        `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [SCHEMA_VERSION]
      );
    }

    console.log(`PostgreSQL: schema ${SCHEMA_VERSION} ready (raw_clusters, raw_messages, listings, match_links)`);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
