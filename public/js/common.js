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
  
  try {
    const response = await fetch(url, config);
    const data = await response.json();
    
    if (response.status === 401) {
      AppState.clearAuth();
      if (!window.location.pathname.includes('login.html')) {
        window.location.href = '/login.html';
      }
    }
    
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.error('API请求失败:', error);
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
