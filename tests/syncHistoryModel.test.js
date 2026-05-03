const { 
  SyncHistory, 
  SyncFailureDetail, 
  mapSyncErrorToType, 
  getErrorTypeDescription,
  SyncStatus
} = require('../src/models/syncHistoryModel');
const { initDatabase, closeDatabase, getDb } = require('../src/services/database');

describe('SyncHistory Model - 错误类型映射测试', () => {
  describe('mapSyncErrorToType 函数', () => {
    test('应该正确识别图标下载失败', () => {
      expect(mapSyncErrorToType('图标下载失败：无法从'))
        .toBe('icon_download_failed');
      expect(mapSyncErrorToType('favicon'))
        .toBe('icon_download_failed');
      expect(mapSyncErrorToType('download'))
        .toBe('icon_download_failed');
      expect(mapSyncErrorToType('icon'))
        .toBe('icon_download_failed');
    });

    test('应该正确识别 URL 无效', () => {
      expect(mapSyncErrorToType('invalid'))
        .toBe('url_invalid');
      expect(mapSyncErrorToType('malformed'))
        .toBe('url_invalid');
    });

    test('应该正确识别网络错误', () => {
      expect(mapSyncErrorToType('network'))
        .toBe('network_error');
      expect(mapSyncErrorToType('connection'))
        .toBe('network_error');
      expect(mapSyncErrorToType('ECONNREFUSED'))
        .toBe('network_error');
    });

    test('应该正确识别超时错误', () => {
      expect(mapSyncErrorToType('timeout'))
        .toBe('timeout');
      expect(mapSyncErrorToType('timed out'))
        .toBe('timeout');
    });

    test('应该正确识别权限错误', () => {
      expect(mapSyncErrorToType('permission'))
        .toBe('permission_error');
      expect(mapSyncErrorToType('access denied'))
        .toBe('permission_error');
      expect(mapSyncErrorToType('EACCES'))
        .toBe('permission_error');
    });

    test('应该默认返回未知错误', () => {
      expect(mapSyncErrorToType('some random error'))
        .toBe('unknown');
      expect(mapSyncErrorToType(''))
        .toBe('unknown');
      expect(mapSyncErrorToType(null))
        .toBe('unknown');
      expect(mapSyncErrorToType(undefined))
        .toBe('unknown');
    });
  });

  describe('getErrorTypeDescription 函数', () => {
    test('应该返回所有错误类型的友好描述', () => {
      expect(getErrorTypeDescription('icon_download_failed'))
        .toContain('favicon');
      expect(getErrorTypeDescription('url_invalid'))
        .toContain('URL');
      expect(getErrorTypeDescription('network_error'))
        .toContain('网络');
      expect(getErrorTypeDescription('timeout'))
        .toContain('超时');
      expect(getErrorTypeDescription('permission_error'))
        .toContain('权限');
      expect(getErrorTypeDescription('unknown'))
        .toContain('未知');
    });

    test('未知类型应该返回未知错误的描述', () => {
      expect(getErrorTypeDescription('nonexistent'))
        .toContain('未知');
    });
  });
});

describe('SyncHistory Model - 实例错误描述方法', () => {
  test('实例方法 getErrorDescription 应该调用 getErrorTypeDescription 函数', () => {
    const instance = new SyncFailureDetail();
    instance.error_type = 'network_error';
    
    expect(instance.getErrorDescription())
      .toBe(getErrorTypeDescription('network_error'));
  });
});

