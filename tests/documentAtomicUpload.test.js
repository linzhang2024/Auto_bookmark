const fs = require('fs');
const path = require('path');
const Document = require('../src/models/documentModel');
const User = require('../src/models/userModel');
const Role = require('../src/models/roleModel');
const { AuthMiddleware } = require('../src/services/authMiddleware');
const { initDatabase, closeDatabase, run, DocumentStatus } = require('../src/services/database');

const TEST_UPLOAD_DIR = path.join(__dirname, 'test_uploads_atomic');

describe('Document Model - 原子化上传与事务测试', () => {
  let db;
  let testUser;
  let adminUser;
  let docEditorRole;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    db = await initDatabase();
    
    let existingRole = await Role.findByName('doc_editor_test');
    if (existingRole) {
      docEditorRole = existingRole;
    } else {
      docEditorRole = await Role.create(
        'doc_editor_test',
        '文档编辑测试角色',
        ['doc:create', 'doc:read', 'doc:write']
      );
    }
    
    const adminRole = await Role.findByName('admin');
    
    let existingTestUser = await User.findByUsername('test_upload_user');
    if (existingTestUser) {
      testUser = existingTestUser;
    } else {
      testUser = await User.create(
        'test_upload_user',
        'password123',
        'upload@example.com',
        docEditorRole.id
      );
    }
    
    let existingAdminUser = await User.findByUsername('admin_upload_user');
    if (existingAdminUser) {
      adminUser = existingAdminUser;
    } else {
      adminUser = await User.create(
        'admin_upload_user',
        'password123',
        'adminupload@example.com',
        adminRole.id
      );
    }

    if (!fs.existsSync(TEST_UPLOAD_DIR)) {
      fs.mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    if (fs.existsSync(TEST_UPLOAD_DIR)) {
      const files = fs.readdirSync(TEST_UPLOAD_DIR);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(TEST_UPLOAD_DIR, file));
        } catch {}
      }
      try {
        fs.rmdirSync(TEST_UPLOAD_DIR);
      } catch {}
    }
    await closeDatabase();
  });

  function deleteDirectoryRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          deleteDirectoryRecursive(fullPath);
        } else {
          fs.unlinkSync(fullPath);
        }
      }
    }
  }

  afterEach(async () => {
    await run('DELETE FROM documents');
    if (fs.existsSync(TEST_UPLOAD_DIR)) {
      deleteDirectoryRecursive(TEST_UPLOAD_DIR);
      try {
        fs.rmdirSync(TEST_UPLOAD_DIR);
      } catch {}
    }
  });

  describe('场景1: 状态管理基础功能', () => {
    test('文档创建时默认状态应该是 pending', async () => {
      const doc = await Document.create('test.pdf', '/uploads/test.pdf', {
        uploader_id: testUser.id
      });

      expect(doc.status).toBe(DocumentStatus.PENDING);
      expect(doc.isPending()).toBe(true);
      expect(doc.isReady()).toBe(false);
      expect(doc.isFailed()).toBe(false);
    });

    test('应该能够将状态更新为 ready', async () => {
      const doc = await Document.create('test.pdf', '/uploads/test.pdf', {
        uploader_id: testUser.id
      });

      const updatedDoc = await Document.markAsReady(doc.id, { processed: true });

      expect(updatedDoc.status).toBe(DocumentStatus.READY);
      expect(updatedDoc.isReady()).toBe(true);
      expect(updatedDoc.metadata.processed).toBe(true);
    });

    test('应该能够将状态更新为 failed', async () => {
      const doc = await Document.create('test.pdf', '/uploads/test.pdf', {
        uploader_id: testUser.id
      });

      const errorMsg = '文件写入失败';
      const updatedDoc = await Document.markAsFailed(doc.id, errorMsg);

      expect(updatedDoc.status).toBe(DocumentStatus.FAILED);
      expect(updatedDoc.isFailed()).toBe(true);
      expect(updatedDoc.metadata.error).toBe(errorMsg);
      expect(updatedDoc.metadata.failed_at).toBeDefined();
    });

    test('findByStatus 应该按状态查询文档', async () => {
      await Document.create('doc1.pdf', '/uploads/doc1.pdf', {
        uploader_id: testUser.id,
        status: DocumentStatus.PENDING
      });
      await Document.create('doc2.pdf', '/uploads/doc2.pdf', {
        uploader_id: testUser.id,
        status: DocumentStatus.READY
      });
      await Document.create('doc3.pdf', '/uploads/doc3.pdf', {
        uploader_id: testUser.id,
        status: DocumentStatus.FAILED
      });

      const pendingDocs = await Document.findByStatus(DocumentStatus.PENDING);
      const readyDocs = await Document.findByStatus(DocumentStatus.READY);
      const failedDocs = await Document.findByStatus(DocumentStatus.FAILED);

      expect(pendingDocs.length).toBe(1);
      expect(readyDocs.length).toBe(1);
      expect(failedDocs.length).toBe(1);
    });
  });

  describe('场景2: 原子化上传正常流程', () => {
    test('atomicUpload 应该成功上传文件并更新状态为 ready', async () => {
      const testContent = 'This is a test document content';
      const testBuffer = Buffer.from(testContent, 'utf-8');

      const result = await Document.atomicUpload({
        filename: 'test.txt',
        fileBuffer: testBuffer,
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id,
        metadata: { source: 'test' }
      });

      expect(result.success).toBe(true);
      expect(result.document).toBeDefined();
      expect(result.document.status).toBe(DocumentStatus.READY);
      expect(result.document.owner_id).toBe(testUser.id);
      expect(result.document.uploader_id).toBe(testUser.id);
      expect(result.document.file_size).toBe(testBuffer.length);
      expect(result.document.mime_type).toBe('text/plain');
      expect(result.document.metadata.source).toBe('test');
      expect(result.document.metadata.upload_completed_at).toBeDefined();

      expect(fs.existsSync(result.document.storage_path)).toBe(true);
      const savedContent = fs.readFileSync(result.document.storage_path, 'utf-8');
      expect(savedContent).toBe(testContent);
    });

    test('atomicUpload 应该正确解析不同文件类型的 MIME 类型', async () => {
      const testBuffer = Buffer.from('PDF content mock');

      const resultPdf = await Document.atomicUpload({
        filename: 'document.pdf',
        fileBuffer: testBuffer,
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(resultPdf.document.mime_type).toBe('application/pdf');

      const resultHtml = await Document.atomicUpload({
        filename: 'page.html',
        fileBuffer: testBuffer,
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(resultHtml.document.mime_type).toBe('text/html');

      const resultPng = await Document.atomicUpload({
        filename: 'image.png',
        fileBuffer: testBuffer,
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(resultPng.document.mime_type).toBe('image/png');
    });

    test('createPending 应该创建 pending 状态的文档', async () => {
      const doc = await Document.createPending('pending.pdf', '/uploads/pending.pdf', {
        uploader_id: testUser.id
      });

      expect(doc.status).toBe(DocumentStatus.PENDING);
    });
  });

  describe('场景3: 原子化上传异常处理与回滚', () => {
    test('atomicUpload 在文件写入失败时应该标记失败', async () => {
      const originalWriteFileSync = fs.writeFileSync;
      
      try {
        const testBuffer = Buffer.from('test content');
        
        let callCount = 0;
        fs.writeFileSync = function(filePath, data) {
          callCount++;
          if (callCount === 1) {
            throw new Error('模拟文件系统写入失败');
          }
          return originalWriteFileSync(filePath, data);
        };

        await expect(
          Document.atomicUpload({
            filename: 'fail_test.txt',
            fileBuffer: testBuffer,
            storageDir: TEST_UPLOAD_DIR,
            uploader_id: testUser.id
          })
        ).rejects.toThrow('模拟文件系统写入失败');

        const docs = await Document.listAll();
        expect(docs.length).toBe(1);
        expect(docs[0].status).toBe(DocumentStatus.FAILED);
        expect(docs[0].metadata.error).toBe('模拟文件系统写入失败');

        const files = fs.readdirSync(TEST_UPLOAD_DIR);
        expect(files.length).toBe(0);

      } finally {
        fs.writeFileSync = originalWriteFileSync;
      }
    });
  });

  describe('场景4: 权限中间件测试', () => {
    test('自定义角色应该有 doc:write 权限', async () => {
      expect(docEditorRole.hasPermission('doc:write')).toBe(true);
    });

    test('admin 角色应该有 admin:access 权限', async () => {
      const adminRole = await Role.findByName('admin');
      expect(adminRole.hasPermission('admin:access')).toBe(true);
    });

    test('hasPermission 应该正确检查权限', async () => {
      expect(docEditorRole.hasPermission('doc:write')).toBe(true);
      expect(docEditorRole.hasPermission('doc:delete')).toBe(false);
    });

    test('hasAnyPermission 应该检查任一权限', async () => {
      expect(docEditorRole.hasAnyPermission(['doc:read', 'doc:write'])).toBe(true);
      expect(docEditorRole.hasAnyPermission(['nonexistent:perm', 'another:none'])).toBe(false);
    });

    test('hasAllPermissions 应该检查所有权限', async () => {
      expect(docEditorRole.hasAllPermissions(['doc:read', 'doc:write'])).toBe(true);
      expect(docEditorRole.hasAllPermissions(['doc:read', 'doc:delete'])).toBe(false);
    });
  });

  describe('场景5: 文档修改权限测试（所有者或管理员二选一）', () => {
    test('文档所有者应该可以修改自己的文档', async () => {
      const result = await Document.atomicUpload({
        filename: 'owner_doc.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      const canModify = await AuthMiddleware.canModifyDocument(testUser.id, result.document);
      expect(canModify).toBe(true);
    });

    test('管理员应该可以修改任何文档', async () => {
      const result = await Document.atomicUpload({
        filename: 'admin_doc.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      const canModify = await AuthMiddleware.canModifyDocument(adminUser.id, result.document);
      expect(canModify).toBe(true);
    });

    test('非所有者且非管理员不应该可以修改文档', async () => {
      let otherUser = await User.findByUsername('other_user');
      if (!otherUser) {
        otherUser = await User.create(
          'other_user',
          'password123',
          'other@example.com',
          docEditorRole.id
        );
      }

      const result = await Document.atomicUpload({
        filename: 'other_doc.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      const canModify = await AuthMiddleware.canModifyDocument(otherUser.id, result.document);
      expect(canModify).toBe(false);
    });

    test('canModifyDocumentById 应该通过 ID 检查权限', async () => {
      const result = await Document.atomicUpload({
        filename: 'by_id_doc.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      const ownerCanModify = await AuthMiddleware.canModifyDocumentById(testUser.id, result.document.id);
      const adminCanModify = await AuthMiddleware.canModifyDocumentById(adminUser.id, result.document.id);

      expect(ownerCanModify).toBe(true);
      expect(adminCanModify).toBe(true);
    });

    test('getDocumentPermissions 应该返回完整权限信息', async () => {
      const result = await Document.atomicUpload({
        filename: 'perm_doc.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      const ownerPerms = await AuthMiddleware.getDocumentPermissions(testUser.id, result.document);
      const adminPerms = await AuthMiddleware.getDocumentPermissions(adminUser.id, result.document);

      expect(ownerPerms.isOwner).toBe(true);
      expect(ownerPerms.isAdmin).toBe(false);
      expect(ownerPerms.read).toBe(true);
      expect(ownerPerms.update).toBe(true);
      expect(ownerPerms.delete).toBe(true);

      expect(adminPerms.isOwner).toBe(false);
      expect(adminPerms.isAdmin).toBe(true);
    });
  });

  describe('场景6: owner_id 和 uploader_id 字段测试', () => {
    test('文档应该正确设置 owner_id 和 uploader_id', async () => {
      const result = await Document.atomicUpload({
        filename: 'owner_uploader.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(result.document.owner_id).toBe(testUser.id);
      expect(result.document.uploader_id).toBe(testUser.id);
    });

    test('应该支持指定不同的 owner_id', async () => {
      const result = await Document.atomicUpload({
        filename: 'different_owner.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id,
        owner_id: adminUser.id
      });

      expect(result.document.owner_id).toBe(adminUser.id);
      expect(result.document.uploader_id).toBe(testUser.id);
    });

    test('findByOwnerId 应该按所有者查询文档', async () => {
      await Document.atomicUpload({
        filename: 'owner1.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id,
        owner_id: adminUser.id
      });

      await Document.atomicUpload({
        filename: 'owner2.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      const adminDocs = await Document.findByOwnerId(adminUser.id);
      const userDocs = await Document.findByOwnerId(testUser.id);

      expect(adminDocs.length).toBe(1);
      expect(userDocs.length).toBe(1);
    });
  });

  describe('场景7: safeDelete 测试', () => {
    test('safeDelete 应该同时删除数据库记录和物理文件', async () => {
      const result = await Document.atomicUpload({
        filename: 'delete_test.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(fs.existsSync(result.document.storage_path)).toBe(true);

      await Document.safeDelete(result.document.id);

      const foundDoc = await Document.findById(result.document.id);
      expect(foundDoc).toBeNull();
      expect(fs.existsSync(result.document.storage_path)).toBe(false);
    });

    test('safeDelete 在文件不存在时也应该能删除数据库记录', async () => {
      const doc = await Document.create('orphan.txt', '/nonexistent/path.txt', {
        uploader_id: testUser.id
      });

      await Document.safeDelete(doc.id);

      const foundDoc = await Document.findById(doc.id);
      expect(foundDoc).toBeNull();
    });
  });

  describe('场景8: 数据一致性验证', () => {
    test('所有 ready 状态的文档都应该有对应的物理文件', async () => {
      await Document.atomicUpload({
        filename: 'consistent1.txt',
        fileBuffer: Buffer.from('content1'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      await Document.atomicUpload({
        filename: 'consistent2.txt',
        fileBuffer: Buffer.from('content2'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      const readyDocs = await Document.findByStatus(DocumentStatus.READY);
      
      for (const doc of readyDocs) {
        expect(doc.fileExists()).toBe(true);
        expect(fs.existsSync(doc.storage_path)).toBe(true);
      }
    });

    test('failed 状态的文档不应该有残留的物理文件', async () => {
      const originalWriteFileSync = fs.writeFileSync;
      
      try {
        const testBuffer = Buffer.from('test content');
        
        let callCount = 0;
        fs.writeFileSync = function(filePath, data) {
          callCount++;
          if (callCount === 1) {
            throw new Error('模拟文件系统写入失败');
          }
          return originalWriteFileSync(filePath, data);
        };

        await expect(
          Document.atomicUpload({
            filename: 'consistency_test.txt',
            fileBuffer: testBuffer,
            storageDir: TEST_UPLOAD_DIR,
            uploader_id: testUser.id
          })
        ).rejects.toThrow('模拟文件系统写入失败');

        const failedDocs = await Document.findByStatus(DocumentStatus.FAILED);
        expect(failedDocs.length).toBe(1);
        expect(failedDocs[0].status).toBe(DocumentStatus.FAILED);

        const files = fs.readdirSync(TEST_UPLOAD_DIR);
        expect(files.length).toBe(0);

      } finally {
        fs.writeFileSync = originalWriteFileSync;
      }
    });
  });

  describe('场景9: 实例方法测试', () => {
    test('isOwner 应该正确判断所有者', async () => {
      const result = await Document.atomicUpload({
        filename: 'owner_check.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(result.document.isOwner(testUser.id)).toBe(true);
      expect(result.document.isOwner(adminUser.id)).toBe(false);
    });

    test('isUploader 应该正确判断上传者', async () => {
      const result = await Document.atomicUpload({
        filename: 'uploader_check.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(result.document.isUploader(testUser.id)).toBe(true);
      expect(result.document.isUploader(adminUser.id)).toBe(false);
    });

    test('canModify 应该正确判断可修改性', async () => {
      const result = await Document.atomicUpload({
        filename: 'modify_check.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(result.document.canModify(testUser.id)).toBe(true);
      expect(result.document.canModify(adminUser.id)).toBe(false);
    });

    test('fileExists 应该正确检查物理文件是否存在', async () => {
      const result = await Document.atomicUpload({
        filename: 'exists_check.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id
      });

      expect(result.document.fileExists()).toBe(true);

      fs.unlinkSync(result.document.storage_path);
      
      expect(result.document.fileExists()).toBe(false);
    });

    test('toJSON 应该返回正确的对象结构', async () => {
      const result = await Document.atomicUpload({
        filename: 'json_test.txt',
        fileBuffer: Buffer.from('content'),
        storageDir: TEST_UPLOAD_DIR,
        uploader_id: testUser.id,
        metadata: { custom: 'value' }
      });

      const json = result.document.toJSON();
      
      expect(json.id).toBeDefined();
      expect(json.filename).toBe('json_test.txt');
      expect(json.status).toBe(DocumentStatus.READY);
      expect(json.owner_id).toBe(testUser.id);
      expect(json.uploader_id).toBe(testUser.id);
      expect(json.metadata.custom).toBe('value');
      expect(json.created_at).toBeDefined();
      expect(json.updated_at).toBeDefined();
    });
  });
});
