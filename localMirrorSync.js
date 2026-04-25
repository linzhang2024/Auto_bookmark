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
 * 检查值是否为有效字符串
 * @param {any} value - 要检查的值
 * @returns {boolean}
 */
function isValidString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 确保路径是有效字符串
 * @param {any} pathValue - 路径值
 * @param {string} defaultValue - 默认值
 * @returns {string}
 */
function ensureValidPath(pathValue, defaultValue) {
  if (isValidString(pathValue)) {
    return pathValue;
  }
  if (isValidString(defaultValue)) {
    return defaultValue;
  }
  return process.cwd();
}

/**
 * 安全的 path.join，处理空值
 * @param {...string} paths - 路径片段
 * @returns {string|null} - 如果有无效参数返回 null
 */
function safePathJoin(...paths) {
  try {
    const validPaths = paths.filter(p => isValidString(p));
    if (validPaths.length === 0) {
      return null;
    }
    return path.join(...validPaths);
  } catch {
    return null;
  }
}

/**
 * 安全的 fs.existsSync，处理空值
 * @param {string|null} pathValue - 路径
 * @returns {boolean}
 */
function safeExistsSync(pathValue) {
  if (!isValidString(pathValue)) {
    return false;
  }
  try {
    return fs.existsSync(pathValue);
  } catch {
    return false;
  }
}

/**
 * 清理文件名中的非法字符
 * @param {string} name - 原始文件名
 * @returns {string} - 清理后的文件名
 */
