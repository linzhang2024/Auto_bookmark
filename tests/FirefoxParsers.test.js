const fs = require('fs');
const path = require('path');
const { BaseParser, BrowserType } = require('../src/parsers/BaseParser');
const { FirefoxParser, detectBrowserType, autoParse } = require('../src/parsers/ChromiumParsers');

const FIREFOX_HTML_PATH = path.join(__dirname, 'test_fixtures', 'firefox_bookmarks.html');

describe('FirefoxParser - 基础功能测试', () => {
  test('FirefoxParser 应该继承自 BaseParser', () => {
    const parser = new FirefoxParser();
    expect(parser instanceof BaseParser).toBe(true);
  });

  test('FirefoxParser 构造函数应该设置正确的 browserType', () => {
    const parser = new FirefoxParser();
    expect(parser.browserType).toBe(BrowserType.FIREFOX);
  });

  test('静态 parse 方法应该工作', () => {
    const simpleHtml = '<DL><p><DT><A HREF="https://test.com">Test</A></DL><p>';
    const result = FirefoxParser.parse(simpleHtml);
    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://test.com');
  });
});

describe('FirefoxParser - ICON_URI 属性解析测试', () => {
  test('应该正确提取 ICON_URI 属性', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.mozilla.org" 
         ADD_DATE="1700000000"
         ICON_URI="https://www.mozilla.org/favicon.ico">
        Mozilla
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].iconUri).toBe('https://www.mozilla.org/favicon.ico');
    expect(result[0].meta.iconUri).toBe('https://www.mozilla.org/favicon.ico');
  });

  test('应该同时支持 ICON 和 ICON_URI', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.google.com" 
         ADD_DATE="1700000000"
         ICON="data:image/png;base64,iVBORw0KGgo="
         ICON_URI="https://www.google.com/favicon.ico">
        Google
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].icon).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(result[0].iconUri).toBe('https://www.google.com/favicon.ico');
  });

  test('没有 ICON_URI 的书签应该返回 null 或 undefined', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000">
        Example
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].iconUri).toBeNull();
  });
});

describe('FirefoxParser - SHORTCUTURL 属性解析测试', () => {
  test('应该正确提取 SHORTCUTURL 属性', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.wikipedia.org" 
         ADD_DATE="1700000000"
         SHORTCUTURL="https://en.wikipedia.org/wiki/Special:Search?search=%s">
        Wikipedia
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.shortcutUrl).toBe('https://en.wikipedia.org/wiki/Special:Search?search=%s');
  });

  test('应该支持 SHORTCUT_URL（带下划线）格式', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.reddit.com" 
         ADD_DATE="1700000000"
         SHORTCUT_URL="https://www.reddit.com/r/%s">
        Reddit
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.shortcutUrl).toBe('https://www.reddit.com/r/%s');
  });

  test('SHORTCUTURL 应该优先于 SHORTCUT_URL', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000"
         SHORTCUTURL="https://shortcuturl.com/%s"
         SHORTCUT_URL="https://shortcut_url.com/%s">
        Test
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.shortcutUrl).toBe('https://shortcuturl.com/%s');
  });

  test('没有 SHORTCUTURL 的书签应该返回 undefined', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000">
        Example
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.shortcutUrl).toBeUndefined();
  });
});

describe('FirefoxParser - TAGS 字段解析测试', () => {
  test('应该正确解析逗号分隔的 TAGS 为数组', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.google.com" 
         ADD_DATE="1700000000"
         TAGS="search,engine,google">
        Google
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(Array.isArray(result[0].meta.tags)).toBe(true);
    expect(result[0].meta.tags).toEqual(['search', 'engine', 'google']);
  });

  test('应该处理标签中的空格', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000"
         TAGS=" tag1 , tag2 , tag3 ">
        Example
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.tags).toEqual(['tag1', 'tag2', 'tag3']);
  });

  test('应该过滤空标签', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000"
         TAGS="valid1,,valid2, ,valid3">
        Example
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.tags).toEqual(['valid1', 'valid2', 'valid3']);
  });

  test('空 TAGS 字符串应该返回空数组', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000"
         TAGS="">
        Example
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.tags).toEqual([]);
  });

  test('只有空格的 TAGS 应该返回空数组', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000"
         TAGS="  ,  ,  ">
        Example
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.tags).toEqual([]);
  });

  test('没有 TAGS 属性的书签应该返回 undefined', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000">
        Example
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.tags).toBeUndefined();
  });

  test('单个标签应该返回单元素数组', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.example.com" 
         ADD_DATE="1700000000"
         TAGS="single">
        Example
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].meta.tags).toEqual(['single']);
  });
});

