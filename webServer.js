const fs = require('fs');
const path = require('path');
const net = require('net');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
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
const Document = require('./documentModel');
const { 
  AuthMiddleware, 
  DOC_WRITE_PERMISSION, 
  ADMIN_PERMISSION,
  ADMIN_STATS_PERMISSION,
  USER_LIST_PERMISSION,
  USER_UPDATE_PERMISSION,
  USER_DELETE_PERMISSION
} = require('./authMiddleware');
const { initDatabase, DocumentStatus } = require('./database');

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
let parsingDocuments = new Map();

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

async function startServer() {
  let actualPort;
  
  try {
    console.log('正在初始化数据库...');
    await initDatabase();
    console.log('数据库初始化完成');
  } catch (error) {
    console.error('数据库初始化失败:', error.message);
    console.error('将继续启动服务器，但用户功能可能不可用');
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
    syncDir,
    skipIcon = false,
    force = false,
    concurrency,
    timeout
  } = req.body;

  const actualConcurrency = concurrency !== undefined ? concurrency : config.maxConcurrency;
  const actualTimeout = timeout !== undefined ? timeout : config.iconTimeout;

  if (!bookmarksPath || !fs.existsSync(bookmarksPath)) {
    return res.status(400).json({ 
      success: false, 
      message: '请提供有效的书签 HTML 文件路径' 
    });
  }

  const targetSyncDir = syncDir ? path.resolve(syncDir) : currentSyncDir;

  isSyncing = true;
  
  const taskInfo = {
    taskId: `sync_${Date.now()}`,
    startTime: new Date().toISOString(),
    bookmarksPath,
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
    const htmlContent = fs.readFileSync(bookmarksPath, 'utf-8');
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
    const requesterId = req.user?.id || req.body?.user_id || req.query?.user_id;
    
    if (!requesterId) {
      return res.status(401).json({
        success: false,
        message: '未授权：缺少用户信息'
      });
    }

    const hasPermission = await AuthMiddleware.hasPermission(requesterId, USER_UPDATE_PERMISSION);
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `禁止访问：缺少 ${USER_UPDATE_PERMISSION} 权限`
      });
    }

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
    const requesterId = req.user?.id || req.body?.user_id || req.query?.user_id;
    
    if (!requesterId) {
      return res.status(401).json({
        success: false,
        message: '未授权：缺少用户信息'
      });
    }

    const hasPermission = await AuthMiddleware.hasPermission(requesterId, USER_DELETE_PERMISSION);
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `禁止访问：缺少 ${USER_DELETE_PERMISSION} 权限`
      });
    }

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

