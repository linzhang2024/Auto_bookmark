/**
 * 浏览器书签自动探测模块
 * 自动定位本地浏览器书签路径，支持 Chrome、Edge、Firefox、Safari
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 浏览器类型枚举
 */
const BrowserType = {
  CHROME: 'chrome',
  EDGE: 'edge',
  FIREFOX: 'firefox',
  SAFARI: 'safari',
  UNKNOWN: 'unknown'
};

/**
 * 浏览器信息
 * @typedef {Object} BrowserInfo
 * @property {string} type - 浏览器类型
 * @property {string} name - 浏览器名称
 * @property {string|null} path - 书签文件路径
 * @property {boolean} isInstalled - 是否已安装
 * @property {string} [format] - 书签格式 (json/html/sqlite/plist)
 */

/**
 * 探测结果
 * @typedef {Object} DetectionResult
 * @property {boolean} success - 是否成功
 * @property {BrowserInfo[]} browsers - 检测到的浏览器列表
 * @property {string} [error] - 错误信息
 */

/**
 * 获取 Windows 环境变量
 * @param {string} name - 环境变量名
 * @returns {string|null}
 */
function getWinEnv(name) {
  try {
    return process.env[name] || null;
  } catch {
    return null;
  }
}

/**
 * 检查文件是否存在且可访问
 * @param {string} filePath - 文件路径
 * @returns {boolean}
 */
