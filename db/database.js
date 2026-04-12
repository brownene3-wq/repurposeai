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
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0`,
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
      // Brand kits - ElevenLabs integration
      `ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT DEFAULT ''`,
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

    // Smart Shorts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS smart_shorts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        video_url TEXT NOT NULL,
        video_title TEXT,
        transcript TEXT,
        moments TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Brand kit table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brand_kits (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        brand_name TEXT DEFAULT '',
        watermark_text TEXT DEFAULT '',
        primary_color TEXT DEFAULT '#FF0050',
        secondary_color TEXT DEFAULT '#6c5ce7',
        font_style TEXT DEFAULT 'modern',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Content calendar entries
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calendar_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        platform TEXT DEFAULT 'tiktok',
        scheduled_date DATE NOT NULL,
        scheduled_time TEXT DEFAULT '12:00',
        status TEXT DEFAULT 'planned',
        content_text TEXT DEFAULT '',
        analysis_id TEXT,
        moment_index INTEGER,
        notes TEXT DEFAULT '',
        color TEXT DEFAULT '#6c5ce7',
        reminder_email TEXT DEFAULT '',
        reminder_minutes INTEGER DEFAULT 0,
        reminder_sent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Migrations for existing tables
    try {
      await pool.query('ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS reminder_email TEXT DEFAULT \'\'');
      await pool.query('ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER DEFAULT 0');
      await pool.query('ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE');
    } catch (migErr) {
      console.log('Calendar migration (may already exist):', migErr.message);
    }

    // Admin role column on users
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`);
    } catch (e) { /* already exists */ }

    // Page editor access permission (only specific users can edit pages)
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_pages BOOLEAN DEFAULT FALSE`);
    } catch (e) { /* already exists */ }

    // Blog posts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        excerpt TEXT DEFAULT '',
        content TEXT DEFAULT '',
        cover_image TEXT DEFAULT '',
        tag TEXT DEFAULT 'General',
        status TEXT DEFAULT 'draft',
        author_name TEXT DEFAULT '',
        published_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Add author_name column if it doesn't exist (migration)
    await pool.query(`
      ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author_name TEXT DEFAULT ''
    `).catch(() => {});

    // Bug reports table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bug_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        user_email TEXT,
        category TEXT DEFAULT 'bug',
        page TEXT DEFAULT '',
        description TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        admin_notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      )
    `);

    // Team invitations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_invitations (
        id TEXT PRIMARY KEY,
        invited_by TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT DEFAULT 'editor',
        permissions TEXT DEFAULT '{}',
        status TEXT DEFAULT 'pending',
        token TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Team members table (accepted invitations)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        added_by TEXT NOT NULL,
        role TEXT DEFAULT 'editor',
        permissions TEXT DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    
    // Add read/unread and response tracking columns
    await pool.query(`ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false`).catch(() => {});
    await pool.query(`ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP`).catch(() => {});
    await pool.query(`ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false`).catch(() => {});
    await pool.query(`ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP`).catch(() => {});

    // Login tracking columns
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0`).catch(() => {});

    // Page content table (visual page editor)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS page_content (
        id TEXT PRIMARY KEY,
        page_slug TEXT NOT NULL,
        content_html TEXT,
        content_css TEXT,
        content_components TEXT,
        content_style TEXT,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_page_content_slug_status ON page_content(page_slug, status)`).catch(() => {});

    // User settings table (preferences)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        -- Notification preferences
        email_processing_complete BOOLEAN DEFAULT true,
        email_weekly_summary BOOLEAN DEFAULT false,
        email_product_updates BOOLEAN DEFAULT true,
        email_tips_tutorials BOOLEAN DEFAULT false,
        -- Export defaults
        default_video_quality TEXT DEFAULT '1080p',
        default_video_format TEXT DEFAULT 'mp4',
        default_aspect_ratio TEXT DEFAULT '16:9',
        -- Caption defaults
        default_caption_style TEXT DEFAULT 'bold-pop',
        default_caption_language TEXT DEFAULT 'en',
        auto_generate_captions BOOLEAN DEFAULT true,
        -- Appearance
        theme TEXT DEFAULT 'dark',
        compact_sidebar BOOLEAN DEFAULT false,
        -- Language & Region
        language TEXT DEFAULT 'en',
        timezone TEXT DEFAULT 'UTC',
        -- Privacy
        share_usage_analytics BOOLEAN DEFAULT true,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Feature usage tracking for admin analytics
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feature_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        feature TEXT NOT NULL,
        metadata TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feature_usage_user ON feature_usage(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feature_usage_feature ON feature_usage(feature)`);

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
  },

  async updatePassword(userId, passwordHash) {
    const result = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *`,
      [passwordHash, userId]
    );
    return result.rows[0];
  },

  async updateName(userId, name) {
    const result = await pool.query(
      `UPDATE users SET name = $1 WHERE id = $2 RETURNING *`,
      [name, userId]
    );
    return result.rows[0];
  },

  async trackLogin(userId) {
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, login_count = COALESCE(login_count, 0) + 1 WHERE id = $1', [userId]);
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
,
  async markAsRead(id) {
    await pool.query('UPDATE contact_messages SET is_read = true WHERE id = $1', [id]);
  },
  async markAsResponded(id) {
    await pool.query('UPDATE contact_messages SET responded_at = CURRENT_TIMESTAMP WHERE id = $1 AND responded_at IS NULL', [id]);
  }
};

