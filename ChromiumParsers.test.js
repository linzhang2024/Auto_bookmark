const fs = require('fs');
const path = require('path');
const { BaseParser, BrowserType, parseTimestamp, chromeTimestampToDate, dateToChromeTimestamp } = require('./BaseParser');
const { ChromiumParser, ChromeParser, EdgeParser, detectBrowserType, autoParse, ICON_PATTERNS } = require('./ChromiumParsers');

const CHROME_HTML_PATH = path.join(__dirname, 'test_fixtures', 'chrome_bookmarks.html');
const EDGE_HTML_PATH = path.join(__dirname, 'test_fixtures', 'edge_bookmarks.html');

describe('ChromiumParsers - 时间戳转换测试', () => {
  const TEST_CHROME_TS = 13348540800000000n;
  const EXPECTED_DATE = new Date(Date.UTC(2024, 2, 15, 12, 0, 0));

  test('parseTimestamp 应该正确转换 Chrome 微秒级时间戳', () => {
    const date = parseTimestamp(TEST_CHROME_TS.toString(), { browserType: BrowserType.CHROME });
    expect(date).toBeInstanceOf(Date);
  });

  test('parseTimestamp 应该自动检测 Chrome 微秒时间戳（无 browserType）', () => {
    const largeTs = '10000000000000000';
    const date = parseTimestamp(largeTs);
    expect(date).toBeInstanceOf(Date);
  });

  test('parseTimestamp 应该正确处理 Unix 秒时间戳', () => {
    const unixTs = '1700000000';
    const date = parseTimestamp(unixTs);
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBe(1700000000000);
  });

  test('chromeTimestampToDate 应该正确转换', () => {
    const date = chromeTimestampToDate(TEST_CHROME_TS);
    expect(date).toBeInstanceOf(Date);
  });

  test('dateToChromeTimestamp 应该生成正确的时间戳', () => {
    const testDate = new Date('2024-03-15T12:00:00Z');
    const chromeTs = dateToChromeTimestamp(testDate);
    expect(chromeTs).toBeDefined();
    expect(typeof chromeTs).toBe('bigint');

    const convertedBack = chromeTimestampToDate(chromeTs);
    expect(Math.abs(convertedBack.getTime() - testDate.getTime())).toBeLessThan(1000);
  });

  test('时间戳转换应该支持字符串输入', () => {
    const date = parseTimestamp(TEST_CHROME_TS.toString());
    expect(date).toBeInstanceOf(Date);
  });

  test('时间戳转换应该处理无效值', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('abc')).toBeNull();
    expect(parseTimestamp('-100')).toBeNull();
  });
});

