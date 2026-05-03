const { BookmarkDeduplicator, DEFAULT_OPTIONS } = require('../src/services/BookmarkDeduplicator');

describe('BookmarkDeduplicator - URL 规范化测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator();
  });

  test('应该忽略 URL 参数', () => {
    const url1 = 'https://example.com/page?param1=value1&param2=value2';
    const url2 = 'https://example.com/page?param3=value3';

    const normalized1 = deduplicator.normalizeUrl(url1);
    const normalized2 = deduplicator.normalizeUrl(url2);

    expect(normalized1).toBe(normalized2);
    expect(normalized1).toBe('example.com/page');
  });

  test('应该忽略 URL 哈希', () => {
    const url1 = 'https://example.com/page#section1';
    const url2 = 'https://example.com/page#section2';

    const normalized1 = deduplicator.normalizeUrl(url1);
    const normalized2 = deduplicator.normalizeUrl(url2);

    expect(normalized1).toBe(normalized2);
    expect(normalized1).toBe('example.com/page');
  });

  test('应该忽略协议差异（http vs https）', () => {
    const url1 = 'http://example.com/page';
    const url2 = 'https://example.com/page';

    const normalized1 = deduplicator.normalizeUrl(url1);
    const normalized2 = deduplicator.normalizeUrl(url2);

    expect(normalized1).toBe(normalized2);
    expect(normalized1).toBe('example.com/page');
  });

  test('应该忽略 www 前缀', () => {
    const url1 = 'https://www.example.com/page';
    const url2 = 'https://example.com/page';

    const normalized1 = deduplicator.normalizeUrl(url1);
    const normalized2 = deduplicator.normalizeUrl(url2);

    expect(normalized1).toBe(normalized2);
    expect(normalized1).toBe('example.com/page');
  });

  test('应该忽略尾部斜杠', () => {
    const url1 = 'https://example.com/page/';
    const url2 = 'https://example.com/page';

    const normalized1 = deduplicator.normalizeUrl(url1);
    const normalized2 = deduplicator.normalizeUrl(url2);

    expect(normalized1).toBe(normalized2);
    expect(normalized1).toBe('example.com/page');
  });

  test('应该忽略大小写差异', () => {
    const url1 = 'https://EXAMPLE.COM/PAGE';
    const url2 = 'https://example.com/page';

    const normalized1 = deduplicator.normalizeUrl(url1);
    const normalized2 = deduplicator.normalizeUrl(url2);

    expect(normalized1).toBe(normalized2);
    expect(normalized1).toBe('example.com/page');
  });

  test('应该处理空的 URL', () => {
    expect(deduplicator.normalizeUrl('')).toBe('');
    expect(deduplicator.normalizeUrl(null)).toBe('');
    expect(deduplicator.normalizeUrl(undefined)).toBe('');
  });

  test('getUrlCorePath 应该返回核心路径', () => {
    const url = 'https://www.example.com/path/to/page?param=value#hash';
    const corePath = deduplicator.getUrlCorePath(url);
    expect(corePath).toBe('example.com/path/to/page');
  });
});

describe('BookmarkDeduplicator - Levenshtein 距离测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator();
  });

  test('应该计算空字符串的距离', () => {
    expect(deduplicator.levenshteinDistance('', '')).toBe(0);
    expect(deduplicator.levenshteinDistance('test', '')).toBe(4);
    expect(deduplicator.levenshteinDistance('', 'test')).toBe(4);
  });

  test('应该计算相同字符串的距离', () => {
    expect(deduplicator.levenshteinDistance('test', 'test')).toBe(0);
    expect(deduplicator.levenshteinDistance('Hello World', 'Hello World')).toBe(0);
  });

  test('应该计算单个字符差异的距离', () => {
    expect(deduplicator.levenshteinDistance('test', 'tes')).toBe(1);
    expect(deduplicator.levenshteinDistance('tes', 'test')).toBe(1);
    expect(deduplicator.levenshteinDistance('test', 'teXt')).toBe(1);
  });

  test('应该计算多个字符差异的距离', () => {
    expect(deduplicator.levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(deduplicator.levenshteinDistance('saturday', 'sunday')).toBe(3);
  });

  test('应该默认忽略大小写', () => {
    expect(deduplicator.levenshteinDistance('Test', 'test')).toBe(0);
    expect(deduplicator.levenshteinDistance('HELLO', 'hello')).toBe(0);
  });

  test('应该支持大小写敏感模式', () => {
    expect(deduplicator.levenshteinDistance('Test', 'test', true)).toBe(1);
    expect(deduplicator.levenshteinDistance('HELLO', 'hello', true)).toBe(5);
  });
});

