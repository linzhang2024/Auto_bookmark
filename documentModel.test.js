const Document = require('./documentModel');
const User = require('./userModel');
const { initDatabase, closeDatabase, getDb, run } = require('./database');

describe('Document Model - 输入验证测试', () => {
  describe('文件名验证', () => {
    test('应该拒绝空文件名', () => {
      expect(Document.validateFilename('').valid).toBe(false);
      expect(Document.validateFilename(null).valid).toBe(false);
      expect(Document.validateFilename(undefined).valid).toBe(false);
    });

    test('应该拒绝太长的文件名', () => {
      const longFilename = 'a'.repeat(256);
      expect(Document.validateFilename(longFilename).valid).toBe(false);
    });

    test('应该接受有效的文件名', () => {
      expect(Document.validateFilename('test.pdf').valid).toBe(true);
      expect(Document.validateFilename('我的文档.docx').valid).toBe(true);
      expect(Document.validateFilename('file.with.many.dots.txt').valid).toBe(true);
    });
  });

  describe('存储路径验证', () => {
    test('应该拒绝空存储路径', () => {
      expect(Document.validateStoragePath('').valid).toBe(false);
      expect(Document.validateStoragePath(null).valid).toBe(false);
      expect(Document.validateStoragePath(undefined).valid).toBe(false);
    });

    test('应该拒绝太长的存储路径', () => {
      const longPath = 'a'.repeat(1001);
      expect(Document.validateStoragePath(longPath).valid).toBe(false);
    });

    test('应该接受有效的存储路径', () => {
      expect(Document.validateStoragePath('/uploads/test.pdf').valid).toBe(true);
      expect(Document.validateStoragePath('C:\\Documents\\test.pdf').valid).toBe(true);
      expect(Document.validateStoragePath('./files/document.docx').valid).toBe(true);
    });
  });

  describe('文件大小验证', () => {
    test('应该接受空或未定义的文件大小', () => {
      expect(Document.validateFileSize(null).valid).toBe(true);
      expect(Document.validateFileSize(undefined).valid).toBe(true);
    });

    test('应该拒绝负数文件大小', () => {
      expect(Document.validateFileSize(-1).valid).toBe(false);
      expect(Document.validateFileSize(-100).valid).toBe(false);
    });

    test('应该拒绝非整数文件大小', () => {
      expect(Document.validateFileSize(100.5).valid).toBe(false);
      expect(Document.validateFileSize('100').valid).toBe(false);
    });

    test('应该接受有效的文件大小', () => {
      expect(Document.validateFileSize(0).valid).toBe(true);
      expect(Document.validateFileSize(100).valid).toBe(true);
      expect(Document.validateFileSize(1048576).valid).toBe(true);
    });
  });

  describe('MIME 类型验证', () => {
    test('应该接受空或未定义的 MIME 类型', () => {
      expect(Document.validateMimeType(null).valid).toBe(true);
      expect(Document.validateMimeType(undefined).valid).toBe(true);
      expect(Document.validateMimeType('').valid).toBe(true);
    });

    test('应该拒绝太长的 MIME 类型', () => {
      const longMimeType = 'a'.repeat(101);
      expect(Document.validateMimeType(longMimeType).valid).toBe(false);
    });

    test('应该接受有效的 MIME 类型', () => {
      expect(Document.validateMimeType('application/pdf').valid).toBe(true);
      expect(Document.validateMimeType('image/png').valid).toBe(true);
      expect(Document.validateMimeType('text/plain').valid).toBe(true);
    });
  });

  describe('元数据验证', () => {
    test('应该接受空或未定义的元数据', () => {
      expect(Document.validateMetadata(null).valid).toBe(true);
      expect(Document.validateMetadata(undefined).valid).toBe(true);
    });

    test('应该拒绝非对象类型的元数据', () => {
      expect(Document.validateMetadata('not-object').valid).toBe(false);
      expect(Document.validateMetadata(123).valid).toBe(false);
      expect(Document.validateMetadata(['array']).valid).toBe(false);
    });

    test('应该接受有效的对象类型元数据', () => {
      expect(Document.validateMetadata({}).valid).toBe(true);
      expect(Document.validateMetadata({ key: 'value' }).valid).toBe(true);
      expect(Document.validateMetadata({ nested: { data: 'test' } }).valid).toBe(true);
    });
  });

  describe('元数据序列化和反序列化', () => {
    test('应该正确序列化元数据对象', () => {
      const metadata = {
        title: 'Test Document',
        author: 'John Doe',
        tags: ['important', 'work'],
        custom: { field: 'value' }
      };
      const serialized = Document.serializeMetadata(metadata);
      expect(typeof serialized).toBe('string');
      
      const deserialized = JSON.parse(serialized);
      expect(deserialized).toEqual(metadata);
    });

    test('应该正确反序列化元数据字符串', () => {
      const metadata = { title: 'Test', tags: ['a', 'b'] };
      const serialized = JSON.stringify(metadata);
      const deserialized = Document.deserializeMetadata(serialized);
      expect(deserialized).toEqual(metadata);
    });

    test('空或无效序列化应该返回空对象', () => {
      expect(Document.deserializeMetadata(null)).toEqual({});
      expect(Document.deserializeMetadata(undefined)).toEqual({});
      expect(Document.deserializeMetadata('invalid-json')).toEqual({});
    });
  });
});

