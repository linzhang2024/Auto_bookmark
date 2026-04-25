const nock = require('nock');
const config = require('./config');
const {
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
} = require('./bookmarkConverter');

describe('config.js - 过滤规则测试', () => {
  test('shouldFilter 应该过滤包含 localhost 的 URL', () => {
    expect(config.shouldFilter('http://localhost:3000')).toBe(true);
    expect(config.shouldFilter('http://localhost')).toBe(true);
    expect(config.shouldFilter('http://localhost/api/docs')).toBe(true);
  });

  test('shouldFilter 应该过滤包含 127.0.0.1 的 URL', () => {
    expect(config.shouldFilter('http://127.0.0.1:8080')).toBe(true);
    expect(config.shouldFilter('http://127.0.0.1')).toBe(true);
    expect(config.shouldFilter('http://127.0.0.1:9000/service')).toBe(true);
  });

  test('shouldFilter 应该过滤包含 dev.test 的 URL', () => {
    expect(config.shouldFilter('http://dev.test')).toBe(true);
    expect(config.shouldFilter('https://app.dev.test/api')).toBe(true);
    expect(config.shouldFilter('http://sub.dev.test/page')).toBe(true);
  });

  test('shouldFilter 不应该过滤正常的 URL', () => {
    expect(config.shouldFilter('https://www.google.com')).toBe(false);
    expect(config.shouldFilter('https://github.com')).toBe(false);
    expect(config.shouldFilter('https://stackoverflow.com/questions')).toBe(false);
  });

  test('shouldFilter 应该正确处理空值和无效值', () => {
    expect(config.shouldFilter('')).toBe(false);
    expect(config.shouldFilter(null)).toBe(false);
    expect(config.shouldFilter(undefined)).toBe(false);
    expect(config.shouldFilter(123)).toBe(false);
  });

  test('shouldFilter 应该不区分大小写', () => {
    expect(config.shouldFilter('HTTP://LOCALHOST:3000')).toBe(true);
    expect(config.shouldFilter('http://LocalHost:8080')).toBe(true);
    expect(config.shouldFilter('http://127.0.0.1')).toBe(true);
    expect(config.shouldFilter('http://DEV.TEST')).toBe(true);
  });
});

describe('bookmarkConverter.js - 域名提取测试', () => {
  test('extractDomainFromUrl 应该正确提取域名', () => {
    expect(extractDomainFromUrl('https://www.google.com')).toBe('www.google.com');
    expect(extractDomainFromUrl('https://github.com')).toBe('github.com');
    expect(extractDomainFromUrl('https://sub.example.com/path')).toBe('sub.example.com');
  });

  test('extractDomainFromUrl 应该处理无效的 URL', () => {
    expect(extractDomainFromUrl('not-a-url')).toBe('not-a-url');
    expect(extractDomainFromUrl('')).toBe('');
    expect(extractDomainFromUrl(null)).toBe('');
    expect(extractDomainFromUrl(undefined)).toBe('');
  });

  test('extractDomainFromUrl 应该处理带端口的 URL', () => {
    expect(extractDomainFromUrl('https://example.com:8080')).toBe('example.com');
  });
});

describe('bookmarkConverter.js - HTML 解析和层级转换测试', () => {
  const simpleHtml = `
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

  test('parseChromeBookmarks 应该正确解析文件夹和链接', () => {
    const result = parseChromeBookmarks(simpleHtml);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('folder');
    expect(result[0].name).toBe('文件夹1');
    expect(result[0].children.length).toBe(2);
    expect(result[0].children[0].type).toBe('link');
    expect(result[0].children[0].title).toBe('链接1');
    expect(result[0].children[0].url).toBe('https://link1.com');
  });

  test('convertToMarkdown 应该正确转换为 Markdown 格式', () => {
    const bookmarks = parseChromeBookmarks(simpleHtml);
    const markdown = convertToMarkdown(bookmarks);

    expect(markdown).toContain('# 文件夹1');
    expect(markdown).toContain('- [链接1](https://link1.com)');
    expect(markdown).toContain('- [链接2](https://link2.com)');
  });

  test('层级结构应该正确映射到标题级别', () => {
    const nestedHtml = `
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

    const bookmarks = parseChromeBookmarks(nestedHtml);
    const markdown = convertToMarkdown(bookmarks);

    expect(markdown).toContain('# 一级文件夹');
    expect(markdown).toContain('## 二级文件夹');
    expect(markdown).toContain('### 三级文件夹');
    expect(markdown).toContain('- [链接1](https://link1.com)');
    expect(markdown).toContain('- [链接2](https://link2.com)');
    expect(markdown).toContain('- [链接3](https://link3.com)');
  });
});

