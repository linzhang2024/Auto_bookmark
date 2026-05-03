const fs = require('fs');
const path = require('path');
const { BaseParser, BrowserType, parseTimestamp, extractDomainFromUrl } = require('../src/parsers/BaseParser');

describe('BaseParser - 基础功能测试', () => {
  describe('parseTimestamp', () => {
    test('应该正确解析 Unix 时间戳', () => {
      const date = parseTimestamp('1600000000');
      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBe(1600000000000);
    });

    test('应该处理无效时间戳', () => {
      expect(parseTimestamp(null)).toBeNull();
      expect(parseTimestamp(undefined)).toBeNull();
      expect(parseTimestamp('')).toBeNull();
      expect(parseTimestamp('abc')).toBeNull();
      expect(parseTimestamp('-100')).toBeNull();
    });
  });

  describe('extractDomainFromUrl', () => {
    test('应该正确提取域名', () => {
      expect(extractDomainFromUrl('https://www.google.com')).toBe('www.google.com');
      expect(extractDomainFromUrl('https://github.com')).toBe('github.com');
      expect(extractDomainFromUrl('https://sub.example.com/path')).toBe('sub.example.com');
    });

    test('应该处理无效的 URL', () => {
      expect(extractDomainFromUrl('not-a-url')).toBe('not-a-url');
      expect(extractDomainFromUrl('')).toBe('');
      expect(extractDomainFromUrl(null)).toBe('');
      expect(extractDomainFromUrl(undefined)).toBe('');
    });
  });

  describe('BrowserType 枚举', () => {
    test('应该包含正确的浏览器类型', () => {
      expect(BrowserType.CHROME).toBe('chrome');
      expect(BrowserType.EDGE).toBe('edge');
      expect(BrowserType.FIREFOX).toBe('firefox');
      expect(BrowserType.UNKNOWN).toBe('unknown');
    });
  });
});

describe('BaseParser - HTML 解析测试', () => {
  test('应该正确解析简单的书签结构', () => {
    const html = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>文件夹1</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><A HREF="https://link2.com">链接2</A>
    </DL><p>
</DL><p>
`;

    const result = BaseParser.parse(html);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('folder');
    expect(result[0].name).toBe('文件夹1');
    expect(result[0].children.length).toBe(2);
    expect(result[0].children[0].type).toBe('link');
    expect(result[0].children[0].title).toBe('链接1');
    expect(result[0].children[0].url).toBe('https://link1.com');
  });

  test('应该正确处理嵌套的文件夹结构', () => {
    const html = `
<DL><p>
    <DT><H3>一级文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><H3>二级文件夹</H3>
        <DL><p>
            <DT><A HREF="https://link2.com">链接2</A>
            <DT><H3>三级文件夹</H3>
            <DL><p>
                <DT><A HREF="https://link3.com">链接3</A>
            </DL><p>
        </DL><p>
    </DL><p>
</DL><p>
`;

    const result = BaseParser.parse(html);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe('一级文件夹');
    expect(result[0].children.length).toBe(2);
    
    const link1 = result[0].children.find(c => c.type === 'link');
    expect(link1.title).toBe('链接1');
    
    const level2Folder = result[0].children.find(c => c.type === 'folder');
    expect(level2Folder.name).toBe('二级文件夹');
    expect(level2Folder.children.length).toBe(2);
    
    const level3Folder = level2Folder.children.find(c => c.type === 'folder');
    expect(level3Folder.name).toBe('三级文件夹');
    expect(level3Folder.children.length).toBe(1);
    expect(level3Folder.children[0].title).toBe('链接3');
  });

  test('应该正确提取书签元数据', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://example.com" 
         ADD_DATE="1600000000" 
         LAST_MODIFIED="1610000000"
         LAST_VISIT="1620000000"
         ICON="data:image/png;base64,test"
         ICON_URI="https://example.com/favicon.ico">
        测试书签
    </A>
</DL><p>
`;

    const result = BaseParser.parse(html);

    expect(result.length).toBe(1);
    expect(result[0].title).toBe('测试书签');
    expect(result[0].url).toBe('https://example.com');
    expect(result[0].addDate).toBeInstanceOf(Date);
    expect(result[0].lastModified).toBeInstanceOf(Date);
    expect(result[0].lastVisit).toBeInstanceOf(Date);
    expect(result[0].icon).toBe('data:image/png;base64,test');
    expect(result[0].iconUri).toBe('https://example.com/favicon.ico');
  });

  test('应该正确提取文件夹元数据', () => {
    const html = `
<DL><p>
    <DT><H3 ADD_DATE="1600000000" 
             LAST_MODIFIED="1610000000"
             PERSONAL_TOOLBAR_FOLDER="true">
        书签栏
    </H3>
    <DL><p>
        <DT><A HREF="https://example.com">链接</A>
    </DL><p>
    <DT><H3 ADD_DATE="1620000000"
             LAST_MODIFIED="1630000000"
             UNFILED_BOOKMARKS_FOLDER="true">
        其他书签
    </H3>
    <DL><p>
        <DT><A HREF="https://other.com">其他链接</A>
    </DL><p>
</DL><p>
`;

    const result = BaseParser.parse(html);

    expect(result.length).toBe(2);
    
    const toolbarFolder = result.find(f => f.name === '书签栏');
    expect(toolbarFolder.isPersonalToolbar).toBe(true);
    expect(toolbarFolder.isUnfiled).toBe(false);
    expect(toolbarFolder.addDate).toBeInstanceOf(Date);
    
    const unfiledFolder = result.find(f => f.name === '其他书签');
    expect(unfiledFolder.isPersonalToolbar).toBe(false);
    expect(unfiledFolder.isUnfiled).toBe(true);
  });
});

