/**
 * 本地镜像同步模块
 * 将 Chrome 书签同步到本地文件系统，包含文件夹映射、元数据持久化、图标缓存和同步策略
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ConcurrencyLimiter, extractDomainFromUrl } = require('./bookmarkConverter');

/**
 * 同步状态枚举
 * @readonly
 * @enum {string}
 */
const SyncStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * 元数据文件结构
 * @typedef {Object} MetaData
 * @property {string} folderName - 文件夹名称
 * @property {string} lastSyncTime - 上次同步时间 ISO 字符串
 * @property {Array<BookmarkMeta>} bookmarks - 书签列表
 * @property {SyncInfo} syncInfo - 同步信息
 */

/**
 * 书签元数据
 * @typedef {Object} BookmarkMeta
 * @property {string} title - 书签标题
 * @property {string} url - 书签 URL
 * @property {string} iconFileName - 图标文件名
 * @property {string} urlStatus - URL 检测状态
 * @property {string|null} lastVisited - 上次访问时间
 * @property {boolean} isInvalid - 是否失效
 * @property {string} syncStatus - 同步状态
 * @property {string|null} lastSyncTime - 上次同步时间
 */

/**
 * 同步信息
 * @typedef {Object} SyncInfo
 * @property {string} syncId - 同步 ID
 * @property {string} startTime - 开始时间
 * @property {string|null} endTime - 结束时间
 * @property {number} totalBookmarks - 总书签数
 * @property {number} completedBookmarks - 已完成书签数
 * @property {number} failedBookmarks - 失败书签数
 */

/**
 * 清理文件名中的非法字符
 * @param {string} name - 原始文件名
 * @returns {string} - 清理后的文件名
 */