describe('BookmarkDeduplicator - 标题相似度测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator();
  });

  test('相同标题应该返回 1.0 相似度', () => {
    const similarity = deduplicator.calculateTitleSimilarity('Google', 'Google');
    expect(similarity).toBe(1.0);
  });

  test('空标题应该返回 0 相似度', () => {
    expect(deduplicator.calculateTitleSimilarity('', 'Google')).toBe(0);
    expect(deduplicator.calculateTitleSimilarity('Google', '')).toBe(0);
    expect(deduplicator.calculateTitleSimilarity(null, 'Google')).toBe(0);
    expect(deduplicator.calculateTitleSimilarity(undefined, 'Google')).toBe(0);
  });

  test('相似标题应该返回高相似度', () => {
    const similarity = deduplicator.calculateTitleSimilarity('Stack Overflow', 'StackOverflow');
    expect(similarity).toBeGreaterThan(0.9);
    expect(similarity).toBeLessThan(1.0);
  });

  test('不同标题应该返回低相似度', () => {
    const similarity = deduplicator.calculateTitleSimilarity('Google', 'Facebook');
    expect(similarity).toBeLessThan(0.5);
  });

  test('大小写差异不影响相似度', () => {
    const similarity = deduplicator.calculateTitleSimilarity('GOOGLE', 'google');
    expect(similarity).toBe(1.0);
  });

  test('标题编辑距离测试用例集', () => {
    const testCases = [
      { title1: 'Google', title2: 'Google', expected: 1.0, desc: '完全相同' },
      { title1: 'Google', title2: 'google', expected: 1.0, desc: '大小写差异' },
      { title1: 'Stack Overflow', title2: 'StackOverflow', expected: 0.929, desc: '缺少空格' },
      { title1: 'GitHub', title2: 'GitLab', expected: 0.667, desc: '相似但不同' },
    ];

    for (const tc of testCases) {
      const similarity = deduplicator.calculateTitleSimilarity(tc.title1, tc.title2);
      expect(similarity).toBeCloseTo(tc.expected, 2);
    }
  });
});

describe('BookmarkDeduplicator - URL 相似度测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator();
  });

  test('相同 URL 核心路径应该返回 1.0 相似度', () => {
    const url1 = 'https://example.com/page?param=1';
    const url2 = 'https://example.com/page?param=2';

    const similarity = deduplicator.calculateUrlSimilarity(url1, url2);
    expect(similarity).toBe(1.0);
  });

  test('不同域名应该返回低相似度', () => {
    const url1 = 'https://google.com/page';
    const url2 = 'https://example.com/other';

    const similarity = deduplicator.calculateUrlSimilarity(url1, url2);
    expect(similarity).toBeLessThan(0.6);
  });

  test('相同域名不同路径应该返回中等相似度', () => {
    const url1 = 'https://example.com/page1';
    const url2 = 'https://example.com/page2';

    const similarity = deduplicator.calculateUrlSimilarity(url1, url2);
    expect(similarity).toBeGreaterThan(0.5);
    expect(similarity).toBeLessThan(1.0);
  });
});