app.post('/api/documents/upload', async (req, res) => {
  try {
    const { filename, file_content, file_base64, uploader_id, owner_id, metadata } = req.body;

    if (!uploader_id) {
      return res.status(400).json({
        success: false,
        message: '缺少上传者 ID'
      });
    }

    const hasDocWritePermission = await AuthMiddleware.hasDocWritePermission(uploader_id);
    if (!hasDocWritePermission) {
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

    let fileBuffer;
    if (file_base64) {
      fileBuffer = Buffer.from(file_base64, 'base64');
    } else if (file_content) {
      if (Buffer.isBuffer(file_content)) {
        fileBuffer = file_content;
      } else if (typeof file_content === 'string') {
        fileBuffer = Buffer.from(file_content);
      } else if (Array.isArray(file_content)) {
        fileBuffer = Buffer.from(file_content);
      }
    }

    if (!fileBuffer) {
      return res.status(400).json({
        success: false,
        message: '缺少文件内容（file_base64 或 file_content）'
      });
    }

    const result = await Document.atomicUpload({
      filename,
      fileBuffer,
      storageDir: DEFAULT_UPLOAD_DIR,
      uploader_id,
      owner_id: owner_id || uploader_id,
      metadata: metadata || {}
    });

    res.status(201).json({
      success: true,
      message: '文档上传成功',
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

app.post('/api/documents/upload-with-transaction', async (req, res) => {
  try {
    const { filename, file_base64, uploader_id, owner_id, metadata } = req.body;

    if (!uploader_id) {
      return res.status(400).json({
        success: false,
        message: '缺少上传者 ID'
      });
    }

    const hasDocWritePermission = await AuthMiddleware.hasDocWritePermission(uploader_id);
    if (!hasDocWritePermission) {
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

app.post('/api/documents/:id/parse', async (req, res) => {
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

    const hasDocWritePermission = await AuthMiddleware.hasDocWritePermission(user_id);
    if (!hasDocWritePermission) {
      return res.status(403).json({
        success: false,
        message: '禁止访问：缺少 doc:write 权限'
      });
    }

    const document = await Document.findById(docId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: '文档不存在'
      });
    }

    if (document.status === DocumentStatus.PROCESSING) {
      return res.status(400).json({
        success: false,
        message: '文档正在解析中'
      });
    }

    if (parsingDocuments.has(docId)) {
      return res.status(400).json({
        success: false,
        message: '解析任务已在进行中'
      });
    }

    await Document.updateStatus(docId, DocumentStatus.PROCESSING, {
      metadata: {
        ...document.metadata,
        parse_started_at: new Date().toISOString(),
        parse_progress: 0,
        parse_phase: 'initializing'
      }
    });

    const taskInfo = {
      taskId: `parse_${docId}_${Date.now()}`,
      documentId: docId,
      startTime: new Date().toISOString(),
      userId: user_id
    };

    parsingDocuments.set(docId, taskInfo);

    res.status(202).json({
      success: true,
      message: '解析任务已启动',
      taskInfo,
      document: {
        id: document.id,
        filename: document.filename,
        status: DocumentStatus.PROCESSING
      }
    });

    broadcast({
      type: 'parse_started',
      data: {
        documentId: docId,
        taskInfo,
        status: DocumentStatus.PROCESSING
      }
    });

    simulateDocumentParsing(docId, document);

  } catch (error) {
    console.error('启动解析任务失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

function extractDocumentMetadata(document) {
  const metadata = {
    ...document.metadata,
    parse_completed_at: new Date().toISOString(),
    parsed: true,
    parsed_info: {
      file_name: document.filename,
      file_size: document.file_size,
      mime_type: document.mime_type,
      extension: path.extname(document.filename).toLowerCase(),
      base_name: path.basename(document.filename, path.extname(document.filename)),
      word_count: Math.floor(Math.random() * 5000) + 100,
      page_count: Math.floor(Math.random() * 100) + 1,
      language: 'zh-CN',
      encoding: 'UTF-8',
      checksum: generateSimpleChecksum(document.filename + document.file_size),
      extracted_keywords: extractKeywords(document.filename)
    }
  };
  return metadata;
}

function generateSimpleChecksum(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function extractKeywords(filename) {
  const baseName = path.basename(filename, path.extname(filename)).toLowerCase();
  const words = baseName.split(/[\s_\-\.]+/).filter(w => w.length > 1);
  const keywords = new Set(words);
  
  const commonKeywords = ['report', 'document', 'file', 'test', 'demo', 'sample', '报告', '文档', '文件', '测试'];
  commonKeywords.forEach(kw => {
    if (baseName.includes(kw)) {
      keywords.add(kw);
    }
  });
  
  return Array.from(keywords).slice(0, 10);
}

async function simulateDocumentParsing(docId, document) {
  try {
    const phases = [
      { name: 'initializing', progress: 10, message: '初始化解析引擎...' },
      { name: 'reading', progress: 30, message: '读取文件内容...' },
      { name: 'analyzing', progress: 50, message: '分析文档结构...' },
      { name: 'extracting', progress: 70, message: '提取元数据...' },
      { name: 'indexing', progress: 90, message: '建立索引...' },
      { name: 'completing', progress: 100, message: '完成解析...' }
    ];

    for (const phase of phases) {
      await new Promise(resolve => setTimeout(resolve, 800));
      
      broadcast({
        type: 'parse_progress',
        data: {
          documentId: docId,
          progress: phase.progress,
          phase: phase.name,
          message: phase.message,
          status: DocumentStatus.PROCESSING
        }
      });

      await Document.update(docId, {
        metadata: {
          ...document.metadata,
          parse_progress: phase.progress,
          parse_phase: phase.name,
          parse_message: phase.message
        }
      });
    }

    const parsedMetadata = extractDocumentMetadata(document);
    
    const updatedDoc = await Document.updateStatus(docId, DocumentStatus.READY, {
      metadata: parsedMetadata
    });

    parsingDocuments.delete(docId);

    broadcast({
      type: 'parse_completed',
      data: {
        documentId: docId,
        status: DocumentStatus.READY,
        document: updatedDoc.toJSON()
      }
    });

  } catch (error) {
    console.error('文档解析失败:', error);
    
    parsingDocuments.delete(docId);

    await Document.markAsFailed(docId, error.message);

    broadcast({
      type: 'parse_failed',
      data: {
        documentId: docId,
        status: DocumentStatus.FAILED,
        error: error.message
      }
    });
  }
}

app.get('/api/admin/stats', async (req, res) => {
  try {
    const userId = req.query?.user_id || req.body?.user_id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未授权：缺少用户信息'
      });
    }

    const hasPermission = await AuthMiddleware.hasPermission(userId, ADMIN_STATS_PERMISSION);
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `禁止访问：缺少 ${ADMIN_STATS_PERMISSION} 权限`
      });
    }

    const stats = await User.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('获取统计数据失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const userId = req.query?.user_id || req.body?.user_id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未授权：缺少用户信息'
      });
    }

    const hasPermission = await AuthMiddleware.hasPermission(userId, USER_LIST_PERMISSION);
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `禁止访问：缺少 ${USER_LIST_PERMISSION} 权限`
      });
    }

    const users = await User.listAllWithRole();
    res.json({
      success: true,
      users: users.map(u => u.toJSON())
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/users/:id/permissions', async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const requesterId = req.query?.user_id || req.body?.user_id || req.user?.id;
    
    if (!requesterId) {
      return res.status(401).json({
        success: false,
        message: '未授权：缺少用户信息'
      });
    }

    const user = await User.findByIdWithRole(targetUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const requesterUser = await User.findByIdWithRole(parseInt(requesterId, 10));
    const canEdit = requesterUser ? await requesterUser.hasPermission(USER_UPDATE_PERMISSION) : false;
    const canDelete = requesterUser ? await requesterUser.hasPermission(USER_DELETE_PERMISSION) : false;

    res.json({
      success: true,
      permissions: {
        can_edit: canEdit,
        can_delete: canDelete,
        user_role: user._role ? user._role.name : null,
        user_permissions: user._role ? user._role.permissions : []
      }
    });
  } catch (error) {
    console.error('获取用户权限失败:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/current-user/permissions', async (req, res) => {
  try {
    const userId = req.query?.user_id || req.body?.user_id || req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未授权：缺少用户信息'
      });
    }

    const user = await User.findByIdWithRole(parseInt(userId, 10));
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const canViewStats = await user.hasPermission(ADMIN_STATS_PERMISSION);
    const canListUsers = await user.hasPermission(USER_LIST_PERMISSION);
    const canEditUsers = await user.hasPermission(USER_UPDATE_PERMISSION);
    const canDeleteUsers = await user.hasPermission(USER_DELETE_PERMISSION);

    res.json({
      success: true,
      permissions: {
        can_view_stats: canViewStats,
        can_list_users: canListUsers,
        can_edit_users: canEditUsers,
        can_delete_users: canDeleteUsers,
        is_admin: await user.hasPermission(ADMIN_PERMISSION),
        user_role: user._role ? user._role.name : null,
        user_permissions: user._role ? user._role.permissions : []
      }
    });
  } catch (error) {
    console.error('获取当前用户权限失败:', error);
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
