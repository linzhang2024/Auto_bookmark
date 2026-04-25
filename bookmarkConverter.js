/**
 * 书签转换核心逻辑
 * 解析 Chrome 导出的 HTML 书签，转换为 Markdown 格式
 */

const cheerio = require('cheerio');
const http = require('http');
const https = require('https');
const config = require('./config');

/**
 * 并发控制类
 * 限制同时运行的异步任务数量
 */
class ConcurrencyLimiter {
  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
    this.activeCount = 0;
    this.queue = [];
  }

  /**
   * 添加任务到队列并执行
   * @param {Function} task - 返回 Promise 的异步函数
   * @returns {Promise} - 任务执行结果
   */
  async add(task) {
    return new Promise((resolve, reject) => {
      const wrapper = async () => {
        this.activeCount++;
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeCount--;
          this.processNext();
        }
      };

      if (this.activeCount < this.maxConcurrent) {
        wrapper();
      } else {
        this.queue.push(wrapper);
      }
    });
  }

  /**
   * 处理队列中的下一个任务
   */
  processNext() {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const next = this.queue.shift();
      next();
    }
  }
}

/**
 * HTTP 请求结果类型
 * @typedef {'success'|'not_found'|'timeout'|'error'} UrlStatus
 */

/**
 * URL 检查结果
 * @typedef {Object} UrlCheckResult
 * @property {UrlStatus} status - URL 状态
 * @property {number|null} statusCode - HTTP 状态码
 * @property {string|null} title - 网页标题（如果成功获取）
 * @property {Error|null} error - 错误信息
 */

/**
 * 发起 HTTP HEAD 请求检查 URL
 * @param {string} url - URL 地址
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<UrlCheckResult>} - 检查结果
 */
async function checkUrl(url, timeout = 5000) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;

    let req = client.request(url, { method: 'HEAD', timeout }, (res) => {
      const statusCode = res.statusCode;
      let title = null;
      
      if (statusCode === 404) {
        res.resume();
        resolve({
          status: 'not_found',
          statusCode,
          title: null,
          error: null
        });
        return;
      }

      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({
          status: 'success',
          statusCode,
          title: null,
          error: null
        });
        return;
      }

      if (statusCode >= 200 && statusCode < 300) {
        res.resume();
        resolve({
          status: 'success',
          statusCode,
          title: null,
          error: null
        });
        return;
      }

      res.resume();
      resolve({
        status: 'error',
        statusCode,
        title: null,
        error: new Error(`HTTP status: ${statusCode}`)
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 'timeout',
        statusCode: null,
        title: null,
        error: new Error('Connection timeout')
      });
    });

    req.on('error', (error) => {
      resolve({
        status: 'error',
        statusCode: null,
        title: null,
        error
      });
    });

    req.end();
  });
}

/**
 * 获取网页标题
 * @param {string} url - URL 地址
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<string|null>} - 网页标题
 */
async function fetchPageTitle(url, timeout = 10000) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;

    const req = client.request(url, { method: 'GET', timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(null);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }

      let html = '';
      let hasTitle = false;
      const titlePattern = /<title[^>]*>([^<]*)<\/title>/i;

      res.on('data', (chunk) => {
        html += chunk.toString();
        
        const match = html.match(titlePattern);
        if (match) {
          hasTitle = true;
          const title = match[1].trim();
          res.destroy();
          resolve(title || null);
        }
      });

      res.on('end', () => {
        if (!hasTitle) {
          const match = html.match(titlePattern);
          if (match) {
            const title = match[1].trim();
            resolve(title || null);
          } else {
            resolve(null);
          }
        }
      });

      res.on('error', () => {
        resolve(null);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => {
      resolve(null);
    });

    req.end();
  });
}

/**
 * 检查多个 URL 并支持并发控制
 * @param {Array<{url: string, title: string}>} links - 链接列表
 * @param {number} maxConcurrent - 最大并发数
 * @param {Object} options - 配置选项
 * @returns {Promise<Array<{url: string, title: string, isInvalid: boolean, fetchedTitle: string|null}>>}
 */
async function checkUrlsConcurrently(links, maxConcurrent = 5, options = {}) {
  const { timeout = 5000, enableTitleFetch = false } = options;
  const limiter = new ConcurrencyLimiter(maxConcurrent);

  const results = await Promise.all(
    links.map((link) =>
      limiter.add(async () => {
        const checkResult = await checkUrl(link.url, timeout);
        const isInvalid = checkResult.status === 'not_found' || checkResult.status === 'timeout';
        
        let fetchedTitle = null;
        if (enableTitleFetch && checkResult.status === 'success') {
          fetchedTitle = await fetchPageTitle(link.url, timeout * 2);
        }

        return {
          url: link.url,
          title: link.title,
          isInvalid,
          fetchedTitle,
          status: checkResult.status
        };
      })
    )
  );

  return results;
}