describe('BookmarkDeduplicator - 重复项检测测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator({
      urlSimilarityThreshold: 1.0,
      titleSimilarityThreshold: 0.9
    });
  });

  test('应该检测到完全相同的书签为重复', () => {
    const bookmark1 = {
      type: 'link',
      title: 'Google',
      url: 'https://www.google.com'
    };

    const bookmark2 = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com'
    };

    const isDuplicate = deduplicator.isDuplicate(bookmark1, bookmark2);
    expect(isDuplicate).toBe(true);

    const score = deduplicator.getSimilarityScore(bookmark1, bookmark2);
    expect(score.isDuplicate).toBe(true);
    expect(score.urlSimilarity).toBe(1.0);
    expect(score.titleSimilarity).toBe(1.0);
  });

  test('应该检测到 URL 相同、标题相似的书签为重复', () => {
    const bookmark1 = {
      type: 'link',
      title: 'Google Search',
      url: 'https://www.google.com/search?q=test'
    };

    const bookmark2 = {
      type: 'link',
      title: 'Google search',
      url: 'https://google.com/search?q=other'
    };

    const isDuplicate = deduplicator.isDuplicate(bookmark1, bookmark2);
    expect(isDuplicate).toBe(true);
  });

  test('不应该检测到 URL 不同的书签为重复', () => {
    const bookmark1 = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com'
    };

    const bookmark2 = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com/different'
    };

    const isDuplicate = deduplicator.isDuplicate(bookmark1, bookmark2);
    expect(isDuplicate).toBe(false);
  });

  test('不应该检测到标题相似度低于阈值的书签为重复', () => {
    const bookmark1 = {
      type: 'link',
      title: 'Google',
      url: 'https://example.com'
    };

    const bookmark2 = {
      type: 'link',
      title: 'Facebook',
      url: 'https://example.com'
    };

    const isDuplicate = deduplicator.isDuplicate(bookmark1, bookmark2);
    expect(isDuplicate).toBe(false);
  });

  test('不同相似度测试用例集', () => {
    const testCases = [
      {
        bookmark1: { title: 'Google', url: 'https://google.com' },
        bookmark2: { title: 'Google', url: 'https://www.google.com' },
        expected: true,
        desc: '完全重复（URL 规范化后相同）'
      },
      {
        bookmark1: { title: 'Google Search', url: 'https://google.com/search' },
        bookmark2: { title: 'Google search', url: 'https://google.com/search?q=test' },
        expected: true,
        desc: '高度相似（URL 相同，标题大小写差异）'
      },
      {
        bookmark1: { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
        bookmark2: { title: 'StackOverflow', url: 'https://stackoverflow.com' },
        expected: true,
        desc: '标题缺少空格（相似度超过 90%）'
      },
      {
        bookmark1: { title: 'Google Search', url: 'https://google.com/search' },
        bookmark2: { title: 'Google search', url: 'https://google.com/search' },
        expected: true,
        desc: '标题大小写差异（相似度 100%）'
      },
      {
        bookmark1: { title: 'Google', url: 'https://google.com' },
        bookmark2: { title: 'Facebook', url: 'https://google.com' },
        expected: false,
        desc: '标题完全不同（相似度低于 90%）'
      },
      {
        bookmark1: { title: 'Google', url: 'https://google.com' },
        bookmark2: { title: 'Google', url: 'https://google.com/search' },
        expected: false,
        desc: 'URL 核心路径不同'
      },
      {
        bookmark1: { title: 'Example', url: 'https://example.com/page?a=1' },
        bookmark2: { title: 'Example', url: 'https://example.com/page?b=2' },
        expected: true,
        desc: 'URL 参数不同但核心路径相同'
      },
      {
        bookmark1: { title: 'Example Page', url: 'https://example.com/page#section1' },
        bookmark2: { title: 'Example Page', url: 'https://example.com/page#section2' },
        expected: true,
        desc: 'URL 哈希不同但核心路径相同'
      },
    ];

    for (const tc of testCases) {
      const isDuplicate = deduplicator.isDuplicate(tc.bookmark1, tc.bookmark2);
      const score = deduplicator.getSimilarityScore(tc.bookmark1, tc.bookmark2);
      
      console.log(`\n测试: ${tc.desc}`);
      console.log(`  Bookmark1: ${tc.bookmark1.title} - ${tc.bookmark1.url}`);
      console.log(`  Bookmark2: ${tc.bookmark2.title} - ${tc.bookmark2.url}`);
      console.log(`  URL 相似度: ${score.urlSimilarity.toFixed(4)}`);
      console.log(`  标题相似度: ${score.titleSimilarity.toFixed(4)}`);
      console.log(`  是否重复: ${isDuplicate} (预期: ${tc.expected})`);
      
      expect(isDuplicate).toBe(tc.expected);
    }
  });
});