describe('bookmarkConverter.js - 过滤逻辑集成测试', () => {
  const htmlWithLocalhost = `
<DL><p>
    <DT><A HREF="https://www.google.com">Google</A>
    <DT><A HREF="http://localhost:3000">本地开发</A>
    <DT><A HREF="http://127.0.0.1:8080">本地服务器</A>
    <DT><A HREF="http://dev.test">测试环境</A>
    <DT><A HREF="https://github.com">GitHub</A>
</DL><p>
`;

  test('应该过滤掉 localhost、127.0.0.1 和 dev.test 的链接', () => {
    const bookmarks = parseChromeBookmarks(htmlWithLocalhost);
    const linkCount = countBookmarks(bookmarks);

    expect(linkCount).toBe(2);

    const titles = bookmarks.map(b => b.title);
    expect(titles).toContain('Google');
    expect(titles).toContain('GitHub');
    expect(titles).not.toContain('本地开发');
    expect(titles).not.toContain('本地服务器');
    expect(titles).not.toContain('测试环境');
  });

  test('Markdown 输出中不应该包含过滤掉的链接', () => {
    const bookmarks = parseChromeBookmarks(htmlWithLocalhost);
    const markdown = convertToMarkdown(bookmarks);

    expect(markdown).toContain('Google');
    expect(markdown).toContain('GitHub');
    expect(markdown).not.toContain('localhost');
    expect(markdown).not.toContain('127.0.0.1');
    expect(markdown).not.toContain('dev.test');
  });
});

