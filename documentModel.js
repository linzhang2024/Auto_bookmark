const fs = require('fs');
const path = require('path');
const db = require('./database');
const User = require('./userModel');
const { DocumentStatus } = require('./database');

const VALID_STATUSES = new Set([
  DocumentStatus.PENDING,
  DocumentStatus.PROCESSING,
  DocumentStatus.READY,
  DocumentStatus.FAILED
]);

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac'
};

class Document {
  constructor(id, filename, storage_path, file_size, mime_type, uploader_id, owner_id, status, metadata, created_at, updated_at) {
    this.id = id;
    this.filename = filename;
    this.storage_path = storage_path;
    this.file_size = file_size || 0;
    this.mime_type = mime_type || '';
    this.uploader_id = uploader_id;
    this.owner_id = owner_id;
    this.status = status || DocumentStatus.PENDING;
    this.metadata = metadata || {};
    this.created_at = created_at;
    this.updated_at = updated_at;
    this._uploader = null;
    this._owner = null;
  }

  static validateStatus(status) {
    if (status === null || status === undefined) {
      return { valid: true };
    }
    if (typeof status !== 'string') {
      return { valid: false, message: '状态必须是字符串类型' };
    }
    if (!VALID_STATUSES.has(status)) {
      return { valid: false, message: `无效的状态值: ${status}` };
    }
    return { valid: true };
  }

  static validateOwnerId(owner_id) {
    if (owner_id === null || owner_id === undefined) {
      return { valid: true };
    }
    if (typeof owner_id !== 'number' || !Number.isInteger(owner_id) || owner_id <= 0) {
      return { valid: false, message: '所有者 ID 必须是正整数' };
    }
    return { valid: true };
  }

  static validateFilename(filename) {
    if (!filename || typeof filename !== 'string') {
      return { valid: false, message: '文件名不能为空' };
    }
    if (filename.length === 0) {
      return { valid: false, message: '文件名不能为空' };
    }
    if (filename.length > 255) {
      return { valid: false, message: '文件名最多 255 个字符' };
    }
    return { valid: true };
  }

  static validateStoragePath(storage_path) {
    if (!storage_path || typeof storage_path !== 'string') {
      return { valid: false, message: '存储路径不能为空' };
    }
    if (storage_path.length === 0) {
      return { valid: false, message: '存储路径不能为空' };
    }
    if (storage_path.length > 1000) {
      return { valid: false, message: '存储路径最多 1000 个字符' };
    }
    return { valid: true };
  }

  static validateFileSize(file_size) {
    if (file_size === null || file_size === undefined) {
      return { valid: true };
    }
    if (typeof file_size !== 'number' || !Number.isInteger(file_size) || file_size < 0) {
      return { valid: false, message: '文件大小必须是非负整数' };
    }
    return { valid: true };
  }

  static validateMimeType(mime_type) {
    if (mime_type === null || mime_type === undefined || mime_type === '') {
      return { valid: true };
    }
    if (typeof mime_type !== 'string') {
      return { valid: false, message: 'MIME 类型必须是字符串' };
    }
    if (mime_type.length > 100) {
      return { valid: false, message: 'MIME 类型最多 100 个字符' };
    }
    return { valid: true };
  }

  static async validateUploaderId(uploader_id) {
    if (uploader_id === null || uploader_id === undefined) {
      return { valid: true };
    }
    if (typeof uploader_id !== 'number' || !Number.isInteger(uploader_id) || uploader_id <= 0) {
      return { valid: false, message: '上传者 ID 必须是正整数' };
    }
    const user = await User.findById(uploader_id);
    if (!user) {
      return { valid: false, message: '上传者不存在' };
    }
    return { valid: true };
  }