describe('SyncHistory Model - 数据库操作测试', () => {
  let db;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    db = await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('创建同步记录', () => {
    test('应该成功创建同步记录', async () => {
      const syncId = 'test-sync-001';
      const browserSource = 'chrome';
      
      await SyncHistory.recordSyncStart(syncId, browserSource);
      
      const records = await SyncHistory.listAll(10, 0);
      
      expect(records.length).toBeGreaterThan(0);
      const created = records.find(r => r.sync_id === syncId);
      expect(created).toBeDefined();
      expect(created.browser_source).toBe(browserSource);
    });

    test('recordSyncStart 应该正确设置默认值', async () => {
      const syncId = 'test-sync-002';
      
      await SyncHistory.recordSyncStart(syncId);
      
      const records = await SyncHistory.listAll(10, 0);
      const created = records.find(r => r.sync_id === syncId);
      
      expect(created).toBeDefined();
      expect(created.total_count).toBe(0);
    });

    test('create 方法应该正确创建同步记录', async () => {
      const result = await SyncHistory.create({
        sync_id: 'test-create-method',
        browser_source: 'edge',
        total_count: 10,
        success_count: 8,
        failed_count: 2,
        sync_dir: '/test/path',
        failures: [
          { title: 'Test', url: 'http://test.com', errorMessage: 'favicon download failed' }
        ]
      });
      
      expect(result).toBeDefined();
      expect(result.sync_id).toBe('test-create-method');
      expect(result.total_count).toBe(10);
      expect(result.success_count).toBe(8);
      expect(result.failed_count).toBe(2);
    });
  });

  describe('更新同步结果', () => {
    test('应该成功更新同步结果', async () => {
      const syncId = 'test-sync-update-001';
      
      await SyncHistory.recordSyncStart(syncId, 'edge');
      
      const result = {
        bookmarksSynced: 10,
        bookmarksAlreadySynced: 5,
        bookmarksFailed: 3,
        foldersCreated: 2,
        duplicatesFound: 1,
        totalFolders: 5,
        syncDir: '/test/path',
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        failedBookmarks: [
          {
            title: 'Test Bookmark',
            url: 'http://example.com',
            folderPath: '/Test',
            errorMessage: '图标下载失败：无法获取 favicon'
          }
        ]
      };
      
      await SyncHistory.updateSyncResult(syncId, result, 'edge');
      
      const records = await SyncHistory.listAll(10, 0);
      const updated = records.find(r => r.sync_id === syncId);
      
      expect(updated).toBeDefined();
      expect(updated.total_count).toBe(18);
      expect(updated.success_count).toBe(15);
      expect(updated.failed_count).toBe(3);
      expect(updated.folders_created).toBe(2);
      expect(updated.duplicates_found).toBe(1);
      expect(updated.status).toBe('partial');
    });

    test('全部成功时状态应该为 completed', async () => {
      const syncId = 'test-sync-success';
      
      await SyncHistory.recordSyncStart(syncId, 'chrome');
      
      const result = {
        bookmarksSynced: 10,
        bookmarksAlreadySynced: 5,
        bookmarksFailed: 0,
        foldersCreated: 2,
        duplicatesFound: 1,
        totalFolders: 5,
        startTime: Date.now() - 5000,
        endTime: Date.now(),
        failedBookmarks: []
      };
      
      await SyncHistory.updateSyncResult(syncId, result, 'chrome');
      
      const records = await SyncHistory.listAll(10, 0);
      const updated = records.find(r => r.sync_id === syncId);
      
      expect(updated.status).toBe('completed');
    });

    test('全部失败时状态应该为 failed', async () => {
      const syncId = 'test-sync-failed';
      
      await SyncHistory.recordSyncStart(syncId, 'firefox');
      
      const result = {
        bookmarksSynced: 0,
        bookmarksAlreadySynced: 0,
        bookmarksFailed: 5,
        foldersCreated: 0,
        duplicatesFound: 0,
        totalFolders: 0,
        startTime: Date.now() - 2000,
        endTime: Date.now(),
        failedBookmarks: [
          { title: '1', url: 'http://1.com', errorMessage: 'network error' },
          { title: '2', url: 'http://2.com', errorMessage: 'timeout' }
        ]
      };
      
      await SyncHistory.updateSyncResult(syncId, result, 'firefox');
      
      const records = await SyncHistory.listAll(10, 0);
      const updated = records.find(r => r.sync_id === syncId);
      
      expect(updated.status).toBe('failed');
    });
  });

  describe('查询同步记录', () => {
    test('应该通过 ID 查找同步记录', async () => {
      const syncId = 'test-sync-find-by-id';
      
      await SyncHistory.recordSyncStart(syncId, 'chrome');
      
      const records = await SyncHistory.listAll(10, 0);
      const created = records.find(r => r.sync_id === syncId);
      
      const found = await SyncHistory.findById(created.id);
      
      expect(found).not.toBeNull();
      expect(found.sync_id).toBe(syncId);
    });

    test('不存在的 ID 应该返回 null', async () => {
      const found = await SyncHistory.findById(999999);
      expect(found).toBeNull();
    });

    test('应该通过 sync_id 查找同步记录', async () => {
      const syncId = 'test-sync-find-by-syncid';
      
      await SyncHistory.recordSyncStart(syncId, 'edge');
      
      const found = await SyncHistory.findBySyncId(syncId);
      
      expect(found).not.toBeNull();
      expect(found.sync_id).toBe(syncId);
    });

    test('不存在的 sync_id 应该返回 null', async () => {
      const found = await SyncHistory.findBySyncId('nonexistent-sync-id');
      expect(found).toBeNull();
    });

    test('列表应该支持分页', async () => {
      for (let i = 0; i < 15; i++) {
        await SyncHistory.recordSyncStart(`pagination-test-${i}`, 'chrome');
      }
      
      const page1 = await SyncHistory.listAll(10, 0);
      const page2 = await SyncHistory.listAll(10, 10);
      
      expect(page1.length).toBe(10);
      expect(page2.length).toBeLessThanOrEqual(10);
      expect(page2.length).toBeGreaterThan(0);
    });

    test('listRecent 应该返回最近的记录', async () => {
      const recent = await SyncHistory.listRecent(5);
      
      expect(recent).toBeDefined();
      expect(Array.isArray(recent)).toBe(true);
    });
  });

  describe('删除同步记录', () => {
    test('应该成功删除同步记录', async () => {
      await SyncHistory.clearAll();
      
      const syncId = 'test-sync-delete';
      
      await SyncHistory.recordSyncStart(syncId, 'chrome');
      
      const records = await SyncHistory.listAll(10, 0);
      const created = records.find(r => r.sync_id === syncId);
      
      expect(created).toBeDefined();
      
      const result = await SyncHistory.delete(created.id);
      
      expect(result).toBe(true);
      
      const found = await SyncHistory.findById(created.id);
      expect(found).toBeNull();
    });

    test('删除不存在的记录应该返回 false', async () => {
      const result = await SyncHistory.delete(999999);
      expect(result).toBe(false);
    });

    test('应该成功清空所有同步记录', async () => {
      await SyncHistory.recordSyncStart('clear-test-1', 'chrome');
      await SyncHistory.recordSyncStart('clear-test-2', 'edge');
      
      await SyncHistory.clearAll();
      
      const records = await SyncHistory.listAll(10, 0);
      expect(records.length).toBe(0);
    });
  });

  describe('统计功能', () => {
    test('应该返回正确的统计信息', async () => {
      await SyncHistory.clearAll();
      
      for (let i = 0; i < 3; i++) {
        const syncId = `stats-test-${i}`;
        await SyncHistory.recordSyncStart(syncId, 'chrome');
        
        const result = {
          bookmarksSynced: 10,
          bookmarksAlreadySynced: 5,
          bookmarksFailed: i,
          foldersCreated: 2,
          duplicatesFound: 1,
          totalFolders: 5,
          startTime: Date.now() - 5000,
          endTime: Date.now(),
          failedBookmarks: i > 0 ? [
            { title: `Fail ${i}`, url: 'http://test.com', errorMessage: 'network error' }
          ] : []
        };
        
        await SyncHistory.updateSyncResult(syncId, result, 'chrome');
      }
      
      const stats = await SyncHistory.getStats();
      
      expect(stats).toBeDefined();
      expect(stats.totalSyncs).toBe(3);
      expect(stats.totalBookmarks).toBe(48);
      expect(stats.totalSuccesses).toBe(45);
      expect(stats.totalFailures).toBe(3);
      expect(stats.successRate).toBe(Math.round((45 / 48) * 100));
    });
  });

  describe('错误分布统计', () => {
    test('应该按错误类型统计失败次数', async () => {
      await SyncHistory.clearAll();
      
      const syncId = 'error-dist-test';
      
      await SyncHistory.recordSyncStart(syncId, 'chrome');
      
      const result = {
        bookmarksSynced: 5,
        bookmarksAlreadySynced: 3,
        bookmarksFailed: 4,
        foldersCreated: 1,
        duplicatesFound: 0,
        totalFolders: 2,
        startTime: Date.now() - 3000,
        endTime: Date.now(),
        failedBookmarks: [
          { title: '1', url: 'http://1.com', errorMessage: 'favicon download failed' },
          { title: '2', url: 'http://2.com', errorMessage: '图标下载失败' },
          { title: '3', url: 'http://3.com', errorMessage: 'network error' },
          { title: '4', url: 'http://4.com', errorMessage: '超时' }
        ]
      };
      
      await SyncHistory.updateSyncResult(syncId, result, 'chrome');
      
      const distribution = await SyncFailureDetail.getErrorDistribution();
      
      expect(distribution).toBeDefined();
      expect(Array.isArray(distribution)).toBe(true);
      
      const iconFail = distribution.find(d => d.error_type === 'icon_download_failed');
      const netFail = distribution.find(d => d.error_type === 'network_error');
      const timeoutFail = distribution.find(d => d.error_type === 'timeout');
      
      expect(iconFail).toBeDefined();
      expect(iconFail.count).toBe(2);
      expect(netFail).toBeDefined();
      expect(netFail.count).toBe(1);
      expect(timeoutFail).toBeDefined();
      expect(timeoutFail.count).toBe(1);
    });
  });

  describe('获取失败详情', () => {
    test('实例方法 getFailures 应该返回该同步的所有失败记录', async () => {
      const syncId = 'test-instance-failures';
      
      await SyncHistory.recordSyncStart(syncId, 'chrome');
      
      const result = {
        bookmarksSynced: 2,
        bookmarksAlreadySynced: 0,
        bookmarksFailed: 3,
        foldersCreated: 0,
        duplicatesFound: 0,
        totalFolders: 1,
        startTime: Date.now() - 2000,
        endTime: Date.now(),
        failedBookmarks: [
          { title: 'A', url: 'http://a.com', folderPath: '/', errorMessage: 'network error' },
          { title: 'B', url: 'http://b.com', folderPath: '/', errorMessage: 'timeout' },
          { title: 'C', url: 'http://c.com', folderPath: '/', errorMessage: 'favicon download failed' }
        ]
      };
      
      await SyncHistory.updateSyncResult(syncId, result, 'chrome');
      
      const records = await SyncHistory.listAll(10, 0);
      const history = records.find(r => r.sync_id === syncId);
      
      const failures = await history.getFailures();
      
      expect(failures).toBeDefined();
      expect(failures.length).toBe(3);
    });

    test('SyncFailureDetail.findBySyncId 应该返回该同步的所有失败记录', async () => {
      const syncId = 'test-find-by-syncid-failures';
      
      await SyncHistory.recordSyncStart(syncId, 'chrome');
      
      const result = {
        bookmarksSynced: 1,
        bookmarksAlreadySynced: 0,
        bookmarksFailed: 2,
        foldersCreated: 0,
        duplicatesFound: 0,
        totalFolders: 1,
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        failedBookmarks: [
          { title: 'Fail 1', url: 'http://fail1.com', errorMessage: 'network error' },
          { title: 'Fail 2', url: 'http://fail2.com', errorMessage: 'timeout' }
        ]
      };
      
      await SyncHistory.updateSyncResult(syncId, result, 'chrome');
      
      const failures = await SyncFailureDetail.findBySyncId(syncId);
      
      expect(failures).toBeDefined();
      expect(failures.length).toBe(2);
    });
  });

  describe('SyncHistory 实例方法', () => {
    test('getSuccessRate 应该计算成功率', async () => {
      const history = new SyncHistory(
        1, 'test', new Date().toISOString(), 'chrome',
        100, 80, 20, 'partial', null, null,
        10, 5, 0, 5000, null, null
      );
      
      expect(history.getSuccessRate()).toBe(80);
    });

    test('getSuccessRate 总数为0时返回0', async () => {
      const history = new SyncHistory(
        1, 'test', new Date().toISOString(), 'chrome',
        0, 0, 0, 'completed', null, null,
        0, 0, 0, 0, null, null
      );
      
      expect(history.getSuccessRate()).toBe(0);
    });

    test('getDurationFormatted 应该格式化时间', async () => {
      const historyMs = new SyncHistory(
        1, 'test', new Date().toISOString(), 'chrome',
        0, 0, 0, 'completed', null, null,
        0, 0, 0, 500, null, null
      );
      expect(historyMs.getDurationFormatted()).toBe('500 毫秒');
      
      const historySec = new SyncHistory(
        1, 'test', new Date().toISOString(), 'chrome',
        0, 0, 0, 'completed', null, null,
        0, 0, 0, 5000, null, null
      );
      expect(historySec.getDurationFormatted()).toBe('5 秒');
      
      const historyMin = new SyncHistory(
        1, 'test', new Date().toISOString(), 'chrome',
        0, 0, 0, 'completed', null, null,
        0, 0, 0, 65000, null, null
      );
      expect(historyMin.getDurationFormatted()).toBe('1 分 5 秒');
    });

    test('toJSON 应该返回完整对象', async () => {
      const history = new SyncHistory(
        1, 'test-sync-id', new Date().toISOString(), 'chrome',
        100, 80, 20, 'partial', null, '/test/path',
        10, 5, 0, 5000, null, null
      );
      
      const json = history.toJSON();
      
      expect(json).toBeDefined();
      expect(json.id).toBe(1);
      expect(json.sync_id).toBe('test-sync-id');
      expect(json.success_rate).toBe(80);
      expect(json.duration_formatted).toBe('5 秒');
    });
  });

  describe('SyncFailureDetail 实例方法', () => {
    test('toJSON 应该返回完整对象', async () => {
      const failure = new SyncFailureDetail(
        1, 'test-sync-id', 'Test Title', 'http://test.com', '/Test',
        'network_error', '网络连接失败',
        new Date().toISOString(), new Date().toISOString()
      );
      
      const json = failure.toJSON();
      
      expect(json).toBeDefined();
      expect(json.id).toBe(1);
      expect(json.bookmark_title).toBe('Test Title');
      expect(json.error_description).toBeDefined();
    });
  });
});