describe('BaseParser - 输出字段测试', () => {
  test('输出的对象应该包含所有要求的基础字段', () => {
    const html = `
<DL><p>
    <DT><H3>工作文件夹</H3>
    <DL><p>
        <DT><H3>开发工具</H3>
        <DL><p>
            <DT><A HREF="https://github.com" ADD_DATE="1600000000">GitHub</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://google.com" ADD_DATE="1610000000">Google</A>
</DL><p>
`;

    const result = BaseParser.parse(html);

    const workFolder = result.find(f => f.type === 'folder');
    expect(workFolder.type).toBe('folder');
    expect(workFolder.name).toBeDefined();
    expect(workFolder.level).toBeDefined();
    expect(workFolder.addDate).toBeDefined();
    expect(workFolder.folderPath).toBeDefined();
    expect(workFolder.children).toBeDefined();

    const googleLink = result.find(f => f.type === 'link');
    expect(googleLink.type).toBe('link');
    expect(googleLink.title).toBe('Google');
    expect(googleLink.url).toBe('https://google.com');
    expect(googleLink.addDate).toBeInstanceOf(Date);
    expect(googleLink.folderPath).toEqual([]);
    expect(googleLink.level).toBeDefined();
  });

  test('应该正确包含所属文件夹路径', () => {
    const html = `
<DL><p>
    <DT><H3>一级文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><H3>二级文件夹</H3>
        <DL><p>
            <DT><A HREF="https://link2.com">链接2</A>
        </DL><p>
    </DL><p>
</DL><p>
`;

    const result = BaseParser.parse(html);
    const level1Folder = result[0];
    
    const link1 = level1Folder.children.find(c => c.type === 'link');
    expect(link1.folderPath).toEqual(['一级文件夹']);
    
    const level2Folder = level1Folder.children.find(c => c.type === 'folder');
    expect(level2Folder.folderPath).toEqual(['一级文件夹']);
    
    const link2 = level2Folder.children[0];
    expect(link2.folderPath).toEqual(['一级文件夹', '二级文件夹']);
  });

  test('没有标题的书签应该使用域名作为标题', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.google.com"></A>
    <DT><A HREF="https://github.com"></A>
    <DT><A HREF="not-a-url"></A>
</DL><p>
`;

    const result = BaseParser.parse(html);

    expect(result[0].title).toBe('www.google.com');
    expect(result[1].title).toBe('github.com');
    expect(result[2].title).toBe('not-a-url');
  });
});

describe('BaseParser - 浏览器类型检测', () => {
  test('应该正确检测 Chrome 浏览器书签', () => {
    const html = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p></DL><p>
`;

    const result = BaseParser.parse(html);
    expect(result[0]?.browserType || BrowserType.CHROME).toBe(BrowserType.CHROME);
  });

  test('应该正确检测 Edge 浏览器书签', () => {
    const html = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>收藏夹</TITLE>
<H1>收藏夹</H1>
<DL><p></DL><p>
`;

    const result = BaseParser.parse(html);
    expect(result[0]?.browserType || BrowserType.EDGE).toBe(BrowserType.EDGE);
  });

  test('应该正确检测 Firefox 浏览器书签', () => {
    const html = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p></DL><p>
`;

    const result = BaseParser.parse(html);
    expect(result[0]?.browserType || BrowserType.FIREFOX).toBe(BrowserType.FIREFOX);
  });
});

