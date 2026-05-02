const fs = require('fs');
const path = require('path');
const net = require('net');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { 
  syncToLocalMirror, 
  checkSyncStatus, 
  SyncStatus 
} = require('./localMirrorSync');
const { 
  parseChromeBookmarks,
  parseBookmarks,
  countBookmarks,
  countFolders
} = require('./bookmarkConverter');
const User = require('./userModel');
const Role = require('./roleModel');
const Document = require('./documentModel');
const { AuthMiddleware, DOC_WRITE_PERMISSION, ADMIN_PERMISSION, USER_LIST_PERMISSION, USER_UPDATE_PERMISSION } = require('./authMiddleware');
const { initDatabase, DocumentStatus } = require('./database');
const { 
  detectBrowsers, 
  readBrowserBookmarks, 
  formatDetectionResult,
  BrowserType 
} = require('./browserBookmarkFinder');
const { BookmarkDeduplicator } = require('./BookmarkDeduplicator');

const JWT_SECRET = process.env.JWT_SECRET || 'auto-bookmark-jwt-secret-key-2024';
const JWT_EXPIRES_IN = '24h';

function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      email: user.email,
      role_id: user.role_id
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.substring(7) 
    : req.query.token || req.body.token;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: '未授权：缺少身份令牌'
    });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      message: '未授权：令牌无效或已过期'
    });
  }

  const user = await User.findByIdWithRole(decoded.id);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: '未授权：用户不存在'
    });
  }

  if (!user.is_enabled) {
    return res.status(403).json({
      success: false,
      message: '账号已被禁用，请联系管理员'
    });
  }

  req.user = user.toJSON();
  next();
}

async function adminMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: '未授权：请先登录'
    });
  }

  const isAdmin = await AuthMiddleware.isAdmin(req.user.id);
  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      message: '禁止访问：需要管理员权限'
    });
  }

  next();
}

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error.message);
  if (error.code === 'EADDRINUSE') {
    console.log('提示: 端口冲突，但动态端口探测应该已处理此情况');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DEFAULT_START_PORT = config.startPort || 4000;
const MAX_PORT_ATTEMPTS = config.maxPortAttempts || 50;
const DEFAULT_SYNC_DIR = config.syncDir || path.join(__dirname, 'bookmarks_mirror');
const DEFAULT_UPLOAD_DIR = path.join(__dirname, 'uploads');

let currentSyncDir = DEFAULT_SYNC_DIR;
let isSyncing = false;
let currentSyncTask = null;

let connectedClients = new Set();

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort = DEFAULT_START_PORT) {
  let port = startPort;
  let attempts = 0;
  
  while (attempts < MAX_PORT_ATTEMPTS) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
    console.log(`端口 ${port} 已被占用，尝试端口 ${port + 1}...`);
    port++;
    attempts++;
  }
  
  throw new Error(`在尝试了 ${MAX_PORT_ATTEMPTS} 个端口后，未找到可用端口 (范围: ${startPort} - ${startPort + MAX_PORT_ATTEMPTS - 1})`);
}

async function ensureTestUsers() {
  try {
    console.log('正在检查测试用户...');
    
    const adminRole = await Role.findByName('admin');
    const userRole = await Role.findByName('user');
    
    if (!adminRole) {
      console.log('警告: 管理员角色不存在，测试用户可能无法正常工作');
      return;
    }
    
    if (!userRole) {
      console.log('警告: 普通用户角色不存在，测试用户可能无法正常工作');
      return;
    }
    
    let adminUser = await User.findByUsername('admin');
    if (!adminUser) {
      console.log('创建管理员账户 (admin/admin123)...');
      adminUser = await User.create(
        'admin',
        'admin123',
        'admin@example.com',
        adminRole.id
      );
      console.log('✓ 管理员账户创建成功');
    } else {
      console.log('✓ 管理员账户已存在');
    }
    
    let testUser = await User.findByUsername('user');
    if (!testUser) {
      console.log('创建普通用户账户 (user/user123)...');
      testUser = await User.create(
        'user',
        'user123',
        'user@example.com',
        userRole.id
      );
      console.log('✓ 普通用户账户创建成功');
    } else {
      console.log('✓ 普通用户账户已存在');
    }
    
  } catch (error) {
    console.error('初始化测试用户失败:', error.message);
    console.error('将继续启动服务器，但测试用户可能不可用');
  }
}

