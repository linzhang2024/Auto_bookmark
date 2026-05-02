const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('./config');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'app.db');
const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

function logInfo(...args) {
  if (!isTestEnvironment) {
    console.log(...args);
  }
}

function logError(...args) {
  if (!isTestEnvironment) {
    console.error(...args);
  }
}

let db;

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function columnExists(tableName, columnName) {
  const row = await getAsync(
    `PRAGMA table_info(${tableName})`,
    []
  );
  const columns = await new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  return columns.some(col => col.name === columnName);
}

const DocumentStatus = {
  PENDING: 'pending',
  READY: 'ready',
  FAILED: 'failed'
};

async function seedRoles() {
  const adminRole = await getAsync('SELECT * FROM roles WHERE name = ?', ['admin']);
  if (!adminRole) {
    await runAsync(
      `INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)`,
      ['admin', '系统管理员，拥有所有权限', JSON.stringify([
        'user:create', 'user:read', 'user:update', 'user:delete',
        'role:create', 'role:read', 'role:update', 'role:delete',
        'bookmark:create', 'bookmark:read', 'bookmark:update', 'bookmark:delete',
        'doc:create', 'doc:read', 'doc:update', 'doc:delete', 'doc:write',
        'admin:access'
      ])]
    );
    logInfo('已预置管理员角色');
  }

  const userRole = await getAsync('SELECT * FROM roles WHERE name = ?', ['user']);
  if (!userRole) {
    await runAsync(
      `INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)`,
      ['user', '普通用户，拥有基本权限', JSON.stringify([
        'user:read', 'user:update',
        'bookmark:create', 'bookmark:read', 'bookmark:update', 'bookmark:delete',
        'doc:create', 'doc:read', 'doc:write'
      ])]
    );
    logInfo('已预置普通用户角色');
  }

  const guestRole = await getAsync('SELECT * FROM roles WHERE name = ?', ['guest']);
  if (!guestRole) {
    await runAsync(
      `INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)`,
      ['guest', '访客角色，仅有只读权限', JSON.stringify([
        'bookmark:read',
        'doc:read'
      ])]
    );
    logInfo('已预置访客角色');
  }
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, async (err) => {
      if (err) {
        logError('数据库连接失败:', err.message);
        reject(err);
        return;
      }
      
      logInfo('成功连接到 SQLite 数据库');

      try {
        await runAsync(`
          CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            permissions TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        logInfo('roles 表已就绪');

        await runAsync(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            role_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (role_id) REFERENCES roles(id)
          )
        `);

        const hasRoleId = await columnExists('users', 'role_id');
        if (!hasRoleId) {
          await runAsync('ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id)');
          logInfo('已添加 role_id 列到 users 表');
        }

        const hasIsEnabled = await columnExists('users', 'is_enabled');
        if (!hasIsEnabled) {
          await runAsync('ALTER TABLE users ADD COLUMN is_enabled INTEGER DEFAULT 1');
          logInfo('已添加 is_enabled 列到 users 表');
        }

        logInfo('users 表已就绪');

        await runAsync(`
          CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            file_size INTEGER DEFAULT 0,
            mime_type TEXT DEFAULT '',
            uploader_id INTEGER,
            owner_id INTEGER,
            status TEXT DEFAULT 'pending',
            metadata TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (uploader_id) REFERENCES users(id),
            FOREIGN KEY (owner_id) REFERENCES users(id)
          )
        `);
        
        const hasStatus = await columnExists('documents', 'status');
        if (!hasStatus) {
          await runAsync(`ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'pending'`);
          logInfo('已添加 status 列到 documents 表');
        }
        
        const hasOwnerId = await columnExists('documents', 'owner_id');
        if (!hasOwnerId) {
          await runAsync(`ALTER TABLE documents ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
          logInfo('已添加 owner_id 列到 documents 表');
        }
        
        logInfo('documents 表已就绪');

        await runAsync(`
          CREATE TABLE IF NOT EXISTS sync_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT NOT NULL UNIQUE,
            executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            browser_source TEXT,
            total_count INTEGER DEFAULT 0,
            success_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'completed',
            error_message TEXT,
            sync_dir TEXT,
            total_folders INTEGER DEFAULT 0,
            folders_created INTEGER DEFAULT 0,
            duplicates_found INTEGER DEFAULT 0,
            duration_ms INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        logInfo('sync_history 表已就绪');

        await runAsync(`
          CREATE TABLE IF NOT EXISTS sync_failure_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT NOT NULL,
            bookmark_title TEXT,
            bookmark_url TEXT,
            folder_path TEXT,
            error_type TEXT,
            error_message TEXT,
            failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sync_id) REFERENCES sync_history(sync_id)
          )
        `);
        logInfo('sync_failure_details 表已就绪');

        const hasSyncHistoryIndex = await getAsync(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sync_history_sync_id'",
          []
        );
        if (!hasSyncHistoryIndex) {
          await runAsync('CREATE INDEX idx_sync_history_sync_id ON sync_history(sync_id)');
          logInfo('已创建 idx_sync_history_sync_id 索引');
        }

        const hasFailureIndex = await getAsync(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sync_failure_sync_id'",
          []
        );
        if (!hasFailureIndex) {
          await runAsync('CREATE INDEX idx_sync_failure_sync_id ON sync_failure_details(sync_id)');
          logInfo('已创建 idx_sync_failure_sync_id 索引');
        }

        await seedRoles();

        resolve(db);
      } catch (dbErr) {
        logError('数据库初始化失败:', dbErr.message);
        reject(dbErr);
      }
    });
  });
}

function getDb() {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return db;
}

function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }
    
    db.close((err) => {
      if (err) {
        logError('关闭数据库失败:', err.message);
        reject(err);
      } else {
        logInfo('数据库连接已关闭');
        db = null;
        resolve();
      }
    });
  });
}

async function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

async function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

async function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

module.exports = {
  initDatabase,
  getDb,
  closeDatabase,
  run,
  get,
  all,
  DocumentStatus
};