// Smart Shorts operations
const shortsOps = {
  async create(userId, videoUrl, videoTitle, transcript) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO smart_shorts (id, user_id, video_url, video_title, transcript, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, userId, videoUrl, videoTitle, transcript, 'pending']
    );
    return result.rows[0]?.id || id;
  },
  async updateMoments(id, moments) {
    const result = await pool.query(
      `UPDATE smart_shorts SET moments = $1, status = 'completed' WHERE id = $2 RETURNING *`,
      [JSON.stringify(moments), id]
    );
    return result.rows[0];
  },
  async updateStatus(id, status) {
    const result = await pool.query(
      `UPDATE smart_shorts SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return result.rows[0];
  },
  async getByUserId(userId, limit = 20, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM smart_shorts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  },
  async getById(id) {
    const result = await pool.query(`SELECT * FROM smart_shorts WHERE id = $1`, [id]);
    return result.rows[0];
  },
  async delete(id) {
    const result = await pool.query(`DELETE FROM smart_shorts WHERE id = $1 RETURNING *`, [id]);
    return result.rows[0];
  },
  async countByUserId(userId) {
    const result = await pool.query(`SELECT COUNT(*) FROM smart_shorts WHERE user_id = $1`, [userId]);
    return parseInt(result.rows[0].count, 10);
  }
};

// Brand kit operations
const brandKitOps = {
  async getByUserId(userId) {
    const result = await pool.query('SELECT * FROM brand_kits WHERE user_id = $1', [userId]);
    return result.rows[0] || null;
  },
  async upsert(userId, data) {
    const result = await pool.query(`
      INSERT INTO brand_kits (id, user_id, brand_name, watermark_text, primary_color, secondary_color, font_style, elevenlabs_api_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        brand_name = EXCLUDED.brand_name,
        watermark_text = EXCLUDED.watermark_text,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        font_style = EXCLUDED.font_style,
        elevenlabs_api_key = EXCLUDED.elevenlabs_api_key,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [uuidv4(), userId, data.brandName || '', data.watermarkText || '',
        data.primaryColor || '#FF0050', data.secondaryColor || '#6c5ce7', data.fontStyle || 'modern',
        data.elevenlabsApiKey || '']);
    return result.rows[0];
  }
};

