const { 
  DiffType,
  ChangeType,
  tokenize,
  tokenizeByChar,
  tokenizeByWord,
  tokenizeByLine,
  computeLCS,
  computeDiff,
  computeCharLevelDiff,
  computeWordLevelDiff,
  computeLineLevelDiff,
  computeSideBySideDiff,
  computeUnifiedDiff,
  computeDiffStatistics,
  mergeAdjacentDiffs,
  escapeHtml
} = require('../src/services/diffEngine');

describe('DiffType 和 ChangeType 枚举', () => {
  test('DiffType 应该包含正确的常量值', () => {
    expect(DiffType.CHAR).toBe('char');
    expect(DiffType.WORD).toBe('word');
    expect(DiffType.LINE).toBe('line');
  });

  test('ChangeType 应该包含正确的常量值', () => {
    expect(ChangeType.SAME).toBe('same');
    expect(ChangeType.ADDED).toBe('added');
    expect(ChangeType.REMOVED).toBe('removed');
  });
});

describe('tokenize 函数', () => {
  test('应该处理空输入', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });

  test('tokenizeByChar 应该按字符分割', () => {
    const result = tokenizeByChar('abc');
    expect(result).toEqual(['a', 'b', 'c']);
  });

  test('tokenizeByLine 应该按行分割（保留换行符）', () => {
    const result = tokenizeByLine('line1\nline2\r\nline3');
    expect(result.length).toBe(3);
    expect(result[0]).toBe('line1\n');
    expect(result[1]).toBe('line2\r\n');
    expect(result[2]).toBe('line3');
  });

  test('tokenizeByWord 应该按单词分割', () => {
    const result = tokenizeByWord('Hello, world!');
    expect(result).toContain('Hello');
    expect(result).toContain(',');
    expect(result).toContain('world');
    expect(result).toContain('!');
  });

  test('tokenize 应该根据类型调用正确的函数', () => {
    const text = 'test';
    expect(tokenize(text, DiffType.CHAR)).toEqual(tokenizeByChar(text));
    expect(tokenize(text, DiffType.LINE)).toEqual(tokenizeByLine(text));
    expect(tokenize(text, DiffType.WORD)).toEqual(tokenizeByWord(text));
  });
});

describe('computeLCS 函数', () => {
  test('应该计算正确的最长公共子序列', () => {
    const oldTokens = ['a', 'b', 'c', 'd', 'e'];
    const newTokens = ['a', 'x', 'c', 'y', 'e'];
    
    const lcs = computeLCS(oldTokens, newTokens);
    
    expect(lcs.length).toBe(3);
    expect(lcs.map(item => item.value)).toEqual(['a', 'c', 'e']);
  });

  test('应该处理完全相同的序列', () => {
    const tokens = ['a', 'b', 'c'];
    const lcs = computeLCS(tokens, tokens);
    
    expect(lcs.length).toBe(3);
    expect(lcs.map(item => item.value)).toEqual(['a', 'b', 'c']);
  });

  test('应该处理完全不同的序列', () => {
    const oldTokens = ['a', 'b', 'c'];
    const newTokens = ['x', 'y', 'z'];
    
    const lcs = computeLCS(oldTokens, newTokens);
    
    expect(lcs.length).toBe(0);
  });

  test('应该处理空序列', () => {
    expect(computeLCS([], ['a', 'b'])).toEqual([]);
    expect(computeLCS(['a', 'b'], [])).toEqual([]);
    expect(computeLCS([], [])).toEqual([]);
  });
});

