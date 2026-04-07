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

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS real_products (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('offer', 'demand')),
        category VARCHAR(30) NOT NULL,
        transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('sale', 'rent')),
        price NUMERIC(15, 2),
        currency VARCHAR(10) DEFAULT 'XOF',
        city VARCHAR(100),
        neighborhood VARCHAR(150),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        bedrooms INTEGER,
        bathrooms INTEGER,
        area NUMERIC(10, 2),
        post_count INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_real_products_category ON real_products(category);
      CREATE INDEX IF NOT EXISTS idx_real_products_city ON real_products(city);

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        real_product_id INTEGER REFERENCES real_products(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(20) NOT NULL CHECK (type IN ('offer', 'demand')),
        category VARCHAR(30) NOT NULL,
        transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('sale', 'rent')),
        price NUMERIC(15, 2),
        currency VARCHAR(10) DEFAULT 'XOF',
        location VARCHAR(255),
        city VARCHAR(100),
        neighborhood VARCHAR(150),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        bedrooms INTEGER,
        bathrooms INTEGER,
        area NUMERIC(10, 2),
        sender VARCHAR(255),
        phone VARCHAR(50),
        whatsapp_message_id VARCHAR(255),
        group_id VARCHAR(255),
        group_name VARCHAR(255),
        is_duplicate BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_wa_msg ON products(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
      CREATE INDEX IF NOT EXISTS idx_products_city ON products(city);
      CREATE INDEX IF NOT EXISTS idx_products_location ON products(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_products_real_product ON products(real_product_id);

      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        product1_id INTEGER REFERENCES real_products(id) ON DELETE CASCADE,
        product2_id INTEGER REFERENCES real_products(id) ON DELETE CASCADE,
        score DOUBLE PRECISION NOT NULL,
        match_type VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_matches_score ON matches(score DESC);

      CREATE TABLE IF NOT EXISTS duplicates (
        id SERIAL PRIMARY KEY,
        original_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        duplicate_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        similarity DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS raw_messages (
        id SERIAL PRIMARY KEY,
        whatsapp_message_id VARCHAR(255) UNIQUE,
        sender VARCHAR(255),
        sender_phone VARCHAR(50),
        group_id VARCHAR(255),
        group_name VARCHAR(255),
        text TEXT NOT NULL,
        is_real_estate BOOLEAN DEFAULT FALSE,
        processed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_raw_messages_created ON raw_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_raw_messages_group ON raw_messages(group_id);
    `);
    // Migrations for existing DBs
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS group_name VARCHAR(255);
      ALTER TABLE real_products DROP CONSTRAINT IF EXISTS real_products_category_check;
      ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;
      ALTER TABLE real_products ADD COLUMN IF NOT EXISTS zone VARCHAR(100);
      ALTER TABLE real_products ADD COLUMN IF NOT EXISTS toilets INTEGER;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS toilets INTEGER;

      ALTER TABLE raw_messages ADD COLUMN IF NOT EXISTS parser_version VARCHAR(20);
      ALTER TABLE raw_messages ADD COLUMN IF NOT EXISTS classification_status VARCHAR(20) DEFAULT 'pending';
      ALTER TABLE raw_messages ADD COLUMN IF NOT EXISTS classification_confidence DOUBLE PRECISION;
      ALTER TABLE raw_messages ADD COLUMN IF NOT EXISTS classification_reasons TEXT;
      ALTER TABLE raw_messages ADD COLUMN IF NOT EXISTS source_mode VARCHAR(30) DEFAULT 'live';
      ALTER TABLE raw_messages ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR(100);
      ALTER TABLE raw_messages ADD COLUMN IF NOT EXISTS segment_count INTEGER DEFAULT 0;

      ALTER TABLE products ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS reason_codes TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS raw_message_id INTEGER;

      CREATE TABLE IF NOT EXISTS raw_message_segments (
        id SERIAL PRIMARY KEY,
        raw_message_id INTEGER REFERENCES raw_messages(id) ON DELETE CASCADE,
        segment_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        is_real_estate BOOLEAN DEFAULT FALSE,
        confidence DOUBLE PRECISION,
        reason_codes TEXT,
        extracted_data JSONB,
        parser_version VARCHAR(20),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_segments_raw_msg ON raw_message_segments(raw_message_id);
      CREATE INDEX IF NOT EXISTS idx_segments_real_estate ON raw_message_segments(is_real_estate);
    `).catch(() => {});

    console.log('PostgreSQL: all tables ready (products, matches, duplicates, raw_messages, segments)');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