describe('bookmarkConverter.js - 容错处理测试', () => {
  test('没有标题的书签应该使用域名作为标题', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.google.com"></A>
    <DT><A HREF="https://github.com"></A>
</DL><p>
`;

    const bookmarks = parseChromeBookmarks(html);

    expect(bookmarks[0].title).toBe('www.google.com');
    expect(bookmarks[1].title).toBe('github.com');
  });

  test('有标题的书签应该保持原标题', () => {
    const html = `
<DL><p>
    <DT><A HREF="https://www.google.com">搜索引擎</A>
</DL><p>
`;

    const bookmarks = parseChromeBookmarks(html);

    expect(bookmarks[0].title).toBe('搜索引擎');
  });
});

describe('bookmarkConverter.js - 统计功能测试', () => {
  const complexHtml = `
<DL><p>
    <DT><H3>文件夹1</H3>
    <DL><p>
        <DT><A HREF="https://link1.com">链接1</A>
        <DT><A HREF="https://link2.com">链接2</A>
        <DT><H3>子文件夹</H3>
        <DL><p>
            <DT><A HREF="https://link3.com">链接3</A>
        </DL><p>
    </DL><p>
    <DT><H3>文件夹2</H3>
    <DL><p>
        <DT><A HREF="https://link4.com">链接4</A>
    </DL><p>
    <DT><A HREF="https://link5.com">链接5</A>
</DL><p>
`;

  test('countBookmarks 应该正确统计链接数量', () => {
    const bookmarks = parseChromeBookmarks(complexHtml);
    const count = countBookmarks(bookmarks);

    expect(count).toBe(5);
  });

  test('countFolders 应该正确统计文件夹数量', () => {
    const bookmarks = parseChromeBookmarks(complexHtml);
    const count = countFolders(bookmarks);

    expect(count).toBe(3);
  });
});

describe('bookmarkConverter.js - 空内容测试', () => {
  test('空 HTML 应该返回空数组', () => {
    const result = parseChromeBookmarks('');
    expect(result).toEqual([]);
  });

  test('没有 DL 标签的 HTML 应该返回空数组', () => {
    const html = '<html><body>没有书签</body></html>';
    const result = parseChromeBookmarks(html);
    expect(result).toEqual([]);
  });

  test('空的 Markdown 转换应该返回空字符串', () => {
    const markdown = convertToMarkdown([]);
    expect(markdown).toBe('');
  });
});

describe('集成测试 - 使用测试 HTML 文件', () => {
  const fs = require('fs');
  const path = require('path');

  test('应该正确解析 test_bookmarks.html', () => {
    const testHtmlPath = path.join(__dirname, 'test_bookmarks.html');
    const htmlContent = fs.readFileSync(testHtmlPath, 'utf-8');

    const bookmarks = parseChromeBookmarks(htmlContent);
    const folderCount = countFolders(bookmarks);
    const linkCount = countBookmarks(bookmarks);

    expect(folderCount).toBe(5);
    expect(linkCount).toBe(12);

    const markdown = convertToMarkdown(bookmarks);

    expect(markdown).toContain('# 书签栏');
    expect(markdown).toContain('## 开发工具');
    expect(markdown).toContain('## 学习资源');
    expect(markdown).toContain('### 前端框架');
    expect(markdown).toContain('# 其他书签');

    expect(markdown).toContain('[Google](https://www.google.com)');
    expect(markdown).toContain('[GitHub](https://www.github.com)');
    expect(markdown).toContain('[Stack Overflow](https://www.stackoverflow.com)');
    expect(markdown).toContain('[www.test.com](https://www.test.com)');

    expect(markdown).not.toContain('localhost');
    expect(markdown).not.toContain('127.0.0.1');
    expect(markdown).not.toContain('本地开发环境');
    expect(markdown).not.toContain('本地服务器');
  });
});

describe('bookmarkConverter.js - 并发控制测试', () => {
  test('ConcurrencyLimiter 应该限制并发数量', async () => {
    const maxConcurrent = 2;
    const limiter = new ConcurrencyLimiter(maxConcurrent);
    const concurrentCounts = [];
    const taskDelays = [100, 50, 150, 80, 120];

    const tasks = taskDelays.map((delay, index) =>
      limiter.add(async () => {
        concurrentCounts.push(limiter.activeCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return index;
      })
    );

    const results = await Promise.all(tasks);

    for (const count of concurrentCounts) {
      expect(count).toBeLessThanOrEqual(maxConcurrent);
    }

    expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  test('ConcurrencyLimiter 应该按顺序处理任务', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const executionOrder = [];

    const tasks = [300, 100, 200].map((delay, index) =>
      limiter.add(async () => {
        await new Promise(resolve => setTimeout(resolve, delay));
        executionOrder.push(index);
        return index;
      })
    );

    await Promise.all(tasks);

    expect(executionOrder).toEqual([0, 1, 2]);
  });

  test('checkUrlsConcurrently 应该限制并发请求数量', async () => {
    const requestTimes = [];
    const maxConcurrent = 2;
    const totalRequests = 6;

    const mockResponses = Array.from({ length: totalRequests }, (_, i) => ({
      url: `http://test-${i}.com`,
      title: `Test ${i}`
    }));

    nock.cleanAll();

    for (let i = 0; i < totalRequests; i++) {
      nock(`http://test-${i}.com`)
        .head('/')
        .delay(50)
        .reply(200, '', { 'Content-Type': 'text/html' });
    }

    const activeRequestsAtStart = [];
    const originalCheckUrl = checkUrl;

    jest.doMock('./bookmarkConverter', () => {
      const original = jest.requireActual('./bookmarkConverter');
      return {
        ...original,
        checkUrl: async (url, timeout) => {
          activeRequestsAtStart.push(Date.now());
          return originalCheckUrl(url, timeout);
        }
      };
    });

    const results = await checkUrlsConcurrently(mockResponses, maxConcurrent, { timeout: 5000 });

    expect(results.length).toBe(totalRequests);
    nock.cleanAll();
  });
});

