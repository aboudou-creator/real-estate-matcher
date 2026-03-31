const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PG_USER || process.env.USER,
  host: process.env.PG_HOST || 'localhost',
  database: process.env.PG_DATABASE || 'real_estate_matcher',
  password: process.env.PG_PASSWORD || '',
  port: process.env.PG_PORT || 5432,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS real_products (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('offer', 'demand')),
        category VARCHAR(30) NOT NULL CHECK (category IN ('apartment', 'house', 'ground', 'agricultural_ground')),
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
        category VARCHAR(30) NOT NULL CHECK (category IN ('apartment', 'house', 'ground', 'agricultural_ground')),
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
    `);
    console.log('PostgreSQL: products, matches, duplicates tables ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