describe('computeDiff 函数', () => {
  test('应该计算两个序列之间的差异', () => {
    const oldTokens = ['a', 'b', 'c'];
    const newTokens = ['a', 'x', 'c'];
    
    const diffs = computeDiff(oldTokens, newTokens);
    
    const types = diffs.map(d => d.type);
    expect(types).toContain(ChangeType.SAME);
    expect(types).toContain(ChangeType.REMOVED);
    expect(types).toContain(ChangeType.ADDED);
  });

  test('应该处理完全相同的序列', () => {
    const tokens = ['a', 'b', 'c'];
    const diffs = computeDiff(tokens, tokens);
    
    expect(diffs.every(d => d.type === ChangeType.SAME)).toBe(true);
  });

  test('应该处理完全不同的序列', () => {
    const oldTokens = ['a', 'b'];
    const newTokens = ['x', 'y'];
    
    const diffs = computeDiff(oldTokens, newTokens);
    
    const types = diffs.map(d => d.type);
    expect(types).toContain(ChangeType.REMOVED);
    expect(types).toContain(ChangeType.ADDED);
  });
});

describe('mergeAdjacentDiffs 函数', () => {
  test('应该合并相邻的相同类型差异', () => {
    const diffs = [
      { type: ChangeType.REMOVED, value: 'a' },
      { type: ChangeType.REMOVED, value: 'b' },
      { type: ChangeType.SAME, value: 'c' },
      { type: ChangeType.ADDED, value: 'd' },
      { type: ChangeType.ADDED, value: 'e' }
    ];
    
    const merged = mergeAdjacentDiffs(diffs);
    
    expect(merged.length).toBe(3);
    expect(merged[0].type).toBe(ChangeType.REMOVED);
    expect(merged[0].content).toBe('ab');
    expect(merged[1].type).toBe(ChangeType.SAME);
    expect(merged[1].content).toBe('c');
    expect(merged[2].type).toBe(ChangeType.ADDED);
    expect(merged[2].content).toBe('de');
  });
});

describe('字符级差异计算', () => {
  test('应该计算字符级别的差异', () => {
    const oldText = 'Hello world';
    const newText = 'Hello World!';
    
    const diffs = computeCharLevelDiff(oldText, newText);
    
    expect(diffs.length).toBeGreaterThan(0);
    const types = diffs.map(d => d.type);
    expect(types).toContain(ChangeType.SAME);
    expect(types).toContain(ChangeType.ADDED);
    expect(types).toContain(ChangeType.REMOVED);
  });

  test('相同文本应该只有 SAME 类型', () => {
    const text = 'same text';
    const diffs = computeCharLevelDiff(text, text);
    
    expect(diffs.length).toBe(1);
    expect(diffs[0].type).toBe(ChangeType.SAME);
    expect(diffs[0].content).toBe(text);
  });
});

describe('单词级差异计算', () => {
  test('应该计算单词级别的差异', () => {
    const oldText = 'I like apples';
    const newText = 'I like oranges';
    
    const diffs = computeWordLevelDiff(oldText, newText);
    
    expect(diffs.length).toBeGreaterThan(0);
  });

  test('相同文本应该只有 SAME 类型', () => {
    const text = 'same words here';
    const diffs = computeWordLevelDiff(text, text);
    
    expect(diffs.every(d => d.type === ChangeType.SAME)).toBe(true);
  });
});

describe('行级差异计算', () => {
  test('应该计算行级别的差异', () => {
    const oldText = 'line1\nline2\nline3';
    const newText = 'line1\nmodified\nline3';
    
    const diffs = computeLineLevelDiff(oldText, newText);
    
    const types = diffs.map(d => d.type);
    expect(types).toContain(ChangeType.REMOVED);
    expect(types).toContain(ChangeType.ADDED);
  });

  test('应该支持忽略空白选项', () => {
    const oldText = 'line  with   spaces';
    const newText = 'line with spaces';
    
    const diffsWithIgnore = computeLineLevelDiff(oldText, newText, { ignoreWhitespace: true });
    const allSame = diffsWithIgnore.every(d => d.type === ChangeType.SAME);
    
    expect(allSame).toBe(true);
  });

  test('应该支持忽略大小写选项', () => {
    const oldText = 'HELLO WORLD';
    const newText = 'hello world';
    
    const diffsWithIgnore = computeLineLevelDiff(oldText, newText, { ignoreCase: true });
    const allSame = diffsWithIgnore.every(d => d.type === ChangeType.SAME);
    
    expect(allSame).toBe(true);
  });
});