function isFileAccessible(filePath) {
  if (!filePath) return false;
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查目录是否存在
 * @param {string} dirPath - 目录路径
 * @returns {boolean}
 */
function dirExists(dirPath) {
  if (!dirPath) return false;
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 获取 Windows 上 Chrome 的书签路径
 * Chrome 书签存储在 JSON 文件中: %LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks
 * @returns {string|null}
 */
function getChromeBookmarksPathWindows() {
  const localAppData = getWinEnv('LOCALAPPDATA');
  if (!localAppData) return null;

  const chromePath = path.join(localAppData, 'Google', 'Chrome', 'User Data');
  if (!dirExists(chromePath)) return null;

  const defaultProfile = path.join(chromePath, 'Default', 'Bookmarks');
  if (isFileAccessible(defaultProfile)) {
    return defaultProfile;
  }

  try {
    const profiles = fs.readdirSync(chromePath);
    for (const profile of profiles) {
      if (profile.startsWith('Profile ')) {
        const bookmarkPath = path.join(chromePath, profile, 'Bookmarks');
        if (isFileAccessible(bookmarkPath)) {
          return bookmarkPath;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * 获取 Windows 上 Edge 的书签路径
 * Edge 书签存储在 JSON 文件中: %LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Bookmarks
 * @returns {string|null}
 */
function getEdgeBookmarksPathWindows() {
  const localAppData = getWinEnv('LOCALAPPDATA');
  if (!localAppData) return null;

  const edgePath = path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
  if (!dirExists(edgePath)) return null;

  const defaultProfile = path.join(edgePath, 'Default', 'Bookmarks');
  if (isFileAccessible(defaultProfile)) {
    return defaultProfile;
  }

  try {
    const profiles = fs.readdirSync(edgePath);
    for (const profile of profiles) {
      if (profile.startsWith('Profile ')) {
        const bookmarkPath = path.join(edgePath, profile, 'Bookmarks');
        if (isFileAccessible(bookmarkPath)) {
          return bookmarkPath;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * 获取 Windows 上 Firefox 的书签路径
 * Firefox 书签存储在 SQLite 数据库中: %APPDATA%\Mozilla\Firefox\Profiles\<profile>\places.sqlite
 * @returns {string|null}
 */
function getFirefoxBookmarksPathWindows() {
  const appData = getWinEnv('APPDATA');
  if (!appData) return null;

  const profilesPath = path.join(appData, 'Mozilla', 'Firefox', 'Profiles');
  if (!dirExists(profilesPath)) return null;

  try {
    const profiles = fs.readdirSync(profilesPath);
    for (const profile of profiles) {
      const profilePath = path.join(profilesPath, profile);
      if (dirExists(profilePath)) {
        const placesPath = path.join(profilePath, 'places.sqlite');
        if (isFileAccessible(placesPath)) {
          return placesPath;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * 解析 Chrome/Edge 的 JSON 书签格式为通用格式
 * @param {Object} jsonData - Chrome 书签 JSON 数据
 * @returns {Array} - 层级结构的书签列表
 */
function parseChromeJsonBookmarks(jsonData) {
  const result = [];

  function processNode(node, level = 0) {
    if (!node) return null;

    if (node.type === 'folder') {
      const children = [];
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          const processed = processNode(child, level + 1);
          if (processed) {
            children.push(processed);
          }
        }
      }

      return {
        type: 'folder',
        name: node.name || 'Untitled Folder',
        level: level,
        children: children,
        addDate: node.date_added ? new Date(node.date_added / 1000) : null,
        lastModified: node.date_modified ? new Date(node.date_modified / 1000) : null
      };
    }

    if (node.type === 'url') {
      return {
        type: 'link',
        title: node.name || extractDomainFromUrl(node.url),
        url: node.url || '',
        level: level,
        addDate: node.date_added ? new Date(node.date_added / 1000) : null,
        lastModified: node.date_modified ? new Date(node.date_modified / 1000) : null
      };
    }

    return null;
  }

  const roots = jsonData.roots || {};
  
  for (const [key, root] of Object.entries(roots)) {
    if (root && root.type === 'folder') {
      const processed = processNode(root, 0);
      if (processed) {
        processed.name = mapChromeRootName(key, processed.name);
        result.push(processed);
      }
    }
  }

  return result;
}

/**
 * 映射 Chrome 根文件夹名称到更友好的中文名称
 * @param {string} key - 根文件夹键名
 * @param {string} originalName - 原始名称
 * @returns {string}
 */
function mapChromeRootName(key, originalName) {
  const nameMap = {
    'bookmark_bar': '书签栏',
    'other': '其他书签',
    'synced': '移动设备书签',
    'managed': '管理书签'
  };
  return nameMap[key] || originalName;
}

/**
 * 从 URL 中提取域名
 * @param {string} url - URL 地址
 * @returns {string}
 */
function extractDomainFromUrl(url) {
  if (!url) return 'Untitled';
  try {
    const urlObj = new URL(url);
    return urlObj.hostname || url;
  } catch {
    return url;
  }
}

/**
 * 读取并解析 Chrome/Edge 的 JSON 书签文件
 * @param {string} filePath - 书签文件路径
 * @returns {Promise<{success: boolean, data: Array, error?: string}>}
 */
async function readChromeBookmarks(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const jsonData = JSON.parse(content);
    const bookmarks = parseChromeJsonBookmarks(jsonData);
    return { success: true, data: bookmarks };
  } catch (error) {
    return { success: false, data: [], error: error.message };
  }
}

/**
 * 检测 Windows 上已安装的浏览器
 * @returns {BrowserInfo[]}
 */
function detectBrowsersWindows() {
  const browsers = [];

  const chromePath = getChromeBookmarksPathWindows();
  browsers.push({
    type: BrowserType.CHROME,
    name: 'Google Chrome',
    path: chromePath,
    isInstalled: chromePath !== null,
    format: 'json'
  });

  const edgePath = getEdgeBookmarksPathWindows();
  browsers.push({
    type: BrowserType.EDGE,
    name: 'Microsoft Edge',
    path: edgePath,
    isInstalled: edgePath !== null,
    format: 'json'
  });

  const firefoxPath = getFirefoxBookmarksPathWindows();
  browsers.push({
    type: BrowserType.FIREFOX,
    name: 'Mozilla Firefox',
    path: firefoxPath,
    isInstalled: firefoxPath !== null,
    format: 'sqlite'
  });

  return browsers;
}

/**
 * 检测 macOS 上已安装的浏览器 (占位实现)
 * @returns {BrowserInfo[]}
 */
function detectBrowsersMacOS() {
  return [
    { type: BrowserType.CHROME, name: 'Google Chrome', path: null, isInstalled: false, format: 'json' },
    { type: BrowserType.EDGE, name: 'Microsoft Edge', path: null, isInstalled: false, format: 'json' },
    { type: BrowserType.FIREFOX, name: 'Mozilla Firefox', path: null, isInstalled: false, format: 'sqlite' },
    { type: BrowserType.SAFARI, name: 'Apple Safari', path: null, isInstalled: false, format: 'plist' }
  ];
}

/**
 * 检测 Linux 上已安装的浏览器 (占位实现)
 * @returns {BrowserInfo[]}
 */
function detectBrowsersLinux() {
  return [
    { type: BrowserType.CHROME, name: 'Google Chrome', path: null, isInstalled: false, format: 'json' },
    { type: BrowserType.EDGE, name: 'Microsoft Edge', path: null, isInstalled: false, format: 'json' },
    { type: BrowserType.FIREFOX, name: 'Mozilla Firefox', path: null, isInstalled: false, format: 'sqlite' }
  ];
}

/**
 * 检测当前系统上已安装的浏览器
 * @returns {DetectionResult}
 */
function detectBrowsers() {
  try {
    const platform = process.platform;
    let browsers;

    switch (platform) {
      case 'win32':
        browsers = detectBrowsersWindows();
        break;
      case 'darwin':
        browsers = detectBrowsersMacOS();
        break;
      case 'linux':
        browsers = detectBrowsersLinux();
        break;
      default:
        browsers = [];
    }

    return {
      success: true,
      browsers: browsers
    };
  } catch (error) {
    return {
      success: false,
      browsers: [],
      error: error.message
    };
  }
}

/**
 * 根据浏览器类型读取书签
 * @param {string} browserType - 浏览器类型
 * @param {string} [customPath] - 自定义路径 (可选)
 * @returns {Promise<{success: boolean, data: Array, error?: string, browserName?: string}>}
 */
async function readBrowserBookmarks(browserType, customPath = null) {
  let actualPath = customPath;
  let browserName = '';

  if (!actualPath) {
    const detection = detectBrowsers();
    if (!detection.success) {
      return { success: false, data: [], error: detection.error || '无法检测浏览器' };
    }

    const browser = detection.browsers.find(b => b.type === browserType);
    if (!browser) {
      return { success: false, data: [], error: `不支持的浏览器类型: ${browserType}` };
    }

    if (!browser.isInstalled) {
      return { 
        success: false, 
        data: [], 
        error: `${browser.name} 未安装或无法访问书签文件`,
        browserName: browser.name
      };
    }

    actualPath = browser.path;
    browserName = browser.name;
  }

  if (!isFileAccessible(actualPath)) {
    return { success: false, data: [], error: `无法访问书签文件: ${actualPath}` };
  }

  if (browserType === BrowserType.CHROME || browserType === BrowserType.EDGE) {
    const result = await readChromeBookmarks(actualPath);
    if (result.success) {
      result.browserName = browserName || (browserType === BrowserType.CHROME ? 'Google Chrome' : 'Microsoft Edge');
    }
    return result;
  }

  if (browserType === BrowserType.FIREFOX) {
    return { 
      success: false, 
      data: [], 
      error: 'Firefox 书签解析需要 SQLite 支持，目前仅支持手动导出 HTML 文件导入',
      browserName: browserName || 'Mozilla Firefox'
    };
  }

  return { success: false, data: [], error: `不支持的浏览器类型: ${browserType}` };
}

/**
 * 将浏览器检测结果转换为 API 响应格式
 * @param {DetectionResult} result - 检测结果
 * @returns {Object}
 */
function formatDetectionResult(result) {
  if (!result.success) {
    return {
      success: false,
      error: result.error || '检测失败'
    };
  }

  return {
    success: true,
    browsers: result.browsers.map(browser => ({
      type: browser.type,
      name: browser.name,
      isInstalled: browser.isInstalled,
      path: browser.path,
      format: browser.format,
      canAutoSync: browser.isInstalled && browser.format === 'json'
    }))
  };
}

module.exports = {
  BrowserType,
  detectBrowsers,
  readBrowserBookmarks,
  getChromeBookmarksPathWindows,
  getEdgeBookmarksPathWindows,
  getFirefoxBookmarksPathWindows,
  readChromeBookmarks,
  parseChromeJsonBookmarks,
  formatDetectionResult,
  isFileAccessible,
  dirExists
};
