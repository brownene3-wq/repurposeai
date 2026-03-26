const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

let pool;

const initDatabase = async () => {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/content_repurpose'
  });

  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        password_hash TEXT,
        google_id TEXT,
        plan TEXT DEFAULT 'free',
        stripe_customer_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migrate: add columns that may not exist on older tables
    const migrations = [
      // Users table migrations
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`,
      // Content items table migrations
      `ALTER TABLE content_items ADD COLUMN IF NOT EXISTS original_content TEXT`,
      `ALTER TABLE content_items ADD COLUMN IF NOT EXISTS content_type TEXT`,
      `ALTER TABLE content_items ADD COLUMN IF NOT EXISTS source_url TEXT`,
      `ALTER TABLE content_items ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'`,
      `ALTER TABLE content_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
      // Generated outputs table migrations
      `ALTER TABLE generated_outputs ADD COLUMN IF NOT EXISTS user_id TEXT`,
      `ALTER TABLE generated_outputs ADD COLUMN IF NOT EXISTS output_type TEXT`,
      `ALTER TABLE generated_outputs ADD COLUMN IF NOT EXISTS generated_content TEXT`,
      `ALTER TABLE generated_outputs ADD COLUMN IF NOT EXISTS platform TEXT`,
      `ALTER TABLE generated_outputs ADD COLUMN IF NOT EXISTS tone TEXT`,
      `ALTER TABLE generated_outputs ADD COLUMN IF NOT EXISTS character_count INTEGER`,
      // Brand voices table migrations
      `ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS description TEXT`,
      `ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS example_content TEXT`,
      `ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS tone TEXT`,
      `ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false`,
    ];
    for (const sql of migrations) {
      try { await pool.query(sql); } catch (e) { /* table or column may not exist yet */ }
    }

    // Content items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        original_content TEXT,
        content_type TEXT,
        source_url TEXT,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Generated outputs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_outputs (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        output_type TEXT,
        generated_content TEXT,
        platform TEXT,
        tone TEXT,
        character_count INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Brand voices table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brand_voices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        example_content TEXT,
        tone TEXT,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Contact messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
};

const getDb = () => pool;

// User operations
const userOps = {
  async create(email, name, passwordHash) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO users (id, email, name, password_hash, plan) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, email, name, passwordHash, 'free']
    );
    return result.rows[0];
  },

  async getByEmail(email) {
    const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    return result.rows[0];
  },

  async getById(id) {
    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return result.rows[0];
  },

  async getByGoogleId(googleId) {
    const result = await pool.query(`SELECT * FROM users WHERE google_id = $1`, [googleId]);
    return result.rows[0];
  },

  async createFromGoogle(googleId, email, name) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, googleId, email, name, 'free']
    );
    return result.rows[0];
  },

  async updatePlan(userId, plan) {
    const result = await pool.query(
      `UPDATE users SET plan = $1 WHERE id = $2 RETURNING *`,
      [plan, userId]
    );
    return result.rows[0];
  },

  async updateStripeCustomerId(userId, stripeCustomerId) {
    const result = await pool.query(
      `UPDATE users SET stripe_customer_id = $1 WHERE id = $2 RETURNING *`,
      [stripeCustomerId, userId]
    );
    return result.rows[0];
  }
};

// Content operations
const contentOps = {
  async create(userId, title, originalContent, contentType, sourceUrl = null) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO content_items (id, user_id, title, original_content, content_type, source_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, userId, title, originalContent, contentType, sourceUrl, 'draft']
    );
    return result.rows[0];
  },

  async getByUserId(userId, limit = 20, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM content_items WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  },

  async getById(contentId) {
    const result = await pool.query(
      `SELECT * FROM content_items WHERE id = $1`,
      [contentId]
    );
    return result.rows[0];
  },

  async updateStatus(contentId, status) {
    const result = await pool.query(
      `UPDATE content_items SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [status, contentId]
    );
    return result.rows[0];
  },

  async delete(contentId) {
    const result = await pool.query(
      `DELETE FROM content_items WHERE id = $1 RETURNING *`,
      [contentId]
    );
    return result.rows[0];
  },

  async countByUserId(userId) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM content_items WHERE user_id = $1`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  },

  async countByUserIdThisMonth(userId) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM content_items WHERE user_id = $1 AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  },

  async getByDateRange(userId, startDate, endDate) {
    const result = await pool.query(
      `SELECT * FROM content_items WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at DESC`,
      [userId, startDate, endDate]
    );
    return result.rows;
  }
};

// Output operations
const outputOps = {
  async create(contentId, userId, outputType, generatedContent, platform, tone) {
    const id = uuidv4();
    const characterCount = generatedContent.length;
    const result = await pool.query(
      `INSERT INTO generated_outputs (id, content_id, user_id, output_type, generated_content, platform, tone, character_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, contentId, userId, outputType, generatedContent, platform, tone, characterCount]
    );
    return result.rows[0];
  },

  async getByContentId(contentId) {
    const result = await pool.query(
      `SELECT * FROM generated_outputs WHERE content_id = $1 ORDER BY created_at DESC`,
      [contentId]
    );
    return result.rows;
  },

  async getByUserId(userId, limit = 20, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM generated_outputs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  },

  async getByPlatform(userId, platform) {
    const result = await pool.query(
      `SELECT * FROM generated_outputs WHERE user_id = $1 AND platform = $2 ORDER BY created_at DESC`,
      [userId, platform]
    );
    return result.rows;
  },

  async getByPlatformForUser(userId, platform, limit = 10, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM generated_outputs WHERE user_id = $1 AND platform = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [userId, platform, limit, offset]
    );
    return result.rows;
  },

  async countByUserId(userId) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM generated_outputs WHERE user_id = $1`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  },

  async countByPlatformForUser(userId, platform) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM generated_outputs WHERE user_id = $1 AND platform = $2`,
      [userId, platform]
    );
    return parseInt(result.rows[0].count, 10);
  },

  async updateById(outputId, generatedContent) {
    const characterCount = generatedContent.length;
    const result = await pool.query(
      `UPDATE generated_outputs SET generated_content = $1, character_count = $2 WHERE id = $3 RETURNING *`,
      [generatedContent, characterCount, outputId]
    );
    return result.rows[0];
  },

  async deleteById(outputId) {
    const result = await pool.query(
      `DELETE FROM generated_outputs WHERE id = $1 RETURNING *`,
      [outputId]
    );
    return result.rows[0];
  }
};