describe('BookmarkDeduplicator - 批量去重测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator();
  });

  test('应该找到批量书签中的重复项', () => {
    const bookmarks = [
      { type: 'link', title: 'Google', url: 'https://google.com' },
      { type: 'link', title: 'Google', url: 'https://www.google.com' },
      { type: 'link', title: 'Stack Overflow', url: 'https://stackoverflow.com' },
      { type: 'link', title: 'StackOverflow', url: 'https://stackoverflow.com' },
      { type: 'link', title: 'Example', url: 'https://example.com' },
    ];

    const duplicates = deduplicator.findDuplicates(bookmarks);

    expect(duplicates.length).toBe(2);
  });

  test('应该按 URL 核心路径分组', () => {
    const bookmarks = [
      { type: 'link', title: 'Google', url: 'https://google.com?param=1' },
      { type: 'link', title: 'Google', url: 'https://google.com?param=2' },
      { type: 'link', title: 'GitHub', url: 'https://github.com' },
    ];

    const groups = deduplicator.groupByUrlCore(bookmarks);

    expect(groups.size).toBe(2);
    expect(groups.get('google.com').length).toBe(2);
    expect(groups.get('github.com').length).toBe(1);
  });

  test('不应该将文件夹计入重复项', () => {
    const bookmarks = [
      { type: 'folder', name: '文件夹1' },
      { type: 'link', title: 'Google', url: 'https://google.com' },
      { type: 'link', title: 'Google', url: 'https://www.google.com' },
    ];

    const duplicates = deduplicator.findDuplicates(bookmarks);

    expect(duplicates.length).toBe(1);
  });

  test('少于 2 个书签时应该返回空数组', () => {
    expect(deduplicator.findDuplicates([])).toEqual([]);
    expect(deduplicator.findDuplicates([{ type: 'link', title: 'Test', url: 'https://test.com' }])).toEqual([]);
  });
});

describe('BookmarkDeduplicator - 保留选择和合并测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator({
      keepNewer: true,
      keepMoreComplete: true
    });
  });

  test('应该选择更新的书签保留', () => {
    const older = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com',
      addDate: new Date('2020-01-01')
    };

    const newer = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com',
      addDate: new Date('2023-01-01')
    };

    const result = deduplicator.selectKeepBookmark(older, newer);

    expect(result.keep).toBe(newer);
    expect(result.remove).toBe(older);
  });

  test('应该选择更完整的书签保留', () => {
    const simple = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com'
    };

    const complete = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com',
      icon: 'icon-data',
      addDate: new Date('2023-01-01'),
      lastVisit: new Date('2023-06-01'),
      folderPath: ['书签栏']
    };

    const result = deduplicator.selectKeepBookmark(simple, complete);

    expect(result.keep).toBe(complete);
    expect(result.remove).toBe(simple);
  });

  test('应该合并元数据', () => {
    const bookmark1 = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com',
      icon: 'icon-from-bookmark1',
      meta: { source: 'chrome' }
    };

    const bookmark2 = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com',
      addDate: new Date('2023-01-01'),
      lastVisit: new Date('2023-06-01'),
      meta: { source: 'firefox', extra: 'data' }
    };

    const merged = deduplicator.mergeBookmarkMetadata(bookmark1, bookmark2);

    expect(merged.title).toBe('Google');
    expect(merged.url).toBe('https://google.com');
    expect(merged.icon).toBe('icon-from-bookmark1');
    expect(merged.addDate).toEqual(new Date('2023-01-01'));
    expect(merged.lastVisit).toEqual(new Date('2023-06-01'));
    expect(merged.meta.source).toBe('chrome');
    expect(merged.meta.extra).toBe('data');
    expect(merged.duplicatesMerged).toBe(1);
    expect(merged.originalTitles).toContain('Google');
  });

  test('应该计算完整性分数', () => {
    const simple = {
      type: 'link',
      title: '',
      url: 'https://google.com'
    };

    const complete = {
      type: 'link',
      title: 'Google',
      url: 'https://google.com',
      icon: 'icon-data',
      addDate: new Date('2023-01-01'),
      lastVisit: new Date('2023-06-01'),
      folderPath: ['书签栏']
    };

    const scoreSimple = deduplicator.calculateCompletenessScore(simple);
    const scoreComplete = deduplicator.calculateCompletenessScore(complete);

    expect(scoreSimple).toBe(0);
    expect(scoreComplete).toBeGreaterThan(scoreSimple);
  });
});

