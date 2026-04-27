# Auto_bookmark

个人自动化书签管理/转换工具，支持 Chrome、Edge、Firefox 等主流浏览器导出的 HTML 书签解析与处理。

## 功能特性

| 功能 | 描述 | 状态 |
|------|------|------|
| 多浏览器兼容 | 支持 Chrome、Edge、Firefox 导出的 HTML 书签解析 | ✅ |
| Markdown 转换 | 将 HTML 书签转换为结构化 Markdown 文档 | ✅ |
| 本地镜像同步 | 将书签同步到本地文件系统，包含图标缓存和元数据 | ✅ |
| 多线程检测 | 并发 URL 状态检测，支持最大并发数配置 | ✅ |
| Favicon 镜像同步 | 自动下载并缓存网站图标 (favicon) | ✅ |
| Web UI 监控 | 提供可视化 Web 管理界面，实时查看同步进度 | ✅ |
| 动态端口自愈 | 端口被占用时自动切换到可用端口 | ✅ |
| 环境变量配置 | 支持 .env 文件配置，实现环境隔离 | ✅ |
| 默认配置回退 | 缺少 .env 时自动加载硬编码默认配置 | ✅ |

## 快速开始

### 1. 依赖安装

```bash
npm install
```

### 2. 环境配置（可选）

复制 `.env.example` 为 `.env` 并根据需要修改配置：

```bash
cp .env.example .env
```

**配置项说明：**

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `INPUT_BOOKMARKS_PATH` | 书签 HTML 文件路径 | 无 |
| `OUTPUT_DIR` | Markdown 转换输出目录 | `./output` |
| `SYNC_DIR` | 本地镜像同步目录 | `./bookmarks_mirror` |
| `PORT` | Web 服务器默认端口 | `3000` |
| `START_PORT` | 端口查找起始端口 | `3000` |
| `MAX_PORT_ATTEMPTS` | 端口查找最大尝试次数 | `50` |
| `MAX_CONCURRENCY` | 最大并发请求数 | `5` |
| `URL_TIMEOUT` | URL 检测超时时间（毫秒） | `5000` |
| `ICON_TIMEOUT` | 图标下载超时时间（毫秒） | `10000` |
| `FILTER_PATTERNS` | 需要过滤的 URL 模式（逗号分隔） | `localhost,127.0.0.1,dev.test` |
| `DEBUG` | 是否启用调试模式 | `false` |
| `LOG_LEVEL` | 日志级别 | `info` |

### 3. 一键启动

**方式一：命令行工具**

```bash
# 转换为 Markdown
node index.js bookmarks.html -o bookmarks.md

# 本地镜像同步（包含图标下载）
node index.js bookmarks.html -s -d ./my_bookmarks

# 检查同步状态
node index.js --check-status ./my_bookmarks
```

**方式二：Web 管理界面**

```bash
npm run web
# 或
node webServer.js
```

启动后访问：`http://localhost:3000`

## 命令行参数说明

### 基本语法

```bash
node index.js [选项] [输入文件]
```

### 通用选项

| 参数 | 短格式 | 说明 |
|------|--------|------|
| `--help` | `-h` | 显示帮助信息 |

### Markdown 转换选项

| 参数 | 短格式 | 说明 |
|------|--------|------|
| `--output <文件>` | `-o <文件>` | 指定输出 Markdown 文件路径 |

### 本地镜像同步选项

| 参数 | 短格式 | 说明 | 默认值 |
|------|--------|------|--------|
| `--sync` | `-s` | 启用本地镜像同步模式 | - |
| `--sync-dir <目录>` | `-d <目录>` | 指定同步输出目录 | `./bookmarks_mirror` |
| `--check-status <目录>` | - | 检查指定目录的同步状态 | - |
| `--skip-icon` | - | 跳过图标下载（仅同步元数据） | - |
| `--force` | - | 强制更新（忽略已存在的文件） | - |
| `--concurrency <数字>` | `-c <数字>` | 最大并发数 | `5` |
| `--timeout <毫秒>` | `-t <毫秒>` | 超时时间 | `10000` |

### 使用示例

```bash
# 基本转换
node index.js bookmarks.html -o bookmarks.md

# 本地镜像同步
node index.js bookmarks.html -s -d ./my_bookmarks

# 快速同步（跳过图标）
node index.js bookmarks.html -s -d ./my_bookmarks --skip-icon

# 强制更新
node index.js bookmarks.html -s -d ./my_bookmarks --force

# 高并发同步
node index.js bookmarks.html -s -d ./my_bookmarks -c 10 -t 5000

# 检查同步状态
node index.js --check-status ./my_bookmarks
```

## Web API 说明

### 启动服务器

