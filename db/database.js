const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        name TEXT,
        plan TEXT DEFAULT 'free',
        google_id TEXT,
        microsoft_id TEXT,
        avatar TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        original_content TEXT,
        content_type TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS generated_outputs (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL REFERENCES content_items(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        output_type TEXT NOT NULL,
        generated_content TEXT,
        platform TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('Database tables initialized successfully');
  } finally {
    client.release();
  }
}

const userOps = {
  async create({ email, password, name }) {
    const id = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (id, email, password, name) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, email, hashedPassword, name]
    );
    const user = result.rows[0];
    delete user.password;
    return user;
  },

  async findByEmail(email) {
    const result = await pool.query('SELECT id, email, name, plan, avatar, created_at FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async findById(id) {
    const result = await pool.query('SELECT id, email, name, plan, avatar, created_at FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByIdWithPassword(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async verifyPassword(user, password) {
    const fullUser = await this.findByIdWithPassword(user.id);
    if (!fullUser || !fullUser.password) return false;
    return bcrypt.compare(password, fullUser.password);
  },

  async updatePlan(id, plan) {
    const result = await pool.query(
      'UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, plan, avatar, created_at',
      [plan, id]
    );
    return result.rows[0] || null;
  },

  async updateProfile(id, updates) {
    const fields = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (['name', 'email', 'avatar'].includes(key)) {
        fields.push(key + ' = $' + idx);
        values.push(value);
        idx++;
      }
    }
    if (fields.length === 0) return this.findById(id);
    fields.push('updated_at = NOW()');
    values.push(id);
    const result = await pool.query(
      'UPDATE users SET ' + fields.join(', ') + ' WHERE id = $' + idx + ' RETURNING id, email, name, plan, avatar, created_at',
      values
    );
    return result.rows[0] || null;
  },

  async findOrCreateGoogle({ googleId, email, name, avatar }) {
    let result = await pool.query('SELECT id, email, name, plan, avatar, created_at FROM users WHERE google_id = $1', [googleId]);
    if (result.rows[0]) return result.rows[0];
    result = await pool.query('SELECT id, email, name, plan, avatar, created_at FROM users WHERE email = $1', [email]);
    if (result.rows[0]) {
      await pool.query('UPDATE users SET google_id = $1, avatar = $2, updated_at = NOW() WHERE id = $3', [googleId, avatar, result.rows[0].id]);
      return { ...result.rows[0], avatar };
    }
    const id = crypto.randomUUID();
    result = await pool.query(
      'INSERT INTO users (id, email, name, google_id, avatar) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, plan, avatar, created_at',
      [id, email, name, googleId, avatar]
    );
    return result.rows[0];
  },

  async findOrCreateMicrosoft({ microsoftId, email, name, avatar }) {
    let result = await pool.query('SELECT id, email, name, plan, avatar, created_at FROM users WHERE microsoft_id = $1', [microsoftId]);
    if (result.rows[0]) return result.rows[0];
    result = await pool.query('SELECT id, email, name, plan, avatar, created_at FROM users WHERE email = $1', [email]);
    if (result.rows[0]) {
      await pool.query('UPDATE users SET microsoft_id = $1, avatar = $2, updated_at = NOW() WHERE id = $3', [microsoftId, avatar, result.rows[0].id]);
      return { ...result.rows[0], avatar };
    }
    const id = crypto.randomUUID();
    result = await pool.query(
      'INSERT INTO users (id, email, name, microsoft_id, avatar) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, plan, avatar, created_at',
      [id, email, name, microsoftId, avatar]
    );
    return result.rows[0];
  }
};

const contentOps = {
  async create({ userId, title, originalContent, contentType }) {
    const id = crypto.randomUUID();
    const result = await pool.query(
      'INSERT INTO content_items (id, user_id, title, original_content, content_type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, userId, title, originalContent, contentType]
    );
    return result.rows[0];
  },

  async findById(id) {
    const result = await pool.query('SELECT * FROM content_items WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByUser(userId) {
    const result = await pool.query('SELECT * FROM content_items WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return result.rows;
  },

  async updateStatus(id, status) {
    const result = await pool.query(
      'UPDATE content_items SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    return result.rows[0] || null;
  },

  async countByUser(userId) {
    const result = await pool.query('SELECT COUNT(*) as count FROM content_items WHERE user_id = $1', [userId]);
    return parseInt(result.rows[0].count);
  },

  async delete(id) {
    await pool.query('DELETE FROM generated_outputs WHERE content_id = $1', [id]);
    const result = await pool.query('DELETE FROM content_items WHERE id = $1 RETURNING *', [id]);
    return result.rows[0] || null;
  }
};

const outputOps = {
  async create({ contentId, userId, outputType, generatedContent, platform }) {
    const id = crypto.randomUUID();
    const result = await pool.query(
      'INSERT INTO generated_outputs (id, content_id, user_id, output_type, generated_content, platform) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [id, contentId, userId, outputType, generatedContent, platform]
    );
    return result.rows[0];
  },

  async findById(id) {
    const result = await pool.query('SELECT * FROM generated_outputs WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByContent(contentId) {
    const result = await pool.query('SELECT * FROM generated_outputs WHERE content_id = $1 ORDER BY created_at DESC', [contentId]);
    return result.rows;
  },

  async findByUser(userId) {
    const result = await pool.query('SELECT * FROM generated_outputs WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return result.rows;
  },

  async updateContent(id, content) {
    const result = await pool.query(
      'UPDATE generated_outputs SET generated_content = $1 WHERE id = $2 RETURNING *',
      [content, id]
    );
    return result.rows[0] || null;
  }
};

const contactOps = {
  async create({ name, email, subject, message }) {
    const id = crypto.randomUUID();
    const result = await pool.query(
      'INSERT INTO contact_messages (id, name, email, subject, message) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, name, email, subject, message]
    );
    return result.rows[0];
  },

  async findAll() {
    const result = await pool.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
    return result.rows;
  }
};

module.exports = {
  initializeDatabase,
  getDb: () => pool,
  userOps,
  contentOps,
  outputOps,
  contactOps
};