// Calendar operations
const calendarOps = {
  async getByUserId(userId, startDate, endDate) {
    const result = await pool.query(
      'SELECT * FROM calendar_entries WHERE user_id = $1 AND scheduled_date >= $2 AND scheduled_date <= $3 ORDER BY scheduled_date, scheduled_time',
      [userId, startDate, endDate]
    );
    return result.rows;
  },
  async create(data) {
    const id = uuidv4();
    const result = await pool.query(`
      INSERT INTO calendar_entries (id, user_id, title, platform, scheduled_date, scheduled_time, status, content_text, analysis_id, moment_index, notes, color, reminder_email, reminder_minutes, reminder_sent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, FALSE)
      RETURNING *
    `, [id, data.userId, data.title, data.platform || 'tiktok', data.scheduledDate, data.scheduledTime || '12:00',
        data.status || 'planned', data.contentText || '', data.analysisId || null, data.momentIndex ?? null,
        data.notes || '', data.color || '#6c5ce7', data.reminderEmail || '', data.reminderMinutes || 0]);
    return result.rows[0];
  },
  async update(id, userId, data) {
    const result = await pool.query(`
      UPDATE calendar_entries SET
        title = COALESCE($3, title),
        platform = COALESCE($4, platform),
        scheduled_date = COALESCE($5, scheduled_date),
        scheduled_time = COALESCE($6, scheduled_time),
        status = COALESCE($7, status),
        content_text = COALESCE($8, content_text),
        notes = COALESCE($9, notes),
        color = COALESCE($10, color),
        reminder_email = $11,
        reminder_minutes = $12,
        reminder_sent = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId, data.title, data.platform, data.scheduledDate, data.scheduledTime,
        data.status, data.contentText, data.notes, data.color,
        data.reminderEmail || '', data.reminderMinutes || 0]);
    return result.rows[0];
  },
  async getPendingReminders() {
    // Get entries that need reminders sent: reminder_email is set, not sent yet, and within reminder window
    const result = await pool.query(`
      SELECT * FROM calendar_entries
      WHERE reminder_email != '' AND reminder_email IS NOT NULL
        AND reminder_sent = FALSE
        AND status != 'published'
        AND (scheduled_date + scheduled_time::time) - (reminder_minutes || ' minutes')::interval <= NOW()
        AND (scheduled_date + scheduled_time::time) >= NOW()
      ORDER BY scheduled_date, scheduled_time
    `);
    return result.rows;
  },
  async markReminderSent(id) {
    await pool.query('UPDATE calendar_entries SET reminder_sent = TRUE WHERE id = $1', [id]);
  },
  async delete(id, userId) {
    await pool.query('DELETE FROM calendar_entries WHERE id = $1 AND user_id = $2', [id, userId]);
  }
};

// Blog post operations
const blogOps = {
  async create(authorId, title, slug, excerpt, content, tag, coverImage, status, authorName) {
    const id = uuidv4();
    const publishedAt = status === 'published' ? new Date() : null;
    const result = await pool.query(
      `INSERT INTO blog_posts (id, author_id, title, slug, excerpt, content, cover_image, tag, status, published_at, author_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [id, authorId, title, slug, excerpt, content, coverImage || '', tag || 'General', status || 'draft', publishedAt, authorName || '']
    );
    return result.rows[0];
  },
  async update(id, data) {
    const publishedAt = data.status === 'published' ? 'COALESCE(published_at, CURRENT_TIMESTAMP)' : 'published_at';
    const result = await pool.query(
      `UPDATE blog_posts SET title=$2, slug=$3, excerpt=$4, content=$5, cover_image=$6, tag=$7, status=$8,
       author_name=$9,
       published_at = ${data.status === 'published' ? 'COALESCE(published_at, CURRENT_TIMESTAMP)' : 'published_at'},
       updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
      [id, data.title, data.slug, data.excerpt || '', data.content, data.coverImage || '', data.tag || 'General', data.status || 'draft', data.authorName || '']
    );
    return result.rows[0];
  },
  async getAll(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT bp.*, COALESCE(NULLIF(bp.author_name, ''), u.name) as author_name, u.email as author_email FROM blog_posts bp
       LEFT JOIN users u ON bp.author_id = u.id ORDER BY bp.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  },
  async getPublished(limit = 20, offset = 0) {
    const result = await pool.query(
      `SELECT bp.*, COALESCE(NULLIF(bp.author_name, ''), u.name) as author_name FROM blog_posts bp
       LEFT JOIN users u ON bp.author_id = u.id
       WHERE bp.status = 'published' ORDER BY bp.published_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  },
  async getById(id) {
    const result = await pool.query(
      `SELECT bp.*, COALESCE(NULLIF(bp.author_name, ''), u.name) as author_name, u.email as author_email FROM blog_posts bp
       LEFT JOIN users u ON bp.author_id = u.id WHERE bp.id = $1`,
      [id]
    );
    return result.rows[0];
  },
  async getBySlug(slug) {
    const result = await pool.query(
      `SELECT bp.*, COALESCE(NULLIF(bp.author_name, ''), u.name) as author_name FROM blog_posts bp
       LEFT JOIN users u ON bp.author_id = u.id WHERE bp.slug = $1 AND bp.status = 'published'`,
      [slug]
    );
    return result.rows[0];
  },
  async delete(id) {
    const result = await pool.query(`DELETE FROM blog_posts WHERE id = $1 RETURNING *`, [id]);
    return result.rows[0];
  },
  async count() {
    const result = await pool.query(`SELECT COUNT(*) FROM blog_posts`);
    return parseInt(result.rows[0].count, 10);
  }
};

// Team invitation operations
const teamOps = {
  async createInvitation(invitedBy, email, role, permissions) {
    const id = uuidv4();
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const result = await pool.query(
      `INSERT INTO team_invitations (id, invited_by, email, role, permissions, status, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) RETURNING *`,
      [id, invitedBy, email, role, JSON.stringify(permissions), token, expiresAt]
    );
    return result.rows[0];
  },
  async getInvitationByToken(token) {
    const result = await pool.query(
      `SELECT ti.*, u.name as inviter_name, u.email as inviter_email FROM team_invitations ti
       LEFT JOIN users u ON ti.invited_by = u.id WHERE ti.token = $1`,
      [token]
    );
    return result.rows[0];
  },
  async getInvitations(limit = 50) {
    const result = await pool.query(
      `SELECT ti.*, u.name as inviter_name FROM team_invitations ti
       LEFT JOIN users u ON ti.invited_by = u.id ORDER BY ti.created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  },
  async updateInvitationStatus(id, status) {
    const result = await pool.query(
      `UPDATE team_invitations SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return result.rows[0];
  },
  async deleteInvitation(id) {
    await pool.query(`DELETE FROM team_invitations WHERE id = $1`, [id]);
  },
  async addMember(userId, addedBy, role, permissions) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO team_members (id, user_id, added_by, role, permissions)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, userId, addedBy, role, JSON.stringify(permissions)]
    );
    return result.rows[0];
  },
  async getMembers() {
    const result = await pool.query(
      `SELECT tm.*, u.name, u.email, u.plan, u.created_at as user_created_at FROM team_members tm
       LEFT JOIN users u ON tm.user_id = u.id ORDER BY tm.created_at DESC`
    );
    return result.rows;
  },
  async getMemberByUserId(userId) {
    const result = await pool.query(`SELECT * FROM team_members WHERE user_id = $1`, [userId]);
    return result.rows[0];
  },
  async updateMember(id, role, permissions) {
    const result = await pool.query(
      `UPDATE team_members SET role = $2, permissions = $3 WHERE id = $1 RETURNING *`,
      [id, role, JSON.stringify(permissions)]
    );
    return result.rows[0];
  },
  async removeMember(id) {
    await pool.query(`DELETE FROM team_members WHERE id = $1`, [id]);
  }
};

