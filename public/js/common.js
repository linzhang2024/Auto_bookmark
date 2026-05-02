const API_BASE = '';
const STORAGE_KEY_TOKEN = 'auto_bookmark_token';
const STORAGE_KEY_USER = 'auto_bookmark_user';

const AppState = {
  token: null,
  user: null,
  
  init() {
    this.token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const userStr = localStorage.getItem(STORAGE_KEY_USER);
    if (userStr) {
      try {
        this.user = JSON.parse(userStr);
      } catch (e) {
        this.user = null;
      }
    }
  },
  
  setAuth(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem(STORAGE_KEY_TOKEN, token);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
  },
  
  clearAuth() {
    this.token = null;
    this.user = null;
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_USER);
  },
  
  isLoggedIn() {
    return !!this.token && !!this.user;
  },
  
  isAdmin() {
    if (!this.user || !this.user.role) return false;
    return this.user.role.name === 'admin' || 
           (this.user.role.permissions && this.user.role.permissions.includes('admin:access'));
  }
};

async function apiRequest(endpoint, options = {}) {
  const url = API_BASE + endpoint;
  const headers = {
    ...options.headers
  };
  
  if (AppState.token) {
    headers['Authorization'] = `Bearer ${AppState.token}`;
  }
  
  const config = {
    method: options.method || 'GET',
    headers,
    ...options
  };
  
  if (options.body && typeof options.body !== 'string') {
    config.body = JSON.stringify(options.body);
    config.headers['Content-Type'] = 'application/json';
  }
  
  console.log(`[API Request] ${config.method} ${url}`);
  if (config.body) {
    const bodyObj = JSON.parse(config.body);
    if (bodyObj.file_base64) {
      bodyObj.file_base64 = `[BASE64 数据，长度: ${bodyObj.file_base64.length} 字符]`;
    }
    console.log('[API Request Body]', bodyObj);
  }
  
  try {
    const response = await fetch(url, config);
    
    console.log(`[API Response] ${config.method} ${url} - Status: ${response.status} ${response.statusText}`);
    
    let data;
    try {
      data = await response.json();
      console.log('[API Response Data]');
      console.dir(data);
    } catch (parseError) {
      console.error('[API Response Parse Error] 无法解析响应为 JSON');
      console.dir(parseError);
      data = { success: false, message: '服务器响应异常，请稍后重试' };
    }
    
    if (response.status === 401) {
      AppState.clearAuth();
      if (!window.location.pathname.includes('login.html')) {
        window.location.href = '/login.html';
      }
    }
    
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.error('[API Request Error] 网络请求失败:');
    console.dir(error);
    return { ok: false, status: 0, data: { success: false, message: '网络请求失败' } };
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 24px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease;
    max-width: 300px;
    word-wrap: break-word;
  `;
  
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  toast.style.backgroundColor = colors[type] || colors.info;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function addGlobalStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function renderNav() {
  const nav = document.createElement('nav');
  nav.className = 'sidebar';
  nav.innerHTML = `
    <div class="logo">
      <h2>书签管理</h2>
    </div>
    <ul class="nav-menu">
      <li><a href="/bookmarks.html" class="nav-item"><span>🔖</span> 书签管理</a></li>
      <li><a href="/documents.html" class="nav-item"><span>📁</span> 文档管理</a></li>
      ${AppState.isAdmin() ? '<li><a href="/admin/users.html" class="nav-item"><span>👥</span> 用户管理</a></li>' : ''}
    </ul>
    <div class="user-info">
      <div class="user-avatar" id="userAvatar">
        ${AppState.user ? AppState.user.username.charAt(0).toUpperCase() : '?'}
      </div>
      <div class="user-details">
        <div class="user-name">${AppState.user ? AppState.user.username : '未登录'}</div>
        <div class="user-role">${AppState.user?.role?.name || '访客'}</div>
      </div>
      <button id="logoutBtn" class="logout-btn" title="退出登录">
        🚪
      </button>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);
  
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      AppState.clearAuth();
      window.location.href = '/login.html';
    });
  }
  
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('href') === currentPath) {
      item.classList.add('active');
    }
  });
}

function checkAuth() {
  AppState.init();
  const currentPath = window.location.pathname;
  
  if (currentPath === '/login.html' || currentPath === '/') {
    if (AppState.isLoggedIn() && currentPath === '/login.html') {
      window.location.href = '/documents.html';
    }
    return;
  }
  
  if (!AppState.isLoggedIn()) {
    window.location.href = '/login.html';
    return;
  }
  
  if (currentPath.startsWith('/admin/') && !AppState.isAdmin()) {
    showToast('无权访问管理员页面', 'error');
    window.location.href = '/documents.html';
    return;
  }
}

AppState.init();
addGlobalStyles();

let globalWs = null;
let wsReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL = 3000;

function connectGlobalWebSocket() {
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    return;
  }
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  try {
    globalWs = new WebSocket(wsUrl);
    
    globalWs.onopen = function() {
      console.log('全局 WebSocket 连接已建立');
      wsReconnectAttempts = 0;
    };
    
    globalWs.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        handleGlobalWebSocketMessage(data);
      } catch (e) {
        console.error('解析全局 WebSocket 消息失败:', e);
      }
    };
    
    globalWs.onclose = function() {
      console.log('全局 WebSocket 连接已关闭');
      attemptReconnect();
    };
    
    globalWs.onerror = function(error) {
      console.error('全局 WebSocket 错误:', error);
    };
  } catch (e) {
    console.error('建立全局 WebSocket 连接失败:', e);
    attemptReconnect();
  }
}

function attemptReconnect() {
  if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    wsReconnectAttempts++;
    console.log(`尝试重新连接 WebSocket (${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    setTimeout(connectGlobalWebSocket, RECONNECT_INTERVAL);
  } else {
    console.error('WebSocket 重连次数已达上限，停止重连');
  }
}

function handleGlobalWebSocketMessage(data) {
  if (!data.type) return;
  
  switch (data.type) {
    case 'document_uploaded':
      if (data.data) {
        const doc = data.data.document;
        showToast(`文档 "${doc.filename}" 上传成功`, 'success');
      }
      break;
      
    case 'document_ready':
      if (data.data) {
        const doc = data.data.document;
        showToast(`文档 "${doc.filename}" 解析完成`, 'success');
      }
      break;
      
    case 'document_failed':
      if (data.data) {
        const doc = data.data.document;
        const error = data.data.error || '未知错误';
        showToast(`文档 "${doc.filename}" 解析失败: ${error}`, 'error');
      }
      break;
      
    case 'notification':
      if (data.data) {
        const message = data.data.message || '通知';
        const type = data.data.type || 'info';
        showToast(message, type);
      }
      break;
      
    case 'retry_started':
    case 'retry_progress':
    case 'retry_completed':
    case 'retry_failed':
      break;
      
    case 'sync_started':
    case 'sync_progress':
    case 'sync_completed':
    case 'sync_failed':
    case 'browser_sync_started':
    case 'browser_sync_status':
    case 'browser_sync_completed':
    case 'browser_sync_failed':
      break;
      
    case 'status':
    case 'config':
    case 'recent_icons':
      break;
      
    case 'pong':
      break;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  if (AppState.isLoggedIn()) {
    connectGlobalWebSocket();
  }
});
