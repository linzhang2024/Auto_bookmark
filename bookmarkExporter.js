/**
 * 书签HTML导出模块
 * 将内部书签结构转换为浏览器通用的HTML格式
 * 兼容 Chrome、Edge、Firefox 等主流浏览器
 */

const fs = require('fs');
const path = require('path');

/**
 * 将 Unix 时间戳转换为秒级字符串
 * @param {Date|number|null} date - 日期对象或时间戳
 * @returns {string} - 秒级时间戳字符串
 */
function toTimestamp(date) {
  if (!date) return Math.floor(Date.now() / 1000).toString();
  if (date instanceof Date) {
    return Math.floor(date.getTime() / 1000).toString();
  }
  if (typeof date === 'number') {
    return Math.floor(date / 1000).toString();
  }
  return Math.floor(Date.now() / 1000).toString();
}

/**
 * 转义 HTML 特殊字符
 * @param {string} text - 原始文本
 * @returns {string} - 转义后的文本
 */
function escapeHtml(text) {
  if (!text) return '';
  const textStr = String(text);
  return textStr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 获取浏览器类型名称
 * @param {string} browserType - 浏览器类型标识
 * @returns {string} - 浏览器名称
 */
function getBrowserName(browserType) {
  const names = {
    'chrome': 'Google Chrome',
    'edge': 'Microsoft Edge',
    'firefox': 'Mozilla Firefox',
    'safari': 'Safari',
    'manual_upload': '手动上传'
  };
  return names[browserType] || 'Bookmarks';
}

/**
 * 递归构建HTML内容
 * @param {Array} items - 书签/文件夹列表
 * @param {number} indent - 缩进层级
 * @returns {string} - HTML片段
 */
function buildHtmlContent(items, indent = 0) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  const lines = [];
  const indentStr = '    '.repeat(indent);

  for (const item of items) {
    if (!item) continue;

    if (item.type === 'folder') {
      const addDate = toTimestamp(item.addDate);
      const lastModified = toTimestamp(item.lastModified);
      const folderName = escapeHtml(item.name || 'Untitled Folder');

      lines.push(`${indentStr}<DT><H3 ADD_DATE="${addDate}" LAST_MODIFIED="${lastModified}">${folderName}</H3>`);
      lines.push(`${indentStr}<DL><p>`);

      if (item.children && Array.isArray(item.children)) {
        const childrenContent = buildHtmlContent(item.children, indent + 1);
        if (childrenContent) {
          lines.push(childrenContent);
        }
      }

      lines.push(`${indentStr}</DL><p>`);
    } else if (item.type === 'link') {
      const href = item.url || '';
      const addDate = toTimestamp(item.addDate);
      const lastModified = toTimestamp(item.lastModified);
      const title = escapeHtml(item.title || 'Untitled');

      let attrs = [];
      attrs.push(`HREF="${escapeHtml(href)}"`);
      attrs.push(`ADD_DATE="${addDate}"`);

      if (item.lastVisit) {
        attrs.push(`LAST_VISIT="${toTimestamp(item.lastVisit)}"`);
      }

      if (item.lastModified) {
        attrs.push(`LAST_MODIFIED="${lastModified}"`);
      }

      if (item.icon) {
        attrs.push(`ICON="${escapeHtml(item.icon)}"`);
      }

      if (item.iconUri) {
        attrs.push(`ICON_URI="${escapeHtml(item.iconUri)}"`);
      }

      lines.push(`${indentStr}<DT><A ${attrs.join(' ')}>${title}</A>`);
    }
  }

  return lines.join('\n');
}

/**
 * 将书签结构转换为浏览器通用的HTML格式
 * @param {Array} bookmarks - 解析后的书签列表
 * @param {Object} options - 选项
 * @param {string} options.browserSource - 浏览器来源
 * @param {string} options.title - 标题
 * @returns {string} - HTML内容
 */