// Brand voice operations
const brandVoiceOps = {
  async create(userId, name, description, exampleContent, tone) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO brand_voices (id, user_id, name, description, example_content, tone, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, userId, name, description, exampleContent, tone, false]
    );
    return result.rows[0];
  },

  async getByUserId(userId) {
    const result = await pool.query(
      `SELECT * FROM brand_voices WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    return result.rows;
  },

  async getById(voiceId) {
    const result = await pool.query(
      `SELECT * FROM brand_voices WHERE id = $1`,
      [voiceId]
    );
    return result.rows[0];
  },

  async getDefault(userId) {
    const result = await pool.query(
      `SELECT * FROM brand_voices WHERE user_id = $1 AND is_default = true`,
      [userId]
    );
    return result.rows[0];
  },

  async update(voiceId, name, description, exampleContent, tone) {
    const result = await pool.query(
      `UPDATE brand_voices SET name = $1, description = $2, example_content = $3, tone = $4 WHERE id = $5 RETURNING *`,
      [name, description, exampleContent, tone, voiceId]
    );
    return result.rows[0];
  },

  async setDefault(voiceId, userId) {
    // First, clear all defaults for this user
    await pool.query(
      `UPDATE brand_voices SET is_default = false WHERE user_id = $1`,
      [userId]
    );
    // Then set the new default
    const result = await pool.query(
      `UPDATE brand_voices SET is_default = true WHERE id = $1 RETURNING *`,
      [voiceId]
    );
    return result.rows[0];
  },

  async delete(voiceId) {
    const result = await pool.query(
      `DELETE FROM brand_voices WHERE id = $1 RETURNING *`,
      [voiceId]
    );
    return result.rows[0];
  }
};

// Contact operations
const contactOps = {
  async create(name, email, subject, message) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO contact_messages (id, name, email, subject, message) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, name, email, subject, message]
    );
    return result.rows[0];
  },

  async getAll(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  },

  async getById(messageId) {
    const result = await pool.query(
      `SELECT * FROM contact_messages WHERE id = $1`,
      [messageId]
    );
    return result.rows[0];
  }
};

module.exports = {
  initDatabase,
  getDb,
  userOps,
  contentOps,
  outputOps,
  brandVoiceOps,
  contactOps
};