/**
 * 从 URL 中提取域名作为标题（容错处理）
 * @param {string} url - URL 地址
 * @returns {string} - 提取的域名
 */
function extractDomainFromUrl(url) {
  if (!url) {
    return '';
  }

  try {
    const urlObj = new URL(url);
    return urlObj.hostname || url;
  } catch {
    return url;
  }
}

/**
 * 解析 Chrome 导出的 HTML 书签文件
 * @param {string} htmlContent - HTML 内容
 * @returns {Array} - 层级结构的书签列表
 */
function parseChromeBookmarks(htmlContent) {
  const $ = cheerio.load(htmlContent, { decodeEntities: false });

  const rootDl = $('dl').first();
  if (!rootDl.length) {
    return [];
  }

  /**
   * 解析 DL 标签内的内容
   * @param {cheerio.Cheerio} dlTag - DL 标签
   * @param {number} level - 层级深度
   * @returns {Array} - 该 DL 内的所有项目
   */
  function parseDlContent(dlTag, level = 0) {
    const items = [];
    const allDts = dlTag.find('dt');

    const directDts = allDts.filter((_, dt) => {
      let current = $(dt).parent();
      while (current.length) {
        if (current[0].name === 'dl') {
          return current[0] === dlTag[0];
        }
        current = current.parent();
      }
      return false;
    });

    directDts.each((_, dt) => {
      const $dt = $(dt);
      const h3Tag = $dt.find('> h3');
      const aTag = $dt.find('> a');

      if (h3Tag.length) {
        const folderName = h3Tag.text().trim();
        if (!folderName) {
          return;
        }

        const subDl = h3Tag.next('dl');

        if (subDl.length) {
          const subItems = parseDlContent(subDl, level + 1);
          items.push({
            type: 'folder',
            name: folderName,
            level: level,
            children: subItems
          });
        } else {
          items.push({
            type: 'folder',
            name: folderName,
            level: level,
            children: []
          });
        }
      } else if (aTag.length) {
        const url = aTag.attr('href') || '';

        if (config.shouldFilter(url)) {
          return;
        }

        let title = aTag.text().trim();
        if (!title) {
          title = extractDomainFromUrl(url);
        }

        items.push({
          type: 'link',
          title: title,
          url: url,
          level: level
        });
      }
    });

    return items;
  }

  return parseDlContent(rootDl);
}

/**
 * 从书签结构中收集所有链接
 * @param {Array} items - 书签列表
 * @returns {Array<{url: string, title: string, originalTitle: string}>} - 链接列表
 */
function collectAllLinks(items) {
  const links = [];

  function traverse(itemsList) {
    for (const item of itemsList) {
      if (item.type === 'link') {
        links.push({
          url: item.url,
          title: item.title,
          originalTitle: item.title
        });
      } else if (item.type === 'folder' && item.children) {
        traverse(item.children);
      }
    }
  }

  traverse(items);
  return links;
}

/**
 * 将增强结果应用到书签结构
 * @param {Array} items - 书签列表
 * @param {Array} enhancementResults - 增强结果
 * @param {Object} options - 配置选项
 * @returns {Array} - 更新后的书签列表
 */
function applyEnhancementResults(items, enhancementResults, options = {}) {
  const { updateTitle = true } = options;
  const resultMap = new Map();

  for (const result of enhancementResults) {
    resultMap.set(result.url, result);
  }

  function apply(itemsList) {
    const newItems = [];

    for (const item of itemsList) {
      if (item.type === 'folder') {
        const newItem = {
          ...item,
          children: item.children ? apply(item.children) : []
        };
        newItems.push(newItem);
      } else if (item.type === 'link') {
        const result = resultMap.get(item.url);
        const newItem = { ...item };

        if (result) {
          newItem.isInvalid = result.isInvalid;
          newItem.urlStatus = result.status;

          if (updateTitle && result.fetchedTitle) {
            const originalTitle = item.originalTitle || item.title;
            if (!originalTitle || originalTitle === extractDomainFromUrl(item.url)) {
              newItem.title = result.fetchedTitle;
              newItem.titleWasUpdated = true;
            }
          }
        }

        newItems.push(newItem);
      }
    }

    return newItems;
  }

  return apply(items);
}