describe('Document Model - CRUD 操作测试', () => {
  let db;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    db = await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  afterEach(async () => {
    await run('DELETE FROM documents');
    await run('DELETE FROM users');
  });

  describe('文档创建', () => {
    test('应该成功创建新文档（无上传者）', async () => {
      const documentData = {
        filename: 'test.pdf',
        storage_path: '/uploads/test.pdf',
        file_size: 1024,
        mime_type: 'application/pdf'
      };

      const doc = await Document.create(
        documentData.filename,
        documentData.storage_path,
        {
          file_size: documentData.file_size,
          mime_type: documentData.mime_type
        }
      );

      expect(doc).toBeDefined();
      expect(doc.id).toBeDefined();
      expect(doc.filename).toBe(documentData.filename);
      expect(doc.storage_path).toBe(documentData.storage_path);
      expect(doc.file_size).toBe(documentData.file_size);
      expect(doc.mime_type).toBe(documentData.mime_type);
      expect(doc.uploader_id).toBeNull();
      expect(doc.metadata).toEqual({});
      expect(doc.created_at).toBeDefined();
      expect(doc.updated_at).toBeDefined();
    });

    test('应该成功创建新文档（带上传者）', async () => {
      const user = await User.create('testuser', 'password123', 'test@example.com');
      
      const documentData = {
        filename: 'test.pdf',
        storage_path: '/uploads/test.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
        uploader_id: user.id
      };

      const doc = await Document.create(
        documentData.filename,
        documentData.storage_path,
        {
          file_size: documentData.file_size,
          mime_type: documentData.mime_type,
          uploader_id: documentData.uploader_id
        }
      );

      expect(doc).toBeDefined();
      expect(doc.uploader_id).toBe(user.id);
    });

    test('应该成功创建带元数据的文档', async () => {
      const metadata = {
        title: 'Test Document',
        author: 'John Doe',
        tags: ['important', 'work'],
        custom_field: 'custom_value'
      };

      const doc = await Document.create(
        'test.pdf',
        '/uploads/test.pdf',
        { metadata }
      );

      expect(doc.metadata).toEqual(metadata);
    });

    test('应该拒绝无效的文件名', async () => {
      await expect(
        Document.create('', '/uploads/test.pdf')
      ).rejects.toThrow('文件名不能为空');
    });

    test('应该拒绝无效的存储路径', async () => {
      await expect(
        Document.create('test.pdf', '')
      ).rejects.toThrow('存储路径不能为空');
    });

    test('应该拒绝无效的文件大小', async () => {
      await expect(
        Document.create('test.pdf', '/uploads/test.pdf', { file_size: -1 })
      ).rejects.toThrow('文件大小必须是非负整数');
    });

    test('应该拒绝不存在的上传者', async () => {
      await expect(
        Document.create('test.pdf', '/uploads/test.pdf', { uploader_id: 999999 })
      ).rejects.toThrow('上传者不存在');
    });

    test('应该拒绝无效的元数据类型', async () => {
      await expect(
        Document.create('test.pdf', '/uploads/test.pdf', { metadata: ['not', 'object'] })
      ).rejects.toThrow('元数据必须是对象类型');
    });
  });

  describe('文档查询', () => {
    test('应该通过 ID 找到文档', async () => {
      const doc = await Document.create('test.pdf', '/uploads/test.pdf');
      const foundDoc = await Document.findById(doc.id);
      
      expect(foundDoc).not.toBeNull();
      expect(foundDoc.id).toBe(doc.id);
      expect(foundDoc.filename).toBe(doc.filename);
    });

    test('通过不存在的 ID 查找应该返回 null', async () => {
      const foundDoc = await Document.findById(999999);
      expect(foundDoc).toBeNull();
    });

    test('应该通过上传者 ID 查找文档', async () => {
      const user = await User.create('testuser', 'password123', 'test@example.com');
      
      await Document.create('doc1.pdf', '/uploads/doc1.pdf', { uploader_id: user.id });
      await Document.create('doc2.pdf', '/uploads/doc2.pdf', { uploader_id: user.id });
      await Document.create('other.pdf', '/uploads/other.pdf');

      const userDocs = await Document.findByUploaderId(user.id);
      expect(userDocs.length).toBe(2);
      
      const noUploaderDocs = await Document.findByUploaderId(null);
      expect(noUploaderDocs).toEqual([]);
    });

    test('应该通过文件名查找文档', async () => {
      await Document.create('test.pdf', '/uploads/test1.pdf');
      await Document.create('test.pdf', '/uploads/test2.pdf');
      await Document.create('other.pdf', '/uploads/other.pdf');

      const docs = await Document.findByFilename('test.pdf');
      expect(docs.length).toBe(2);
    });

    test('应该列出所有文档', async () => {
      const allDocs = await Document.listAll();
      expect(allDocs).toEqual([]);

      await Document.create('doc1.pdf', '/uploads/doc1.pdf');
      await Document.create('doc2.pdf', '/uploads/doc2.pdf');

      const docs = await Document.listAll();
      expect(docs.length).toBe(2);
    });

    test('toJSON 方法应该返回正确的对象', async () => {
      const metadata = { title: 'Test' };
      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { metadata });

      const docJson = doc.toJSON();
      
      expect(docJson.id).toBe(doc.id);
      expect(docJson.filename).toBe(doc.filename);
      expect(docJson.storage_path).toBe(doc.storage_path);
      expect(docJson.metadata).toEqual(metadata);
      expect(docJson.created_at).toBeDefined();
    });
  });

  describe('文档信息更新', () => {
    test('应该成功更新文档信息', async () => {
      const doc = await Document.create('old.pdf', '/uploads/old.pdf', {
        file_size: 100,
        mime_type: 'text/plain',
        metadata: { old: 'data' }
      });

      const updates = {
        filename: 'new.pdf',
        storage_path: '/uploads/new.pdf',
        file_size: 200,
        mime_type: 'application/pdf',
        metadata: { new: 'data' }
      };

      const updatedDoc = await Document.update(doc.id, updates);
      
      expect(updatedDoc.filename).toBe(updates.filename);
      expect(updatedDoc.storage_path).toBe(updates.storage_path);
      expect(updatedDoc.file_size).toBe(updates.file_size);
      expect(updatedDoc.mime_type).toBe(updates.mime_type);
      expect(updatedDoc.metadata).toEqual(updates.metadata);
    });

    test('应该成功更新上传者', async () => {
      const user = await User.create('testuser', 'password123', 'test@example.com');
      const doc = await Document.create('test.pdf', '/uploads/test.pdf');

      const updatedDoc = await Document.update(doc.id, { uploader_id: user.id });
      expect(updatedDoc.uploader_id).toBe(user.id);
    });

    test('更新不存在的文档应该抛出错误', async () => {
      await expect(
        Document.update(999999, { filename: 'test.pdf' })
      ).rejects.toThrow('文档不存在');
    });

    test('没有提供更新字段时应该返回原文档', async () => {
      const doc = await Document.create('test.pdf', '/uploads/test.pdf');
      const updatedDoc = await Document.update(doc.id, {});
      
      expect(updatedDoc.id).toBe(doc.id);
      expect(updatedDoc.filename).toBe(doc.filename);
    });
  });

  describe('文档删除', () => {
    test('应该成功删除文档', async () => {
      const doc = await Document.create('test.pdf', '/uploads/test.pdf');
      
      const result = await Document.delete(doc.id);
      expect(result).toBe(true);

      const foundDoc = await Document.findById(doc.id);
      expect(foundDoc).toBeNull();
    });

    test('删除不存在的文档应该抛出错误', async () => {
      await expect(
        Document.delete(999999)
      ).rejects.toThrow('文档不存在');
    });
  });
});