// Admin operations
const adminOps = {
  async getAllUsers(limit = 100, offset = 0) {
    const result = await pool.query(
      `SELECT id, email, name, plan, role, created_at, stripe_customer_id FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  },
  async countUsers() {
    const result = await pool.query(`SELECT COUNT(*) FROM users`);
    return parseInt(result.rows[0].count, 10);
  },
  async countUsersByPlan() {
    const result = await pool.query(
      `SELECT plan, COUNT(*) as count FROM users GROUP BY plan ORDER BY count DESC`
    );
    return result.rows;
  },
  async setUserRole(userId, role) {
    const result = await pool.query(
      `UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, name, plan, role`,
      [userId, role]
    );
    return result.rows[0];
  },
  async setPageEditorAccess(userId, canEdit) {
    const result = await pool.query(
      `UPDATE users SET can_edit_pages = $2 WHERE id = $1 RETURNING id, email, name, role, can_edit_pages`,
      [userId, canEdit]
    );
    return result.rows[0];
  },
  async getPageEditorUsers() {
    const result = await pool.query(
      `SELECT id, email, name, role, can_edit_pages FROM users WHERE role = 'admin' ORDER BY created_at ASC`
    );
    return result.rows;
  },
  async getStats() {
    const [users, content, outputs, shorts, featureTotals] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users`),
      pool.query(`SELECT COUNT(*) FROM content_items`),
      pool.query(`SELECT COUNT(*) FROM generated_outputs`),
      pool.query(`SELECT COUNT(*) FROM smart_shorts`),
      pool.query(`SELECT feature, COUNT(*) as count FROM feature_usage GROUP BY feature`)
    ]);
    const recentUsers = await pool.query(
      `SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`
    );
    const featureMap = {};
    featureTotals.rows.forEach(r => { featureMap[r.feature] = parseInt(r.count, 10); });
    return {
      totalUsers: parseInt(users.rows[0].count, 10),
      totalContent: parseInt(content.rows[0].count, 10),
      totalOutputs: parseInt(outputs.rows[0].count, 10),
      totalShorts: parseInt(shorts.rows[0].count, 10),
      newUsersThisMonth: parseInt(recentUsers.rows[0].count, 10),
      featureBreakdown: featureMap
    };
  }