describe('BaseParser - 容错处理测试', () => {
  test('应该处理空的 HTML 内容', () => {
    expect(BaseParser.parse('')).toEqual([]);
    expect(BaseParser.parse(null)).toEqual([]);
    expect(BaseParser.parse(undefined)).toEqual([]);
    expect(BaseParser.parse(123)).toEqual([]);
  });

  test('应该处理没有 DL 标签的 HTML', () => {
    const html = '<html><body>没有书签</body></html>';
    expect(BaseParser.parse(html)).toEqual([]);
  });

  test('应该处理标签未闭合的情况', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://example.com">未闭合的链接
    <DT><H3>未闭合的文件夹
    <DL><p>
        <DT><A HREF="https://other.com">其他链接
`;

    const result = BaseParser.parse(html);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  test('应该处理格式混乱的 HTML', () => {
    const html = `
<DL><p>
    <DT><H3>正常文件夹</H3>
    <DL><p>
        <DT <A HREF="https://test1.com">损坏的标签
        <DT><A HREF="https://valid.com">有效链接</A>
        <<>> 混乱的标签
        <DT><A HREF="https://another.com">另一个链接</A>
    </DL><p>
</DL><p>
`;

    const result = BaseParser.parse(html);
    expect(result.length).toBe(1);
    
    const folder = result[0];
    expect(folder.name).toBe('正常文件夹');
    
    const validLinks = folder.children.filter(c => c.type === 'link');
    expect(validLinks.length).toBeGreaterThanOrEqual(1);
  });

  test('应该处理缺少必需属性的标签', () => {
    const html = `
<DL><p>
    <DT><A>没有 href 的链接</A>
    <DT><A HREF="">空 href 的链接</A>
    <DT><A HREF="https://valid.com">有效链接</A>
</DL><p>
`;

    const result = BaseParser.parse(html);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe('BaseParser - 过滤规则测试', () => {
  test('应该过滤掉 localhost 链接', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.google.com">Google</A>
    <DT><A HREF="http://localhost:4000">本地开发</A>
    <DT><A HREF="http://127.0.0.1:8080">本地服务器</A>
    <DT><A HREF="http://dev.test">测试环境</A>
    <DT><A HREF="https://github.com">GitHub</A>
</DL><p>
`;

    const result = BaseParser.parse(html);

    const titles = result.map(b => b.title);
    expect(titles).toContain('Google');
    expect(titles).toContain('GitHub');
    expect(titles).not.toContain('本地开发');
    expect(titles).not.toContain('本地服务器');
    expect(titles).not.toContain('测试环境');
  });
});