describe('FirefoxParser - 浏览器类型检测测试', () => {
  const FIREFOX_HTML = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p></DL><p>
`;

  const CHROME_HTML = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p></DL><p>
`;

  test('detectBrowserType 应该正确识别 Firefox', () => {
    const type = detectBrowserType(FIREFOX_HTML);
    expect(type).toBe(BrowserType.FIREFOX);
  });

  test('detectBrowserType 应该正确识别 Chrome', () => {
    const type = detectBrowserType(CHROME_HTML);
    expect(type).toBe(BrowserType.CHROME);
  });

  test('autoParse 应该自动检测并使用 FirefoxParser', () => {
    const htmlWithContent = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><A HREF="https://test.com" TAGS="firefox,test">Test</A>
</DL><p>
`;
    const result = autoParse(htmlWithContent, { flatten: true });
    expect(result.length).toBe(1);
    expect(result[0].browserType).toBe(BrowserType.FIREFOX);
    expect(result[0].meta.tags).toEqual(['firefox', 'test']);
  });

  test('FirefoxParser 解析结果应该有正确的 browserType', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://test.com">Test</A>
</DL><p>
`;
    const result = FirefoxParser.parse(html);
    expect(result.length).toBe(1);
    expect(result[0].browserType).toBe(BrowserType.FIREFOX);
  });
});

describe('FirefoxParser - 文件夹层级结构测试', () => {
  const NESTED_HTML = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000000">一级文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com" ADD_DATE="1700000001" TAGS="level1">链接1</A>
        <DT><H3 ADD_DATE="1700000002" LAST_MODIFIED="1700000002">二级文件夹</H3>
        <DL><p>
            <DT><A HREF="https://link2.com" ADD_DATE="1700000003" TAGS="level2">链接2</A>
            <DT><H3 ADD_DATE="1700000004" LAST_MODIFIED="1700000004">三级文件夹</H3>
            <DL><p>
                <DT><A HREF="https://link3.com" ADD_DATE="1700000005" TAGS="level3,deep">链接3</A>
            </DL><p>
        </DL><p>
    </DL><p>
    <DT><H3 ADD_DATE="1700000006" LAST_MODIFIED="1700000006">同级文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link4.com" ADD_DATE="1700000007" TAGS="sibling">链接4</A>
    </DL><p>
</DL><p>
`;

  test('应该正确解析多级嵌套文件夹', () => {
    const result = FirefoxParser.parse(NESTED_HTML);

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
    const result = FirefoxParser.parse(NESTED_HTML, { flatten: true });

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
    expect(link3.meta.tags).toEqual(['level3', 'deep']);
  });

  test('文件夹应该有正确的 addDate 和 lastModified', () => {
    const result = FirefoxParser.parse(NESTED_HTML);
    const level1Folder = result.find(f => f.name === '一级文件夹');

    expect(level1Folder.addDate).toBeInstanceOf(Date);
    expect(level1Folder.lastModified).toBeInstanceOf(Date);
  });

  test('书签应该有正确的标签属性', () => {
    const result = FirefoxParser.parse(NESTED_HTML, { flatten: true });
    const link2 = result.find(i => i.title === '链接2');

    expect(link2.meta.tags).toEqual(['level2']);
  });
});

describe('FirefoxParser - 集成测试（使用样本文件）', () => {
  test('应该正确解析 Firefox 测试文件', () => {
    if (fs.existsSync(FIREFOX_HTML_PATH)) {
      const htmlContent = fs.readFileSync(FIREFOX_HTML_PATH, 'utf-8');
      const result = FirefoxParser.parse(htmlContent);

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

  test('样本文件中的书签应该有正确的 TAGS 解析', () => {
    if (fs.existsSync(FIREFOX_HTML_PATH)) {
      const htmlContent = fs.readFileSync(FIREFOX_HTML_PATH, 'utf-8');
      const result = FirefoxParser.parse(htmlContent, { flatten: true });

      const googleLink = result.find(i => i.title === 'Google');
      expect(googleLink).toBeDefined();
      expect(googleLink.meta.tags).toContain('search');
      expect(googleLink.meta.tags).toContain('google');

      const githubLink = result.find(i => i.title === 'GitHub');
      expect(githubLink).toBeDefined();
      expect(githubLink.meta.tags).toContain('development');
      expect(githubLink.meta.tags).toContain('github');
    }
  });

  test('样本文件中的书签应该有正确的 ICON_URI', () => {
    if (fs.existsSync(FIREFOX_HTML_PATH)) {
      const htmlContent = fs.readFileSync(FIREFOX_HTML_PATH, 'utf-8');
      const result = FirefoxParser.parse(htmlContent, { flatten: true });

      const mozillaLink = result.find(i => i.title === 'Mozilla');
      expect(mozillaLink).toBeDefined();
      expect(mozillaLink.iconUri).toBe('https://www.mozilla.org/favicon.ico');

      const mdnLink = result.find(i => i.title === 'MDN Web Docs');
      expect(mdnLink).toBeDefined();
      expect(mdnLink.iconUri).toBe('https://developer.mozilla.org/favicon.ico');
    }
  });

  test('样本文件中的书签应该有正确的 SHORTCUTURL', () => {
    if (fs.existsSync(FIREFOX_HTML_PATH)) {
      const htmlContent = fs.readFileSync(FIREFOX_HTML_PATH, 'utf-8');
      const result = FirefoxParser.parse(htmlContent, { flatten: true });

      const wikiLink = result.find(i => i.title === '维基百科');
      expect(wikiLink).toBeDefined();
      expect(wikiLink.meta.shortcutUrl).toContain('wikipedia.org');
      expect(wikiLink.meta.shortcutUrl).toContain('%s');

      const redditLink = result.find(i => i.title === 'Reddit');
      expect(redditLink).toBeDefined();
      expect(redditLink.meta.shortcutUrl).toContain('reddit.com');
      expect(redditLink.meta.shortcutUrl).toContain('%s');
    }
  });

  test('样本文件中的空标签应该正确处理', () => {
    if (fs.existsSync(FIREFOX_HTML_PATH)) {
      const htmlContent = fs.readFileSync(FIREFOX_HTML_PATH, 'utf-8');
      const result = FirefoxParser.parse(htmlContent, { flatten: true });

      const noTagsLink = result.find(i => i.title === '测试网站（无标签）');
      expect(noTagsLink).toBeDefined();
      expect(noTagsLink.meta.tags).toEqual([]);

      const emptyTagsLink = result.find(i => i.title === '示例网站（空标签和空格）');
      expect(emptyTagsLink).toBeDefined();
      expect(emptyTagsLink.meta.tags).toEqual(['empty', 'spaces']);
    }
  });

  test('文件解析静态方法应该正确工作', async () => {
    if (fs.existsSync(FIREFOX_HTML_PATH)) {
      const result = await FirefoxParser.parseFile(FIREFOX_HTML_PATH);
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

describe('FirefoxParser - 与 Chrome/Edge 兼容性测试', () => {
  test('FirefoxParser 不应该干扰 Chrome 格式解析', () => {
    const chromeHtml = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://chrome.test" 
         ADD_DATE="13348540800000000"
         ICON="data:image/png;base64,iVBORw0KGgo=">
        Chrome Bookmark
    </A>
</DL><p>
`;
    const result = FirefoxParser.parse(chromeHtml);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Chrome Bookmark');
    expect(result[0].icon).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  test('autoParse 应该正确区分 Firefox 和 Chrome', () => {
    const firefoxHtml = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><A HREF="https://firefox.test" TAGS="firefox">Firefox</A>
</DL><p>
`;

    const chromeHtml = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://chrome.test">Chrome</A>
</DL><p>
`;

    const firefoxResult = autoParse(firefoxHtml, { flatten: true });
    const chromeResult = autoParse(chromeHtml, { flatten: true });

    expect(firefoxResult[0].browserType).toBe(BrowserType.FIREFOX);
    expect(chromeResult[0].browserType).toBe(BrowserType.CHROME);
  });
});