```bash
npm run web
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 获取同步状态 |
| GET | `/api/config` | 获取当前配置 |
| POST | `/api/config` | 更新配置 |
| GET | `/api/icons` | 获取最近同步的图标列表 |
| GET | `/api/icons-file` | 获取图标文件（需 `path` 参数） |
| GET | `/api/bookmark-files` | 获取目录下的 HTML 书签文件列表 |
| POST | `/api/sync` | 启动同步任务 |
| POST | `/api/cancel-sync` | 取消同步任务 |

### WebSocket 实时推送

服务器通过 WebSocket 推送实时更新：

| 消息类型 | 说明 |
|----------|------|
| `status` | 同步状态更新 |
| `sync_started` | 同步任务已启动 |
| `sync_progress` | 同步进度更新 |
| `sync_completed` | 同步任务完成 |
| `sync_failed` | 同步任务失败 |
| `recent_icons` | 最近同步的图标列表 |
| `notification` | 通知消息 |
| `config` | 配置更新 |

### 同步请求参数

`POST /api/sync` 请求体：

```json
{
  "bookmarksPath": "/path/to/bookmarks.html",
  "syncDir": "/path/to/sync/dir",
  "skipIcon": false,
  "force": false,
  "concurrency": 5,
  "timeout": 10000
}
```

## 项目结构

```
Auto_bookmark/
├── index.js              # 命令行入口
├── webServer.js          # Web 服务器
├── bookmarkConverter.js  # 书签解析和转换核心
├── localMirrorSync.js    # 本地镜像同步模块
├── config.js             # 配置模块
├── package.json          # 项目配置
├── .env.example          # 环境配置示例
├── README.md             # 项目文档
├── public/               # Web 前端资源
│   └── index.html        # Web 管理界面
├── test_fixtures/        # 测试样本文件
│   ├── chrome_bookmarks.html
│   ├── edge_bookmarks.html
│   └── firefox_bookmarks.html
├── *.test.js             # 测试文件
├── bookmarks_mirror/     # 默认同步目录
└── my_bookmarks/         # 示例同步目录
```

## 开发与测试

### 开发依赖

项目使用以下开发依赖：

| 依赖 | 版本 | 说明 |
|------|------|------|
| jest | ^29.7.0 | JavaScript 测试框架 |
| nock | ^14.0.13 | HTTP 请求 Mock 库 |

### 安装开发依赖

```bash
npm install --save-dev jest nock
```

### 测试环境配置

项目使用 Jest 作为测试框架，已配置好 `jest.config.js` 和 `jest.setup.js`。

**测试环境特点：**
- 支持 `.env.test` 测试专用配置文件（优先级高于 `.env`）
- 缺少 `.env` 文件时自动使用默认配置，不会中断测试
- 支持所有 Jest 内置全局变量（`describe`, `test`, `expect`, `beforeEach` 等）

**测试配置文件：**

| 文件 | 说明 |
|------|------|
| `jest.config.js` | Jest 主配置文件 |
| `jest.setup.js` | 测试环境初始化脚本 |

### 运行测试

```bash
# 运行所有测试
npm test

# 运行所有测试并显示详细输出
npm test -- --verbose

# 运行特定测试文件
npm test -- bookmarkConverter.test.js
npm test -- localMirrorSync.test.js
npm test -- tests/integration/browserCompatibility.test.js

# 运行匹配特定模式的测试
npm test -- --testNamePattern="Firefox"
npm test -- --testPathPattern="integration"
```

### 测试文件结构

```
Auto_bookmark/
├── bookmarkConverter.test.js     # 核心转换逻辑单元测试
├── localMirrorSync.test.js       # 本地镜像同步单元测试
└── tests/
    └── integration/
        ├── browserCompatibility.test.js  # 多浏览器解析兼容性测试
        ├── configLoading.test.js         # 环境变量加载和默认配置回退测试
        └── portSwitching.test.js         # 动态端口切换逻辑测试
```

### 测试覆盖范围

| 测试文件 | 覆盖内容 |
|----------|----------|
| `browserCompatibility.test.js` | Chrome/Edge/Firefox 浏览器类型检测、ICON/ICON_URI 属性解析、时间戳解析、边界情况处理 |
| `configLoading.test.js` | 配置解析函数（parseNumber/parseBoolean/parseList/parsePath）、默认配置回退、shouldFilter 过滤逻辑 |
| `portSwitching.test.js` | 端口可用性检测、动态端口查找、边界值验证 |
| `localMirrorSync.test.js` | 文件名处理、元数据读写、同步状态分析 |

## 支持的浏览器

| 浏览器 | 支持版本 | 测试状态 |
|--------|----------|----------|
| Chrome | 所有版本 | ✅ |
| Edge (Chromium) | 79+ | ✅ |
| Firefox | 所有版本 | ✅ |
| Safari | 支持（导入标准 HTML） | ✅ |

## 注意事项

1. **图标下载**：图标下载依赖网络连接，如果网络不稳定或目标网站不可达，图标可能下载失败。失败的书签会在元数据中标记为 `FAILED` 状态。

2. **端口冲突**：Web 服务器默认使用端口 3000。如果端口被占用，程序会自动从 `START_PORT` 开始尝试后续端口，直到找到可用端口。

3. **过滤规则**：默认会过滤 `localhost`、`127.0.0.1`、`dev.test` 等本地开发环境 URL。可通过 `FILTER_PATTERNS` 环境变量自定义过滤规则。

4. **环境变量优先级**：命令行参数 > 环境变量 > 默认配置。

## License

MIT