describe('Document Model - 跨表查询与关联测试', () => {
  const { initDatabase, closeDatabase, run } = require('./database');
  let db;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    db = await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  afterEach(async () => {
    await run('DELETE FROM documents');
    await run('DELETE FROM users');
  });

  describe('查询文档并关联上传者信息', () => {
    test('findByIdWithUploader 应该返回带上传者信息的文档', async () => {
      const user = await User.create('testuser', 'password123', 'test@example.com');
      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { uploader_id: user.id });

      const docWithUploader = await Document.findByIdWithUploader(doc.id);
      
      expect(docWithUploader).not.toBeNull();
      expect(docWithUploader._uploader).not.toBeNull();
      expect(docWithUploader._uploader.id).toBe(user.id);
      expect(docWithUploader._uploader.username).toBe(user.username);
      expect(docWithUploader._uploader.email).toBe(user.email);
    });

    test('listAllWithUploader 应该返回所有带上传者信息的文档', async () => {
      const user1 = await User.create('user1', 'password123', 'user1@example.com');
      const user2 = await User.create('user2', 'password123', 'user2@example.com');
      
      await Document.create('doc1.pdf', '/uploads/doc1.pdf', { uploader_id: user1.id });
      await Document.create('doc2.pdf', '/uploads/doc2.pdf', { uploader_id: user2.id });
      await Document.create('no_uploader.pdf', '/uploads/no_uploader.pdf');

      const allDocs = await Document.listAllWithUploader();
      expect(allDocs.length).toBe(3);

      const doc1 = allDocs.find(d => d.filename === 'doc1.pdf');
      const doc2 = allDocs.find(d => d.filename === 'doc2.pdf');
      const docNoUploader = allDocs.find(d => d.filename === 'no_uploader.pdf');

      expect(doc1._uploader.username).toBe('user1');
      expect(doc2._uploader.username).toBe('user2');
      expect(docNoUploader._uploader).toBeNull();
    });

    test('getUploader 实例方法应该获取上传者信息', async () => {
      const user = await User.create('testuser', 'password123', 'test@example.com');
      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { uploader_id: user.id });

      const uploader = await doc.getUploader();
      
      expect(uploader).not.toBeNull();
      expect(uploader.id).toBe(user.id);
      expect(uploader.username).toBe(user.username);
      expect(uploader.email).toBe(user.email);
    });

    test('没有上传者的文档应该返回 null', async () => {
      const doc = await Document.create('test.pdf', '/uploads/test.pdf');
      
      const uploader = await doc.getUploader();
      expect(uploader).toBeNull();
    });

    test('toJSON 方法应该包含上传者信息（如果已加载）', async () => {
      const user = await User.create('testuser', 'password123', 'test@example.com');
      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { uploader_id: user.id });

      const docWithUploader = await Document.findByIdWithUploader(doc.id);
      const json = docWithUploader.toJSON();
      
      expect(json.uploader).toBeDefined();
      expect(json.uploader.id).toBe(user.id);
      expect(json.uploader.username).toBe(user.username);
    });
  });
});

