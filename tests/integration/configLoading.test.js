/**
 * 集成测试：环境变量加载和默认配置回退测试
 * 验证环境变量加载逻辑，特别是"默认配置回退"的覆盖情况
 */

const path = require('path');
const {
  parseBoolean,
  parseNumber,
  parseList,
  parsePath,
  DEFAULT_CONFIG,
  getPublicConfig,
  shouldFilter,
  reload
} = require('../../src/services/config');

describe('集成测试 - 配置解析函数测试', () => {
  describe('parseNumber', () => {
    test('应正确解析有效数字字符串', () => {
      expect(parseNumber('8080', 4000)).toBe(8080);
      expect(parseNumber('10', 5)).toBe(10);
      expect(parseNumber('4000', 5000)).toBe(4000);
      expect(parseNumber('0', 100)).toBe(0);
    });

    test('对于无效数字应使用默认值', () => {
      expect(parseNumber('invalid', 4000)).toBe(4000);
      expect(parseNumber('abc', 5)).toBe(5);
      expect(parseNumber('', 100)).toBe(100);
    });

    test('对于 null/undefined 应使用默认值', () => {
      expect(parseNumber(null, 4000)).toBe(4000);
      expect(parseNumber(undefined, 5)).toBe(5);
    });
  });

  describe('parseBoolean', () => {
    test('应正确解析 true 值', () => {
      expect(parseBoolean('true', false)).toBe(true);
      expect(parseBoolean('TRUE', false)).toBe(true);
      expect(parseBoolean('True', false)).toBe(true);
      expect(parseBoolean('1', false)).toBe(true);
      expect(parseBoolean('yes', false)).toBe(true);
      expect(parseBoolean('YES', false)).toBe(true);
    });

    test('应正确解析 false 值', () => {
      expect(parseBoolean('false', true)).toBe(false);
      expect(parseBoolean('FALSE', true)).toBe(false);
      expect(parseBoolean('0', true)).toBe(false);
      expect(parseBoolean('no', true)).toBe(false);
      expect(parseBoolean('NO', true)).toBe(false);
    });

    test('对于无效值应使用默认值', () => {
      expect(parseBoolean('invalid', true)).toBe(true);
      expect(parseBoolean('maybe', false)).toBe(false);
      expect(parseBoolean('', true)).toBe(true);
    });

    test('对于 null/undefined 应使用默认值', () => {
      expect(parseBoolean(null, true)).toBe(true);
      expect(parseBoolean(undefined, false)).toBe(false);
    });
  });

  describe('parseList', () => {
    test('应正确解析逗号分隔的列表', () => {
      expect(parseList('a,b,c', [])).toEqual(['a', 'b', 'c']);
      expect(parseList('localhost,127.0.0.1', [])).toEqual(['localhost', '127.0.0.1']);
      expect(parseList('  a  ,  b  ,  c  ', [])).toEqual(['a', 'b', 'c']);
    });

    test('对于空字符串应使用默认值', () => {
      expect(parseList('', ['default'])).toEqual(['default']);
      expect(parseList(null, ['default'])).toEqual(['default']);
      expect(parseList(undefined, ['default'])).toEqual(['default']);
    });

    test('应过滤掉空字符串项', () => {
      expect(parseList('a,,b,,c', [])).toEqual(['a', 'b', 'c']);
      expect(parseList(',,a,,b,,', [])).toEqual(['a', 'b']);
    });

    test('仅包含空格和逗号的字符串应返回空数组', () => {
      expect(parseList('  ,  ,  ', [])).toEqual([]);
    });
  });

  describe('parsePath', () => {
    test('应直接返回绝对路径', () => {
      const absolutePath = path.join(__dirname, 'test');
      expect(parsePath(absolutePath, '/default')).toBe(absolutePath);
    });

    test('应将相对路径转换为绝对路径', () => {
      const result = parsePath('./custom_dir', '/default');
      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toContain('custom_dir');
    });

    test('对于 null/undefined/空字符串应使用默认值', () => {
      expect(parsePath(null, '/default')).toBe('/default');
      expect(parsePath(undefined, '/default')).toBe('/default');
      expect(parsePath('', '/default')).toBe('/default');
    });
  });
});