function sanitizeFileName(name) {
  if (!name) return 'untitled';
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * 生成唯一的文件名（处理重名冲突）
 * @param {string} baseName - 基础文件名
 * @param {string} extension - 文件扩展名
 * @param {string} directory - 目标目录
 * @returns {string} - 唯一的文件名
 */
function generateUniqueFileName(baseName, extension, directory) {
  const sanitizedBase = sanitizeFileName(baseName);
  let fileName = `${sanitizedBase}${extension}`;
  let counter = 1;

  while (fs.existsSync(path.join(directory, fileName))) {
    fileName = `${sanitizedBase}_${counter}${extension}`;
    counter++;
  }

  return fileName;
}

/**
 * 检查文件是否已存在且非空
 * @param {string} filePath - 文件路径
 * @returns {boolean}
 */
function fileExistsAndNonEmpty(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * 从 URL 中提取域名用于 favicon 下载
 * @param {string} url - URL 地址
 * @returns {string|null} - 域名，失败返回 null
 */
function getDomainForFavicon(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

/**
 * 下载文件
 * @param {string} url - 文件 URL
 * @param {string} destPath - 目标路径
 * @param {number} timeout - 超时时间
 * @returns {Promise<boolean>} - 是否下载成功
 */
function downloadFile(url, destPath, timeout = 10000) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;

    const req = client.request(url, { method: 'GET', timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(false);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        resolve(false);
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(true);
      });

      fileStream.on('error', () => {
        try {
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
        } catch {}
        resolve(false);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.end();
  });
}

/**
 * 下载 favicon 图标
 * 尝试多种 favicon 源：
 * 1. Google favicon service
 * 2. 直接访问域名 /favicon.ico
 * 3. DuckDuckGo favicon service
 * 
 * @param {string} url - 书签 URL
 * @param {string} destDir - 目标目录
 * @param {string} baseName - 基础文件名
 * @param {number} timeout - 超时时间
 * @returns {Promise<string|null>} - 成功返回文件名，失败返回 null
 */
async function downloadFavicon(url, destDir, baseName, timeout = 10000) {
  const domain = getDomainForFavicon(url);
  if (!domain) {
    return null;
  }

  const sanitizedBase = sanitizeFileName(baseName);
  const tempPath = path.join(destDir, `${sanitizedBase}_temp.ico`);

  const faviconSources = [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    `https://${domain}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`
  ];

  for (const faviconUrl of faviconSources) {
    try {
      const success = await downloadFile(faviconUrl, tempPath, timeout);
      if (success && fileExistsAndNonEmpty(tempPath)) {
        const finalFileName = generateUniqueFileName(sanitizedBase, '.ico', destDir);
        const finalPath = path.join(destDir, finalFileName);
        fs.renameSync(tempPath, finalPath);
        return finalFileName;
      }
    } catch {}
  }

  try {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch {}

  return null;
}

/**
 * 读取现有的元数据文件
 * @param {string} metaPath - 元数据文件路径
 * @returns {MetaData|null} - 元数据对象，不存在或解析失败返回 null
 */
function readExistingMeta(metaPath) {
  try {
    if (!fs.existsSync(metaPath)) {
      return null;
    }
    const content = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 写入元数据文件
 * @param {string} metaPath - 元数据文件路径
 * @param {MetaData} metaData - 元数据对象
 */
function writeMeta(metaPath, metaData) {
  const content = JSON.stringify(metaData, null, 2);
  fs.writeFileSync(metaPath, content, 'utf-8');
}

/**
 * 根据现有元数据和书签列表检查同步状态
 * @param {Array} items - 书签/文件夹列表
 * @param {string} baseDir - 基础目录
 * @returns {Object} - 同步状态分析结果
 */
function analyzeSyncStatus(items, baseDir) {
  const result = {
    totalFolders: 0,
    totalBookmarks: 0,
    foldersToCreate: [],
    bookmarksToSync: [],
    bookmarksAlreadySynced: [],
    bookmarksWithConflicts: []
  };

  function traverse(itemsList, currentDir) {
    for (const item of itemsList) {
      if (item.type === 'folder') {
        result.totalFolders++;
        const folderName = sanitizeFileName(item.name);
        const folderPath = path.join(currentDir, folderName);
        const metaPath = path.join(folderPath, '.meta.json');

        if (!fs.existsSync(folderPath)) {
          result.foldersToCreate.push({
            name: item.name,
            path: folderPath,
            sanitizedName: folderName
          });
        }

        const existingMeta = readExistingMeta(metaPath);
        const existingBookmarks = new Map();
        
        if (existingMeta && existingMeta.bookmarks) {
          for (const bm of existingMeta.bookmarks) {
            existingBookmarks.set(bm.url, bm);
          }
        }

        if (item.children) {
          traverse(item.children, folderPath);
        }
      } else if (item.type === 'link') {
        result.totalBookmarks++;
        const bookmarkTitle = sanitizeFileName(item.title);
        const expectedIconPath = path.join(currentDir, `${bookmarkTitle}.ico`);
        const metaPath = path.join(currentDir, '.meta.json');
        
        const existingMeta = readExistingMeta(metaPath);
        let existingBookmark = null;
        
        if (existingMeta && existingMeta.bookmarks) {
          existingBookmark = existingMeta.bookmarks.find(bm => bm.url === item.url);
        }

        const hasIcon = fileExistsAndNonEmpty(expectedIconPath) || 
          (existingBookmark && fileExistsAndNonEmpty(path.join(currentDir, existingBookmark.iconFileName)));

        const hasMetaEntry = existingBookmark != null;

        if (hasIcon && hasMetaEntry && existingBookmark.syncStatus === SyncStatus.COMPLETED) {
          result.bookmarksAlreadySynced.push({
            ...item,
            folderPath: currentDir,
            existingMeta: existingBookmark
          });
        } else {
          const titlePattern = new RegExp(`^${sanitizeFileName(item.title)}(_\\d+)?\\.ico$`);
          const conflictingIcons = [];
          
          try {
            if (fs.existsSync(currentDir)) {
              const files = fs.readdirSync(currentDir);
              for (const file of files) {
                if (titlePattern.test(file)) {
                  const iconMeta = existingMeta?.bookmarks?.find(bm => bm.iconFileName === file);
                  if (iconMeta && iconMeta.url !== item.url) {
                    conflictingIcons.push({
                      fileName: file,
                      url: iconMeta.url,
                      title: iconMeta.title
                    });
                  }
                }
              }
            }
          } catch {}

          const bookmarkInfo = {
            ...item,
            folderPath: currentDir,
            hasIcon,
            hasMetaEntry,
            existingMeta: existingBookmark,
            conflicts: conflictingIcons
          };

          if (conflictingIcons.length > 0) {
            result.bookmarksWithConflicts.push(bookmarkInfo);
          } else {
            result.bookmarksToSync.push(bookmarkInfo);
          }
        }
      }
    }
  }

  traverse(items, baseDir);
  return result;
}

/**
 * 创建文件夹结构
 * @param {Array} foldersToCreate - 要创建的文件夹列表
 */
function createFolderStructure(foldersToCreate) {
  for (const folder of foldersToCreate) {
    if (!fs.existsSync(folder.path)) {
      fs.mkdirSync(folder.path, { recursive: true });
    }
  }
}

/**
 * 更新文件夹的元数据信息
 * @param {string} folderPath - 文件夹路径
 * @param {string} folderName - 文件夹名称
 * @param {Array} bookmarksInFolder - 该文件夹中的书签
 * @param {Object} syncInfo - 同步信息
 */
function updateFolderMeta(folderPath, folderName, bookmarksInFolder, syncInfo) {
  const metaPath = path.join(folderPath, '.meta.json');
  const existingMeta = readExistingMeta(metaPath);

  const metaData = {
    folderName: folderName,
    lastSyncTime: new Date().toISOString(),
    bookmarks: bookmarksInFolder.map(bm => ({
      title: bm.title,
      url: bm.url,
      iconFileName: bm.iconFileName || null,
      urlStatus: bm.urlStatus || 'unknown',
      lastVisited: bm.lastVisited || null,
      isInvalid: bm.isInvalid || false,
      syncStatus: bm.syncStatus || SyncStatus.PENDING,
      lastSyncTime: bm.lastSyncTime || null
    })),
    syncInfo: {
      syncId: syncInfo.syncId,
      startTime: syncInfo.startTime,
      endTime: new Date().toISOString(),
      totalBookmarks: bookmarksInFolder.length,
      completedBookmarks: bookmarksInFolder.filter(bm => bm.syncStatus === SyncStatus.COMPLETED).length,
      failedBookmarks: bookmarksInFolder.filter(bm => bm.syncStatus === SyncStatus.FAILED).length
    }
  };

  if (existingMeta) {
    const existingBookmarks = new Map();
    if (existingMeta.bookmarks) {
      for (const bm of existingMeta.bookmarks) {
        existingBookmarks.set(bm.url, bm);
      }
    }

    metaData.bookmarks = metaData.bookmarks.map(bm => {
      const existing = existingBookmarks.get(bm.url);
      if (existing) {
        return {
          ...existing,
          ...bm,
          lastVisited: bm.lastVisited || existing.lastVisited
        };
      }
      return bm;
    });
  }

  writeMeta(metaPath, metaData);
}

/**
 * 同步单个书签
 * @param {Object} bookmark - 书签信息
 * @param {Object} options - 同步选项
 * @returns {Promise<Object>} - 同步结果
 */
async function syncSingleBookmark(bookmark, options) {
  const { 
    timeout = 10000, 
    skipIconDownload = false,
    forceUpdate = false
  } = options;

  const result = {
    ...bookmark,
    syncStatus: SyncStatus.PENDING,
    iconFileName: bookmark.existingMeta?.iconFileName || null,
    lastSyncTime: bookmark.existingMeta?.lastSyncTime || null
  };

  let baseFileName = sanitizeFileName(bookmark.title);
  
  if (bookmark.conflicts && bookmark.conflicts.length > 0) {
    let counter = 1;
    let newBaseName = `${baseFileName}_${counter}`;
    while (fs.existsSync(path.join(bookmark.folderPath, `${newBaseName}.ico`))) {
      counter++;
      newBaseName = `${baseFileName}_${counter}`;
    }
    baseFileName = newBaseName;
  }

  const iconPath = path.join(bookmark.folderPath, `${baseFileName}.ico`);
  const iconAlreadyExists = fileExistsAndNonEmpty(iconPath);

  if (!skipIconDownload && (!iconAlreadyExists || forceUpdate)) {
    const downloadedFileName = await downloadFavicon(
      bookmark.url, 
      bookmark.folderPath, 
      baseFileName, 
      timeout
    );

    if (downloadedFileName) {
      result.iconFileName = downloadedFileName;
      result.syncStatus = SyncStatus.COMPLETED;
    } else {
      result.syncStatus = SyncStatus.FAILED;
    }
  } else {
    if (iconAlreadyExists) {
      result.iconFileName = `${baseFileName}.ico`;
    }
    result.syncStatus = SyncStatus.COMPLETED;
  }

  result.lastSyncTime = new Date().toISOString();
  return result;
}

/**
 * 按文件夹分组书签
 * @param {Array} bookmarks - 书签列表
 * @returns {Map<string, Array>} - 按文件夹路径分组的书签
 */
function groupBookmarksByFolder(bookmarks) {
  const groups = new Map();
  
  for (const bookmark of bookmarks) {
    const folderPath = bookmark.folderPath;
    if (!groups.has(folderPath)) {
      groups.set(folderPath, []);
    }
    groups.get(folderPath).push(bookmark);
  }
  
  return groups;
}

/**
 * 从书签结构中收集所有文件夹信息
 * @param {Array} items - 书签/文件夹列表
 * @param {string} baseDir - 基础目录
 * @returns {Map<string, string>} - 文件夹路径到文件夹名称的映射
 */
function collectFolderInfo(items, baseDir) {
  const folderMap = new Map();
  
  function traverse(itemsList, currentDir) {
    for (const item of itemsList) {
      if (item.type === 'folder') {
        const folderName = sanitizeFileName(item.name);
        const folderPath = path.join(currentDir, folderName);
        folderMap.set(folderPath, item.name);
        
        if (item.children) {
          traverse(item.children, folderPath);
        }
      }
    }
  }
  
  traverse(items, baseDir);
  return folderMap;
}

/**
 * 执行本地镜像同步
 * @param {Array} bookmarks - 解析后的书签列表
 * @param {string} outputDir - 输出目录
 * @param {Object} options - 同步选项
 * @param {number} options.maxConcurrent - 最大并发数
 * @param {number} options.timeout - 超时时间（毫秒）
 * @param {boolean} options.skipIconDownload - 是否跳过图标下载
 * @param {boolean} options.forceUpdate - 是否强制更新（忽略已存在的文件）
 * @param {function} options.onProgress - 进度回调函数 (current, total, message)
 * @returns {Promise<Object>} - 同步结果
 */
async function syncToLocalMirror(bookmarks, outputDir, options = {}) {
  const {
    maxConcurrent = 5,
    timeout = 10000,
    skipIconDownload = false,
    forceUpdate = false,
    onProgress = null
  } = options;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const syncId = `sync_${Date.now()}`;
  const syncStartTime = new Date().toISOString();

  if (onProgress) {
    onProgress(0, 0, '正在分析同步状态...');
  }

  const syncAnalysis = analyzeSyncStatus(bookmarks, outputDir);
  const folderInfo = collectFolderInfo(bookmarks, outputDir);

  if (onProgress) {
    onProgress(0, syncAnalysis.totalBookmarks, `分析完成：需要创建 ${syncAnalysis.foldersToCreate.length} 个文件夹，需要同步 ${syncAnalysis.bookmarksToSync.length} 个书签，已同步 ${syncAnalysis.bookmarksAlreadySynced.length} 个，存在冲突 ${syncAnalysis.bookmarksWithConflicts.length} 个`);
  }

  if (syncAnalysis.foldersToCreate.length > 0) {
    if (onProgress) {
      onProgress(0, syncAnalysis.totalBookmarks, `正在创建文件夹结构...`);
    }
    createFolderStructure(syncAnalysis.foldersToCreate);
  }

  const bookmarksToProcess = [
    ...syncAnalysis.bookmarksToSync,
    ...syncAnalysis.bookmarksWithConflicts
  ];

  const totalToProcess = bookmarksToProcess.length;
  let completedCount = 0;

  const syncedResults = [];
  const failedResults = [];

  if (totalToProcess > 0) {
    const limiter = new ConcurrencyLimiter(maxConcurrent);

    const results = await Promise.all(
      bookmarksToProcess.map((bookmark) =>
        limiter.add(async () => {
          const result = await syncSingleBookmark(bookmark, {
            timeout,
            skipIconDownload,
            forceUpdate
          });

          completedCount++;
          if (onProgress) {
            const message = result.syncStatus === SyncStatus.COMPLETED 
              ? `已完成: ${result.title}` 
              : `失败: ${result.title}`;
            onProgress(completedCount + syncAnalysis.bookmarksAlreadySynced.length, 
                       syncAnalysis.totalBookmarks, 
                       message);
          }

          return result;
        })
      )
    );

    for (const result of results) {
      if (result.syncStatus === SyncStatus.COMPLETED) {
        syncedResults.push(result);
      } else {
        failedResults.push(result);
      }
    }
  }

  const allBookmarks = [
    ...syncedResults,
    ...failedResults,
    ...syncAnalysis.bookmarksAlreadySynced.map(bm => ({
      ...bm,
      syncStatus: SyncStatus.COMPLETED
    }))
  ];

  const groupedByFolder = groupBookmarksByFolder(allBookmarks);

  if (onProgress) {
    onProgress(syncAnalysis.totalBookmarks, syncAnalysis.totalBookmarks, '正在更新元数据文件...');
  }

  for (const [folderPath, folderBookmarks] of groupedByFolder) {
    const folderName = folderInfo.get(folderPath) || path.basename(folderPath);
    updateFolderMeta(folderPath, folderName, folderBookmarks, {
      syncId,
      startTime: syncStartTime
    });
  }

  return {
    syncId,
    startTime: syncStartTime,
    endTime: new Date().toISOString(),
    totalFolders: syncAnalysis.totalFolders,
    totalBookmarks: syncAnalysis.totalBookmarks,
    foldersCreated: syncAnalysis.foldersToCreate.length,
    bookmarksSynced: syncedResults.length,
    bookmarksAlreadySynced: syncAnalysis.bookmarksAlreadySynced.length,
    bookmarksFailed: failedResults.length,
    bookmarksWithConflicts: syncAnalysis.bookmarksWithConflicts.length,
    failedBookmarks: failedResults.map(bm => ({
      title: bm.title,
      url: bm.url
    }))
  };
}

/**
 * 检查同步状态（用于断点续传）
 * @param {string} outputDir - 输出目录
 * @returns {Object} - 同步状态摘要
 */
function checkSyncStatus(outputDir) {
  const result = {
    totalFolders: 0,
    totalBookmarks: 0,
    completedBookmarks: 0,
    pendingBookmarks: 0,
    failedBookmarks: 0,
    folders: []
  };

  function scanDirectory(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const metaPath = path.join(dir, '.meta.json');
      const meta = readExistingMeta(metaPath);

      if (meta && meta.bookmarks) {
        result.totalFolders++;
        const folderInfo = {
          path: dir,
          name: meta.folderName,
          lastSyncTime: meta.lastSyncTime,
          totalBookmarks: meta.bookmarks.length,
          completedBookmarks: 0,
          pendingBookmarks: 0,
          failedBookmarks: 0
        };

        for (const bookmark of meta.bookmarks) {
          result.totalBookmarks++;
          switch (bookmark.syncStatus) {
            case SyncStatus.COMPLETED:
              result.completedBookmarks++;
              folderInfo.completedBookmarks++;
              break;
            case SyncStatus.FAILED:
              result.failedBookmarks++;
              folderInfo.failedBookmarks++;
              break;
            default:
              result.pendingBookmarks++;
              folderInfo.pendingBookmarks++;
              break;
          }
        }

        result.folders.push(folderInfo);
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          scanDirectory(path.join(dir, entry.name));
        }
      }
    } catch {}
  }

  if (fs.existsSync(outputDir)) {
    scanDirectory(outputDir);
  }

  return result;
}

module.exports = {
  SyncStatus,
  syncToLocalMirror,
  checkSyncStatus,
  analyzeSyncStatus,
  downloadFavicon,
  sanitizeFileName,
  generateUniqueFileName,
  readExistingMeta,
  writeMeta,
  createFolderStructure,
  groupBookmarksByFolder,
  collectFolderInfo
};