,

  async getUserUsageStats() {
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.email, u.plan, u.stripe_customer_id, u.created_at, u.last_login_at, u.login_count,
        COALESCE(go_count.total, 0) as repurpose_count,
        COALESCE(ci_count.total, 0) as content_items_count,
        COALESCE(ss_count.total, 0) as smart_shorts_count,
        COALESCE(bv_count.total, 0) as brand_voices_count,
        COALESCE(cal_count.total, 0) as calendar_entries_count,
        COALESCE(fu_captions.total, 0) as ai_captions_count,
        COALESCE(fu_hooks.total, 0) as ai_hooks_count,
        COALESCE(fu_broll.total, 0) as ai_broll_count,
        COALESCE(fu_thumbnails.total, 0) as ai_thumbnails_count,
        COALESCE(fu_reframe.total, 0) as ai_reframe_count,
        COALESCE(fu_editor.total, 0) as video_editor_count,
        COALESCE(fu_styles.total, 0) as caption_styles_count,
        COALESCE(fu_enhance.total, 0) as enhance_speech_count,
        COALESCE(GREATEST(go_recent.last_used, fu_recent.last_used), u.created_at) as last_activity
      FROM users u
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM generated_outputs GROUP BY user_id) go_count ON u.id = go_count.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM content_items GROUP BY user_id) ci_count ON u.id = ci_count.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM smart_shorts GROUP BY user_id) ss_count ON u.id = ss_count.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM brand_voices GROUP BY user_id) bv_count ON u.id = bv_count.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM calendar_entries GROUP BY user_id) cal_count ON u.id = cal_count.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM feature_usage WHERE feature = 'ai_captions' GROUP BY user_id) fu_captions ON u.id = fu_captions.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM feature_usage WHERE feature = 'ai_hooks' GROUP BY user_id) fu_hooks ON u.id = fu_hooks.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM feature_usage WHERE feature = 'ai_broll' GROUP BY user_id) fu_broll ON u.id = fu_broll.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM feature_usage WHERE feature = 'ai_thumbnails' GROUP BY user_id) fu_thumbnails ON u.id = fu_thumbnails.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM feature_usage WHERE feature = 'ai_reframe' GROUP BY user_id) fu_reframe ON u.id = fu_reframe.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM feature_usage WHERE feature = 'video_editor' GROUP BY user_id) fu_editor ON u.id = fu_editor.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM feature_usage WHERE feature = 'caption_styles' GROUP BY user_id) fu_styles ON u.id = fu_styles.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as total FROM feature_usage WHERE feature = 'enhance_speech' GROUP BY user_id) fu_enhance ON u.id = fu_enhance.user_id
      LEFT JOIN (SELECT user_id, MAX(created_at) as last_used FROM generated_outputs GROUP BY user_id) go_recent ON u.id = go_recent.user_id
      LEFT JOIN (SELECT user_id, MAX(created_at) as last_used FROM feature_usage GROUP BY user_id) fu_recent ON u.id = fu_recent.user_id
      ORDER BY u.created_at DESC
    `);
    return result.rows;
  },

  async getPlatformBreakdown() {
    const result = await pool.query(`
      SELECT platform, COUNT(*) as count FROM generated_outputs GROUP BY platform ORDER BY count DESC
    `);
    return result.rows;
  },

  async getFeatureBreakdown() {
    const result = await pool.query(`
      SELECT feature, COUNT(*) as count FROM feature_usage GROUP BY feature ORDER BY count DESC
    `);
    return result.rows;
  },

  async getUsageSummary() {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM generated_outputs) as total_outputs,
        (SELECT COUNT(*) FROM content_items) as total_content,
        (SELECT COUNT(*) FROM smart_shorts) as total_shorts,
        (SELECT COUNT(*) FROM users WHERE last_login_at > NOW() - INTERVAL '7 days') as active_7d,
        (SELECT COUNT(*) FROM users WHERE last_login_at > NOW() - INTERVAL '30 days') as active_30d,
        (SELECT COUNT(*) FROM generated_outputs WHERE created_at > NOW() - INTERVAL '30 days') as outputs_30d,
        (SELECT COUNT(*) FROM feature_usage) as total_feature_uses,
        (SELECT COUNT(*) FROM feature_usage WHERE feature = 'ai_captions') as total_captions,
        (SELECT COUNT(*) FROM feature_usage WHERE feature = 'ai_hooks') as total_hooks,
        (SELECT COUNT(*) FROM feature_usage WHERE feature = 'ai_broll') as total_broll,
        (SELECT COUNT(*) FROM feature_usage WHERE feature = 'ai_thumbnails') as total_thumbnails,
        (SELECT COUNT(*) FROM feature_usage WHERE feature = 'ai_reframe') as total_reframe,
        (SELECT COUNT(*) FROM feature_usage WHERE feature = 'video_editor') as total_editor,
        (SELECT COUNT(*) FROM feature_usage WHERE feature = 'caption_styles') as total_caption_styles,
        (SELECT COUNT(*) FROM feature_usage WHERE feature = 'enhance_speech') as total_enhance
    `);
    return result.rows[0];
  }};

