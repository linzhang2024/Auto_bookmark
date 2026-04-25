/**
 * 过滤规则配置
 * 用于过滤不需要的书签
 */

module.exports = {
  /**
   * 需要过滤的 URL 模式
   * 支持字符串匹配和正则表达式
   */
  filterPatterns: [
    // 本地开发环境
    'localhost',
    '127.0.0.1',
    'dev.test',
  ],

  /**
   * 检查 URL 是否需要被过滤
   * @param {string} url - 要检查的 URL
   * @returns {boolean} - 如果需要过滤返回 true，否则返回 false
   */
  shouldFilter(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }

    const urlLower = url.toLowerCase();

    for (const pattern of this.filterPatterns) {
      if (typeof pattern === 'string') {
        if (this.matchesPattern(urlLower, pattern)) {
          return true;
        }
      } else if (pattern instanceof RegExp) {
        if (pattern.test(urlLower)) {
          return true;
        }
      }
    }

    return false;
  },

  /**
   * 检查 URL 是否匹配某个模式
   * @param {string} urlLower - 小写的 URL
   * @param {string} pattern - 匹配模式
   * @returns {boolean}
   */
  matchesPattern(urlLower, pattern) {
    const patternLower = pattern.toLowerCase();

    try {
      const urlObj = new URL(urlLower);
      const hostname = urlObj.hostname || '';

      if (hostname.includes(patternLower)) {
        return true;
      }
    } catch {
      // 如果无法解析为 URL，使用简单的字符串匹配
    }

    return urlLower.includes(patternLower);
  },
};