async function startServer() {
  let actualPort;
  
  try {
    console.log('正在初始化数据库...');
    await initDatabase();
    console.log('数据库初始化完成');
    
    await ensureTestUsers();
    
    console.log('正在确保上传目录存在...');
    if (!fs.existsSync(DEFAULT_UPLOAD_DIR)) {
      fs.mkdirSync(DEFAULT_UPLOAD_DIR, { recursive: true });
      console.log(`✓ 上传目录已创建: ${DEFAULT_UPLOAD_DIR}`);
    } else {
      console.log(`✓ 上传目录已存在: ${DEFAULT_UPLOAD_DIR}`);
    }
    
  } catch (error) {
    console.error('初始化失败:', error.message);
    console.error('将继续启动服务器，但部分功能可能不可用');
  }
  
  try {
    if (process.env.PORT) {
      const envPort = parseInt(process.env.PORT, 10);
      if (!isNaN(envPort) && envPort > 0 && envPort < 65536) {
        const available = await isPortAvailable(envPort);
        if (available) {
          actualPort = envPort;
        } else {
          console.log(`环境变量指定的端口 ${envPort} 不可用，将自动查找可用端口...`);
          actualPort = await findAvailablePort(DEFAULT_START_PORT);
        }
      } else {
        actualPort = await findAvailablePort(DEFAULT_START_PORT);
      }
    } else {
      actualPort = await findAvailablePort(DEFAULT_START_PORT);
    }
  } catch (error) {
    console.error('查找可用端口失败:', error.message);
    console.log('尝试使用动态端口模式 (端口 0)...');
    actualPort = 0;
  }

  return new Promise((resolve, reject) => {
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${actualPort} 仍然不可用`));
      } else {
        reject(error);
      }
    });

    server.listen(actualPort, '127.0.0.1', () => {
      const address = server.address();
      const finalPort = address.port;
      
      console.log(`\n═══════════════════════════════════════════`);
      console.log(`  本地镜像同步 - Web 管理后台已启动`);
      console.log(`═══════════════════════════════════════════`);
      console.log(`  服务器已在 http://localhost:${finalPort} 成功运行`);
      console.log(`  默认同步目录: ${DEFAULT_SYNC_DIR}`);
      console.log(`═══════════════════════════════════════════\n`);
      
      resolve(finalPort);
    });
  });
}

function broadcast(message) {
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

function formatSyncStatusForClient(status) {
  const total = status.totalBookmarks;
  const completed = status.completedBookmarks;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    type: 'status',
    data: {
      totalFolders: status.totalFolders,
      totalBookmarks: total,
      completedBookmarks: completed,
      pendingBookmarks: status.pendingBookmarks,
      failedBookmarks: status.failedBookmarks,
      successRate,
      folders: status.folders,
      lastUpdated: new Date().toISOString(),
      isSyncing,
      syncDir: currentSyncDir
    }
  };
}

function getRecentIcons(dir, limit = 10) {
  const icons = [];
  
  function scanDirectory(dirPath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.ico') && !entry.name.startsWith('.')) {
          const fullPath = path.join(dirPath, entry.name);
          try {
            const stats = fs.statSync(fullPath);
            const relativePath = path.relative(dir, fullPath);
            icons.push({
              name: entry.name,
              path: relativePath,
              folder: path.basename(path.dirname(fullPath)) || '根目录',
              size: stats.size,
              mtime: stats.mtime
            });
          } catch {}
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scanDirectory(path.join(dirPath, entry.name));
        }
      }
    } catch {}
  }

  if (fs.existsSync(dir)) {
    scanDirectory(dir);
  }

  icons.sort((a, b) => b.mtime - a.mtime);
  return icons.slice(0, limit);
}

function getHtmlFiles(dir) {
  try {
    const files = fs.readdirSync(dir);
    const htmlFiles = files
      .filter(file => file.toLowerCase().endsWith('.html'))
      .map(file => {
        const fullPath = path.join(dir, file);
        try {
          const stats = fs.statSync(fullPath);
          return {
            name: file,
            path: fullPath,
            mtime: stats.mtime
          };
        } catch {
          return { name: file, path: fullPath, mtime: null };
        }
      });
    return htmlFiles.sort((a, b) => {
      if (a.mtime && b.mtime) return b.mtime - a.mtime;
      return 0;
    });
  } catch {
    return [];
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  const status = checkSyncStatus(currentSyncDir);
  res.json(formatSyncStatusForClient(status).data);
});

app.get('/api/config', (req, res) => {
  res.json({
    filterPatterns: config.filterPatterns,
    syncDir: currentSyncDir
  });
});