/**
 * 将解析后的书签结构转换为 Markdown 格式
 * @param {Array} items - 解析后的书签列表
 * @param {Object} options - 配置选项
 * @param {boolean} options.showInvalidMark - 是否显示 [失效] 标记
 * @returns {string} - Markdown 内容
 */
function convertToMarkdown(items, options = {}) {
  const { showInvalidMark = true } = options;
  const markdownLines = [];

  function processItems(itemsList) {
    for (const item of itemsList) {
      if (item.type === 'folder') {
        const level = item.level + 1;
        const title = item.name;
        markdownLines.push(`${'#'.repeat(level)} ${title}`);
        markdownLines.push('');

        if (item.children && item.children.length > 0) {
          processItems(item.children);

          if (markdownLines.length > 0 && markdownLines[markdownLines.length - 1] !== '') {
            markdownLines.push('');
          }
        }
      } else if (item.type === 'link') {
        const level = item.level;
        let title = item.title;
        const url = item.url;

        if (showInvalidMark && item.isInvalid) {
          title = `${title} [失效]`;
        }

        const indent = '  '.repeat(level);
        markdownLines.push(`${indent}- [${title}](${url})`);
      }
    }
  }

  processItems(items);

  return markdownLines.join('\n');
}

/**
 * 执行动态增强流程
 * @param {Array} bookmarks - 解析后的书签列表
 * @param {Object} options - 配置选项
 * @param {number} options.maxConcurrent - 最大并发数
 * @param {number} options.timeout - 超时时间（毫秒）
 * @param {boolean} options.enableTitleFetch - 是否启用标题抓取
 * @param {boolean} options.updateTitle - 是否更新无标题书签
 * @param {function} options.onProgress - 进度回调函数 (current, total)
 * @returns {Promise<{bookmarks: Array, results: Array}>} - 增强后的书签和结果
 */
async function enhanceBookmarks(bookmarks, options = {}) {
  const {
    maxConcurrent = 5,
    timeout = 5000,
    enableTitleFetch = false,
    updateTitle = true,
    onProgress = null
  } = options;

  const links = collectAllLinks(bookmarks);

  if (links.length === 0) {
    return {
      bookmarks,
      results: []
    };
  }

  const total = links.length;
  let completed = 0;

  const wrappedLinks = links.map((link, index) => ({
    ...link,
    _index: index
  }));

  const limiter = new ConcurrencyLimiter(maxConcurrent);

  const results = await Promise.all(
    wrappedLinks.map((link) =>
      limiter.add(async () => {
        const checkResult = await checkUrl(link.url, timeout);
        const isInvalid = checkResult.status === 'not_found' || checkResult.status === 'timeout';

        let fetchedTitle = null;
        if (enableTitleFetch && checkResult.status === 'success') {
          fetchedTitle = await fetchPageTitle(link.url, timeout * 2);
        }

        completed++;
        if (onProgress) {
          onProgress(completed, total);
        }

        return {
          url: link.url,
          title: link.title,
          originalTitle: link.originalTitle,
          isInvalid,
          fetchedTitle,
          status: checkResult.status,
          _index: link._index
        };
      })
    )
  );

  results.sort((a, b) => a._index - b._index);
  results.forEach(r => delete r._index);

  const enhancedBookmarks = applyEnhancementResults(bookmarks, results, { updateTitle });

  return {
    bookmarks: enhancedBookmarks,
    results
  };
}

/**
 * 统计书签数量（只统计链接，不统计文件夹）
 * @param {Array} items - 书签列表
 * @returns {number} - 链接数量
 */
function countBookmarks(items) {
  let count = 0;
  for (const item of items) {
    if (item.type === 'link') {
      count++;
    } else if (item.type === 'folder' && item.children) {
      count += countBookmarks(item.children);
    }
  }
  return count;
}

/**
 * 统计文件夹数量
 * @param {Array} items - 书签列表
 * @returns {number} - 文件夹数量
 */
function countFolders(items) {
  let count = 0;
  for (const item of items) {
    if (item.type === 'folder') {
      count++;
      if (item.children) {
        count += countFolders(item.children);
      }
    }
  }
  return count;
}

module.exports = {
  parseChromeBookmarks,
  convertToMarkdown,
  countBookmarks,
  countFolders,
  extractDomainFromUrl,
  collectAllLinks,
  applyEnhancementResults,
  enhanceBookmarks,
  checkUrl,
  fetchPageTitle,
  checkUrlsConcurrently,
  ConcurrencyLimiter
};
