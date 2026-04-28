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

function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        logError('数据库连接失败:', err.message);
        reject(err);
        return;
      }
      
      logInfo('成功连接到 SQLite 数据库');
      
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          logError('创建 users 表失败:', err.message);
          reject(err);
          return;
        }
        
        logInfo('users 表已就绪');
        resolve(db);
      });
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
  all
};