app.post('/api/config', (req, res) => {
  try {
    const { filterPatterns, syncDir } = req.body;

    if (filterPatterns && Array.isArray(filterPatterns)) {
      const validPatterns = filterPatterns.filter(p => 
        typeof p === 'string' && p.trim().length > 0
      );
      
      const configPath = path.join(__dirname, 'config.js');
      let configContent = fs.readFileSync(configPath, 'utf-8');
      
      const patternsArrayStr = validPatterns.map(p => `'${p.replace(/'/g, "\\'")}'`).join(',\n    ');
      
      const newFilterPatterns = `  filterPatterns: [
    // 本地开发环境
    ${patternsArrayStr},
  ],`;
      
      configContent = configContent.replace(
        /  filterPatterns: \[[\s\S]*?\],/,
        newFilterPatterns
      );

      fs.writeFileSync(configPath, configContent, 'utf-8');
      
      delete require.cache[require.resolve('./config')];
      Object.assign(config, require('./config'));
    }

    if (syncDir && typeof syncDir === 'string') {
      currentSyncDir = path.resolve(syncDir);
    }

    res.json({ success: true, message: '配置已更新' });
    broadcast({
      type: 'notification',
      data: {
        message: '配置已更新',
        type: 'success'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/icons', (req, res) => {
  const icons = getRecentIcons(currentSyncDir, 20);
  res.json({
    icons: icons.map(icon => ({
      name: icon.name,
      path: `/api/icons-file?path=${encodeURIComponent(icon.path)}`,
      folder: icon.folder,
      mtime: icon.mtime
    }))
  });
});

app.get('/api/icons-file', (req, res) => {
  const iconPath = req.query.path;
  if (!iconPath) {
    return res.status(400).json({ error: '缺少路径参数' });
  }
  
  const decodedPath = decodeURIComponent(iconPath);
  const fullPath = path.join(currentSyncDir, decodedPath);
  
  try {
    if (fs.existsSync(fullPath) && fullPath.startsWith(currentSyncDir)) {
      res.setHeader('Content-Type', 'image/x-icon');
      fs.createReadStream(fullPath).pipe(res);
    } else {
      res.status(404).json({ error: '图标不存在' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bookmark-files', (req, res) => {
  const files = getHtmlFiles(__dirname);
  res.json({
    files: files.map(f => ({
      name: f.name,
      path: f.path,
      mtime: f.mtime
    }))
  });
});

app.post('/api/sync', async (req, res) => {
  if (isSyncing) {
    return res.status(400).json({ 
      success: false, 
      message: '同步任务正在进行中' 
    });
  }

  const { 
    bookmarksPath,
    bookmarksContent,
    syncDir,
    skipIcon = false,
    force = false,
    concurrency,
    timeout
  } = req.body;

  const actualConcurrency = concurrency !== undefined ? concurrency : config.maxConcurrency;
  const actualTimeout = timeout !== undefined ? timeout : config.iconTimeout;

  let htmlContent = null;
  let sourcePath = null;

  if (bookmarksContent && typeof bookmarksContent === 'string' && bookmarksContent.trim()) {
    htmlContent = bookmarksContent;
    sourcePath = 'uploaded_content';
  } else if (bookmarksPath && fs.existsSync(bookmarksPath)) {
    htmlContent = fs.readFileSync(bookmarksPath, 'utf-8');
    sourcePath = bookmarksPath;
  } else {
    return res.status(400).json({ 
      success: false, 
      message: '请提供有效的书签 HTML 文件路径或内容' 
    });
  }

  const targetSyncDir = syncDir ? path.resolve(syncDir) : currentSyncDir;

  isSyncing = true;
  
  const taskInfo = {
    taskId: `sync_${Date.now()}`,
    startTime: new Date().toISOString(),
    bookmarksPath: sourcePath,
    syncDir: targetSyncDir
  };

  currentSyncTask = taskInfo;

  res.json({ 
    success: true, 
    message: '同步任务已启动',
    taskInfo
  });

  broadcast({
    type: 'sync_started',
    data: taskInfo
  });

  try {
    const bookmarks = parseBookmarks(htmlContent);
    const totalBookmarks = countBookmarks(bookmarks);
    const totalFolders = countFolders(bookmarks);

    broadcast({
      type: 'sync_progress',
      data: {
        current: 0,
        total: totalBookmarks,
        message: `发现 ${totalFolders} 个文件夹，${totalBookmarks} 个书签，开始同步...`,
        phase: 'analyzing'
      }
    });

    let completedCount = 0;
    let lastProgressTime = Date.now();

    const result = await syncToLocalMirror(bookmarks, targetSyncDir, {
      maxConcurrent: actualConcurrency,
      timeout: actualTimeout,
      skipIconDownload: skipIcon,
      forceUpdate: force,
      onProgress: (current, total, message) => {
        const now = Date.now();
        if (now - lastProgressTime > 500 || current === total) {
          broadcast({
            type: 'sync_progress',
            data: {
              current,
              total,
              message,
              phase: 'syncing'
            }
          });
          lastProgressTime = now;
        }
      }
    });

    broadcast({
      type: 'sync_completed',
      data: {
        taskId: taskInfo.taskId,
        result: {
          ...result,
          endTime: new Date().toISOString()
        }
      }
    });

    const status = checkSyncStatus(targetSyncDir);
    broadcast(formatSyncStatusForClient(status));

  } catch (error) {
    console.error('同步任务失败:', error);
    broadcast({
      type: 'sync_failed',
      data: {
        taskId: taskInfo.taskId,
        error: error.message
      }
    });
  } finally {
    isSyncing = false;
    currentSyncTask = null;
  }
});

app.post('/api/cancel-sync', (req, res) => {
  if (isSyncing) {
    res.json({ success: true, message: '已发送取消请求' });
  } else {
    res.json({ success: false, message: '当前没有正在进行的同步任务' });
  }
});

app.get('/api/browsers', (req, res) => {
  try {
    const detection = detectBrowsers();
    const result = formatDetectionResult(detection);
    res.json(result);
  } catch (error) {
    console.error('检测浏览器失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '检测浏览器失败'
    });
  }
});

app.post('/api/browser-bookmarks', async (req, res) => {
  try {
    const { browserType, customPath } = req.body;
    
    if (!browserType) {
      return res.status(400).json({
        success: false,
        error: '请指定浏览器类型'
      });
    }
    
    const validTypes = [BrowserType.CHROME, BrowserType.EDGE, BrowserType.FIREFOX, BrowserType.SAFARI];
    if (!validTypes.includes(browserType)) {
      return res.status(400).json({
        success: false,
        error: `不支持的浏览器类型: ${browserType}`
      });
    }
    
    const result = await readBrowserBookmarks(browserType, customPath);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        browserName: result.browserName
      });
    }
    
    const totalBookmarks = countBookmarks(result.data);
    const totalFolders = countFolders(result.data);
    
    res.json({
      success: true,
      browserName: result.browserName,
      totalBookmarks,
      totalFolders,
      bookmarks: result.data
    });
    
  } catch (error) {
    console.error('读取浏览器书签失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '读取浏览器书签失败'
    });
  }
});

function flattenBookmarks(items) {
  const result = [];
  
  function traverse(itemsList, folderPath = '') {
    if (!Array.isArray(itemsList)) return;
    
    for (const item of itemsList) {
      if (!item) continue;
      
      if (item.type === 'folder') {
        const newPath = folderPath ? `${folderPath}/${item.name}` : item.name;
        if (item.children) {
          traverse(item.children, newPath);
        }
      } else if (item.type === 'link') {
        result.push({
          ...item,
          folderPath: folderPath
        });
      }
    }
  }
  
  traverse(items);
  return result;
}

function deduplicateBookmarks(newBookmarks, existingBookmarks = []) {
  const deduplicator = new BookmarkDeduplicator({
    urlSimilarityThreshold: 1.0,
    titleSimilarityThreshold: 0.9,
    ignoreUrlParams: true,
    ignoreUrlProtocol: true,
    ignoreUrlTrailingSlash: true,
    keepNewer: true,
    keepMoreComplete: true
  });
  
  const allBookmarks = [
    ...(existingBookmarks || []),
    ...newBookmarks
  ];
  
  const { deduplicated, report } = deduplicator.deduplicate(allBookmarks);
  
  return {
    deduplicated,
    report
  };
}

function collectAllBookmarksWithFolders(items) {
  const result = {
    folders: new Map(),
    bookmarks: []
  };
  
  function traverse(itemsList, currentPath = '') {
    if (!Array.isArray(itemsList)) return;
    
    for (const item of itemsList) {
      if (!item) continue;
      
      if (item.type === 'folder') {
        const folderKey = currentPath ? `${currentPath}/${item.name}` : item.name;
        result.folders.set(folderKey, {
          name: item.name,
          path: folderKey,
          addDate: item.addDate,
          lastModified: item.lastModified
        });
        
        if (item.children) {
          traverse(item.children, folderKey);
        }
      } else if (item.type === 'link') {
        result.bookmarks.push({
          ...item,
          folderPath: currentPath
        });
      }
    }
  }
  
  traverse(items);
  return result;
}

app.post('/api/browser-sync', async (req, res) => {
  if (isSyncing) {
    return res.status(400).json({ 
      success: false, 
      message: '同步任务正在进行中' 
    });
  }

  const { 
    browserType, 
    customPath,
    syncDir,
    skipIcon = false,
    force = false,
    enableDeduplication = true,
    concurrency,
    timeout
  } = req.body;

  if (!browserType) {
    return res.status(400).json({
      success: false,
      error: '请指定浏览器类型'
    });
  }

  const actualConcurrency = concurrency !== undefined ? concurrency : config.maxConcurrency;
  const actualTimeout = timeout !== undefined ? timeout : config.iconTimeout;

  broadcast({
    type: 'browser_sync_status',
    data: {
      phase: 'scanning',
      message: '正在扫描浏览器书签...',
      progress: 0
    }
  });

  let bookmarksData;
  try {
    const readResult = await readBrowserBookmarks(browserType, customPath);
    
    if (!readResult.success) {
      broadcast({
        type: 'browser_sync_failed',
        data: {
          error: readResult.error,
          browserName: readResult.browserName
        }
      });
      return res.status(400).json({
        success: false,
        error: readResult.error,
        browserName: readResult.browserName
      });
    }
    
    bookmarksData = readResult.data;
  } catch (error) {
    broadcast({
      type: 'browser_sync_failed',
      data: {
        error: error.message
      }
    });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }

  const totalBookmarks = countBookmarks(bookmarksData);
  const totalFolders = countFolders(bookmarksData);

  broadcast({
    type: 'browser_sync_status',
    data: {
      phase: 'analyzing',
      message: `分析完成：发现 ${totalFolders} 个文件夹，${totalBookmarks} 个书签`,
      progress: 20
    }
  });

      let duplicatesFound = 0;
  if (enableDeduplication) {
    broadcast({
      type: 'browser_sync_status',
      data: {
        phase: 'deduplicating',
        message: '正在检查重复书签...',
        progress: 30
      }
    });

    const { deduplicated, report } = deduplicateBookmarks(
      flattenBookmarks(bookmarksData)
    );

    if (report.duplicatesFound > 0) {
      console.log(`去重完成：发现 ${report.duplicatesFound} 个重复书签，已合并`);
      duplicatesFound = report.duplicatesFound;
    }
  }

  const targetSyncDir = syncDir ? path.resolve(syncDir) : currentSyncDir;

  isSyncing = true;
  
  const taskInfo = {
    taskId: `browser_sync_${Date.now()}`,
    startTime: new Date().toISOString(),
    browserType,
    customPath,
    syncDir: targetSyncDir
  };

  currentSyncTask = taskInfo;

  res.json({ 
    success: true, 
    message: '浏览器同步任务已启动',
    taskInfo,
    stats: {
      totalBookmarks,
      totalFolders
    }
  });

  broadcast({
    type: 'browser_sync_started',
    data: {
      ...taskInfo,
      totalBookmarks,
      totalFolders
    }
  });

  (async () => {
    try {
      broadcast({
        type: 'browser_sync_status',
        data: {
          phase: 'syncing',
          message: '开始同步书签...',
          progress: 40
        }
      });

      let completedCount = 0;
      let lastProgressTime = Date.now();

      const result = await syncToLocalMirror(bookmarksData, targetSyncDir, {
        maxConcurrent: actualConcurrency,
        timeout: actualTimeout,
        skipIconDownload: skipIcon,
        forceUpdate: force,
        onProgress: (current, total, message) => {
          const now = Date.now();
          if (now - lastProgressTime > 500 || current === total) {
            const progress = 40 + Math.round((current / Math.max(total, 1)) * 50);
            broadcast({
              type: 'browser_sync_status',
              data: {
                phase: 'syncing',
                current,
                total,
                message,
                progress: Math.min(progress, 90)
              }
            });
            lastProgressTime = now;
          }
        }
      });

      broadcast({
        type: 'browser_sync_status',
        data: {
          phase: 'finalizing',
          message: '正在完成同步...',
          progress: 95
        }
      });

      broadcast({
        type: 'browser_sync_completed',
        data: {
          taskId: taskInfo.taskId,
          result: {
            ...result,
            endTime: new Date().toISOString(),
            duplicatesFound: duplicatesFound
          }
        }
      });

      const status = checkSyncStatus(targetSyncDir);
      broadcast(formatSyncStatusForClient(status));

    } catch (error) {
      console.error('浏览器同步任务失败:', error);
      broadcast({
        type: 'browser_sync_failed',
        data: {
          taskId: taskInfo.taskId,
          error: error.message
        }
      });
    } finally {
      isSyncing = false;
      currentSyncTask = null;
    }
  })();
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名和密码都不能为空'
      });
    }

    const user = await User.findByUsernameWithRole(username);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    const isPasswordValid = await User.comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    if (!user.is_enabled) {
      return res.status(403).json({
        success: false,
        message: '账号已被禁用，请联系管理员'
      });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: '登录成功',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role_id: user.role_id,
        is_enabled: user.is_enabled,
        role: user._role ? user._role.toJSON() : null
      }
    });

  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({
      success: false,
      message: '登录失败，请稍后重试'
    });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findByIdWithRole(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role_id: user.role_id,
        is_enabled: user.is_enabled,
        role: user._role ? user._role.toJSON() : null
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: '已退出登录'
  });
});