describe('Document Model - JSON 元数据读写测试', () => {
  const { initDatabase, closeDatabase, run } = require('./database');
  let db;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    db = await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  afterEach(async () => {
    await run('DELETE FROM documents');
  });

  describe('元数据存储和读取', () => {
    test('应该正确存储和读取简单元数据', async () => {
      const metadata = {
        title: 'Test Document',
        author: 'John Doe',
        version: 1,
        is_active: true
      };

      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { metadata });
      const foundDoc = await Document.findById(doc.id);

      expect(foundDoc.metadata).toEqual(metadata);
      expect(foundDoc.metadata.title).toBe('Test Document');
      expect(foundDoc.metadata.author).toBe('John Doe');
      expect(foundDoc.metadata.version).toBe(1);
      expect(foundDoc.metadata.is_active).toBe(true);
    });

    test('应该正确存储和读取嵌套元数据', async () => {
      const metadata = {
        document_info: {
          title: 'Test',
          author: {
            name: 'John Doe',
            email: 'john@example.com'
          }
        },
        tags: ['important', 'work', 'review'],
        custom: {
          nested: {
            deep: {
              value: 'test'
            }
          }
        }
      };

      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { metadata });
      const foundDoc = await Document.findById(doc.id);

      expect(foundDoc.metadata).toEqual(metadata);
      expect(foundDoc.metadata.document_info.author.name).toBe('John Doe');
      expect(foundDoc.metadata.tags).toEqual(['important', 'work', 'review']);
      expect(foundDoc.metadata.custom.nested.deep.value).toBe('test');
    });

    test('应该正确存储和读取空元数据', async () => {
      const doc1 = await Document.create('test1.pdf', '/uploads/test1.pdf');
      const doc2 = await Document.create('test2.pdf', '/uploads/test2.pdf', { metadata: {} });
      const doc3 = await Document.create('test3.pdf', '/uploads/test3.pdf', { metadata: null });

      expect(doc1.metadata).toEqual({});
      expect(doc2.metadata).toEqual({});
      expect(doc3.metadata).toEqual({});
    });

    test('应该正确更新元数据', async () => {
      const initialMetadata = {
        title: 'Initial Title',
        version: 1
      };

      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { metadata: initialMetadata });

      const updatedMetadata = {
        title: 'Updated Title',
        version: 2,
        new_field: 'new value'
      };

      const updatedDoc = await Document.update(doc.id, { metadata: updatedMetadata });
      const foundDoc = await Document.findById(doc.id);

      expect(updatedDoc.metadata).toEqual(updatedMetadata);
      expect(foundDoc.metadata).toEqual(updatedMetadata);
      expect(foundDoc.metadata.title).toBe('Updated Title');
      expect(foundDoc.metadata.version).toBe(2);
      expect(foundDoc.metadata.new_field).toBe('new value');
    });

    test('元数据应该正确支持书签属性（按需求预留）', async () => {
      const bookmarkMetadata = {
        title: 'Bookmark Collection',
        description: 'A collection of important bookmarks',
        bookmarks: [
          {
            url: 'https://example.com',
            title: 'Example Website',
            added_at: '2024-01-01',
            tags: ['example', 'important']
          },
          {
            url: 'https://google.com',
            title: 'Google',
            added_at: '2024-01-02',
            tags: ['search']
          }
        ],
        statistics: {
          total_bookmarks: 2,
          total_folders: 0,
          last_import: '2024-01-02'
        },
        source: {
          browser: 'Chrome',
          version: '120.0',
          export_date: '2024-01-01'
        }
      };

      const doc = await Document.create('bookmarks.html', '/uploads/bookmarks.html', {
        metadata: bookmarkMetadata
      });

      const foundDoc = await Document.findById(doc.id);

      expect(foundDoc.metadata).toEqual(bookmarkMetadata);
      expect(foundDoc.metadata.bookmarks.length).toBe(2);
      expect(foundDoc.metadata.bookmarks[0].url).toBe('https://example.com');
      expect(foundDoc.metadata.statistics.total_bookmarks).toBe(2);
      expect(foundDoc.metadata.source.browser).toBe('Chrome');
    });
  });

  describe('元数据序列化边界情况', () => {
    test('应该正确处理特殊字符', async () => {
      const metadata = {
        title: 'Document with "quotes" and \'apostrophes\'',
        description: 'Contains <html> tags & special chars',
        json_string: '{"key":"value"}'
      };

      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { metadata });
      const foundDoc = await Document.findById(doc.id);

      expect(foundDoc.metadata).toEqual(metadata);
    });

    test('应该正确处理大尺寸元数据', async () => {
      const largeTags = Array.from({ length: 100 }, (_, i) => `tag_${i}`);
      const metadata = {
        title: 'Large Metadata Test',
        tags: largeTags,
        data: Array.from({ length: 50 }, (_, i) => ({
          id: i,
          name: `item_${i}`,
          value: `This is a long value for item ${i} that contains many characters.`
        }))
      };

      const doc = await Document.create('test.pdf', '/uploads/test.pdf', { metadata });
      const foundDoc = await Document.findById(doc.id);

      expect(foundDoc.metadata).toEqual(metadata);
      expect(foundDoc.metadata.tags.length).toBe(100);
      expect(foundDoc.metadata.data.length).toBe(50);
    });
  });
});