function sanitizeFileName(name) {
  if (!name) return 'untitled';
  const nameStr = String(name);
  return nameStr.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * 生成唯一的文件名（处理重名冲突）
 * @param {string} baseName - 基础文件名
 * @param {string} extension - 文件扩展名
 * @param {string} directory - 目标目录
 * @returns {string} - 唯一的文件名
 */
function generateUniqueFileName(baseName, extension, directory) {
  if (!isValidString(directory)) {
    const sanitizedBase = sanitizeFileName(baseName);
    return `${sanitizedBase}${extension}`;
  }

  const sanitizedBase = sanitizeFileName(baseName);
  let fileName = `${sanitizedBase}${extension}`;
  let counter = 1;

  const fullPath = safePathJoin(directory, fileName);
  if (!fullPath) {
    return fileName;
  }

  while (safeExistsSync(fullPath)) {
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
  if (!isValidString(filePath)) {
    return false;
  }
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
  if (!isValidString(url)) {
    return null;
  }
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
    if (!isValidString(url) || !isValidString(destPath)) {
      resolve(false);
      return;
    }

    let isHttps = false;
    try {
      isHttps = url.startsWith('https:');
    } catch {
      resolve(false);
      return;
    }

    const client = isHttps ? https : http;

    let req;
    try {
      req = client.request(url, { method: 'GET', timeout }, (res) => {
        try {
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
            try {
              fileStream.close();
              resolve(true);
            } catch {
              resolve(false);
            }
          });

          fileStream.on('error', () => {
            try {
              if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
              }
            } catch {}
            resolve(false);
          });
        } catch {
          resolve(false);
        }
      });

      req.on('timeout', () => {
        try {
          req.destroy();
        } catch {}
        resolve(false);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.end();
    } catch {
      resolve(false);
    }
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
  if (!isValidString(destDir)) {
    return null;
  }

  const domain = getDomainForFavicon(url);
  if (!domain) {
    return null;
  }

  const sanitizedBase = sanitizeFileName(baseName);
  const tempPath = safePathJoin(destDir, `${sanitizedBase}_temp.ico`);
  
  if (!tempPath) {
    return null;
  }

  const faviconSources = [];
  try {
    faviconSources.push(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
      `https://${domain}/favicon.ico`,
      `https://icons.duckduckgo.com/ip3/${domain}.ico`
    );
  } catch {
    return null;
  }

  for (const faviconUrl of faviconSources) {
    try {
      const success = await downloadFile(faviconUrl, tempPath, timeout);
      if (success && fileExistsAndNonEmpty(tempPath)) {
        const finalFileName = generateUniqueFileName(sanitizedBase, '.ico', destDir);
        const finalPath = safePathJoin(destDir, finalFileName);
        if (finalPath) {
          try {
            fs.renameSync(tempPath, finalPath);
            return finalFileName;
          } catch {
            // 重命名失败，继续尝试
          }
        }
      }
    } catch {
      // 继续尝试下一个源
    }
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
  if (!isValidString(metaPath)) {
    return null;
  }
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
 * @returns {boolean} - 是否写入成功
 */
function writeMeta(metaPath, metaData) {
  if (!isValidString(metaPath)) {
    return false;
  }
  try {
    const content = JSON.stringify(metaData, null, 2);
    fs.writeFileSync(metaPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 根据现有元数据和书签列表检查同步状态
 * @param {Array} items - 书签/文件夹列表
 * @param {string} baseDir - 基础目录
 * @returns {Object} - 同步状态分析结果
 */
function analyzeSyncStatus(items, baseDir) {
  const safeBaseDir = ensureValidPath(baseDir, process.cwd());

  const result = {
    totalFolders: 0,
    totalBookmarks: 0,
    foldersToCreate: [],
    bookmarksToSync: [],
    bookmarksAlreadySynced: [],
    bookmarksWithConflicts: []
  };

  function traverse(itemsList, currentDir) {
    if (!Array.isArray(itemsList)) {
      return;
    }

    const safeCurrentDir = ensureValidPath(currentDir, safeBaseDir);

    for (const item of itemsList) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      try {
        if (item.type === 'folder') {
          result.totalFolders++;
          
          const folderName = sanitizeFileName(item.name);
          const folderPath = safePathJoin(safeCurrentDir, folderName);
          
          if (folderPath && !safeExistsSync(folderPath)) {
            result.foldersToCreate.push({
              name: item.name || folderName,
              path: folderPath,
              sanitizedName: folderName
            });
          }

          const metaPath = folderPath ? safePathJoin(folderPath, '.meta.json') : null;
          const existingMeta = readExistingMeta(metaPath);
          
          if (existingMeta && Array.isArray(existingMeta.bookmarks)) {
            // 文件夹元数据已存在，继续处理子项
          }

          if (item.children && Array.isArray(item.children)) {
            traverse(item.children, folderPath || safeCurrentDir);
          }
        } else if (item.type === 'link') {
          result.totalBookmarks++;
          
          const bookmarkTitle = sanitizeFileName(item.title);
          const expectedIconPath = safePathJoin(safeCurrentDir, `${bookmarkTitle}.ico`);
          const metaPath = safePathJoin(safeCurrentDir, '.meta.json');
          
          const existingMeta = readExistingMeta(metaPath);
          let existingBookmark = null;
          
          if (existingMeta && Array.isArray(existingMeta.bookmarks) && isValidString(item.url)) {
            existingBookmark = existingMeta.bookmarks.find(bm => bm.url === item.url);
          }

          let hasIcon = false;
          if (expectedIconPath) {
            hasIcon = fileExistsAndNonEmpty(expectedIconPath);
          }
          
          if (!hasIcon && existingBookmark && existingBookmark.iconFileName) {
            const existingIconPath = safePathJoin(safeCurrentDir, existingBookmark.iconFileName);
            if (existingIconPath) {
              hasIcon = fileExistsAndNonEmpty(existingIconPath);
            }
          }

          const hasMetaEntry = existingBookmark != null;
          const isCompleted = hasMetaEntry && existingBookmark.syncStatus === SyncStatus.COMPLETED;

          if (hasIcon && isCompleted) {
            result.bookmarksAlreadySynced.push({
              ...item,
              folderPath: safeCurrentDir,
              existingMeta: existingBookmark
            });
          } else {
            const conflictingIcons = [];
            
            try {
              const titleBase = sanitizeFileName(item.title);
              const titlePattern = new RegExp(`^${titleBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d+)?\\.ico$`);
              
              if (safeExistsSync(safeCurrentDir)) {
                const files = fs.readdirSync(safeCurrentDir);
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
            } catch {
              // 忽略冲突检测错误
            }

            const bookmarkInfo = {
              ...item,
              folderPath: safeCurrentDir,
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
      } catch (error) {
        // 单个书签处理失败，继续处理其他书签
        console.warn(`处理书签时发生错误，已跳过: ${error.message}`);
        continue;
      }
    }
  }

  try {
    traverse(items, safeBaseDir);
  } catch (error) {
    console.error(`分析同步状态时发生错误: ${error.message}`);
  }

  return result;
}

/**
 * 创建文件夹结构
 * @param {Array} foldersToCreate - 要创建的文件夹列表
 */
function createFolderStructure(foldersToCreate) {
  if (!Array.isArray(foldersToCreate)) {
    return;
  }

  for (const folder of foldersToCreate) {
    if (!folder || !isValidString(folder.path)) {
      continue;
    }
    try {
      if (!fs.existsSync(folder.path)) {
        fs.mkdirSync(folder.path, { recursive: true });
      }
    } catch (error) {
      console.warn(`创建文件夹失败 ${folder.path}: ${error.message}`);
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
  if (!isValidString(folderPath)) {
    return;
  }

  const metaPath = safePathJoin(folderPath, '.meta.json');
  if (!metaPath) {
    return;
  }

  const existingMeta = readExistingMeta(metaPath);

  const safeFolderName = isValidString(folderName) ? folderName : path.basename(folderPath);
  const safeBookmarks = Array.isArray(bookmarksInFolder) ? bookmarksInFolder : [];

  const metaData = {
    folderName: safeFolderName,
    lastSyncTime: new Date().toISOString(),
    bookmarks: safeBookmarks.map(bm => {
      if (!bm || typeof bm !== 'object') {
        return null;
      }
      return {
        title: bm.title || 'untitled',
        url: bm.url || '',
        iconFileName: bm.iconFileName || null,
        urlStatus: bm.urlStatus || 'unknown',
        lastVisited: bm.lastVisited || null,
        isInvalid: bm.isInvalid || false,
        syncStatus: bm.syncStatus || SyncStatus.PENDING,
        lastSyncTime: bm.lastSyncTime || null
      };
    }).filter(Boolean),
    syncInfo: {
      syncId: syncInfo?.syncId || `sync_${Date.now()}`,
      startTime: syncInfo?.startTime || new Date().toISOString(),
      endTime: new Date().toISOString(),
      totalBookmarks: safeBookmarks.length,
      completedBookmarks: safeBookmarks.filter(bm => bm?.syncStatus === SyncStatus.COMPLETED).length,
      failedBookmarks: safeBookmarks.filter(bm => bm?.syncStatus === SyncStatus.FAILED).length
    }
  };

  if (existingMeta && Array.isArray(existingMeta.bookmarks)) {
    const existingBookmarks = new Map();
    for (const bm of existingMeta.bookmarks) {
      if (bm && isValidString(bm.url)) {
        existingBookmarks.set(bm.url, bm);
      }
    }

    metaData.bookmarks = metaData.bookmarks.map(bm => {
      if (!bm || !isValidString(bm.url)) {
        return bm;
      }
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
  const defaultResult = {
    syncStatus: SyncStatus.FAILED,
    iconFileName: null,
    lastSyncTime: null
  };

  if (!bookmark || typeof bookmark !== 'object') {
    return defaultResult;
  }

  const { 
    timeout = 10000, 
    skipIconDownload = false,
    forceUpdate = false
  } = options || {};

  const folderPath = ensureValidPath(bookmark.folderPath, process.cwd());

  const result = {
    ...bookmark,
    syncStatus: SyncStatus.PENDING,
    iconFileName: bookmark.existingMeta?.iconFileName || null,
    lastSyncTime: bookmark.existingMeta?.lastSyncTime || null
  };

  try {
    let baseFileName = sanitizeFileName(bookmark.title);
    
    if (bookmark.conflicts && Array.isArray(bookmark.conflicts) && bookmark.conflicts.length > 0) {
      let counter = 1;
      let newBaseName = `${baseFileName}_${counter}`;
      
      while (true) {
        const checkPath = safePathJoin(folderPath, `${newBaseName}.ico`);
        if (!checkPath || !safeExistsSync(checkPath)) {
          break;
        }
        counter++;
        newBaseName = `${baseFileName}_${counter}`;
      }
      baseFileName = newBaseName;
    }

    const iconPath = safePathJoin(folderPath, `${baseFileName}.ico`);
    const iconAlreadyExists = iconPath ? fileExistsAndNonEmpty(iconPath) : false;

    if (!skipIconDownload && (!iconAlreadyExists || forceUpdate)) {
      if (!isValidString(bookmark.url)) {
        result.syncStatus = SyncStatus.FAILED;
      } else {
        const downloadedFileName = await downloadFavicon(
          bookmark.url, 
          folderPath, 
          baseFileName, 
          timeout
        );

        if (downloadedFileName) {
          result.iconFileName = downloadedFileName;
          result.syncStatus = SyncStatus.COMPLETED;
        } else {
          result.syncStatus = SyncStatus.FAILED;
        }
      }
    } else {
      if (iconAlreadyExists && iconPath) {
        result.iconFileName = path.basename(iconPath);
      }
      result.syncStatus = SyncStatus.COMPLETED;
    }
  } catch (error) {
    console.warn(`同步书签 "${bookmark.title || 'unknown'}" 时发生错误: ${error.message}`);
    result.syncStatus = SyncStatus.FAILED;
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
  
  if (!Array.isArray(bookmarks)) {
    return groups;
  }
  
  for (const bookmark of bookmarks) {
    if (!bookmark || typeof bookmark !== 'object') {
      continue;
    }
    
    const folderPath = ensureValidPath(bookmark.folderPath, process.cwd());
    
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
  
  if (!Array.isArray(items)) {
    return folderMap;
  }

  const safeBaseDir = ensureValidPath(baseDir, process.cwd());
  
  function traverse(itemsList, currentDir) {
    if (!Array.isArray(itemsList)) {
      return;
    }

    const safeCurrentDir = ensureValidPath(currentDir, safeBaseDir);

    for (const item of itemsList) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      try {
        if (item.type === 'folder') {
          const folderName = item.name || 'untitled';
          const sanitizedName = sanitizeFileName(folderName);
          const folderPath = safePathJoin(safeCurrentDir, sanitizedName);
          
          if (folderPath) {
            folderMap.set(folderPath, folderName);
          }
          
          if (item.children && Array.isArray(item.children)) {
            traverse(item.children, folderPath || safeCurrentDir);
          }
        }
      } catch {
        // 忽略单个文件夹处理错误
        continue;
      }
    }
  }
  
  try {
    traverse(items, safeBaseDir);
  } catch {
    // 忽略遍历错误
  }

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
  const safeOutputDir = ensureValidPath(outputDir, path.join(process.cwd(), 'bookmarks_mirror'));

  const {
    maxConcurrent = 5,
    timeout = 10000,
    skipIconDownload = false,
    forceUpdate = false,
    onProgress = null
  } = options;

  try {
    if (!fs.existsSync(safeOutputDir)) {
      fs.mkdirSync(safeOutputDir, { recursive: true });
    }
  } catch (error) {
    throw new Error(`无法创建输出目录 ${safeOutputDir}: ${error.message}`);
  }

  const syncId = `sync_${Date.now()}`;
  const syncStartTime = new Date().toISOString();

  if (onProgress && typeof onProgress === 'function') {
    try {
      onProgress(0, 0, '正在分析同步状态...');
    } catch {}
  }

  let syncAnalysis;
  let folderInfo;
  
  try {
    syncAnalysis = analyzeSyncStatus(bookmarks, safeOutputDir);
    folderInfo = collectFolderInfo(bookmarks, safeOutputDir);
  } catch (error) {
    throw new Error(`分析同步状态失败: ${error.message}`);
  }

  if (onProgress && typeof onProgress === 'function') {
    try {
      onProgress(0, syncAnalysis.totalBookmarks, 
        `分析完成：需要创建 ${syncAnalysis.foldersToCreate.length} 个文件夹，` +
        `需要同步 ${syncAnalysis.bookmarksToSync.length} 个书签，` +
        `已同步 ${syncAnalysis.bookmarksAlreadySynced.length} 个，` +
        `存在冲突 ${syncAnalysis.bookmarksWithConflicts.length} 个`);
    } catch {}
  }

  if (syncAnalysis.foldersToCreate.length > 0) {
    if (onProgress && typeof onProgress === 'function') {
      try {
        onProgress(0, syncAnalysis.totalBookmarks, `正在创建文件夹结构...`);
      } catch {}
    }
    createFolderStructure(syncAnalysis.foldersToCreate);
  }

  const bookmarksToProcess = [
    ...(syncAnalysis.bookmarksToSync || []),
    ...(syncAnalysis.bookmarksWithConflicts || [])
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
          try {
            const result = await syncSingleBookmark(bookmark, {
              timeout,
              skipIconDownload,
              forceUpdate
            });

            completedCount++;
            if (onProgress && typeof onProgress === 'function') {
              try {
                const message = result.syncStatus === SyncStatus.COMPLETED 
                  ? `已完成: ${result.title || 'unknown'}` 
                  : `失败: ${result.title || 'unknown'}`;
                onProgress(
                  completedCount + (syncAnalysis.bookmarksAlreadySynced?.length || 0), 
                  syncAnalysis.totalBookmarks, 
                  message
                );
              } catch {}
            }

            return result;
          } catch (error) {
            completedCount++;
            const title = bookmark?.title || 'unknown';
            console.warn(`处理书签 "${title}" 时发生未预期的错误: ${error.message}`);
            
            return {
              ...bookmark,
              syncStatus: SyncStatus.FAILED,
              iconFileName: null,
              lastSyncTime: new Date().toISOString()
            };
          }
        })
      )
    );

    for (const result of results) {
      if (result && result.syncStatus === SyncStatus.COMPLETED) {
        syncedResults.push(result);
      } else {
        failedResults.push(result);
      }
    }
  }

  const allBookmarks = [
    ...syncedResults,
    ...failedResults,
    ...(syncAnalysis.bookmarksAlreadySynced || []).map(bm => ({
      ...bm,
      syncStatus: SyncStatus.COMPLETED
    }))
  ];

  const groupedByFolder = groupBookmarksByFolder(allBookmarks);

  if (onProgress && typeof onProgress === 'function') {
    try {
      onProgress(syncAnalysis.totalBookmarks, syncAnalysis.totalBookmarks, '正在更新元数据文件...');
    } catch {}
  }

  for (const [folderPath, folderBookmarks] of groupedByFolder) {
    try {
      const folderName = folderInfo.get(folderPath) || (isValidString(folderPath) ? path.basename(folderPath) : 'unknown');
      updateFolderMeta(folderPath, folderName, folderBookmarks, {
        syncId,
        startTime: syncStartTime
      });
    } catch (error) {
      console.warn(`更新文件夹元数据失败 ${folderPath}: ${error.message}`);
    }
  }

  return {
    syncId,
    startTime: syncStartTime,
    endTime: new Date().toISOString(),
    totalFolders: syncAnalysis.totalFolders || 0,
    totalBookmarks: syncAnalysis.totalBookmarks || 0,
    foldersCreated: syncAnalysis.foldersToCreate?.length || 0,
    bookmarksSynced: syncedResults.length,
    bookmarksAlreadySynced: syncAnalysis.bookmarksAlreadySynced?.length || 0,
    bookmarksFailed: failedResults.length,
    bookmarksWithConflicts: syncAnalysis.bookmarksWithConflicts?.length || 0,
    failedBookmarks: failedResults.map(bm => ({
      title: bm?.title || 'unknown',
      url: bm?.url || ''
    }))
  };
}

/**
 * 检查同步状态（用于断点续传）
 * @param {string} outputDir - 输出目录
 * @returns {Object} - 同步状态摘要
 */
function checkSyncStatus(outputDir) {
  const safeOutputDir = ensureValidPath(outputDir, process.cwd());

  const result = {
    totalFolders: 0,
    totalBookmarks: 0,
    completedBookmarks: 0,
    pendingBookmarks: 0,
    failedBookmarks: 0,
    folders: []
  };

  function scanDirectory(dir) {
    if (!isValidString(dir)) {
      return;
    }

    try {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      const metaPath = safePathJoin(dir, '.meta.json');
      const meta = readExistingMeta(metaPath);

      if (meta && Array.isArray(meta.bookmarks)) {
        result.totalFolders++;
        const folderInfo = {
          path: dir,
          name: meta.folderName || (isValidString(dir) ? path.basename(dir) : 'unknown'),
          lastSyncTime: meta.lastSyncTime || null,
          totalBookmarks: meta.bookmarks.length,
          completedBookmarks: 0,
          pendingBookmarks: 0,
          failedBookmarks: 0
        };

        for (const bookmark of meta.bookmarks) {
          if (!bookmark || typeof bookmark !== 'object') {
            continue;
          }

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
        if (entry && entry.isDirectory && entry.isDirectory()) {
          const subDir = safePathJoin(dir, entry.name);
          if (subDir) {
            scanDirectory(subDir);
          }
        }
      }
    } catch (error) {
      console.warn(`扫描目录时发生错误 ${dir}: ${error.message}`);
    }
  }

  if (safeExistsSync(safeOutputDir)) {
    scanDirectory(safeOutputDir);
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
  collectFolderInfo,
  isValidString,
  ensureValidPath,
  safePathJoin,
  safeExistsSync
};
