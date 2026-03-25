const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'repurposeai.db');

let db = null;
let SQL = null;

async function getDb() {
  if (db) return db;

  SQL = await initSqlJs();

  try {
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  } catch {
    db = new SQL.Database();
  }

  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

async function initializeDatabase() {
  const db = await getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      plan TEXT DEFAULT 'starter',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      avatar_color TEXT DEFAULT '#7c3aed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_content TEXT,
      source_url TEXT,
      status TEXT DEFAULT 'processing',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS generated_outputs (
      id TEXT PRIMARY KEY,
      content_item_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      format TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      scheduled_at DATETIME,
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (content_item_id) REFERENCES content_items(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDb();
  console.log('Database initialized successfully');
}

// Helper to run a query and get all rows as objects
function allRows(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper to get one row
function oneRow(sql, params = []) {
  const rows = allRows(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper to run a statement (INSERT/UPDATE/DELETE)
function runStmt(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// User operations
const userOps = {
  create(email, password, name) {
    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 12);
    const colors = ['#7c3aed', '#06b6d4', '#f472b6', '#f59e0b', '#34d399', '#ef4444'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    runStmt(
      `INSERT INTO users (id, email, password_hash, name, avatar_color) VALUES (?, ?, ?, ?, ?)`,
      [id, email.toLowerCase(), passwordHash, name, avatarColor]
    );
    return userOps.findById(id);
  },

  findByEmail(email) {
    return oneRow('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  },

  findById(id) {
    const user = oneRow('SELECT * FROM users WHERE id = ?', [id]);
    if (user) {
      const { password_hash, ...safeUser } = user;
      return safeUser;
    }
    return null;
  },

  findByIdWithPassword(id) {
    return oneRow('SELECT * FROM users WHERE id = ?', [id]);
  },

  verifyPassword(user, password) {
    return bcrypt.compareSync(password, user.password_hash);
  },

  updatePlan(userId, plan, stripeCustomerId, stripeSubscriptionId) {
    runStmt(
      `UPDATE users SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [plan, stripeCustomerId, stripeSubscriptionId, userId]
    );
    return userOps.findById(userId);
  },

  updateProfile(userId, name) {
    runStmt('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, userId]);
    return userOps.findById(userId);
  }
};

// Content operations
const contentOps = {
  create(userId, title, sourceType, sourceContent, sourceUrl) {
    const id = uuidv4();
    runStmt(
      `INSERT INTO content_items (id, user_id, title, source_type, source_content, source_url) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, title, sourceType, sourceContent || null, sourceUrl || null]
    );
    return contentOps.findById(id);
  },

  findById(id) {
    return oneRow('SELECT * FROM content_items WHERE id = ?', [id]);
  },

  findByUser(userId, limit = 20, offset = 0) {
    return allRows('SELECT * FROM content_items WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [userId, limit, offset]);
  },

  updateStatus(id, status) {
    runStmt('UPDATE content_items SET status = ? WHERE id = ?', [status, id]);
  },

  countByUser(userId) {
    const row = oneRow('SELECT COUNT(*) as count FROM content_items WHERE user_id = ?', [userId]);
    return row ? row.count : 0;
  },

  delete(id, userId) {
    runStmt('DELETE FROM generated_outputs WHERE content_item_id = ? AND user_id = ?', [id, userId]);
    runStmt('DELETE FROM content_items WHERE id = ? AND user_id = ?', [id, userId]);
  }
};

// Output operations
const outputOps = {
  create(contentItemId, userId, platform, format, content) {
    const id = uuidv4();
    runStmt(
      `INSERT INTO generated_outputs (id, content_item_id, user_id, platform, format, content) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, contentItemId, userId, platform, format, content]
    );
    return outputOps.findById(id);
  },

  findById(id) {
    return oneRow('SELECT * FROM generated_outputs WHERE id = ?', [id]);
  },

  findByContent(contentItemId) {
    return allRows('SELECT * FROM generated_outputs WHERE content_item_id = ? ORDER BY created_at DESC', [contentItemId]);
  },

  findByUser(userId, limit = 50) {
    return allRows(
      `SELECT go.*, ci.title as source_title FROM generated_outputs go JOIN content_items ci ON go.content_item_id = ci.id WHERE go.user_id = ? ORDER BY go.created_at DESC LIMIT ?`,
      [userId, limit]
    );
  },

  updateContent(id, userId, content) {
    runStmt('UPDATE generated_outputs SET content = ? WHERE id = ? AND user_id = ?', [content, id, userId]);
  },

  updateStatus(id, userId, status) {
    runStmt('UPDATE generated_outputs SET status = ? WHERE id = ? AND user_id = ?', [status, id, userId]);
  },

  countByUser(userId) {
    const row = oneRow('SELECT COUNT(*) as count FROM generated_outputs WHERE user_id = ?', [userId]);
    return row ? row.count : 0;
  },

  getStats(userId) {
    const total = (oneRow('SELECT COUNT(*) as count FROM generated_outputs WHERE user_id = ?', [userId]) || {}).count || 0;
    const published = (oneRow("SELECT COUNT(*) as count FROM generated_outputs WHERE user_id = ? AND status = 'published'", [userId]) || {}).count || 0;
    const drafts = (oneRow("SELECT COUNT(*) as count FROM generated_outputs WHERE user_id = ? AND status = 'draft'", [userId]) || {}).count || 0;
    const platforms = allRows('SELECT DISTINCT platform FROM generated_outputs WHERE user_id = ?', [userId]);
    return { total, published, drafts, platforms: platforms.map(p => p.platform) };
  }
};

// Contact operations
const contactOps = {
  create(name, email, subject, message) {
    const id = uuidv4();
    runStmt(
      `INSERT INTO contact_messages (id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)`,
      [id, name, email, subject, message]
    );
    return { id, name, email, subject, message };
  }
};

module.exports = { initializeDatabase, getDb, userOps, contentOps, outputOps, contactOps };