describe('BookmarkDeduplicator - 去重报告测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator();
  });

  test('应该生成完整的去重报告', () => {
    const bookmarks = [
      { type: 'folder', name: '工作' },
      { type: 'link', title: 'Google', url: 'https://google.com' },
      { type: 'link', title: 'Google', url: 'https://www.google.com' },
      { type: 'link', title: 'Stack Overflow', url: 'https://stackoverflow.com' },
      { type: 'link', title: 'StackOverflow', url: 'https://stackoverflow.com' },
      { type: 'link', title: 'Example', url: 'https://example.com' },
    ];

    const report = deduplicator.generateDeduplicationReport(bookmarks);

    expect(report.totalBookmarks).toBe(5);
    expect(report.duplicateGroups).toBe(2);
    expect(report.duplicatesFound).toBe(2);
    expect(report.toKeep.length).toBe(3);
    expect(report.toRemove.length).toBe(2);
    expect(report.statistics.beforeCount).toBe(5);
    expect(report.statistics.afterCount).toBe(3);
    expect(report.statistics.removedCount).toBe(2);
  });

  test('deduplicate 方法应该返回去重后的书签和报告', () => {
    const bookmarks = [
      { type: 'folder', name: '工作' },
      { type: 'link', title: 'Google', url: 'https://google.com' },
      { type: 'link', title: 'Google', url: 'https://www.google.com' },
      { type: 'link', title: 'Example', url: 'https://example.com' },
    ];

    const result = deduplicator.deduplicate(bookmarks);

    expect(result.deduplicated).toBeDefined();
    expect(result.report).toBeDefined();
    expect(result.deduplicated.length).toBeLessThan(bookmarks.length);
  });

  test('去重报告应该包含正确的分组信息', () => {
    const bookmarks = [
      { type: 'link', title: 'Google', url: 'https://google.com?a=1', addDate: new Date('2023-01-01') },
      { type: 'link', title: 'Google', url: 'https://google.com?b=2', addDate: new Date('2023-06-01') },
      { type: 'link', title: 'Example', url: 'https://example.com' },
    ];

    const report = deduplicator.generateDeduplicationReport(bookmarks);

    expect(report.groups.length).toBe(1);
    expect(report.groups[0].corePath).toBe('google.com');
    expect(report.groups[0].bookmarkCount).toBe(2);
    expect(report.groups[0].keep).toBeDefined();
    expect(report.groups[0].remove.length).toBe(1);
  });

  test('没有重复项时报告应该显示正确的统计', () => {
    const bookmarks = [
      { type: 'link', title: 'Google', url: 'https://google.com' },
      { type: 'link', title: 'GitHub', url: 'https://github.com' },
      { type: 'link', title: 'Stack Overflow', url: 'https://stackoverflow.com' },
    ];

    const report = deduplicator.generateDeduplicationReport(bookmarks);

    expect(report.totalBookmarks).toBe(3);
    expect(report.duplicateGroups).toBe(0);
    expect(report.duplicatesFound).toBe(0);
    expect(report.toKeep.length).toBe(3);
    expect(report.toRemove.length).toBe(0);
    expect(report.statistics.removedCount).toBe(0);
  });
});

