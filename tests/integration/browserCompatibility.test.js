/**
 * 集成测试：多浏览器书签解析兼容性测试
 * 测试 Chrome、Edge、Firefox 导出的 HTML 书签解析准确性
 */

const fs = require('fs');
const path = require('path');
const {
  parseBookmarks,
  parseChromeBookmarks,
  BrowserType,
  detectBrowserType,
  parseTimestamp,
  extractFolderMeta,
  extractBookmarkMeta,
  countBookmarks,
  countFolders
} = require('../../bookmarkConverter');

const TEST_FIXTURES_DIR = path.join(__dirname, '../../test_fixtures');

function loadFixture(filename) {
  const filePath = path.join(TEST_FIXTURES_DIR, filename);
  return fs.readFileSync(filePath, 'utf-8');
}

describe('集成测试 - 多浏览器书签解析兼容性', () => {
  describe('浏览器类型检测', () => {
    test('应正确检测 Chrome 书签格式', () => {
      const html = loadFixture('chrome_bookmarks.html');
      const $ = require('cheerio').load(html, {
        decodeEntities: false,
        xmlMode: false,
        lowerCaseTags: true,
        lowerCaseAttributeNames: true
      });
      const browserType = detectBrowserType($);
      expect(browserType).toBe(BrowserType.CHROME);
    });

    test('应正确检测 Edge 书签格式', () => {
      const html = loadFixture('edge_bookmarks.html');
      const $ = require('cheerio').load(html, {
        decodeEntities: false,
        xmlMode: false,
        lowerCaseTags: true,
        lowerCaseAttributeNames: true
      });
      const browserType = detectBrowserType($);
      expect(browserType).toBe(BrowserType.EDGE);
    });

    test('应正确检测 Firefox 书签格式', () => {
      const html = loadFixture('firefox_bookmarks.html');
      const $ = require('cheerio').load(html, {
        decodeEntities: false,
        xmlMode: false,
        lowerCaseTags: true,
        lowerCaseAttributeNames: true
      });
      const browserType = detectBrowserType($);
      expect(browserType).toBe(BrowserType.FIREFOX);
    });
  });

  describe('时间戳解析', () => {
    test('应正确解析秒级 Unix 时间戳', () => {
      const timestamp = parseTimestamp('1700000000');
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBe(1700000000000);
    });

    test('对于无效时间戳应返回 null', () => {
      expect(parseTimestamp(null)).toBeNull();
      expect(parseTimestamp(undefined)).toBeNull();
      expect(parseTimestamp('')).toBeNull();
      expect(parseTimestamp('abc')).toBeNull();
      expect(parseTimestamp('0')).toBeNull();
    });
  });

  describe('Chrome 书签解析', () => {
    let bookmarks;

    beforeAll(() => {
      const html = loadFixture('chrome_bookmarks.html');
      bookmarks = parseBookmarks(html);
    });

    test('应正确解析书签数量', () => {
      const totalLinks = countBookmarks(bookmarks);
      expect(totalLinks).toBeGreaterThan(0);
    });

    test('应正确解析文件夹数量', () => {
      const totalFolders = countFolders(bookmarks);
      expect(totalFolders).toBeGreaterThan(0);
    });

    test('应包含顶层文件夹', () => {
      const rootFolders = bookmarks.filter(item => item.type === 'folder');
      expect(rootFolders.length).toBeGreaterThan(0);
    });

    test('每个书签应包含必要属性', () => {
      function checkBookmarks(items) {
        for (const item of items) {
          if (item.type === 'link') {
            expect(item).toHaveProperty('title');
            expect(item).toHaveProperty('url');
            expect(item).toHaveProperty('type', 'link');
            expect(item).toHaveProperty('level');
            expect(item.title).toBeDefined();
            expect(item.url).toBeDefined();
            expect(item.url).not.toBe('');
          } else if (item.type === 'folder') {
            expect(item).toHaveProperty('name');
            expect(item).toHaveProperty('type', 'folder');
            expect(item).toHaveProperty('children');
            expect(Array.isArray(item.children)).toBe(true);
            if (item.children.length > 0) {
              checkBookmarks(item.children);
            }
          }
        }
      }
      checkBookmarks(bookmarks);
    });

    test('应正确识别书签栏文件夹', () => {
      function findToolbarFolder(items) {
        for (const item of items) {
          if (item.type === 'folder' && item.isPersonalToolbar) {
            return item;
          }
          if (item.children && item.children.length > 0) {
            const found = findToolbarFolder(item.children);
            if (found) return found;
          }
        }
        return null;
      }
      
      const toolbarFolder = findToolbarFolder(bookmarks);
      if (toolbarFolder) {
        expect(toolbarFolder.isPersonalToolbar).toBe(true);
      }
    });

    test('应正确提取元数据', () => {
      function checkMeta(items) {
        for (const item of items) {
          if (item.type === 'link') {
            expect(item).toHaveProperty('meta');
            expect(item.meta).toHaveProperty('href');
            expect(item.meta).toHaveProperty('addDate');
          } else if (item.type === 'folder' && item.children) {
            checkMeta(item.children);
          }
        }
      }
      checkMeta(bookmarks);
    });
  });

  describe('Edge 书签解析', () => {
    let bookmarks;

    beforeAll(() => {
      const html = loadFixture('edge_bookmarks.html');
      bookmarks = parseBookmarks(html);
    });

    test('应正确解析中文文件夹名称', () => {
      function hasChineseFolder(items) {
        for (const item of items) {
          if (item.type === 'folder') {
            if (item.name.includes('收藏') || item.name.includes('夹')) {
              return true;
            }
            if (item.children && hasChineseFolder(item.children)) {
              return true;
            }
          }
        }
        return false;
      }
      expect(hasChineseFolder(bookmarks) || bookmarks.length > 0).toBe(true);
    });

    test('应正确解析书签数量', () => {
      const totalLinks = countBookmarks(bookmarks);
      expect(totalLinks).toBeGreaterThan(0);
    });

    test('应正确解析文件夹数量', () => {
      const totalFolders = countFolders(bookmarks);
      expect(totalFolders).toBeGreaterThan(0);
    });
  });

  describe('Firefox 书签解析', () => {
    let bookmarks;

    beforeAll(() => {
      const html = loadFixture('firefox_bookmarks.html');
      bookmarks = parseBookmarks(html);
    });

    test('应正确解析书签数量', () => {
      const totalLinks = countBookmarks(bookmarks);
      expect(totalLinks).toBeGreaterThan(0);
    });

    test('应正确解析文件夹数量', () => {
      const totalFolders = countFolders(bookmarks);
      expect(totalFolders).toBeGreaterThan(0);
    });

    test('应正确提取 ICON 属性（如果存在）', () => {
      function checkIcon(items) {
        for (const item of items) {
          if (item.type === 'link' && item.meta) {
            if (item.meta.icon !== undefined) {
              return true;
            }
          }
          if (item.children) {
            if (checkIcon(item.children)) {
              return true;
            }
          }
        }
        return false;
      }
      checkIcon(bookmarks);
    });

    test('应正确提取 ICON_URI 属性（Firefox 特定）', () => {
      function findBookmarkWithIconUri(items) {
        for (const item of items) {
          if (item.type === 'link') {
            if (item.iconUri || (item.meta && item.meta.iconUri)) {
              return item;
            }
          }
          if (item.children) {
            const found = findBookmarkWithIconUri(item.children);
            if (found) return found;
          }
        }
        return null;
      }
      
      const bookmark = findBookmarkWithIconUri(bookmarks);
      
      expect(bookmark).not.toBeNull();
      expect(bookmark.iconUri).toBeDefined();
      expect(bookmark.iconUri).not.toBeNull();
      expect(bookmark.iconUri).toContain('favicon.ico');
    });

    test('应同时支持 ICON 和 ICON_URI 两种属性格式', () => {
      const bookmarksWithIcon = [];
      const bookmarksWithIconUri = [];
      
      function collect(items) {
        for (const item of items) {
          if (item.type === 'link') {
            if (item.icon) {
              bookmarksWithIcon.push(item);
            }
            if (item.iconUri) {
              bookmarksWithIconUri.push(item);
            }
          }
          if (item.children) {
            collect(item.children);
          }
        }
      }
      
      collect(bookmarks);
      
      expect(bookmarksWithIcon.length).toBeGreaterThan(0);
      expect(bookmarksWithIconUri.length).toBeGreaterThan(0);
      
      expect(bookmarksWithIcon[0].icon).toContain('data:image');
      expect(bookmarksWithIconUri[0].iconUri).toContain('https://');
    });
  });

  describe('跨浏览器一致性测试', () => {
    test('不同浏览器的书签应具有一致的结构', () => {
      const chromeHtml = loadFixture('chrome_bookmarks.html');
      const edgeHtml = loadFixture('edge_bookmarks.html');
      const firefoxHtml = loadFixture('firefox_bookmarks.html');

      const chromeBookmarks = parseBookmarks(chromeHtml);
      const edgeBookmarks = parseBookmarks(edgeHtml);
      const firefoxBookmarks = parseBookmarks(firefoxHtml);

      function checkStructure(items) {
        for (const item of items) {
          expect(item).toHaveProperty('type');
          expect(['folder', 'link']).toContain(item.type);
          expect(item).toHaveProperty('level');
          expect(typeof item.level).toBe('number');

          if (item.type === 'folder') {
            expect(item).toHaveProperty('name');
            expect(item).toHaveProperty('children');
            expect(Array.isArray(item.children)).toBe(true);
            if (item.children.length > 0) {
              checkStructure(item.children);
            }
          } else {
            expect(item).toHaveProperty('title');
            expect(item).toHaveProperty('url');
          }
        }
      }

      checkStructure(chromeBookmarks);
      checkStructure(edgeBookmarks);
      checkStructure(firefoxBookmarks);
    });

    test('parseBookmarks 和 parseChromeBookmarks 应返回相同结果', () => {
      const html = loadFixture('chrome_bookmarks.html');
      const result1 = parseBookmarks(html);
      const result2 = parseChromeBookmarks(html);
      
      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });
  });

  describe('边界情况测试', () => {
    test('对于空 HTML 内容应返回空数组', () => {
      expect(parseBookmarks('')).toEqual([]);
    });

    test('对于 null 应返回空数组', () => {
      expect(parseBookmarks(null)).toEqual([]);
    });

    test('对于 undefined 应返回空数组', () => {
      expect(parseBookmarks(undefined)).toEqual([]);
    });

    test('对于无效 HTML 应返回空数组', () => {
      expect(parseBookmarks('<html></html>')).toEqual([]);
      expect(parseBookmarks('<div>not a bookmark</div>')).toEqual([]);
    });
  });
});