// Feature usage tracking operations
const featureUsageOps = {
  async log(userId, feature, metadata = '') {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO feature_usage (id, user_id, feature, metadata) VALUES ($1, $2, $3, $4)`,
      [id, userId, feature, metadata]
    );
    return id;
  },
  async getByUser(userId) {
    const result = await pool.query(
      `SELECT feature, COUNT(*) as count FROM feature_usage WHERE user_id = $1 GROUP BY feature`,
      [userId]
    );
    return result.rows;
  }
};

// Bug report operations
const bugReportOps = {
  async create(userId, userEmail, category, page, description) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO bug_reports (id, user_id, user_email, category, page, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, userId || null, userEmail || '', category || 'bug', page || '', description]
    );
    return result.rows[0];
  },
  async getAll(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM bug_reports ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  },
  async getOpen() {
    const result = await pool.query(
      `SELECT * FROM bug_reports WHERE status = 'open' ORDER BY created_at DESC`
    );
    return result.rows;
  },
  async updateStatus(id, status, adminNotes) {
    const resolvedAt = status === 'resolved' ? new Date() : null;
    const result = await pool.query(
      `UPDATE bug_reports SET status=$2, admin_notes=$3, resolved_at=$4 WHERE id=$1 RETURNING *`,
      [id, status, adminNotes || '', resolvedAt]
    );
    return result.rows[0];
  },
  async count() {
    const result = await pool.query(`SELECT COUNT(*) FROM bug_reports WHERE status = 'open'`);
    return parseInt(result.rows[0].count, 10);
  },
  async delete(id) {
    const result = await pool.query(`DELETE FROM bug_reports WHERE id = $1 RETURNING *`, [id]);
    return result.rows[0];
  }
,
  async markAsRead(id) {
    await pool.query('UPDATE bug_reports SET is_read = true WHERE id = $1', [id]);
  },
  async markAsResponded(id) {
    await pool.query('UPDATE bug_reports SET responded_at = CURRENT_TIMESTAMP WHERE id = $1 AND responded_at IS NULL', [id]);
  }

};

const pageContentOps = {
  async get(pageSlug, status) {
    const result = await pool.query(
      `SELECT * FROM page_content WHERE page_slug = $1 AND status = $2 ORDER BY updated_at DESC LIMIT 1`,
      [pageSlug, status || 'published']
    );
    return result.rows[0] || null;
  },
  async save(pageSlug, data, userId) {
    const id = uuidv4();
    // Upsert draft for this page
    const existing = await pool.query(
      `SELECT id FROM page_content WHERE page_slug = $1 AND status = 'draft' LIMIT 1`,
      [pageSlug]
    );
    if (existing.rows.length > 0) {
      const result = await pool.query(
        `UPDATE page_content SET content_html=$1, content_css=$2, content_components=$3, content_style=$4, updated_at=CURRENT_TIMESTAMP, updated_by=$5 WHERE id=$6 RETURNING *`,
        [data.html, data.css, data.components, data.style, userId, existing.rows[0].id]
      );
      return result.rows[0];
    }
    const result = await pool.query(
      `INSERT INTO page_content (id, page_slug, content_html, content_css, content_components, content_style, status, updated_by) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *`,
      [id, pageSlug, data.html, data.css, data.components, data.style, userId]
    );
    return result.rows[0];
  },
  async publish(pageSlug, userId) {
    const draft = await this.get(pageSlug, 'draft');
    if (!draft) return null;
    // Mark any existing published row as archived
    await pool.query(
      `UPDATE page_content SET status='archived' WHERE page_slug=$1 AND status='published'`,
      [pageSlug]
    );
    // Promote draft to published
    const result = await pool.query(
      `UPDATE page_content SET status='published', updated_at=CURRENT_TIMESTAMP, updated_by=$1 WHERE id=$2 RETURNING *`,
      [userId, draft.id]
    );
    return result.rows[0];
  },
  async revert(pageSlug) {
    // Delete draft, keep published
    await pool.query(
      `DELETE FROM page_content WHERE page_slug=$1 AND status='draft'`,
      [pageSlug]
    );
    return true;
  }
};

module.exports = {
  initDatabase,
  getDb,
  get pool() { return pool; },
  userOps,
  contentOps,
  outputOps,
  brandVoiceOps,
  contactOps,
  shortsOps,
  brandKitOps,
  calendarOps,
  blogOps,
  bugReportOps,
  teamOps,
  adminOps,
  featureUsageOps,
  pageContentOps
};