describe('BookmarkDeduplicator - 配置选项测试', () => {
  test('应该支持自定义相似度阈值', () => {
    const strictDeduplicator = new BookmarkDeduplicator({
      urlSimilarityThreshold: 1.0,
      titleSimilarityThreshold: 1.0
    });

    const lenientDeduplicator = new BookmarkDeduplicator({
      urlSimilarityThreshold: 1.0,
      titleSimilarityThreshold: 0.85
    });

    const bookmark1 = {
      type: 'link',
      title: 'Stack Overflow',
      url: 'https://stackoverflow.com'
    };

    const bookmark2 = {
      type: 'link',
      title: 'StackOverflow',
      url: 'https://stackoverflow.com'
    };

    expect(strictDeduplicator.isDuplicate(bookmark1, bookmark2)).toBe(false);
    expect(lenientDeduplicator.isDuplicate(bookmark1, bookmark2)).toBe(true);
  });

  test('DEFAULT_OPTIONS 应该包含正确的默认值', () => {
    expect(DEFAULT_OPTIONS.urlSimilarityThreshold).toBe(1.0);
    expect(DEFAULT_OPTIONS.titleSimilarityThreshold).toBe(0.9);
    expect(DEFAULT_OPTIONS.ignoreUrlParams).toBe(true);
    expect(DEFAULT_OPTIONS.ignoreUrlProtocol).toBe(true);
    expect(DEFAULT_OPTIONS.ignoreUrlTrailingSlash).toBe(true);
    expect(DEFAULT_OPTIONS.caseSensitive).toBe(false);
    expect(DEFAULT_OPTIONS.keepNewer).toBe(true);
    expect(DEFAULT_OPTIONS.keepMoreComplete).toBe(true);
  });

  test('应该支持配置大小写敏感模式', () => {
    const caseSensitiveDeduplicator = new BookmarkDeduplicator({
      caseSensitive: true
    });

    const url1 = 'https://Example.com/Page';
    const url2 = 'https://example.com/page';

    const normalized1 = caseSensitiveDeduplicator.normalizeUrl(url1, { caseSensitive: true });
    const normalized2 = caseSensitiveDeduplicator.normalizeUrl(url2, { caseSensitive: true });

    expect(normalized1).not.toBe(normalized2);
  });
});

describe('BookmarkDeduplicator - 边界情况测试', () => {
  let deduplicator;

  beforeEach(() => {
    deduplicator = new BookmarkDeduplicator();
  });

  test('应该处理空书签列表', () => {
    expect(deduplicator.deduplicate([]).deduplicated).toEqual([]);
    expect(deduplicator.generateDeduplicationReport([]).totalBookmarks).toBe(0);
  });

  test('应该处理只有文件夹的书签列表', () => {
    const bookmarks = [
      { type: 'folder', name: '工作' },
      { type: 'folder', name: '学习' },
    ];

    const result = deduplicator.deduplicate(bookmarks);

    expect(result.report.totalBookmarks).toBe(0);
    expect(result.report.duplicatesFound).toBe(0);
    expect(result.deduplicated.length).toBe(2);
  });

  test('应该处理 URL 为空的书签', () => {
    const bookmarks = [
      { type: 'link', title: 'Test 1', url: '' },
      { type: 'link', title: 'Test 2', url: null },
    ];

    const report = deduplicator.generateDeduplicationReport(bookmarks);

    expect(report.totalBookmarks).toBe(2);
  });

  test('应该处理标题为空的书签', () => {
    const bookmarks = [
      { type: 'link', title: '', url: 'https://example.com' },
      { type: 'link', title: null, url: 'https://example.com' },
    ];

    const isDuplicate = deduplicator.isDuplicate(bookmarks[0], bookmarks[1]);
    expect(isDuplicate).toBe(false);
  });

  test('应该处理大量书签数据', () => {
    const bookmarks = [];

    for (let i = 0; i < 100; i++) {
      bookmarks.push({
        type: 'link',
        title: `书签 ${i}`,
        url: `https://example-${i}.com/page`
      });
    }

    for (let i = 0; i < 50; i++) {
      bookmarks.push({
        type: 'link',
        title: `书签 ${i}`,
        url: `https://www.example-${i}.com/page?param=value`
      });
    }

    const report = deduplicator.generateDeduplicationReport(bookmarks);

    expect(report.totalBookmarks).toBe(150);
    expect(report.duplicateGroups).toBe(50);
    expect(report.duplicatesFound).toBe(50);
    expect(report.toKeep.length).toBe(100);
  });
});