app.post('/api/users/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password || !email) {
      return res.status(400).json({
        success: false,
        message: '用户名、密码和邮箱都不能为空'
      });
    }

    const user = await User.create(username, password, email);
    res.status(201).json({
      success: true,
      message: '用户注册成功',
      user: user.toJSON()
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: '无效的用户 ID'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      user: user.toJSON()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { username, email, password } = req.body;
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: '无效的用户 ID'
      });
    }

    const updates = {};
    if (username !== undefined) updates.username = username;
    if (email !== undefined) updates.email = email;
    if (password !== undefined) updates.password = password;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的字段'
      });
    }

    const updatedUser = await User.update(userId, updates);
    
    res.json({
      success: true,
      message: '用户信息更新成功',
      user: updatedUser.toJSON()
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: '无效的用户 ID'
      });
    }

    const result = await User.delete(userId);
    
    if (result) {
      res.json({
        success: true,
        message: '用户注销成功'
      });
    }
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.listAllWithRole();
    const roles = await Role.listAll();

    res.json({
      success: true,
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role_id: u.role_id,
        is_enabled: u.is_enabled,
        created_at: u.created_at,
        updated_at: u.updated_at,
        role: u._role ? u._role.toJSON() : null
      })),
      roles: roles.map(r => r.toJSON())
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role_id, is_enabled } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: '无效的用户 ID'
      });
    }

    const updates = {};
    if (role_id !== undefined) updates.role_id = role_id;
    if (is_enabled !== undefined) updates.is_enabled = is_enabled;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的字段'
      });
    }

    const updatedUser = await User.update(userId, updates);
    const userWithRole = await User.findByIdWithRole(updatedUser.id);

    res.json({
      success: true,
      message: '用户信息更新成功',
      user: {
        id: userWithRole.id,
        username: userWithRole.username,
        email: userWithRole.email,
        role_id: userWithRole.role_id,
        is_enabled: userWithRole.is_enabled,
        created_at: userWithRole.created_at,
        updated_at: userWithRole.updated_at,
        role: userWithRole._role ? userWithRole._role.toJSON() : null
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/admin/roles', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const roles = await Role.listAll();
    res.json({
      success: true,
      roles: roles.map(r => r.toJSON())
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/documents/upload', async (req, res) => {
  console.log('\n═══════════════════════════════════════════');
  console.log('[Document Upload] 收到上传请求');
  console.log('[Document Upload] 请求方法:', req.method);
  console.log('[Document Upload] 请求路径:', req.path);
  console.log('[Document Upload] Content-Type:', req.headers['content-type']);
  
  try {
    const { filename, file_content, file_base64, uploader_id, owner_id, metadata } = req.body;
    
    console.log('[Document Upload] 收到的请求体字段:', {
      filename: filename ? `存在 (${filename})` : '缺失',
      file_base64: file_base64 ? `存在 (长度: ${file_base64.length})` : '缺失',
      file_content: file_content ? '存在' : '缺失',
      uploader_id: uploader_id,
      owner_id: owner_id,
      metadata: metadata ? '存在' : '缺失'
    });

    if (!uploader_id) {
      console.log('[Document Upload] 错误: 缺少 uploader_id');
      return res.status(400).json({
        success: false,
        message: '缺少上传者 ID'
      });
    }

    const isAdmin = await AuthMiddleware.isAdmin(uploader_id);
    const hasDocWritePermission = await AuthMiddleware.hasDocWritePermission(uploader_id);
    const canUpload = isAdmin || hasDocWritePermission;
    
    console.log('[Document Upload] 权限检查:', {
      isAdmin,
      hasDocWritePermission,
      canUpload
    });
    
    if (!canUpload) {
      console.log('[Document Upload] 权限拒绝: 用户既不是管理员也没有 doc:write 权限');
      return res.status(403).json({
        success: false,
        message: '禁止访问：缺少 doc:write 权限'
      });
    }

    if (!filename) {
      console.log('[Document Upload] 错误: 缺少 filename');
      return res.status(400).json({
        success: false,
        message: '缺少文件名'
      });
    }

    let fileBuffer;
    if (file_base64) {
      console.log('[Document Upload] 使用 file_base64 解码...');
      try {
        fileBuffer = Buffer.from(file_base64, 'base64');
        console.log('[Document Upload] Base64 解码成功，文件大小:', fileBuffer.length, '字节');
      } catch (decodeError) {
        console.error('[Document Upload] Base64 解码失败:', decodeError.message);
        return res.status(400).json({
          success: false,
          message: 'Base64 解码失败: ' + decodeError.message
        });
      }
    } else if (file_content) {
      console.log('[Document Upload] 使用 file_content...');
      if (Buffer.isBuffer(file_content)) {
        fileBuffer = file_content;
      } else if (typeof file_content === 'string') {
        fileBuffer = Buffer.from(file_content);
      } else if (Array.isArray(file_content)) {
        fileBuffer = Buffer.from(file_content);
      }
      console.log('[Document Upload] file_content 处理完成，大小:', fileBuffer ? fileBuffer.length : 0, '字节');
    }

    if (!fileBuffer) {
      console.log('[Document Upload] 错误: 无法解析文件内容');
      return res.status(400).json({
        success: false,
        message: '缺少文件内容（file_base64 或 file_content）'
      });
    }

    console.log('[Document Upload] 开始执行 atomicUpload...');
    console.log('[Document Upload] 文件名:', filename);
    console.log('[Document Upload] 上传者 ID:', uploader_id);
    console.log('[Document Upload] 存储目录:', DEFAULT_UPLOAD_DIR);

    const result = await Document.atomicUpload({
      filename,
      fileBuffer,
      storageDir: DEFAULT_UPLOAD_DIR,
      uploader_id,
      owner_id: owner_id || uploader_id,
      metadata: metadata || {}
    });

    console.log('[Document Upload] atomicUpload 成功!');
    console.log('[Document Upload] 文档 ID:', result.document.id);
    console.log('[Document Upload] 存储路径:', result.document.storage_path);

    const response = {
      success: true,
      message: '文档上传成功',
      document: result.document.toJSON()
    };

    console.log('[Document Upload] 返回响应:', JSON.stringify(response, null, 2));
    console.log('═══════════════════════════════════════════\n');

    res.status(201).json(response);

  } catch (error) {
    console.error('[Document Upload] 捕获到异常:');
    console.error('[Document Upload] 错误类型:', error.constructor.name);
    console.error('[Document Upload] 错误消息:', error.message);
    console.error('[Document Upload] 错误堆栈:', error.stack);
    console.log('═══════════════════════════════════════════\n');
    
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/documents', async (req, res) => {
  try {
    const { status, uploader_id, owner_id } = req.query;
    let documents;

    if (status) {
      documents = await Document.findByStatus(status);
    } else if (uploader_id) {
      documents = await Document.findByUploaderId(parseInt(uploader_id, 10));
    } else if (owner_id) {
      documents = await Document.findByOwnerId(parseInt(owner_id, 10));
    } else {
      documents = await Document.listAll();
    }

    res.json({
      success: true,
      documents: documents.map(d => d.toJSON())
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/documents/:id', async (req, res) => {
  try {
    const docId = parseInt(req.params.id, 10);
    
    if (isNaN(docId)) {
      return res.status(400).json({
        success: false,
        message: '无效的文档 ID'
      });
    }

    const document = await Document.findByIdWithUploader(docId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    res.json({
      success: true,
      document: document.toJSON()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.put('/api/documents/:id', async (req, res) => {
  try {
    const docId = parseInt(req.params.id, 10);
    const { user_id, filename, storage_path, metadata, status } = req.body;

    if (isNaN(docId)) {
      return res.status(400).json({
        success: false,
        message: '无效的文档 ID'
      });
    }

    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: '未授权：缺少用户信息'
      });
    }

    const canModify = await AuthMiddleware.canModifyDocumentById(user_id, docId);
    if (!canModify) {
      return res.status(403).json({
        success: false,
        message: '禁止访问：仅文档所有者或管理员可以执行此操作'
      });
    }

    const updates = {};
    if (filename !== undefined) updates.filename = filename;
    if (storage_path !== undefined) updates.storage_path = storage_path;
    if (metadata !== undefined) updates.metadata = metadata;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的字段'
      });
    }

    const updatedDoc = await Document.update(docId, updates);

    res.json({
      success: true,
      message: '文档更新成功',
      document: updatedDoc.toJSON()
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const docId = parseInt(req.params.id, 10);
    const { user_id } = req.body;

    if (isNaN(docId)) {
      return res.status(400).json({
        success: false,
        message: '无效的文档 ID'
      });
    }

    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: '未授权：缺少用户信息'
      });
    }

    const canModify = await AuthMiddleware.canModifyDocumentById(user_id, docId);
    if (!canModify) {
      return res.status(403).json({
        success: false,
        message: '禁止访问：仅文档所有者或管理员可以执行此操作'
      });
    }

    await Document.safeDelete(docId);

    res.json({
      success: true,
      message: '文档删除成功'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/documents/:id/download', async (req, res) => {
  try {
    const docId = parseInt(req.params.id, 10);
    
    if (isNaN(docId)) {
      return res.status(400).json({
        success: false,
        message: '无效的文档 ID'
      });
    }

    const document = await Document.findById(docId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    if (!document.storage_path || !fs.existsSync(document.storage_path)) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    const stat = fs.statSync(document.storage_path);
    if (!stat.isFile()) {
      return res.status(404).json({
        success: false,
        message: '无效的文件路径'
      });
    }

    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`);
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(document.storage_path);
    readStream.pipe(res);

    readStream.on('error', (err) => {
      console.error('文件读取错误:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: '文件读取失败'
        });
      }
    });

  } catch (error) {
    console.error('下载文档失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/documents/:id/view', async (req, res) => {
  try {
    const docId = parseInt(req.params.id, 10);
    
    if (isNaN(docId)) {
      return res.status(400).json({
        success: false,
        message: '无效的文档 ID'
      });
    }

    const document = await Document.findById(docId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    if (!document.storage_path || !fs.existsSync(document.storage_path)) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    const stat = fs.statSync(document.storage_path);
    if (!stat.isFile()) {
      return res.status(404).json({
        success: false,
        message: '无效的文件路径'
      });
    }

    const viewableTypePrefixes = ['application/pdf', 'image/', 'text/'];
    const isViewable = viewableTypePrefixes.some(prefix => 
      document.mime_type && document.mime_type.startsWith(prefix)
    );

    if (!isViewable) {
      return res.status(400).json({
        success: false,
        message: '该文件类型不支持在线预览，请下载后查看'
      });
    }

    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(document.storage_path);
    readStream.pipe(res);

    readStream.on('error', (err) => {
      console.error('文件读取错误:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: '文件读取失败'
        });
      }
    });

  } catch (error) {
    console.error('查看文档失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/documents/:id/raw', async (req, res) => {
  try {
    const docId = parseInt(req.params.id, 10);
    
    if (isNaN(docId)) {
      return res.status(400).json({
        success: false,
        message: '无效的文档 ID'
      });
    }

    const document = await Document.findById(docId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    if (!document.storage_path || !fs.existsSync(document.storage_path)) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      });
    }

    const stat = fs.statSync(document.storage_path);
    if (!stat.isFile()) {
      return res.status(404).json({
        success: false,
        message: '无效的文件路径'
      });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(document.storage_path);
    readStream.pipe(res);

    readStream.on('error', (err) => {
      console.error('文件读取错误:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: '文件读取失败'
        });
      }
    });

  } catch (error) {
    console.error('获取原始文件失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/documents/upload-with-transaction', async (req, res) => {
  try {
    const { filename, file_base64, uploader_id, owner_id, metadata } = req.body;

    if (!uploader_id) {
      return res.status(400).json({
        success: false,
        message: '缺少上传者 ID'
      });
    }

    const isAdmin = await AuthMiddleware.isAdmin(uploader_id);
    const hasDocWritePermission = await AuthMiddleware.hasDocWritePermission(uploader_id);
    const canUpload = isAdmin || hasDocWritePermission;
    
    if (!canUpload) {
      return res.status(403).json({
        success: false,
        message: '禁止访问：缺少 doc:write 权限'
      });
    }

    if (!filename) {
      return res.status(400).json({
        success: false,
        message: '缺少文件名'
      });
    }

    if (!file_base64) {
      return res.status(400).json({
        success: false,
        message: '缺少文件内容（file_base64）'
      });
    }

    const fileBuffer = Buffer.from(file_base64, 'base64');

    const result = await Document.atomicUploadWithTransaction({
      filename,
      fileBuffer,
      storageDir: DEFAULT_UPLOAD_DIR,
      uploader_id,
      owner_id: owner_id || uploader_id,
      metadata: metadata || {}
    });

    res.status(201).json({
      success: true,
      message: '文档上传成功（事务模式）',
      document: result.document.toJSON()
    });

  } catch (error) {
    console.error('文档上传失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

wss.on('connection', (ws) => {
  console.log('新的 WebSocket 客户端连接');
  connectedClients.add(ws);

  const status = checkSyncStatus(currentSyncDir);
  ws.send(JSON.stringify(formatSyncStatusForClient(status)));

  const icons = getRecentIcons(currentSyncDir, 10);
  ws.send(JSON.stringify({
    type: 'recent_icons',
    data: {
      icons: icons.map(icon => ({
        name: icon.name,
        path: `/api/icons-file?path=${encodeURIComponent(icon.path)}`,
        folder: icon.folder,
        mtime: icon.mtime
      }))
    }
  }));

  ws.send(JSON.stringify({
    type: 'config',
    data: {
      filterPatterns: config.filterPatterns
    }
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (data.type === 'get_status') {
        const status = checkSyncStatus(currentSyncDir);
        ws.send(JSON.stringify(formatSyncStatusForClient(status)));
      }
    } catch (error) {
      console.error('解析 WebSocket 消息失败:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket 客户端断开连接');
    connectedClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error);
    connectedClients.delete(ws);
  });
});

setInterval(() => {
  if (connectedClients.size > 0 && !isSyncing) {
    const status = checkSyncStatus(currentSyncDir);
    broadcast(formatSyncStatusForClient(status));
  }
}, 30000);

process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'shutdown' }));
      client.close();
    }
  });
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

startServer().catch((error) => {
  console.error('启动服务器失败:', error.message);
  console.log('\n═══════════════════════════════════════════');
  console.log('  错误: 无法启动服务器');
  console.log('  原因:', error.message);
  console.log('═══════════════════════════════════════════');
  process.exit(1);
});

module.exports = { 
  app, 
  server, 
  wss, 
  broadcast, 
  startServer, 
  isPortAvailable, 
  findAvailablePort 
};
