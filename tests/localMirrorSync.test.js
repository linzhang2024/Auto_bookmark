const fs = require('fs');
const path = require('path');
const {
  SyncStatus,
  sanitizeFileName,
  generateUniqueFileName,
  readExistingMeta,
  writeMeta,
  groupBookmarksByFolder,
  collectFolderInfo,
  analyzeSyncStatus,
  checkSyncStatus,
  isValidString,
  ensureValidPath,
  safePathJoin,
  safeExistsSync
} = require('../src/services/localMirrorSync');

describe('localMirrorSync.js - 辅助函数健壮性测试', () => {
  test('isValidString 应该正确验证字符串', () => {
    expect(isValidString('valid')).toBe(true);
    expect(isValidString('  valid  ')).toBe(true);
    expect(isValidString('')).toBe(false);
    expect(isValidString('   ')).toBe(false);
    expect(isValidString(null)).toBe(false);
    expect(isValidString(undefined)).toBe(false);
    expect(isValidString(123)).toBe(false);
    expect(isValidString({})).toBe(false);
    expect(isValidString([])).toBe(false);
  });

  test('ensureValidPath 应该确保返回有效路径', () => {
    expect(ensureValidPath('/valid/path', '/default')).toBe('/valid/path');
    expect(ensureValidPath(null, '/default')).toBe('/default');
    expect(ensureValidPath(undefined, '/default')).toBe('/default');
    expect(ensureValidPath('', '/default')).toBe('/default');
    expect(ensureValidPath(null, null)).toBe(process.cwd());
  });

  test('safePathJoin 应该安全地处理路径连接', () => {
    expect(safePathJoin('/base', 'folder', 'file.txt')).toBe(path.join('/base', 'folder', 'file.txt'));
    expect(safePathJoin('/base', null, 'file.txt')).toBe(path.join('/base', 'file.txt'));
    expect(safePathJoin(null, null, null)).toBeNull();
    expect(safePathJoin(null, '/valid')).toBe('/valid');
  });

  test('safeExistsSync 应该安全地检查文件存在性', () => {
    const existingPath = __dirname;
    const nonExistentPath = '/non/existent/path/12345';
    
    expect(safeExistsSync(existingPath)).toBe(true);
    expect(safeExistsSync(nonExistentPath)).toBe(false);
    expect(safeExistsSync(null)).toBe(false);
    expect(safeExistsSync(undefined)).toBe(false);
    expect(safeExistsSync('')).toBe(false);
  });
});

describe('localMirrorSync.js - 文件名处理测试', () => {
  test('sanitizeFileName 应该清理文件名中的非法字符', () => {
    expect(sanitizeFileName('normal/file')).toBe('normal_file');
    expect(sanitizeFileName('file<name>')).toBe('file_name_');
    expect(sanitizeFileName('test:file')).toBe('test_file');
    expect(sanitizeFileName('file"name')).toBe('file_name');
    expect(sanitizeFileName('file\\path')).toBe('file_path');
    expect(sanitizeFileName('file|pipe')).toBe('file_pipe');
    expect(sanitizeFileName('file?query')).toBe('file_query');
    expect(sanitizeFileName('file*star')).toBe('file_star');
  });

  test('sanitizeFileName 应该处理空值', () => {
    expect(sanitizeFileName('')).toBe('untitled');
    expect(sanitizeFileName(null)).toBe('untitled');
    expect(sanitizeFileName(undefined)).toBe('untitled');
  });

  test('sanitizeFileName 应该保持正常文件名不变', () => {
    expect(sanitizeFileName('Google')).toBe('Google');
    expect(sanitizeFileName('我的书签')).toBe('我的书签');
    expect(sanitizeFileName('test_bookmark')).toBe('test_bookmark');
  });

  test('generateUniqueFileName 应该在文件已存在时生成唯一文件名', () => {
    const testDir = path.join(__dirname, 'test_unique_files');
    
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }

    fs.writeFileSync(path.join(testDir, 'test.ico'), '');

    try {
      expect(generateUniqueFileName('test', '.ico', testDir)).toBe('test_1.ico');
      
      fs.writeFileSync(path.join(testDir, 'test_1.ico'), '');
      expect(generateUniqueFileName('test', '.ico', testDir)).toBe('test_2.ico');
    } finally {
      if (fs.existsSync(testDir)) {
        const files = fs.readdirSync(testDir);
        for (const file of files) {
          fs.unlinkSync(path.join(testDir, file));
        }
        fs.rmdirSync(testDir);
      }
    }
  });

  test('generateUniqueFileName 应该处理无效目录参数', () => {
    expect(generateUniqueFileName('test', '.ico', null)).toBe('test.ico');
    expect(generateUniqueFileName('test', '.ico', undefined)).toBe('test.ico');
  });
});