describe('FirefoxParser - 边界情况测试', () => {
  test('应该处理空的 HTML 内容', () => {
    expect(FirefoxParser.parse('')).toEqual([]);
    expect(FirefoxParser.parse(null)).toEqual([]);
    expect(FirefoxParser.parse(undefined)).toEqual([]);
  });

  test('应该处理没有有效书签的 HTML', () => {
    const html = '<html><body>没有书签内容</body></html>';
    expect(FirefoxParser.parse(html)).toEqual([]);
  });

  test('应该支持事件驱动解析', () => {
    const html = `
<DL><p>
    <DT><H3>测试文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com" TAGS="tag1">链接1</A>
        <DT><A HREF="https://link2.com" TAGS="tag2">链接2</A>
    </DL><p>
</DL><p>
`;

    const items = [];
    const folders = [];
    const links = [];

    const parser = new FirefoxParser({
      emitEvent: true,
      onItem: (item) => items.push(item),
      onFolder: (folder) => folders.push(folder),
      onLink: (link) => links.push(link)
    });

    parser.parse(html);

    expect(items.length).toBe(3);
    expect(folders.length).toBe(1);
    expect(links.length).toBe(2);
    expect(links[0].meta.tags).toEqual(['tag1']);
  });

  test('应该支持流式解析', async () => {
    const html = `
<DL><p>
    <DT><A HREF="https://link1.com" TAGS="stream,test">流式测试</A>
</DL><p>
`;

    const { Readable } = require('stream');
    const readStream = Readable.from(html);
    
    const result = await FirefoxParser.parseFromStream(readStream);

    expect(result.length).toBe(1);
    expect(result[0].title).toBe('流式测试');
    expect(result[0].meta.tags).toEqual(['stream', 'test']);
  });
});