  static validateMetadata(metadata) {
    if (metadata === null || metadata === undefined) {
      return { valid: true };
    }
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
      return { valid: false, message: '元数据必须是对象类型' };
    }
    return { valid: true };
  }

  static serializeMetadata(metadata) {
    if (!metadata) {
      return '{}';
    }
    return JSON.stringify(metadata);
  }

  static deserializeMetadata(metadataStr) {
    if (!metadataStr) {
      return {};
    }
    try {
      return JSON.parse(metadataStr);
    } catch (err) {
      return {};
    }
  }

  static getMimeTypeFromFilename(filename) {
    const ext = path.extname(filename).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
  }

  static getFileSize(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch (err) {
      return 0;
    }
  }

  static parseFileMetadata(filePath, filename) {
    const metadata = {
      file_size: 0,
      mime_type: 'application/octet-stream',
      extension: '',
      original_name: filename
    };

    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        metadata.file_size = stats.size;
        metadata.created_at = stats.birthtime?.toISOString();
        metadata.modified_at = stats.mtime?.toISOString();
      }
    } catch (err) {
      
    }

    if (filename) {
      metadata.extension = path.extname(filename).toLowerCase();
      metadata.mime_type = Document.getMimeTypeFromFilename(filename);
      metadata.basename = path.basename(filename, metadata.extension);
    }

    return metadata;
  }

  static fromRow(row) {
    return new Document(
      row.id,
      row.filename,
      row.storage_path,
      row.file_size,
      row.mime_type,
      row.uploader_id,
      row.owner_id,
      row.status,
      Document.deserializeMetadata(row.metadata),
      row.created_at,
      row.updated_at
    );
  }

  isPending() {
    return this.status === DocumentStatus.PENDING;
  }

  isReady() {
    return this.status === DocumentStatus.READY;
  }

  isFailed() {
    return this.status === DocumentStatus.FAILED;
  }

  isOwner(userId) {
    return this.owner_id === userId;
  }

  isUploader(userId) {
    return this.uploader_id === userId;
  }

  canModify(userId) {
    return this.isOwner(userId) || this.isUploader(userId);
  }

  static async create(filename, storage_path, options = {}) {
    const filenameValidation = Document.validateFilename(filename);
    if (!filenameValidation.valid) {
      throw new Error(filenameValidation.message);
    }

    const storagePathValidation = Document.validateStoragePath(storage_path);
    if (!storagePathValidation.valid) {
      throw new Error(storagePathValidation.message);
    }

    const { 
      file_size = 0, 
      mime_type = '', 
      uploader_id = null, 
      owner_id = null,
      status = DocumentStatus.PENDING,
      metadata = {} 
    } = options;

    const fileSizeValidation = Document.validateFileSize(file_size);
    if (!fileSizeValidation.valid) {
      throw new Error(fileSizeValidation.message);
    }

    const mimeTypeValidation = Document.validateMimeType(mime_type);
    if (!mimeTypeValidation.valid) {
      throw new Error(mimeTypeValidation.message);
    }

    const statusValidation = Document.validateStatus(status);
    if (!statusValidation.valid) {
      throw new Error(statusValidation.message);
    }

    const ownerIdValidation = Document.validateOwnerId(owner_id);
    if (!ownerIdValidation.valid) {
      throw new Error(ownerIdValidation.message);
    }

    const uploaderIdValidation = await Document.validateUploaderId(uploader_id);
    if (!uploaderIdValidation.valid) {
      throw new Error(uploaderIdValidation.message);
    }

    const metadataValidation = Document.validateMetadata(metadata);
    if (!metadataValidation.valid) {
      throw new Error(metadataValidation.message);
    }

    const serializedMetadata = Document.serializeMetadata(metadata);

    const result = await db.run(
      `INSERT INTO documents (filename, storage_path, file_size, mime_type, uploader_id, owner_id, status, metadata) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [filename, storage_path, file_size, mime_type, uploader_id, owner_id, status, serializedMetadata]
    );

    return Document.findById(result.lastID);
  }

  static async createPending(filename, storage_path, options = {}) {
    return Document.create(filename, storage_path, {
      ...options,
      status: DocumentStatus.PENDING
    });
  }

  static async updateStatus(id, status, options = {}) {
    const statusValidation = Document.validateStatus(status);
    if (!statusValidation.valid) {
      throw new Error(statusValidation.message);
    }

    const document = await Document.findById(id);
    if (!document) {
      throw new Error('文档不存在');
    }

    const updates = { status };
    if (options.metadata !== undefined) {
      updates.metadata = options.metadata;
    }
    if (options.file_size !== undefined) {
      updates.file_size = options.file_size;
    }
    if (options.mime_type !== undefined) {
      updates.mime_type = options.mime_type;
    }

    return Document.update(id, updates);
  }

  static async markAsReady(id, metadata = {}) {
    return Document.updateStatus(id, DocumentStatus.READY, { metadata });
  }

  static async markAsFailed(id, errorMessage = '') {
    const metadata = {
      error: errorMessage,
      failed_at: new Date().toISOString()
    };
    return Document.updateStatus(id, DocumentStatus.FAILED, { metadata });
  }

  static async atomicUpload({
    filename,
    fileBuffer,
    storageDir,
    uploader_id,
    owner_id = null,
    metadata = {}
  }) {
    if (!filename || !fileBuffer || !storageDir) {
      throw new Error('缺少必要参数: filename, fileBuffer, storageDir');
    }

    if (!uploader_id) {
      throw new Error('缺少上传者 ID');
    }

    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext);
    const uniqueFilename = `${baseName}_${timestamp}_${randomStr}${ext}`;
    const storage_path = path.join(storageDir, uniqueFilename);

    let document = null;
    let fileWritten = false;

    try {
      document = await Document.createPending(filename, storage_path, {
        uploader_id,
        owner_id: owner_id || uploader_id,
        metadata: {
          ...metadata,
          upload_started_at: new Date().toISOString()
        }
      });

      fs.writeFileSync(storage_path, fileBuffer);
      fileWritten = true;

      const fileMetadata = Document.parseFileMetadata(storage_path, filename);
      
      const finalMetadata = {
        ...metadata,
        ...fileMetadata,
        upload_completed_at: new Date().toISOString()
      };

      const updatedDoc = await Document.update(document.id, {
        status: DocumentStatus.READY,
        file_size: fileMetadata.file_size,
        mime_type: fileMetadata.mime_type,
        metadata: finalMetadata
      });

      return {
        success: true,
        document: updatedDoc
      };

    } catch (error) {
      if (fileWritten && fs.existsSync(storage_path)) {
        try {
          fs.unlinkSync(storage_path);
        } catch (cleanupErr) {
          console.error('清理临时文件失败:', cleanupErr.message);
        }
      }

      if (document) {
        try {
          await Document.markAsFailed(document.id, error.message);
        } catch (updateErr) {
          console.error('更新状态为失败时出错:', updateErr.message);
        }
      }

      throw error;
    }
  }

  static async atomicUploadWithTransaction({
    filename,
    fileBuffer,
    storageDir,
    uploader_id,
    owner_id = null,
    metadata = {}
  }) {
    const database = db.getDb();
    
    return new Promise((resolve, reject) => {
      database.serialize(async () => {
        database.run('BEGIN TRANSACTION');

        let transactionSuccessful = false;
        let document = null;
        let fileWritten = false;
        let storage_path = null;

        try {
          if (!filename || !fileBuffer || !storageDir) {
            throw new Error('缺少必要参数: filename, fileBuffer, storageDir');
          }

          if (!uploader_id) {
            throw new Error('缺少上传者 ID');
          }

          if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
          }

          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(2, 8);
          const ext = path.extname(filename);
          const baseName = path.basename(filename, ext);
          const uniqueFilename = `${baseName}_${timestamp}_${randomStr}${ext}`;
          storage_path = path.join(storageDir, uniqueFilename);

          const serializedMetadata = Document.serializeMetadata({
            ...metadata,
            upload_started_at: new Date().toISOString()
          });

          const result = await db.run(
            `INSERT INTO documents (filename, storage_path, file_size, mime_type, uploader_id, owner_id, status, metadata) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [filename, storage_path, 0, '', uploader_id, owner_id || uploader_id, DocumentStatus.PENDING, serializedMetadata]
          );

          document = await Document.findById(result.lastID);
          if (!document) {
            throw new Error('创建文档记录失败');
          }

          fs.writeFileSync(storage_path, fileBuffer);
          fileWritten = true;

          const fileMetadata = Document.parseFileMetadata(storage_path, filename);
          
          const finalMetadata = {
            ...metadata,
            ...fileMetadata,
            upload_completed_at: new Date().toISOString()
          };

          await db.run(
            `UPDATE documents SET status = ?, file_size = ?, mime_type = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [DocumentStatus.READY, fileMetadata.file_size, fileMetadata.mime_type, Document.serializeMetadata(finalMetadata), document.id]
          );

          database.run('COMMIT');
          transactionSuccessful = true;

          const finalDoc = await Document.findById(document.id);
          resolve({
            success: true,
            document: finalDoc
          });

        } catch (error) {
          if (!transactionSuccessful) {
            database.run('ROLLBACK');
          }

          if (fileWritten && storage_path && fs.existsSync(storage_path)) {
            try {
              fs.unlinkSync(storage_path);
            } catch (cleanupErr) {
              console.error('清理临时文件失败:', cleanupErr.message);
            }
          }

          reject(error);
        }
      });
    });
  }

  static async safeDelete(id) {
    const document = await Document.findById(id);
    if (!document) {
      throw new Error('文档不存在');
    }

    if (document.storage_path && fs.existsSync(document.storage_path)) {
      try {
        fs.unlinkSync(document.storage_path);
      } catch (err) {
        console.error('删除物理文件失败:', err.message);
      }
    }

    await db.run('DELETE FROM documents WHERE id = ?', [id]);
    return true;
  }

  static async findById(id) {
    const row = await db.get('SELECT * FROM documents WHERE id = ?', [id]);
    if (!row) {
      return null;
    }
    return Document.fromRow(row);
  }

  static async findByIdWithUploader(id) {
    const row = await db.get(`
      SELECT 
        d.id, d.filename, d.storage_path, d.file_size, d.mime_type, d.status,
        d.uploader_id, d.owner_id, d.metadata, d.created_at, d.updated_at,
        u.username as uploader_username, u.email as uploader_email, u.role_id as uploader_role_id
      FROM documents d
      LEFT JOIN users u ON d.uploader_id = u.id
      WHERE d.id = ?
    `, [id]);
    if (!row) {
      return null;
    }
    const document = Document.fromRow(row);
    if (row.uploader_id) {
      document._uploader = {
        id: row.uploader_id,
        username: row.uploader_username,
        email: row.uploader_email,
        role_id: row.uploader_role_id
      };
    }
    return document;
  }

  static async findByUploaderId(uploader_id) {
    if (!uploader_id) {
      return [];
    }
    const rows = await db.all('SELECT * FROM documents WHERE uploader_id = ? ORDER BY created_at DESC', [uploader_id]);
    return rows.map(row => Document.fromRow(row));
  }

  static async findByOwnerId(owner_id) {
    if (!owner_id) {
      return [];
    }
    const rows = await db.all('SELECT * FROM documents WHERE owner_id = ? ORDER BY created_at DESC', [owner_id]);
    return rows.map(row => Document.fromRow(row));
  }

  static async findByStatus(status) {
    const statusValidation = Document.validateStatus(status);
    if (!statusValidation.valid) {
      throw new Error(statusValidation.message);
    }
    const rows = await db.all('SELECT * FROM documents WHERE status = ? ORDER BY created_at DESC', [status]);
    return rows.map(row => Document.fromRow(row));
  }

  static async findByFilename(filename) {
    const rows = await db.all('SELECT * FROM documents WHERE filename = ? ORDER BY created_at DESC', [filename]);
    return rows.map(row => Document.fromRow(row));
  }

  static async update(id, updates) {
    const document = await Document.findById(id);
    if (!document) {
      throw new Error('文档不存在');
    }

    const allowedUpdates = ['filename', 'storage_path', 'file_size', 'mime_type', 'uploader_id', 'owner_id', 'status', 'metadata'];
    const validUpdates = {};

    for (const key in updates) {
      if (allowedUpdates.includes(key)) {
        if (key === 'filename') {
          const validation = Document.validateFilename(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.filename = updates[key];
        } else if (key === 'storage_path') {
          const validation = Document.validateStoragePath(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.storage_path = updates[key];
        } else if (key === 'file_size') {
          const validation = Document.validateFileSize(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.file_size = updates[key];
        } else if (key === 'mime_type') {
          const validation = Document.validateMimeType(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.mime_type = updates[key] || '';
        } else if (key === 'uploader_id') {
          const validation = await Document.validateUploaderId(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.uploader_id = updates[key];
        } else if (key === 'owner_id') {
          const validation = Document.validateOwnerId(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.owner_id = updates[key];
        } else if (key === 'status') {
          const validation = Document.validateStatus(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.status = updates[key];
        } else if (key === 'metadata') {
          const validation = Document.validateMetadata(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.metadata = Document.serializeMetadata(updates[key]);
        }
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      return document;
    }

    const setClauses = Object.keys(validUpdates).map(key => `${key} = ?`);
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    const values = Object.values(validUpdates);
    values.push(id);

    await db.run(
      `UPDATE documents SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    return Document.findById(id);
  }

  static async delete(id) {
    const document = await Document.findById(id);
    if (!document) {
      throw new Error('文档不存在');
    }

    await db.run('DELETE FROM documents WHERE id = ?', [id]);
    return true;
  }

  static async listAll() {
    const rows = await db.all('SELECT * FROM documents ORDER BY created_at DESC');
    return rows.map(row => Document.fromRow(row));
  }

  static async listAllWithUploader() {
    const rows = await db.all(`
      SELECT 
        d.id, d.filename, d.storage_path, d.file_size, d.mime_type, d.status,
        d.uploader_id, d.owner_id, d.metadata, d.created_at, d.updated_at,
        u.username as uploader_username, u.email as uploader_email, u.role_id as uploader_role_id
      FROM documents d
      LEFT JOIN users u ON d.uploader_id = u.id
      ORDER BY d.created_at DESC
    `);
    return rows.map(row => {
      const document = Document.fromRow(row);
      if (row.uploader_id) {
        document._uploader = {
          id: row.uploader_id,
          username: row.uploader_username,
          email: row.uploader_email,
          role_id: row.uploader_role_id
        };
      }
      return document;
    });
  }

  async getUploader() {
    if (this._uploader) {
      return this._uploader;
    }
    if (!this.uploader_id) {
      return null;
    }
    const user = await User.findById(this.uploader_id);
    if (user) {
      this._uploader = user.toJSON();
    }
    return this._uploader;
  }

  async getOwner() {
    if (this._owner) {
      return this._owner;
    }
    if (!this.owner_id) {
      return null;
    }
    const user = await User.findById(this.owner_id);
    if (user) {
      this._owner = user.toJSON();
    }
    return this._owner;
  }

  fileExists() {
    return this.storage_path && fs.existsSync(this.storage_path);
  }

  toJSON() {
    const json = {
      id: this.id,
      filename: this.filename,
      storage_path: this.storage_path,
      file_size: this.file_size,
      mime_type: this.mime_type,
      uploader_id: this.uploader_id,
      owner_id: this.owner_id,
      status: this.status,
      metadata: this.metadata,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
    if (this._uploader) {
      json.uploader = this._uploader;
    }
    if (this._owner) {
      json.owner = this._owner;
    }
    return json;
  }
}

module.exports = Document;
