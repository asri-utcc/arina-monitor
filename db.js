const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'monitor.db');

let db = null;

// Initialize database
async function initializeDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ping', 'api')),
      target_url TEXT,
      secret_token TEXT NOT NULL,
      interval_seconds INTEGER DEFAULT 60,
      is_active INTEGER DEFAULT 1,
      notify_telegram INTEGER DEFAULT 0,
      notify_pwa INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Pending' CHECK(status IN ('Online', 'Offline', 'Pending')),
      last_seen TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Online', 'Offline', 'Pending')),
      message TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_monitor_id ON logs(monitor_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`);

  // Default settings
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_bot_token', '')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_chat_id', '')`);

  saveDatabase();
  return db;
}

// Save database to disk
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// Helper to get all results
function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper to get one result
function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// Helper to run a statement
function run(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0 };
}

// Monitor operations
const monitorQueries = {
  getAll: () => getAll(`SELECT * FROM monitors ORDER BY created_at DESC`),

  getById: (id) => getOne(`SELECT * FROM monitors WHERE id = ?`, [id]),

  getActiveMonitors: () => getAll(`SELECT * FROM monitors WHERE is_active = 1`),

  getActiveByType: (type) => getAll(`SELECT * FROM monitors WHERE is_active = 1 AND type = ?`, [type]),

  create: (data) => {
    const maxId = getOne(`SELECT MAX(id) as maxId FROM monitors`);
    const nextId = (maxId?.maxId || 0) + 1;
    run(`
      INSERT INTO monitors (id, name, type, target_url, secret_token, interval_seconds, is_active, notify_telegram, notify_pwa, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [nextId, data.name, data.type, data.target_url, data.secret_token, data.interval_seconds, data.is_active, data.notify_telegram, data.notify_pwa, data.status || 'Pending']);
    return getOne(`SELECT * FROM monitors WHERE id = ?`, [nextId]);
  },

  update: (data) => {
    run(`
      UPDATE monitors SET
        name = ?,
        type = ?,
        target_url = ?,
        secret_token = ?,
        interval_seconds = ?,
        is_active = ?,
        notify_telegram = ?,
        notify_pwa = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [data.name, data.type, data.target_url, data.secret_token, data.interval_seconds, data.is_active, data.notify_telegram, data.notify_pwa, data.id]);
    return getOne(`SELECT * FROM monitors WHERE id = ?`, [data.id]);
  },

  updateStatus: (data) => {
    run(`
      UPDATE monitors SET
        status = ?,
        last_seen = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [data.status, data.last_seen, data.id]);
  },

  delete: (id) => {
    run(`DELETE FROM monitors WHERE id = ?`, [id]);
  },

  getStats: () => {
    const total = getOne(`SELECT COUNT(*) as total FROM monitors`);
    const online = getOne(`SELECT COUNT(*) as online FROM monitors WHERE status = 'Online'`);
    const offline = getOne(`SELECT COUNT(*) as offline FROM monitors WHERE status = 'Offline'`);
    const pending = getOne(`SELECT COUNT(*) as pending FROM monitors WHERE status = 'Pending'`);
    return {
      total: total?.total || 0,
      online: online?.online || 0,
      offline: offline?.offline || 0,
      pending: pending?.pending || 0
    };
  }
};

// Log operations
const logQueries = {
  getByMonitorId: (monitorId) => getAll(`SELECT * FROM logs WHERE monitor_id = ? ORDER BY timestamp DESC LIMIT 100`, [monitorId]),

  getRecent: () => getAll(`
    SELECT l.*, m.name as monitor_name
    FROM logs l
    JOIN monitors m ON l.monitor_id = m.id
    ORDER BY l.timestamp DESC
    LIMIT 200
  `),

  create: (data) => {
    run(`
      INSERT INTO logs (monitor_id, status, message) VALUES (?, ?, ?)
    `, [data.monitor_id, data.status, data.message]);
  }
};

// Settings operations
const settingsQueries = {
  get: (key) => getOne(`SELECT value FROM settings WHERE key = ?`, [key]),

  set: (key, value) => {
    run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  },

  getAll: () => getAll(`SELECT * FROM settings`)
};

module.exports = {
  initializeDatabase,
  monitorQueries,
  logQueries,
  settingsQueries,
  getDb: () => db
};
