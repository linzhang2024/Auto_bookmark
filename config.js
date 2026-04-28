/**
 * 全局配置模块
 * 支持从 .env 文件加载配置，并提供优雅的默认值回退
 */

const path = require('path');
const fs = require('fs');

let dotenvLoaded = false;

try {
  require('dotenv').config();
  dotenvLoaded = true;
} catch (e) {
  dotenvLoaded = false;
}

/**
 * 默认配置值
 * 当 .env 文件不存在或配置项缺失时使用
 */
const DEFAULT_CONFIG = {
  inputBookmarksPath: null,
  outputDir: path.join(process.cwd(), 'output'),
  syncDir: path.join(process.cwd(), 'bookmarks_mirror'),
  port: 4000,
  startPort: 4000,
  maxPortAttempts: 50,
  maxConcurrency: 5,
  urlTimeout: 5000,
  iconTimeout: 10000,
  filterPatterns: [
    'localhost',
    '127.0.0.1',
    'dev.test',
  ],
  debug: false,
  logLevel: 'info',
};

/**
 * 解析环境变量中的布尔值
 * @param {string} value - 环境变量值
 * @param {boolean} defaultValue - 默认值
 * @returns {boolean}
 */
function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const lower = String(value).toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') {
    return true;
  }
  if (lower === 'false' || lower === '0' || lower === 'no') {
    return false;
  }
  return defaultValue;
}

/**
 * 解析环境变量中的数字值
 * @param {string} value - 环境变量值
 * @param {number} defaultValue - 默认值
 * @returns {number}
 */
function parseNumber(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const num = parseInt(String(value), 10);
  if (isNaN(num)) {
    return defaultValue;
  }
  return num;
}

/**
 * 解析逗号分隔的列表
 * @param {string} value - 环境变量值（逗号分隔）
 * @param {Array} defaultValue - 默认值
 * @returns {Array}
 */
function parseList(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * 解析路径（支持相对路径和绝对路径）
 * @param {string} value - 环境变量值
 * @param {string} defaultValue - 默认值
 * @returns {string}
 */
function parsePath(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(process.cwd(), value);
}

/**
 * 构建配置对象
 * @returns {Object} - 完整的配置对象
 */
function buildConfig() {
  const env = process.env;

  return {
    inputBookmarksPath: parsePath(env.INPUT_BOOKMARKS_PATH, DEFAULT_CONFIG.inputBookmarksPath),
    outputDir: parsePath(env.OUTPUT_DIR, DEFAULT_CONFIG.outputDir),
    syncDir: parsePath(env.SYNC_DIR, DEFAULT_CONFIG.syncDir),
    port: parseNumber(env.PORT, DEFAULT_CONFIG.port),
    startPort: parseNumber(env.START_PORT, DEFAULT_CONFIG.startPort),
    maxPortAttempts: parseNumber(env.MAX_PORT_ATTEMPTS, DEFAULT_CONFIG.maxPortAttempts),
    maxConcurrency: parseNumber(env.MAX_CONCURRENCY, DEFAULT_CONFIG.maxConcurrency),
    urlTimeout: parseNumber(env.URL_TIMEOUT, DEFAULT_CONFIG.urlTimeout),
    iconTimeout: parseNumber(env.ICON_TIMEOUT, DEFAULT_CONFIG.iconTimeout),
    filterPatterns: parseList(env.FILTER_PATTERNS, DEFAULT_CONFIG.filterPatterns),
    debug: parseBoolean(env.DEBUG, DEFAULT_CONFIG.debug),
    logLevel: env.LOG_LEVEL || DEFAULT_CONFIG.logLevel,
    _envLoaded: dotenvLoaded,
    _defaults: { ...DEFAULT_CONFIG },
  };
}

const config = buildConfig();

/**
 * 检查 URL 是否需要被过滤
 * @param {string} url - 要检查的 URL
 * @returns {boolean} - 如果需要过滤返回 true，否则返回 false
 */
function shouldFilter(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const urlLower = url.toLowerCase();

  for (const pattern of config.filterPatterns) {
    if (typeof pattern === 'string') {
      if (matchesPattern(urlLower, pattern)) {
        return true;
      }
    } else if (pattern instanceof RegExp) {
      if (pattern.test(urlLower)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 检查 URL 是否匹配某个模式
 * @param {string} urlLower - 小写的 URL
 * @param {string} pattern - 匹配模式
 * @returns {boolean}
 */
function matchesPattern(urlLower, pattern) {
  const patternLower = pattern.toLowerCase();

  try {
    const urlObj = new URL(urlLower);
    const hostname = urlObj.hostname || '';

    if (hostname.includes(patternLower)) {
      return true;
    }
  } catch {
    // 如果无法解析为 URL，使用简单的字符串匹配
  }

  return urlLower.includes(patternLower);
}

/**
 * 获取配置对象的可枚举版本（用于 API 返回）
 * @returns {Object}
 */
function getPublicConfig() {
  return {
    inputBookmarksPath: config.inputBookmarksPath,
    outputDir: config.outputDir,
    syncDir: config.syncDir,
    port: config.port,
    startPort: config.startPort,
    maxPortAttempts: config.maxPortAttempts,
    maxConcurrency: config.maxConcurrency,
    urlTimeout: config.urlTimeout,
    iconTimeout: config.iconTimeout,
    filterPatterns: config.filterPatterns,
    debug: config.debug,
    logLevel: config.logLevel,
    envLoaded: config._envLoaded,
  };
}

/**
 * 重新加载配置（用于运行时更新）
 */
function reload() {
  delete require.cache[require.resolve('dotenv')];
  try {
    require('dotenv').config();
    dotenvLoaded = true;
  } catch (e) {
    dotenvLoaded = false;
  }

  const newConfig = buildConfig();
  Object.assign(config, newConfig);
}

module.exports = {
  ...config,
  shouldFilter,
  matchesPattern,
  getPublicConfig,
  reload,
  DEFAULT_CONFIG,
  buildConfig,
  parseBoolean,
  parseNumber,
  parseList,
  parsePath,
};