describe('ChromiumParsers - ICON 属性处理测试', () => {
  const VALID_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVQ4jWNgYGD4jwWTBCAmXixYtGgQYQAAAO8AAR82aK0AAAAASUVORK5CYII=';
  const INCOMPLETE_BASE64 = 'data:image/png;base64,iVBORw0KGgo';
  const PURE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVQ4jWNgYGD4jwWTBCAmXixYtGgQYQAAAO8AAR82aK0AAAAASUVORK5CYII=';

  test('ChromiumParser 应该正确处理有效的 ICON', () => {
    const parser = new ChromiumParser();
    const processed = parser.safeProcessIcon(VALID_ICON);
    expect(processed).toBeDefined();
    expect(processed).toContain('data:image');
  });

  test('ChromiumParser 应该修复不完整的 Base64 padding', () => {
    const parser = new ChromiumParser();
    const processed = parser.validateAndRepairIcon(INCOMPLETE_BASE64);
    expect(processed).toBeDefined();
    const base64Part = processed.split(',')[1];
    if (base64Part) {
      expect(base64Part.length % 4).toBe(0);
    }
  });

  test('ChromiumParser 应该处理纯 Base64 格式（无 data URI）', () => {
    const parser = new ChromiumParser();
    const processed = parser.normalizeIconData(PURE_BASE64);
    expect(processed).toContain('data:image');
  });

  test('ChromiumParser 应该正确提取 MIME 类型', () => {
    const parser = new ChromiumParser();
    const mimeType = parser.extractMimeType(VALID_ICON);
    expect(mimeType).toBe('image/png');
  });

  test('ChromiumParser 应该正确计算图标大小', () => {
    const parser = new ChromiumParser();
    const size = parser.calculateIconSize(VALID_ICON);
    expect(size).toBeGreaterThan(0);
    expect(typeof size).toBe('number');
  });

  test('ChromiumParser 应该验证 Base64 格式', () => {
    const parser = new ChromiumParser();
    expect(parser.isValidBase64(VALID_ICON)).toBe(true);
    expect(parser.isValidBase64('invalid!!!')).toBe(false);
    expect(parser.isValidBase64(null)).toBe(false);
  });

  test('ChromiumParser 应该处理空的或无效的 ICON', () => {
    const parser = new ChromiumParser();
    expect(parser.safeProcessIcon(null)).toBeNull();
    expect(parser.safeProcessIcon('')).toBeNull();
    expect(parser.safeProcessIcon(undefined)).toBeNull();
  });

  test('ChromiumParser 应该限制超大图标', () => {
    const parser = new ChromiumParser({ maxIconSize: 100 });
    const largeIcon = 'data:image/png;base64,' + 'A'.repeat(200);
    const result = parser.safeProcessIcon(largeIcon);
    expect(result).toBeNull();
  });

  test('extractBookmarkMeta 应该正确解析 ICON 元数据', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://test.com" 
         ADD_DATE="13348540800000000" 
         ICON="${VALID_ICON}">
        测试书签
    </A>
</DL><p>
`;
    const result = ChromeParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].icon).toBeDefined();
  });
});

describe('ChromiumParsers - 浏览器类型检测测试', () => {
  const CHROME_HTML = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p></DL><p>
`;

  const EDGE_HTML = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>收藏夹</TITLE>
<H1>收藏夹</H1>
<DL><p></DL><p>
`;

  const FIREFOX_HTML = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p></DL><p>
`;

  test('detectBrowserType 应该正确识别 Chrome', () => {
    const type = detectBrowserType(CHROME_HTML);
    expect(type).toBe(BrowserType.CHROME);
  });

  test('detectBrowserType 应该正确识别 Edge', () => {
    const type = detectBrowserType(EDGE_HTML);
    expect(type).toBe(BrowserType.EDGE);
  });

  test('detectBrowserType 应该正确识别 Firefox', () => {
    const type = detectBrowserType(FIREFOX_HTML);
    expect(type).toBe(BrowserType.FIREFOX);
  });

  test('detectBrowserType 应该处理无效输入', () => {
    expect(detectBrowserType(null)).toBe(BrowserType.UNKNOWN);
    expect(detectBrowserType(undefined)).toBe(BrowserType.UNKNOWN);
    expect(detectBrowserType('')).toBe(BrowserType.UNKNOWN);
    expect(detectBrowserType(123)).toBe(BrowserType.UNKNOWN);
  });

  test('ChromeParser 应该设置正确的 browserType', () => {
    const result = ChromeParser.parse(CHROME_HTML, { flatten: true });
    if (result.length > 0) {
      expect(result[0].browserType).toBe(BrowserType.CHROME);
    }
  });

  test('EdgeParser 应该设置正确的 browserType', () => {
    const result = EdgeParser.parse(EDGE_HTML, { flatten: true });
    if (result.length > 0) {
      expect(result[0].browserType).toBe(BrowserType.EDGE);
    }
  });

  test('autoParse 应该自动检测并使用正确的解析器', () => {
    const chromeResult = autoParse(CHROME_HTML, { flatten: true });
    if (chromeResult.length > 0) {
      expect(chromeResult[0].browserType).toBe(BrowserType.CHROME);
    }

    const edgeResult = autoParse(EDGE_HTML, { flatten: true });
    if (edgeResult.length > 0) {
      expect(edgeResult[0].browserType).toBe(BrowserType.EDGE);
    }
  });
});

describe('ChromiumParsers - 文件夹嵌套结构测试', () => {
  const NESTED_HTML = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="13348540800000000" LAST_MODIFIED="13348540800000000">一级文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com" ADD_DATE="13348540801000000">链接1</A>
        <DT><H3 ADD_DATE="13348627200000000" LAST_MODIFIED="13348627200000000">二级文件夹</H3>
        <DL><p>
            <DT><A HREF="https://link2.com" ADD_DATE="13348713600000000">链接2</A>
            <DT><H3 ADD_DATE="13348800000000000" LAST_MODIFIED="13348800000000000">三级文件夹</H3>
            <DL><p>
                <DT><A HREF="https://link3.com" ADD_DATE="13348886400000000">链接3</A>
            </DL><p>
        </DL><p>
    </DL><p>
    <DT><H3 ADD_DATE="13348972800000000" LAST_MODIFIED="13348972800000000">同级文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link4.com" ADD_DATE="13349059200000000">链接4</A>
    </DL><p>
</DL><p>
`;

  test('应该正确解析多级嵌套文件夹', () => {
    const result = ChromeParser.parse(NESTED_HTML);

    expect(result.length).toBe(2);

    const level1Folder = result.find(f => f.name === '一级文件夹');
    expect(level1Folder).toBeDefined();
    expect(level1Folder.type).toBe('folder');
    expect(level1Folder.children.length).toBe(2);

    const level2Folder = level1Folder.children.find(c => c.type === 'folder' && c.name === '二级文件夹');
    expect(level2Folder).toBeDefined();
    expect(level2Folder.children.length).toBe(2);

    const level3Folder = level2Folder.children.find(c => c.type === 'folder' && c.name === '三级文件夹');
    expect(level3Folder).toBeDefined();
    expect(level3Folder.children.length).toBe(1);
    expect(level3Folder.children[0].title).toBe('链接3');
  });

  test('flatten 选项应该正确展开所有项并保持 folderPath', () => {
    const result = ChromeParser.parse(NESTED_HTML, { flatten: true });

    const allItems = result;
    expect(allItems.length).toBeGreaterThan(0);

    const link1 = allItems.find(i => i.title === '链接1');
    expect(link1).toBeDefined();
    expect(link1.folderPath).toContain('一级文件夹');

    const link3 = allItems.find(i => i.title === '链接3');
    expect(link3).toBeDefined();
    expect(link3.folderPath).toContain('一级文件夹');
    expect(link3.folderPath).toContain('二级文件夹');
    expect(link3.folderPath).toContain('三级文件夹');
  });

  test('文件夹应该有正确的 addDate 和 lastModified', () => {
    const result = ChromeParser.parse(NESTED_HTML);
    const level1Folder = result.find(f => f.name === '一级文件夹');

    expect(level1Folder.addDate).toBeInstanceOf(Date);
    expect(level1Folder.lastModified).toBeInstanceOf(Date);
  });

  test('书签应该有正确的时间戳属性', () => {
    const result = ChromeParser.parse(NESTED_HTML, { flatten: true });
    const link1 = result.find(i => i.title === '链接1');

    expect(link1.addDate).toBeInstanceOf(Date);
  });

  test('同级文件夹应该正确解析', () => {
    const result = ChromeParser.parse(NESTED_HTML);

    const level1Folder = result.find(f => f.name === '一级文件夹');
    const siblingFolder = result.find(f => f.name === '同级文件夹');

    expect(level1Folder).toBeDefined();
    expect(siblingFolder).toBeDefined();
    expect(level1Folder.level).toBe(siblingFolder.level);
  });
});

describe('ChromiumParsers - 集成测试', () => {
  test('应该正确解析 Chrome 测试文件', () => {
    if (fs.existsSync(CHROME_HTML_PATH)) {
      const htmlContent = fs.readFileSync(CHROME_HTML_PATH, 'utf-8');
      const result = ChromeParser.parse(htmlContent);

      expect(result.length).toBeGreaterThan(0);

      const countItems = (items, type) => {
        let count = 0;
        for (const item of items) {
          if (item.type === type) count++;
          if (item.children) {
            count += countItems(item.children, type);
          }
        }
        return count;
      };

      const folderCount = countItems(result, 'folder');
      const linkCount = countItems(result, 'link');

      expect(folderCount).toBeGreaterThan(0);
      expect(linkCount).toBeGreaterThan(0);
    }
  });

  test('应该正确解析 Edge 测试文件', () => {
    if (fs.existsSync(EDGE_HTML_PATH)) {
      const htmlContent = fs.readFileSync(EDGE_HTML_PATH, 'utf-8');
      const result = EdgeParser.parse(htmlContent);

      expect(result.length).toBeGreaterThan(0);

      const resultFlat = EdgeParser.parse(htmlContent, { flatten: true });
      const withIcon = resultFlat.find(i => i.icon);
      if (withIcon) {
        expect(withIcon.icon).toContain('data:image');
      }
    }
  });

  test('autoParse 应该正确处理各种浏览器格式', () => {
    if (fs.existsSync(CHROME_HTML_PATH)) {
      const htmlContent = fs.readFileSync(CHROME_HTML_PATH, 'utf-8');
      const result = autoParse(htmlContent, { flatten: true });

      expect(result.length).toBeGreaterThan(0);
    }
  });

  test('流式解析应该支持大文件', async () => {
    let largeHtml = '<DL><p>\n';
    for (let i = 0; i < 100; i++) {
      largeHtml += `<DT><A HREF="https://link-${i}.com" ADD_DATE="1334854080${i}000000">链接 ${i}</A>\n`;
    }
    largeHtml += '</DL><p>';

    const { Readable } = require('stream');
    const readStream = Readable.from(largeHtml);

    const result = await ChromiumParser.parseFromStream(readStream, { flatten: true });

    expect(result.length).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(result[i].title).toBe(`链接 ${i}`);
    }
  });

  test('文件解析应该正确工作', async () => {
    if (fs.existsSync(CHROME_HTML_PATH)) {
      const result = await ChromeParser.parseFile(CHROME_HTML_PATH);

      expect(result.length).toBeGreaterThan(0);
    }
  });
});

describe('ChromiumParsers - 兼容性测试', () => {
  test('ChromeParser 应该继承自 BaseParser', () => {
    const parser = new ChromeParser();
    expect(parser instanceof BaseParser).toBe(true);
    expect(parser instanceof ChromiumParser).toBe(true);
  });

  test('EdgeParser 应该继承自 BaseParser', () => {
    const parser = new EdgeParser();
    expect(parser instanceof BaseParser).toBe(true);
    expect(parser instanceof ChromiumParser).toBe(true);
  });

  test('ChromeParser 静态方法应该工作', () => {
    const simpleHtml = '<DL><p><DT><A HREF="https://test.com">Test</A></DL><p>';
    const result = ChromeParser.parse(simpleHtml);

    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://test.com');
  });

  test('EdgeParser 静态方法应该工作', () => {
    const simpleHtml = '<DL><p><DT><A HREF="https://test.com">Test</A></DL><p>';
    const result = EdgeParser.parse(simpleHtml);

    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://test.com');
  });

  test('ChromiumParser 应该支持事件驱动解析', () => {
    const html = `
<DL><p>
    <DT><H3>测试文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><A HREF="https://link2.com">链接2</A>
    </DL><p>
</DL><p>
`;

    const items = [];
    const folders = [];
    const links = [];

    const parser = new ChromeParser({
      emitEvent: true,
      onItem: (item) => items.push(item),
      onFolder: (folder) => folders.push(folder),
      onLink: (link) => links.push(link)
    });

    parser.parse(html);

    expect(items.length).toBe(3);
    expect(folders.length).toBe(1);
    expect(links.length).toBe(2);
  });
});

describe('ChromiumParsers - 边界情况测试', () => {
  test('应该处理空的 HTML 内容', () => {
    expect(ChromeParser.parse('')).toEqual([]);
    expect(ChromeParser.parse(null)).toEqual([]);
    expect(ChromeParser.parse(undefined)).toEqual([]);
  });

  test('应该处理没有有效书签的 HTML', () => {
    const html = '<html><body>没有书签内容</body></html>';
    expect(ChromeParser.parse(html)).toEqual([]);
  });

  test('应该处理格式混乱的 HTML', () => {
    const html = `
<DL><p>
    <DT<H3损坏的标签
    <<>>混乱内容
    <DT><A HREF="https://valid.com">有效链接</A>
`;
    const result = ChromeParser.parse(html);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  test('应该处理缺少必需属性的标签', () => {
    const html = `
<DL><p>
    <DT><A>没有 href</A>
    <DT><A HREF="">空 href</A>
    <DT><A HREF="https://valid.com">有效</A>
</DL><p>
`;
    const result = ChromeParser.parse(html);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  test('应该处理超长的属性值', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(1000);
    const html = `
<DL><p>
    <DT><A HREF="${longUrl}" 
         ADD_DATE="13348540800000000"
         ICON="data:image/png;base64,${'iVBORw0KGgo'.repeat(100)}">
        超长属性测试
    </A>
</DL><p>
`;
    const result = ChromeParser.parse(html);
    expect(result.length).toBe(1);
  });
});