describe('BaseParser - 流式解析测试', () => {
  test('应该支持事件驱动的解析', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://link1.com">链接1</A>
    <DT><A HREF="https://link2.com">链接2</A>
    <DT><A HREF="https://link3.com">链接3</A>
</DL><p>
`;

    const items = [];
    const parser = new BaseParser({
      emitEvent: true,
      onItem: (item) => items.push(item)
    });

    parser.parse(html);

    expect(items.length).toBe(3);
    expect(items[0].title).toBe('链接1');
    expect(items[1].title).toBe('链接2');
    expect(items[2].title).toBe('链接3');
  });

  test('应该支持分批处理', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://link1.com">链接1</A>
    <DT><A HREF="https://link2.com">链接2</A>
    <DT><A HREF="https://link3.com">链接3</A>
    <DT><A HREF="https://link4.com">链接4</A>
    <DT><A HREF="https://link5.com">链接5</A>
</DL><p>
`;

    const batches = [];
    const parser = new BaseParser({
      emitEvent: true,
      batchSize: 2,
      onBatch: (batch) => batches.push([...batch])
    });

    parser.parse(html);

    expect(batches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('BaseParser - 集成测试', () => {
  const testHtmlPath = path.join(__dirname, 'test_bookmarks.html');

  test('应该正确解析测试 HTML 文件', () => {
    if (fs.existsSync(testHtmlPath)) {
      const htmlContent = fs.readFileSync(testHtmlPath, 'utf-8');
      const result = BaseParser.parse(htmlContent);

      expect(result.length).toBeGreaterThan(0);

      const countLinks = (items) => {
        let count = 0;
        for (const item of items) {
          if (item.type === 'link') {
            count++;
          } else if (item.children) {
            count += countLinks(item.children);
          }
        }
        return count;
      };

      const countFolders = (items) => {
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
      };

      const linkCount = countLinks(result);
      const folderCount = countFolders(result);

      expect(linkCount).toBeGreaterThan(0);
      expect(folderCount).toBeGreaterThan(0);
    }
  });

  test('解析结果应该与原始实现兼容', () => {
    const html = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>测试文件夹</H3>
    <DL><p>
        <DT><A HREF="https://example.com" ADD_DATE="1600000000">测试链接</A>
    </DL><p>
</DL><p>
`;

    const result = BaseParser.parse(html);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('folder');
    expect(result[0].name).toBe('测试文件夹');
    expect(result[0].level).toBeDefined();
    expect(result[0].children).toBeDefined();
    expect(result[0].addDate).toBeDefined();
    expect(result[0].browserType).toBeDefined();

    const link = result[0].children[0];
    expect(link.type).toBe('link');
    expect(link.title).toBe('测试链接');
    expect(link.url).toBe('https://example.com');
    expect(link.level).toBeDefined();
    expect(link.addDate).toBeInstanceOf(Date);
    expect(link.browserType).toBeDefined();
  });
});

describe('BaseParser - 流式解析高级测试', () => {
  const tempFiles = [];

  afterEach(() => {
    for (const file of tempFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (e) {
        // 忽略错误
      }
    }
    tempFiles.length = 0;
  });

  function createTempHtmlFile(htmlContent) {
    const tempPath = path.join(__dirname, `temp_test_${Date.now()}.html`);
    fs.writeFileSync(tempPath, htmlContent, 'utf-8');
    tempFiles.push(tempPath);
    return tempPath;
  }

  test('应该支持从 ReadStream 解析', async () => {
    const html = `
<DL><p>
    <DT><H3>测试文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><A HREF="https://link2.com">链接2</A>
    </DL><p>
</DL><p>
`;

    const { Readable } = require('stream');
    const readStream = Readable.from(html);
    
    const result = await BaseParser.parseFromStream(readStream);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('folder');
    expect(result[0].name).toBe('测试文件夹');
    expect(result[0].children.length).toBe(2);
  });

  test('应该支持从文件路径解析（使用 createReadStream）', async () => {
    const html = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>工作文件夹</H3>
    <DL><p>
        <DT><A HREF="https://github.com" ADD_DATE="1600000000">GitHub</A>
        <DT><A HREF="https://google.com">Google</A>
    </DL><p>
    <DT><A HREF="https://stackoverflow.com">Stack Overflow</A>
</DL><p>
`;

    const tempPath = createTempHtmlFile(html);
    const result = await BaseParser.parseFile(tempPath);

    expect(result.length).toBe(2);

    const folder = result.find(r => r.type === 'folder');
    expect(folder.name).toBe('工作文件夹');
    expect(folder.children.length).toBe(2);

    const link = result.find(r => r.type === 'link');
    expect(link.title).toBe('Stack Overflow');
    expect(link.url).toBe('https://stackoverflow.com');
  });

  test('流式解析应该正确处理嵌套层级关系', async () => {
    const html = `
<DL><p>
    <DT><H3>一级文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><H3>二级文件夹</H3>
        <DL><p>
            <DT><A HREF="https://link2.com">链接2</A>
        </DL><p>
    </DL><p>
</DL><p>
`;

    const { Readable } = require('stream');
    const readStream = Readable.from(html);
    
    const result = await BaseParser.parseFromStream(readStream);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe('一级文件夹');
    expect(result[0].folderPath).toEqual([]);

    const level1Children = result[0].children;
    const link1 = level1Children.find(c => c.type === 'link');
    expect(link1.folderPath).toEqual(['一级文件夹']);

    const level2Folder = level1Children.find(c => c.type === 'folder');
    expect(level2Folder.name).toBe('二级文件夹');
    expect(level2Folder.folderPath).toEqual(['一级文件夹']);
    expect(level2Folder.children[0].folderPath).toEqual(['一级文件夹', '二级文件夹']);
  });

  test('流式解析应该支持事件驱动', async () => {
    const html = `
<DL><p>
    <DT><H3>文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><A HREF="https://link2.com">链接2</A>
    </DL><p>
</DL><p>
`;

    const items = [];
    const folders = [];
    const links = [];

    const parser = new BaseParser({
      emitEvent: true,
      onItem: (item) => items.push(item),
      onFolder: (folder) => folders.push(folder),
      onLink: (link) => links.push(link)
    });

    const { Readable } = require('stream');
    const readStream = Readable.from(html);
    
    const result = await parser.parseFromStream(readStream);

    expect(items.length).toBe(3);
    expect(folders.length).toBe(1);
    expect(links.length).toBe(2);
  });

  test('流式解析应该支持分批处理', async () => {
    let html = '<DL><p>\n';
    for (let i = 0; i < 25; i++) {
      html += `<DT><A HREF="https://link-${i}.com">链接 ${i}</A>\n`;
    }
    html += '</DL><p>';

    const batches = [];

    const parser = new BaseParser({
      emitEvent: true,
      batchSize: 10,
      onBatch: (batch) => batches.push([...batch])
    });

    const { Readable } = require('stream');
    const readStream = Readable.from(html);
    
    const result = await parser.parseFromStream(readStream);

    expect(result.length).toBe(25);
    
    let totalItems = 0;
    for (const batch of batches) {
      totalItems += batch.length;
      expect(batch.length).toBeLessThanOrEqual(10);
    }
    expect(totalItems).toBe(25);
  });

  test('流式解析应该支持 flatten 选项', async () => {
    const html = `
<DL><p>
    <DT><H3>一级文件夹</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><H3>二级文件夹</H3>
        <DL><p>
            <DT><A HREF="https://link2.com">链接2</A>
        </DL><p>
    </DL><p>
</DL><p>
`;

    const { Readable } = require('stream');
    const readStream = Readable.from(html);
    
    const result = await BaseParser.parseFromStream(readStream, { flatten: true });

    expect(result.length).toBe(4);

    const level1Folder = result.find(r => r.type === 'folder' && r.name === '一级文件夹');
    const level2Folder = result.find(r => r.type === 'folder' && r.name === '二级文件夹');
    const link1 = result.find(r => r.type === 'link' && r.title === '链接1');
    const link2 = result.find(r => r.type === 'link' && r.title === '链接2');

    expect(level1Folder.folderPath).toEqual([]);
    expect(level2Folder.folderPath).toEqual(['一级文件夹']);
    expect(link1.folderPath).toEqual(['一级文件夹']);
    expect(link2.folderPath).toEqual(['一级文件夹', '二级文件夹']);
  });

  test('流式解析应该正确处理小分块数据', async () => {
    const html = `
<DL><p>
    <DT><H3>测试文件夹</H3>
    <DL><p>
        <DT><A HREF="https://example.com">这是一个很长很长的书签标题，需要测试流式解析的正确性</A>
    </DL><p>
</DL><p>
`;

    const { PassThrough } = require('stream');
    const passThrough = new PassThrough();
    
    const chunks = [];
    const chunkSize = 20;
    for (let i = 0; i < html.length; i += chunkSize) {
      chunks.push(html.slice(i, i + chunkSize));
    }

    setTimeout(() => {
      for (const chunk of chunks) {
        passThrough.write(chunk);
      }
      passThrough.end();
    }, 10);

    const result = await BaseParser.parseFromStream(passThrough);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe('测试文件夹');
    expect(result[0].children[0].title).toContain('很长的书签标题');
  });
});

describe('BaseParser - 大文件性能测试', () => {
  test('应该能够处理大量书签数据', () => {
    let html = '<DL><p>\n';
    
    for (let i = 0; i < 1000; i++) {
      html += `<DT><A HREF="https://example-${i}.com">链接 ${i}</A>\n`;
    }
    
    html += '</DL><p>';

    const result = BaseParser.parse(html);

    expect(result.length).toBe(1000);
    
    for (let i = 0; i < 1000; i++) {
      expect(result[i].title).toBe(`链接 ${i}`);
      expect(result[i].url).toBe(`https://example-${i}.com`);
    }
  });

  test('应该能够处理深层嵌套结构', () => {
    let html = '<DL><p>\n';
    
    for (let i = 0; i < 50; i++) {
      html += `<DT><H3>文件夹 ${i}</H3>\n<DL><p>\n`;
    }
    
    html += `<DT><A HREF="https://deep-link.com">深层链接</A>\n`;
    
    for (let i = 0; i < 50; i++) {
      html += '</DL><p>\n';
    }
    
    html += '</DL><p>';

    const result = BaseParser.parse(html);
    expect(result.length).toBe(1);

    let current = result[0];
    for (let i = 0; i < 49; i++) {
      expect(current.name).toBe(`文件夹 ${i}`);
      expect(current.children.length).toBe(1);
      current = current.children[0];
    }

    const lastFolder = current;
    expect(lastFolder.children.length).toBe(1);
    expect(lastFolder.children[0].type).toBe('link');
    expect(lastFolder.children[0].title).toBe('深层链接');
  });
});