function convertToHtml(bookmarks, options = {}) {
  const { browserSource = 'manual_upload', title = null } = options;

  const browserName = title || getBrowserName(browserSource);

  const htmlParts = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<TITLE>${escapeHtml(browserName)}</TITLE>`,
    `<H1>${escapeHtml(browserName)}</H1>`,
    '<DL><p>'
  ];

  if (Array.isArray(bookmarks)) {
    const content = buildHtmlContent(bookmarks, 1);
    if (content) {
      htmlParts.push(content);
    }
  }

  htmlParts.push('</DL><p>');

  return htmlParts.join('\n');
}

/**
 * 从本地镜像目录读取书签结构并转换为HTML
 * @param {string} mirrorDir - 本地镜像目录
 * @param {Object} options - 选项
 * @param {string} options.browserSource - 浏览器来源
 * @returns {Promise<string>} - HTML内容
 */
async function convertFromMirrorToHtml(mirrorDir, options = {}) {
  const { browserSource = 'manual_upload' } = options;

  if (!fs.existsSync(mirrorDir)) {
    throw new Error(`镜像目录不存在: ${mirrorDir}`);
  }

  const bookmarks = await collectBookmarksFromMirror(mirrorDir);
  return convertToHtml(bookmarks, { browserSource });
}

/**
 * 从本地镜像目录收集书签结构
 * @param {string} dir - 目录路径
 * @returns {Promise<Array>} - 书签列表
 */
async function collectBookmarksFromMirror(dir) {
  const result = [];

  async function scanDirectory(currentDir, folderPath = '') {
    const metaPath = path.join(currentDir, '.meta.json');
    let meta = null;

    if (fs.existsSync(metaPath)) {
      try {
        const metaContent = fs.readFileSync(metaPath, 'utf-8');
        meta = JSON.parse(metaContent);
      } catch {
        meta = null;
      }
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    const folders = [];
    const bookmarks = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        folders.push({
          name: entry.name,
          path: fullPath
        });
      } else if (entry.name.endsWith('.ico')) {
        const baseName = path.basename(entry.name, '.ico');
        if (meta && meta.bookmarks) {
          const bookmark = meta.bookmarks.find(bm => 
            bm.iconFileName === entry.name || 
            (bm.title && path.basename(bm.title, '.ico') === baseName)
          );
          if (bookmark) {
            bookmarks.push({
              type: 'link',
              title: bookmark.title || baseName,
              url: bookmark.url || '',
              addDate: bookmark.lastSyncTime ? new Date(bookmark.lastSyncTime) : null,
              iconUri: null
            });
          }
        }
      }
    }

    if (meta && meta.bookmarks) {
      for (const bm of meta.bookmarks) {
        const exists = bookmarks.some(b => b.url === bm.url);
        if (!exists && bm.url) {
          bookmarks.push({
            type: 'link',
            title: bm.title || 'Untitled',
            url: bm.url,
            addDate: bm.lastSyncTime ? new Date(bm.lastSyncTime) : null,
            iconUri: null
          });
        }
      }
    }

    for (const bm of bookmarks) {
      result.push({
        ...bm,
        folderPath: folderPath
      });
    }

    for (const folder of folders) {
      const folderBookmarks = [];
      const subResult = await scanDirectory(folder.path, folderPath ? `${folderPath}/${folder.name}` : folder.name);
      
      if (subResult.length > 0) {
        result.push({
          type: 'folder',
          name: folder.name,
          children: subResult,
          addDate: meta?.lastSyncTime ? new Date(meta.lastSyncTime) : null
        });
      }
    }

    return bookmarks;
  }

  await scanDirectory(dir);
  return result;
}

/**
 * 生成备份文件名（基于时间戳）
 * @param {string} browserSource - 浏览器来源
 * @param {Date|null} date - 日期对象，默认当前时间
 * @returns {string} - 文件名
 */
function generateBackupFilename(browserSource = 'manual_upload', date = null) {
  const d = date || new Date();
  const timestamp = d.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .substring(0, 15);
  
  const browserName = browserSource.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `bookmarks_${browserName}_${timestamp}.html`;
}

/**
 * 将书签保存为HTML文件
 * @param {Array} bookmarks - 书签列表
 * @param {string} outputPath - 输出文件路径
 * @param {Object} options - 选项
 * @param {string} options.browserSource - 浏览器来源
 * @returns {Promise<string>} - 保存的文件路径
 */
async function saveBookmarksToHtml(bookmarks, outputPath, options = {}) {
  const htmlContent = convertToHtml(bookmarks, options);
  
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, htmlContent, 'utf-8');
  return outputPath;
}

/**
 * 从本地镜像创建备份文件
 * @param {string} mirrorDir - 本地镜像目录
 * @param {string} backupDir - 备份目录
 * @param {Object} options - 选项
 * @param {string} options.browserSource - 浏览器来源
 * @returns {Promise<string>} - 备份文件路径
 */
async function createBackupFromMirror(mirrorDir, backupDir, options = {}) {
  const { browserSource = 'manual_upload' } = options;

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const filename = generateBackupFilename(browserSource);
  const outputPath = path.join(backupDir, filename);

  try {
    const htmlContent = await convertFromMirrorToHtml(mirrorDir, { browserSource });
    fs.writeFileSync(outputPath, htmlContent, 'utf-8');
    return outputPath;
  } catch (error) {
    console.error('创建备份失败:', error.message);
    throw error;
  }
}

/**
 * 直接从书签数据创建备份文件
 * @param {Array} bookmarks - 书签列表（解析后的结构）
 * @param {string} backupDir - 备份目录
 * @param {Object} options - 选项
 * @param {string} options.browserSource - 浏览器来源
 * @returns {Promise<string>} - 备份文件路径
 */
async function createBackupFromBookmarks(bookmarks, backupDir, options = {}) {
  const { browserSource = 'manual_upload' } = options;

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const filename = generateBackupFilename(browserSource);
  const outputPath = path.join(backupDir, filename);

  await saveBookmarksToHtml(bookmarks, outputPath, { browserSource });
  return outputPath;
}

module.exports = {
  convertToHtml,
  convertFromMirrorToHtml,
  collectBookmarksFromMirror,
  generateBackupFilename,
  saveBookmarksToHtml,
  createBackupFromMirror,
  createBackupFromBookmarks,
  getBrowserName,
  escapeHtml,
  toTimestamp
};