describe('localMirrorSync.js - 元数据处理测试', () => {
  const testMetaDir = path.join(__dirname, 'test_meta');

  beforeEach(() => {
    if (!fs.existsSync(testMetaDir)) {
      fs.mkdirSync(testMetaDir);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testMetaDir)) {
      const files = fs.readdirSync(testMetaDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testMetaDir, file));
      }
      fs.rmdirSync(testMetaDir);
    }
  });

  test('writeMeta 和 readExistingMeta 应该正确写入和读取元数据', () => {
    const metaPath = path.join(testMetaDir, '.meta.json');
    const testMeta = {
      folderName: '测试文件夹',
      lastSyncTime: new Date().toISOString(),
      bookmarks: [
        {
          title: 'Google',
          url: 'https://www.google.com',
          iconFileName: 'Google.ico',
          urlStatus: 'success',
          lastVisited: null,
          isInvalid: false,
          syncStatus: SyncStatus.COMPLETED,
          lastSyncTime: new Date().toISOString()
        }
      ],
      syncInfo: {
        syncId: 'test_sync_123',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalBookmarks: 1,
        completedBookmarks: 1,
        failedBookmarks: 0
      }
    };

    writeMeta(metaPath, testMeta);
    const readMeta = readExistingMeta(metaPath);

    expect(readMeta).not.toBeNull();
    expect(readMeta.folderName).toBe('测试文件夹');
    expect(readMeta.bookmarks.length).toBe(1);
    expect(readMeta.bookmarks[0].title).toBe('Google');
    expect(readMeta.bookmarks[0].syncStatus).toBe(SyncStatus.COMPLETED);
  });

  test('readExistingMeta 对于不存在的文件应该返回 null', () => {
    const nonExistentPath = path.join(testMetaDir, 'non_existent_meta.json');
    expect(readExistingMeta(nonExistentPath)).toBeNull();
  });

  test('readExistingMeta 对于损坏的 JSON 应该返回 null', () => {
    const corruptedPath = path.join(testMetaDir, 'corrupted_meta.json');
    fs.writeFileSync(corruptedPath, '这不是有效的 JSON {{{', 'utf-8');
    expect(readExistingMeta(corruptedPath)).toBeNull();
  });

  test('readExistingMeta 对于无效路径应该返回 null', () => {
    expect(readExistingMeta(null)).toBeNull();
    expect(readExistingMeta(undefined)).toBeNull();
    expect(readExistingMeta('')).toBeNull();
  });

  test('writeMeta 对于无效路径应该返回 false', () => {
    expect(writeMeta(null, {})).toBe(false);
    expect(writeMeta(undefined, {})).toBe(false);
    expect(writeMeta('', {})).toBe(false);
  });
});