describe('集成测试 - 默认配置回退测试', () => {
  test('DEFAULT_CONFIG 应包含所有默认配置项', () => {
    expect(DEFAULT_CONFIG).toBeDefined();
    expect(DEFAULT_CONFIG.port).toBe(4000);
    expect(DEFAULT_CONFIG.startPort).toBe(4000);
    expect(DEFAULT_CONFIG.maxPortAttempts).toBe(50);
    expect(DEFAULT_CONFIG.maxConcurrency).toBe(5);
    expect(DEFAULT_CONFIG.urlTimeout).toBe(5000);
    expect(DEFAULT_CONFIG.iconTimeout).toBe(10000);
    expect(DEFAULT_CONFIG.debug).toBe(false);
    expect(DEFAULT_CONFIG.logLevel).toBe('info');
    expect(Array.isArray(DEFAULT_CONFIG.filterPatterns)).toBe(true);
    expect(DEFAULT_CONFIG.filterPatterns).toContain('localhost');
    expect(DEFAULT_CONFIG.filterPatterns).toContain('127.0.0.1');
  });

  test('getPublicConfig 应返回可用于 API 的配置', () => {
    const publicConfig = getPublicConfig();
    
    expect(publicConfig).toBeDefined();
    expect(publicConfig).toHaveProperty('port');
    expect(publicConfig).toHaveProperty('maxConcurrency');
    expect(publicConfig).toHaveProperty('debug');
    expect(publicConfig).toHaveProperty('filterPatterns');
    expect(publicConfig).toHaveProperty('envLoaded');
    
    expect(publicConfig).not.toHaveProperty('_envLoaded');
    expect(publicConfig).not.toHaveProperty('_defaults');
  });
});

describe('集成测试 - shouldFilter 函数测试', () => {
  test('应过滤包含 localhost 的 URL', () => {
    expect(shouldFilter('http://localhost:4000')).toBe(true);
    expect(shouldFilter('https://localhost/api')).toBe(true);
  });

  test('应过滤包含 127.0.0.1 的 URL', () => {
    expect(shouldFilter('http://127.0.0.1:8080')).toBe(true);
    expect(shouldFilter('https://127.0.0.1')).toBe(true);
  });

  test('不应过滤外部 URL', () => {
    expect(shouldFilter('https://www.google.com')).toBe(false);
    expect(shouldFilter('https://github.com')).toBe(false);
    expect(shouldFilter('https://example.com/page')).toBe(false);
  });

  test('对于无效输入应返回 false', () => {
    expect(shouldFilter(null)).toBe(false);
    expect(shouldFilter(undefined)).toBe(false);
    expect(shouldFilter('')).toBe(false);
    expect(shouldFilter(123)).toBe(false);
  });
});

describe('集成测试 - 配置解析函数边界测试', () => {
  test('parseNumber 应处理边界值', () => {
    expect(parseNumber('65535', 0)).toBe(65535);
    expect(parseNumber('1', 0)).toBe(1);
    expect(parseNumber('0', 100)).toBe(0);
  });

  test('parseBoolean 应处理各种大小写组合', () => {
    expect(parseBoolean('TrUe', false)).toBe(true);
    expect(parseBoolean('tRuE', false)).toBe(true);
    expect(parseBoolean('fAlSe', true)).toBe(false);
    expect(parseBoolean('FaLsE', true)).toBe(false);
  });

  test('parseList 应处理单元素列表', () => {
    expect(parseList('single', [])).toEqual(['single']);
    expect(parseList('  single  ', [])).toEqual(['single']);
  });

  test('shouldFilter 应正确匹配子字符串', () => {
    expect(shouldFilter('http://my-localhost.com')).toBe(true);
    expect(shouldFilter('http://127.0.0.1.example.com')).toBe(true);
    expect(shouldFilter('http://example.com/path?localhost=1')).toBe(true);
  });

  test('DEFAULT_CONFIG 应包含正确的默认过滤模式', () => {
    expect(DEFAULT_CONFIG.filterPatterns).toContain('localhost');
    expect(DEFAULT_CONFIG.filterPatterns).toContain('127.0.0.1');
    expect(DEFAULT_CONFIG.filterPatterns).toContain('dev.test');
  });
});