describe('computeSideBySideDiff 函数', () => {
  test('应该返回左右分栏的差异结构', () => {
    const oldText = 'line1\nline2';
    const newText = 'line1\nmodified';
    
    const result = computeSideBySideDiff(oldText, newText);
    
    expect(result).toHaveProperty('left');
    expect(result).toHaveProperty('right');
    expect(Array.isArray(result.left)).toBe(true);
    expect(Array.isArray(result.right)).toBe(true);
    expect(result.left.length).toBe(result.right.length);
  });

  test('删除的行应该出现在左侧', () => {
    const oldText = 'line1\nremoved\nline3';
    const newText = 'line1\nline3';
    
    const result = computeSideBySideDiff(oldText, newText);
    
    const removedInLeft = result.left.find(item => 
      item.type === ChangeType.REMOVED && item.content === 'removed'
    );
    expect(removedInLeft).toBeDefined();
  });

  test('新增的行应该出现在右侧', () => {
    const oldText = 'line1\nline3';
    const newText = 'line1\nadded\nline3';
    
    const result = computeSideBySideDiff(oldText, newText);
    
    const addedInRight = result.right.find(item => 
      item.type === ChangeType.ADDED && item.content === 'added'
    );
    expect(addedInRight).toBeDefined();
  });
});

describe('computeUnifiedDiff 函数', () => {
  test('应该返回合并视图的差异结构', () => {
    const oldText = 'line1\nline2\nline3';
    const newText = 'line1\nmodified\nline3';
    
    const result = computeUnifiedDiff(oldText, newText);
    
    expect(result).toHaveProperty('hunks');
    expect(result).toHaveProperty('unifiedText');
    expect(result).toHaveProperty('lineDiffs');
    expect(Array.isArray(result.hunks)).toBe(true);
    expect(Array.isArray(result.lineDiffs)).toBe(true);
  });

  test('应该包含正确的行前缀', () => {
    const oldText = 'old line';
    const newText = 'new line';
    
    const result = computeUnifiedDiff(oldText, newText);
    
    expect(result.unifiedText).toContain('-old line');
    expect(result.unifiedText).toContain('+new line');
  });

  test('应该包含 hunk 头部信息', () => {
    const oldText = 'line1\nline2\nline3';
    const newText = 'line1\nmodified\nline3';
    
    const result = computeUnifiedDiff(oldText, newText);
    
    expect(result.unifiedText).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  test('应该支持自定义上下文行数', () => {
    const oldText = 'context1\ncontext2\nold\ncontext3\ncontext4';
    const newText = 'context1\ncontext2\nnew\ncontext3\ncontext4';
    
    const result = computeUnifiedDiff(oldText, newText, { contextLines: 1 });
    
    expect(result.hunks.length).toBeGreaterThan(0);
  });
});

describe('computeDiffStatistics 函数', () => {
  test('应该返回正确的统计信息', () => {
    const oldText = 'line1\nline2\nline3';
    const newText = 'line1\nmodified\nline3\nline4';
    
    const stats = computeDiffStatistics(oldText, newText);
    
    expect(stats).toHaveProperty('lines');
    expect(stats).toHaveProperty('bytes');
    expect(stats).toHaveProperty('changePercentage');
    
    expect(stats.lines.old).toBe(3);
    expect(stats.lines.new).toBe(4);
    expect(stats.lines.added).toBe(2);
    expect(stats.lines.removed).toBe(1);
    expect(stats.lines.unchanged).toBe(2);
  });

  test('应该计算正确的字节大小', () => {
    const oldText = 'abc';
    const newText = 'abcd';
    
    const stats = computeDiffStatistics(oldText, newText);
    
    expect(stats.bytes.old).toBe(3);
    expect(stats.bytes.new).toBe(4);
    expect(stats.bytes.delta).toBe(1);
  });

  test('应该计算正确的变化百分比', () => {
    const oldText = 'line1\nline2\nline3\nline4\nline5';
    const newText = 'line1\nmodified\nline3\nmodified2\nline5';
    
    const stats = computeDiffStatistics(oldText, newText);
    
    expect(stats.changePercentage.lines).toBeGreaterThan(0);
    expect(stats.changePercentage.lines).toBeLessThanOrEqual(100);
  });

  test('相同文本的变化百分比应该为 0', () => {
    const text = 'same text\nsame line';
    const stats = computeDiffStatistics(text, text);
    
    expect(stats.lines.added).toBe(0);
    expect(stats.lines.removed).toBe(0);
    expect(stats.changePercentage.lines).toBe(0);
    expect(stats.changePercentage.bytes).toBe(0);
  });

  test('应该处理空文本', () => {
    const stats = computeDiffStatistics('', '');
    
    expect(stats.lines.old).toBe(0);
    expect(stats.lines.new).toBe(0);
    expect(stats.bytes.old).toBe(0);
    expect(stats.bytes.new).toBe(0);
  });
});

describe('escapeHtml 函数', () => {
  test('应该正确转义 HTML 特殊字符', () => {
    const html = '<div class="test">Hello & "World"</div>';
    const escaped = escapeHtml(html);
    
    expect(escaped).toContain('&lt;');
    expect(escaped).toContain('&gt;');
    expect(escaped).toContain('&amp;');
    expect(escaped).toContain('&quot;');
  });

  test('应该处理空输入', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('集成测试', () => {
  test('完整的差异计算流程', () => {
    const oldText = `function hello() {
  console.log("Hello, World!");
  return true;
}`;

    const newText = `function hello() {
  console.log("Hello, Updated World!");
  console.log("New line added");
  return true;
}`;

    const lineDiff = computeLineLevelDiff(oldText, newText);
    const sideBySide = computeSideBySideDiff(oldText, newText);
    const unified = computeUnifiedDiff(oldText, newText);
    const stats = computeDiffStatistics(oldText, newText);

    expect(lineDiff.length).toBeGreaterThan(0);
    expect(sideBySide.left.length).toBe(sideBySide.right.length);
    expect(unified.hunks.length).toBeGreaterThan(0);
    expect(stats.lines.added).toBeGreaterThan(0);
  });

  test('三种粒度的差异计算应该都能正常工作', () => {
    const oldText = 'The quick brown fox jumps over the lazy dog.';
    const newText = 'The quick red fox leaps over the lazy cat.';

    const charDiff = computeCharLevelDiff(oldText, newText);
    const wordDiff = computeWordLevelDiff(oldText, newText);
    const lineDiff = computeLineLevelDiff(oldText, newText);

    expect(charDiff.length).toBeGreaterThan(0);
    expect(wordDiff.length).toBeGreaterThan(0);
    expect(lineDiff.length).toBeGreaterThan(0);
  });
});

describe('边界情况测试', () => {
  test('空文本比较', () => {
    const diffs = computeLineLevelDiff('', '');
    expect(diffs.length).toBe(0);
    
    const stats = computeDiffStatistics('', '');
    expect(stats.lines.old).toBe(0);
    expect(stats.lines.new).toBe(0);
  });

  test('从空文本到非空文本', () => {
    const oldText = '';
    const newText = 'line1\nline2';
    
    const diffs = computeLineLevelDiff(oldText, newText);
    const allAdded = diffs.every(d => d.type === ChangeType.ADDED);
    
    expect(allAdded).toBe(true);
  });

  test('从非空文本到空文本', () => {
    const oldText = 'line1\nline2';
    const newText = '';
    
    const diffs = computeLineLevelDiff(oldText, newText);
    const allRemoved = diffs.every(d => d.type === ChangeType.REMOVED);
    
    expect(allRemoved).toBe(true);
  });

  test('单行文本变化', () => {
    const oldText = 'original text';
    const newText = 'modified text';
    
    const diffs = computeLineLevelDiff(oldText, newText);
    
    expect(diffs.length).toBe(2);
    expect(diffs[0].type).toBe(ChangeType.REMOVED);
    expect(diffs[1].type).toBe(ChangeType.ADDED);
  });
});