describe('localMirrorSync.js - 文件夹和书签分组测试', () => {
  test('collectFolderInfo 应该正确收集文件夹信息', () => {
    const bookmarks = [
      {
        type: 'folder',
        name: '一级文件夹',
        level: 0,
        children: [
          {
            type: 'link',
            title: '链接1',
            url: 'https://link1.com',
            level: 1
          },
          {
            type: 'folder',
            name: '二级文件夹',
            level: 1,
            children: [
              {
                type: 'link',
                title: '链接2',
                url: 'https://link2.com',
                level: 2
              }
            ]
          }
        ]
      }
    ];

    const baseDir = '/test/base';
    const folderInfo = collectFolderInfo(bookmarks, baseDir);

    expect(folderInfo.size).toBe(2);
    
    const level1Path = path.join(baseDir, '一级文件夹');
    const level2Path = path.join(baseDir, '一级文件夹', '二级文件夹');
    
    expect(folderInfo.get(level1Path)).toBe('一级文件夹');
    expect(folderInfo.get(level2Path)).toBe('二级文件夹');
  });

  test('collectFolderInfo 应该处理无效输入', () => {
    const result1 = collectFolderInfo(null, '/test');
    const result2 = collectFolderInfo(undefined, '/test');
    const result3 = collectFolderInfo('not an array', '/test');

    expect(result1.size).toBe(0);
    expect(result2.size).toBe(0);
    expect(result3.size).toBe(0);
  });

  test('groupBookmarksByFolder 应该按文件夹路径分组书签', () => {
    const bookmarks = [
      {
        title: '链接1',
        url: 'https://link1.com',
        folderPath: '/folder1'
      },
      {
        title: '链接2',
        url: 'https://link2.com',
        folderPath: '/folder1'
      },
      {
        title: '链接3',
        url: 'https://link3.com',
        folderPath: '/folder2'
      }
    ];

    const groups = groupBookmarksByFolder(bookmarks);

    expect(groups.size).toBe(2);
    expect(groups.get('/folder1').length).toBe(2);
    expect(groups.get('/folder2').length).toBe(1);
  });

  test('groupBookmarksByFolder 应该处理无效输入', () => {
    const result1 = groupBookmarksByFolder(null);
    const result2 = groupBookmarksByFolder(undefined);
    const result3 = groupBookmarksByFolder('not an array');

    expect(result1.size).toBe(0);
    expect(result2.size).toBe(0);
    expect(result3.size).toBe(0);
  });

  test('groupBookmarksByFolder 应该处理无效书签对象', () => {
    const bookmarks = [
      null,
      undefined,
      'not an object',
      123,
      {},
      {
        title: '有效链接',
        url: 'https://valid.com',
        folderPath: '/folder1'
      }
    ];

    const groups = groupBookmarksByFolder(bookmarks);

    expect(groups.size).toBeGreaterThan(0);
  });
});