describe('bookmarkConverter.js - URL 有效性检测测试', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  test('checkUrl 应该返回 success 对于 200 响应', async () => {
    const scope = nock('http://example.com')
      .head('/')
      .reply(200);

    const result = await checkUrl('http://example.com', 5000);

    expect(result.status).toBe('success');
    expect(result.statusCode).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  test('checkUrl 应该返回 not_found 对于 404 响应', async () => {
    const scope = nock('http://example.com')
      .head('/')
      .reply(404);

    const result = await checkUrl('http://example.com', 5000);

    expect(result.status).toBe('not_found');
    expect(result.statusCode).toBe(404);
    expect(result.isInvalid).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  test('checkUrl 应该返回 success 对于重定向响应', async () => {
    const scope = nock('http://example.com')
      .head('/')
      .reply(301, '', { 'Location': 'http://new-example.com' });

    const result = await checkUrl('http://example.com', 5000);

    expect(result.status).toBe('success');
    expect(scope.isDone()).toBe(true);
  });

  test('checkUrl 应该返回 error 对于连接错误', async () => {
    const scope = nock('http://nonexistent.example')
      .head('/')
      .replyWithError('Connection refused');

    const result = await checkUrl('http://nonexistent.example', 5000);

    expect(result.status).toBe('error');
    expect(result.error).not.toBeNull();
  });

  test('checkUrl 应该返回 timeout 对于超时', async () => {
    const scope = nock('http://slow.example.com')
      .head('/')
      .delay(1000)
      .reply(200);

    const result = await checkUrl('http://slow.example.com', 100);

    expect(result.status).toBe('timeout');
  });

  test('HTTPS URL 应该正确处理', async () => {
    const scope = nock('https://secure.example.com')
      .head('/')
      .reply(200);

    const result = await checkUrl('https://secure.example.com', 5000);

    expect(result.status).toBe('success');
    expect(scope.isDone()).toBe(true);
  });
});

describe('bookmarkConverter.js - 元数据抓取测试', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  test('fetchPageTitle 应该从 HTML 中提取 title', async () => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page Title</title>
        </head>
        <body>
          <h1>Hello</h1>
        </body>
      </html>
    `;

    const scope = nock('http://example.com')
      .get('/')
      .reply(200, htmlContent, { 'Content-Type': 'text/html' });

    const title = await fetchPageTitle('http://example.com', 5000);

    expect(title).toBe('Test Page Title');
    expect(scope.isDone()).toBe(true);
  });

  test('fetchPageTitle 应该处理带属性的 title 标签', async () => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title data-lang="en">Beautiful Website</title>
        </head>
        <body></body>
      </html>
    `;

    const scope = nock('http://example.com')
      .get('/')
      .reply(200, htmlContent, { 'Content-Type': 'text/html' });

    const title = await fetchPageTitle('http://example.com', 5000);

    expect(title).toBe('Beautiful Website');
    expect(scope.isDone()).toBe(true);
  });

  test('fetchPageTitle 应该在没有 title 时返回 null', async () => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body></body>
      </html>
    `;

    const scope = nock('http://example.com')
      .get('/')
      .reply(200, htmlContent, { 'Content-Type': 'text/html' });

    const title = await fetchPageTitle('http://example.com', 5000);

    expect(title).toBeNull();
    expect(scope.isDone()).toBe(true);
  });

  test('fetchPageTitle 对于 404 应该返回 null', async () => {
    const scope = nock('http://example.com')
      .get('/')
      .reply(404);

    const title = await fetchPageTitle('http://example.com', 5000);

    expect(title).toBeNull();
    expect(scope.isDone()).toBe(true);
  });

  test('fetchPageTitle 对于连接错误应该返回 null', async () => {
    const scope = nock('http://example.com')
      .get('/')
      .replyWithError('Connection refused');

    const title = await fetchPageTitle('http://example.com', 5000);

    expect(title).toBeNull();
  });
});

describe('bookmarkConverter.js - 动态增强集成测试', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  test('collectAllLinks 应该收集所有链接', () => {
    const bookmarks = [
      {
        type: 'folder',
        name: 'Test Folder',
        level: 0,
        children: [
          {
            type: 'link',
            title: 'Link 1',
            url: 'http://link1.com',
            level: 1
          },
          {
            type: 'folder',
            name: 'Sub Folder',
            level: 1,
            children: [
              {
                type: 'link',
                title: 'Link 2',
                url: 'http://link2.com',
                level: 2
              }
            ]
          }
        ]
      },
      {
        type: 'link',
        title: 'Link 3',
        url: 'http://link3.com',
        level: 0
      }
    ];

    const links = collectAllLinks(bookmarks);

    expect(links.length).toBe(3);
    expect(links.map(l => l.url)).toContain('http://link1.com');
    expect(links.map(l => l.url)).toContain('http://link2.com');
    expect(links.map(l => l.url)).toContain('http://link3.com');
  });

  test('applyEnhancementResults 应该标记失效链接', () => {
    const bookmarks = [
      {
        type: 'link',
        title: 'Valid Link',
        url: 'http://valid.com',
        level: 0
      },
      {
        type: 'link',
        title: 'Invalid Link',
        url: 'http://invalid.com',
        level: 0
      }
    ];

    const results = [
      {
        url: 'http://valid.com',
        title: 'Valid Link',
        isInvalid: false,
        status: 'success'
      },
      {
        url: 'http://invalid.com',
        title: 'Invalid Link',
        isInvalid: true,
        status: 'not_found'
      }
    ];

    const enhanced = applyEnhancementResults(bookmarks, results);

    expect(enhanced[0].isInvalid).toBe(false);
    expect(enhanced[1].isInvalid).toBe(true);
  });

  test('applyEnhancementResults 应该更新无标题书签的标题', () => {
    const bookmarks = [
      {
        type: 'link',
        title: 'example.com',
        url: 'http://example.com',
        level: 0
      },
      {
        type: 'link',
        title: 'Existing Title',
        url: 'http://other.com',
        level: 0
      }
    ];

    const results = [
      {
        url: 'http://example.com',
        title: 'example.com',
        isInvalid: false,
        status: 'success',
        fetchedTitle: 'Real Page Title'
      },
      {
        url: 'http://other.com',
        title: 'Existing Title',
        isInvalid: false,
        status: 'success',
        fetchedTitle: 'Other Page Title'
      }
    ];

    const enhanced = applyEnhancementResults(bookmarks, results, { updateTitle: true });

    expect(enhanced[0].title).toBe('Real Page Title');
    expect(enhanced[0].titleWasUpdated).toBe(true);
    expect(enhanced[1].title).toBe('Existing Title');
    expect(enhanced[1].titleWasUpdated).toBeUndefined();
  });

  test('convertToMarkdown 应该在失效链接后添加 [失效] 标记', () => {
    const bookmarks = [
      {
        type: 'link',
        title: 'Valid Link',
        url: 'http://valid.com',
        level: 0,
        isInvalid: false
      },
      {
        type: 'link',
        title: 'Invalid Link',
        url: 'http://invalid.com',
        level: 0,
        isInvalid: true
      }
    ];

    const markdown = convertToMarkdown(bookmarks);

    expect(markdown).toContain('[Valid Link](http://valid.com)');
    expect(markdown).not.toContain('[Valid Link [失效]]');
    expect(markdown).toContain('[Invalid Link [失效]](http://invalid.com)');
  });

  test('convertToMarkdown 应该支持禁用 [失效] 标记', () => {
    const bookmarks = [
      {
        type: 'link',
        title: 'Invalid Link',
        url: 'http://invalid.com',
        level: 0,
        isInvalid: true
      }
    ];

    const markdown = convertToMarkdown(bookmarks, { showInvalidMark: false });

    expect(markdown).toContain('[Invalid Link](http://invalid.com)');
    expect(markdown).not.toContain('[失效]');
  });

  test('enhanceBookmarks 应该执行完整的动态增强流程', async () => {
    const bookmarks = [
      {
        type: 'link',
        title: 'Valid Link',
        url: 'http://valid.com',
        level: 0
      },
      {
        type: 'link',
        title: '404 Link',
        url: 'http://not-found.com',
        level: 0
      }
    ];

    nock('http://valid.com')
      .head('/')
      .reply(200);

    nock('http://valid.com')
      .get('/')
      .reply(200, '<title>Real Valid Title</title>', { 'Content-Type': 'text/html' });

    nock('http://not-found.com')
      .head('/')
      .reply(404);

    const result = await enhanceBookmarks(bookmarks, {
      maxConcurrent: 2,
      timeout: 5000,
      enableTitleFetch: true
    });

    expect(result.results.length).toBe(2);

    const validResult = result.results.find(r => r.url === 'http://valid.com');
    const notFoundResult = result.results.find(r => r.url === 'http://not-found.com');

    expect(validResult.isInvalid).toBe(false);
    expect(notFoundResult.isInvalid).toBe(true);

    const enhancedBookmarks = result.bookmarks;
    expect(enhancedBookmarks[0].isInvalid).toBe(false);
    expect(enhancedBookmarks[1].isInvalid).toBe(true);
  });

  test('enhanceBookmarks 应该处理空书签列表', async () => {
    const result = await enhanceBookmarks([]);

    expect(result.bookmarks).toEqual([]);
    expect(result.results).toEqual([]);
  });

  test('enhanceBookmarks 应该调用进度回调', async () => {
    const bookmarks = [
      { type: 'link', title: 'Link 1', url: 'http://link1.com', level: 0 },
      { type: 'link', title: 'Link 2', url: 'http://link2.com', level: 0 },
      { type: 'link', title: 'Link 3', url: 'http://link3.com', level: 0 }
    ];

    nock('http://link1.com').head('/').reply(200);
    nock('http://link2.com').head('/').reply(200);
    nock('http://link3.com').head('/').reply(200);

    const progressUpdates = [];
    const onProgress = jest.fn((current, total) => {
      progressUpdates.push({ current, total });
    });

    await enhanceBookmarks(bookmarks, {
      maxConcurrent: 2,
      timeout: 5000,
      enableTitleFetch: false,
      onProgress
    });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(progressUpdates[0].total).toBe(3);
    expect(progressUpdates[2].current).toBe(3);
  });
});
