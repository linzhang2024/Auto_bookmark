const fs = require('fs');
const path = require('path');
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
  countBookmarks,
  countFolders
} = require('./bookmarkConverter');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DEFAULT_SYNC_DIR = path.join(__dirname, 'bookmarks_mirror');

let currentSyncDir = DEFAULT_SYNC_DIR;
let isSyncing = false;
let currentSyncTask = null;

let connectedClients = new Set();

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
    concurrency = 5,
    timeout = 10000
  } = req.body;

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
    const bookmarks = parseChromeBookmarks(htmlContent);
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
      maxConcurrent: concurrency,
      timeout,
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

server.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  本地镜像同步 - Web 管理后台已启动`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`  服务器地址: http://localhost:${PORT}`);
  console.log(`  默认同步目录: ${DEFAULT_SYNC_DIR}`);
  console.log(`═══════════════════════════════════════════\n`);
});

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

module.exports = { app, server, wss, broadcast };