describe('localMirrorSync.js - 同步状态分析测试', () => {
  const testSyncDir = path.join(__dirname, 'test_sync_dir');

  beforeEach(() => {
    if (!fs.existsSync(testSyncDir)) {
      fs.mkdirSync(testSyncDir);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testSyncDir)) {
      function deleteDirRecursive(dir) {
        if (fs.existsSync(dir)) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              deleteDirRecursive(entryPath);
            } else {
              fs.unlinkSync(entryPath);
            }
          }
          fs.rmdirSync(dir);
        }
      }
      deleteDirRecursive(testSyncDir);
    }
  });

  test('analyzeSyncStatus 应该正确分析空目录的同步状态', () => {
    const bookmarks = [
      {
        type: 'folder',
        name: '测试文件夹',
        level: 0,
        children: [
          {
            type: 'link',
            title: 'Google',
            url: 'https://www.google.com',
            level: 1
          }
        ]
      }
    ];

    const result = analyzeSyncStatus(bookmarks, testSyncDir);

    expect(result.totalFolders).toBe(1);
    expect(result.totalBookmarks).toBe(1);
    expect(result.foldersToCreate.length).toBe(1);
    expect(result.bookmarksToSync.length).toBe(1);
    expect(result.bookmarksAlreadySynced.length).toBe(0);
  });

  test('checkSyncStatus 应该正确检查同步状态', () => {
    const subFolder = path.join(testSyncDir, '子文件夹');
    fs.mkdirSync(subFolder);

    const metaData = {
      folderName: '子文件夹',
      lastSyncTime: new Date().toISOString(),
      bookmarks: [
        {
          title: '已完成',
          url: 'https://completed.com',
          iconFileName: '已完成.ico',
          urlStatus: 'success',
          lastVisited: null,
          isInvalid: false,
          syncStatus: SyncStatus.COMPLETED,
          lastSyncTime: new Date().toISOString()
        },
        {
          title: '待处理',
          url: 'https://pending.com',
          iconFileName: null,
          urlStatus: 'unknown',
          lastVisited: null,
          isInvalid: false,
          syncStatus: SyncStatus.PENDING,
          lastSyncTime: null
        },
        {
          title: '失败',
          url: 'https://failed.com',
          iconFileName: null,
          urlStatus: 'timeout',
          lastVisited: null,
          isInvalid: true,
          syncStatus: SyncStatus.FAILED,
          lastSyncTime: new Date().toISOString()
        }
      ],
      syncInfo: {
        syncId: 'test_123',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalBookmarks: 3,
        completedBookmarks: 1,
        failedBookmarks: 1
      }
    };

    writeMeta(path.join(subFolder, '.meta.json'), metaData);

    const status = checkSyncStatus(testSyncDir);

    expect(status.totalFolders).toBe(1);
    expect(status.totalBookmarks).toBe(3);
    expect(status.completedBookmarks).toBe(1);
    expect(status.pendingBookmarks).toBe(1);
    expect(status.failedBookmarks).toBe(1);
    expect(status.folders.length).toBe(1);
    expect(status.folders[0].name).toBe('子文件夹');
  });

  test('checkSyncStatus 对于空目录应该返回零值', () => {
    const emptyDir = path.join(testSyncDir, 'empty');
    fs.mkdirSync(emptyDir);

    const status = checkSyncStatus(emptyDir);
    expect(status.totalFolders).toBe(0);
    expect(status.totalBookmarks).toBe(0);
    expect(status.completedBookmarks).toBe(0);
  });

  test('analyzeSyncStatus 应该检测已完成同步的书签', () => {
    const folderPath = path.join(testSyncDir, '已同步文件夹');
    fs.mkdirSync(folderPath);

    const iconPath = path.join(folderPath, 'Google.ico');
    fs.writeFileSync(iconPath, 'fake icon data');

    const metaData = {
      folderName: '已同步文件夹',
      lastSyncTime: new Date().toISOString(),
      bookmarks: [
        {
          title: 'Google',
          url: 'https://www.google.com',
          iconFileName: 'Google.ico',
          urlStatus: 'success',
          lastVisited: null,
          isInvalid: false,
          syncStatus: SyncStatus.COMPLETED,
          lastSyncTime: new Date().toISOString()
        }
      ],
      syncInfo: {
        syncId: 'test_123',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalBookmarks: 1,
        completedBookmarks: 1,
        failedBookmarks: 0
      }
    };

    writeMeta(path.join(folderPath, '.meta.json'), metaData);

    const bookmarks = [
      {
        type: 'folder',
        name: '已同步文件夹',
        level: 0,
        children: [
          {
            type: 'link',
            title: 'Google',
            url: 'https://www.google.com',
            level: 1
          }
        ]
      }
    ];

    const result = analyzeSyncStatus(bookmarks, testSyncDir);

    expect(result.bookmarksAlreadySynced.length).toBe(1);
    expect(result.bookmarksToSync.length).toBe(0);
  });

  test('analyzeSyncStatus 应该检测重名冲突', () => {
    const folderPath = path.join(testSyncDir, '冲突文件夹');
    fs.mkdirSync(folderPath);

    const existingIconPath = path.join(folderPath, 'Google.ico');
    fs.writeFileSync(existingIconPath, 'existing icon');

    const metaData = {
      folderName: '冲突文件夹',
      lastSyncTime: new Date().toISOString(),
      bookmarks: [
        {
          title: 'Google',
          url: 'https://www.original-google.com',
          iconFileName: 'Google.ico',
          urlStatus: 'success',
          lastVisited: null,
          isInvalid: false,
          syncStatus: SyncStatus.COMPLETED,
          lastSyncTime: new Date().toISOString()
        }
      ],
      syncInfo: {
        syncId: 'test_123',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalBookmarks: 1,
        completedBookmarks: 1,
        failedBookmarks: 0
      }
    };

    writeMeta(path.join(folderPath, '.meta.json'), metaData);

    const bookmarks = [
      {
        type: 'folder',
        name: '冲突文件夹',
        level: 0,
        children: [
          {
            type: 'link',
            title: 'Google',
            url: 'https://www.new-google.com',
            level: 1
          }
        ]
      }
    ];

    const result = analyzeSyncStatus(bookmarks, testSyncDir);

    expect(result.bookmarksWithConflicts.length).toBe(1);
    expect(result.bookmarksWithConflicts[0].conflicts.length).toBe(1);
    expect(result.bookmarksWithConflicts[0].conflicts[0].url).toBe('https://www.original-google.com');
  });

  test('analyzeSyncStatus 应该处理无效输入', () => {
    const result1 = analyzeSyncStatus(null, testSyncDir);
    const result2 = analyzeSyncStatus(undefined, testSyncDir);
    const result3 = analyzeSyncStatus('not an array', testSyncDir);

    expect(result1.totalFolders).toBe(0);
    expect(result2.totalFolders).toBe(0);
    expect(result3.totalFolders).toBe(0);
  });

  test('analyzeSyncStatus 应该处理无效书签对象', () => {
    const bookmarks = [
      null,
      undefined,
      'not an object',
      123,
      {},
      {
        type: 'folder',
        name: '测试文件夹',
        level: 0,
        children: [
          null,
          undefined,
          {
            type: 'link',
            title: 'Google',
            url: 'https://www.google.com',
            level: 1
          }
        ]
      }
    ];

    const result = analyzeSyncStatus(bookmarks, testSyncDir);

    expect(result.totalFolders).toBe(1);
    expect(result.totalBookmarks).toBe(1);
  });

  test('checkSyncStatus 应该处理无效路径', () => {
    const status1 = checkSyncStatus(null);
    const status2 = checkSyncStatus(undefined);
    const status3 = checkSyncStatus('');

    expect(status1.totalFolders).toBe(0);
    expect(status2.totalFolders).toBe(0);
    expect(status3.totalFolders).toBe(0);
  });

  test('checkSyncStatus 应该处理元数据中的无效书签', () => {
    const subFolder = path.join(testSyncDir, '测试文件夹');
    fs.mkdirSync(subFolder);

    const metaData = {
      folderName: '测试文件夹',
      lastSyncTime: new Date().toISOString(),
      bookmarks: [
        null,
        undefined,
        'not an object',
        {
          title: '有效书签',
          url: 'https://valid.com',
          iconFileName: '有效书签.ico',
          urlStatus: 'success',
          lastVisited: null,
          isInvalid: false,
          syncStatus: SyncStatus.COMPLETED,
          lastSyncTime: new Date().toISOString()
        },
        {
          title: '失败书签',
          url: 'https://failed.com',
          iconFileName: null,
          urlStatus: 'timeout',
          lastVisited: null,
          isInvalid: true,
          syncStatus: SyncStatus.FAILED,
          lastSyncTime: new Date().toISOString()
        }
      ],
      syncInfo: {
        syncId: 'test_123',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalBookmarks: 2,
        completedBookmarks: 1,
        failedBookmarks: 1
      }
    };

    writeMeta(path.join(subFolder, '.meta.json'), metaData);

    const status = checkSyncStatus(testSyncDir);

    expect(status.totalBookmarks).toBe(2);
    expect(status.completedBookmarks).toBe(1);
    expect(status.failedBookmarks).toBe(1);
  });
});

describe('localMirrorSync.js - SyncStatus 常量测试', () => {
  test('SyncStatus 应该包含正确的状态值', () => {
    expect(SyncStatus.PENDING).toBe('pending');
    expect(SyncStatus.IN_PROGRESS).toBe('in_progress');
    expect(SyncStatus.COMPLETED).toBe('completed');
    expect(SyncStatus.FAILED).toBe('failed');
  });
});
