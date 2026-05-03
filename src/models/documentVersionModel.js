const fs = require('fs');
const path = require('path');
const db = require('../services/database');
const Document = require('./documentModel');
const User = require('./userModel');
const diffEngine = require('../services/diffEngine');

const VersionStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DELETED: 'deleted'
};

class DocumentVersion {
  constructor(id, document_id, version_number, version_label, storage_path, file_size, 
              mime_type, uploader_id, change_summary, diff_statistics, status, 
              metadata, created_at) {
    this.id = id;
    this.document_id = document_id;
    this.version_number = version_number;
    this.version_label = version_label || '';
    this.storage_path = storage_path;
    this.file_size = file_size || 0;
    this.mime_type = mime_type || '';
    this.uploader_id = uploader_id;
    this.change_summary = change_summary || '';
    this.diff_statistics = diff_statistics || {};
    this.status = status || VersionStatus.ACTIVE;
    this.metadata = metadata || {};
    this.created_at = created_at;
    this._uploader = null;
    this._document = null;
  }

  static serializeDiffStatistics(stats) {
    if (!stats) return '{}';
    return JSON.stringify(stats);
  }

  static deserializeDiffStatistics(statsStr) {
    if (!statsStr) return {};
    try {
      return JSON.parse(statsStr);
    } catch (err) {
      return {};
    }
  }

  static serializeMetadata(metadata) {
    if (!metadata) return '{}';
    return JSON.stringify(metadata);
  }

  static deserializeMetadata(metadataStr) {
    if (!metadataStr) return {};
    try {
      return JSON.parse(metadataStr);
    } catch (err) {
      return {};
    }
  }

  static fromRow(row) {
    return new DocumentVersion(
      row.id,
      row.document_id,
      row.version_number,
      row.version_label,
      row.storage_path,
      row.file_size,
      row.mime_type,
      row.uploader_id,
      row.change_summary,
      DocumentVersion.deserializeDiffStatistics(row.diff_statistics),
      row.status,
      DocumentVersion.deserializeMetadata(row.metadata),
      row.created_at
    );
  }

  static async getNextVersionNumber(document_id) {
    const row = await db.get(
      `SELECT MAX(version_number) as max_version FROM document_versions WHERE document_id = ?`,
      [document_id]
    );
    return (row && row.max_version) ? row.max_version + 1 : 1;
  }

  static async create(document_id, options = {}) {
    const {
      storage_path,
      file_size = 0,
      mime_type = '',
      uploader_id,
      version_label = '',
      change_summary = '',
      metadata = {},
      fileBuffer = null,
      compareWithPrevious = true
    } = options;

    if (!document_id) {
      throw new Error('文档 ID 不能为空');
    }

    const document = await Document.findById(document_id);
    if (!document) {
      throw new Error('文档不存在');
    }

    const version_number = await DocumentVersion.getNextVersionNumber(document_id);
    
    let diff_statistics = {};
    let final_storage_path = storage_path;
    let final_file_size = file_size;
    let final_mime_type = mime_type;

    if (fileBuffer) {
      const fileCategory = getFileCategory(document.filename);
      const categoryDir = path.join(path.dirname(document.storage_path), 'versions');
      
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 8);
      const ext = path.extname(document.filename);
      const baseName = path.basename(document.filename, ext);
      const uniqueFilename = `${baseName}_v${version_number}_${timestamp}_${randomStr}${ext}`;
      final_storage_path = path.join(categoryDir, uniqueFilename);
      
      fs.writeFileSync(final_storage_path, fileBuffer);
      
      const stats = fs.statSync(final_storage_path);
      final_file_size = stats.size;
      final_mime_type = Document.getMimeTypeFromFilename(document.filename);
    }

    if (compareWithPrevious && version_number > 1) {
      const previousVersion = await DocumentVersion.getLatestVersion(document_id);
      if (previousVersion) {
        diff_statistics = await DocumentVersion.compareVersions(previousVersion, {
          storage_path: final_storage_path,
          file_size: final_file_size,
          mime_type: final_mime_type
        });
      }
    }

    const result = await db.run(
      `INSERT INTO document_versions (
        document_id, version_number, version_label, storage_path, 
        file_size, mime_type, uploader_id, change_summary, 
        diff_statistics, status, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        document_id,
        version_number,
        version_label,
        final_storage_path,
        final_file_size,
        final_mime_type,
        uploader_id,
        change_summary,
        DocumentVersion.serializeDiffStatistics(diff_statistics),
        VersionStatus.ACTIVE,
        DocumentVersion.serializeMetadata(metadata)
      ]
    );

    return DocumentVersion.findById(result.lastID);
  }

  static async compareVersions(versionA, versionB) {
    if (!versionA || !versionB) {
      return {};
    }

    const storageA = versionA.storage_path || (versionA.get ? versionA.storage_path : versionA);
    const storageB = versionB.storage_path || (versionB.get ? versionB.storage_path : versionB);

    const textContentA = readTextContent(storageA);
    const textContentB = readTextContent(storageB);

    const sizeA = versionA.file_size || (fs.existsSync(storageA) ? fs.statSync(storageA).size : 0);
    const sizeB = versionB.file_size || (fs.existsSync(storageB) ? fs.statSync(storageB).size : 0);

    const stats = diffEngine.computeDiffStatistics(textContentA, textContentB);

    return {
      ...stats,
      bytes: {
        old: sizeA,
        new: sizeB,
        delta: sizeB - sizeA
      }
    };
  }

  static async getDiffBetweenVersions(versionId1, versionId2, options = {}) {
    const { diffType = 'line', format = 'unified' } = options;
    
    if (versionId1 === undefined || versionId1 === null) {
      throw new Error('缺少第一个版本 ID 参数（versionId1）');
    }
    
    if (versionId2 === undefined || versionId2 === null) {
      throw new Error('缺少第二个版本 ID 参数（versionId2）');
    }
    
    const v1 = parseInt(versionId1, 10);
    const v2 = parseInt(versionId2, 10);
    
    if (isNaN(v1) || v1 <= 0) {
      throw new Error(`第一个版本 ID 无效：versionId1 = ${versionId1}，必须是有效的正整数`);
    }
    
    if (isNaN(v2) || v2 <= 0) {
      throw new Error(`第二个版本 ID 无效：versionId2 = ${versionId2}，必须是有效的正整数`);
    }
    
    if (v1 === v2) {
      throw new Error(`两个版本 ID 相同（versionId1 = versionId2 = ${v1}），请选择不同的版本进行比对`);
    }
    
    const version1 = await DocumentVersion.findById(v1);
    const version2 = await DocumentVersion.findById(v2);

    if (!version1 && !version2) {
      throw new Error(`两个版本都不存在：versionId1 = ${v1}，versionId2 = ${v2}`);
    }
    
    if (!version1) {
      throw new Error(`第一个版本不存在：versionId1 = ${v1}，该版本可能已被删除或 ID 无效`);
    }
    
    if (!version2) {
      throw new Error(`第二个版本不存在：versionId2 = ${v2}，该版本可能已被删除或 ID 无效`);
    }
    
    if (version1.status !== VersionStatus.ACTIVE) {
      throw new Error(`第一个版本状态无效：versionId1 = ${v1}，当前状态为 "${version1.status}"，需要 "active" 状态`);
    }
    
    if (version2.status !== VersionStatus.ACTIVE) {
      throw new Error(`第二个版本状态无效：versionId2 = ${v2}，当前状态为 "${version2.status}"，需要 "active" 状态`);
    }
    
    if (version1.document_id !== version2.document_id) {
      throw new Error(`两个版本必须属于同一文档：versionId1 属于文档 ${version1.document_id}，versionId2 属于文档 ${version2.document_id}`);
    }

    const text1 = readTextContent(version1.storage_path);
    const text2 = readTextContent(version2.storage_path);

    let diffResult;
    
    if (format === 'side-by-side') {
      diffResult = diffEngine.computeSideBySideDiff(text1, text2, options);
    } else if (format === 'unified') {
      diffResult = diffEngine.computeUnifiedDiff(text1, text2, options);
    } else {
      switch (diffType) {
        case 'char':
          diffResult = diffEngine.computeCharLevelDiff(text1, text2);
          break;
        case 'word':
          diffResult = diffEngine.computeWordLevelDiff(text1, text2);
          break;
        case 'line':
        default:
          diffResult = diffEngine.computeLineLevelDiff(text1, text2, options);
      }
    }

    return diffResult;
  }

  static async getLatestVersion(document_id) {
    const row = await db.get(
      `SELECT * FROM document_versions 
       WHERE document_id = ? AND status = ? 
       ORDER BY version_number DESC LIMIT 1`,
      [document_id, VersionStatus.ACTIVE]
    );
    return row ? DocumentVersion.fromRow(row) : null;
  }

  static async getVersionByNumber(document_id, version_number) {
    const row = await db.get(
      `SELECT * FROM document_versions WHERE document_id = ? AND version_number = ?`,
      [document_id, version_number]
    );
    return row ? DocumentVersion.fromRow(row) : null;
  }

  static async findById(id) {
    const row = await db.get('SELECT * FROM document_versions WHERE id = ?', [id]);
    return row ? DocumentVersion.fromRow(row) : null;
  }

  static async findByIdWithUploader(id) {
    const row = await db.get(`
      SELECT 
        v.*,
        u.username as uploader_username, u.email as uploader_email, u.role_id as uploader_role_id
      FROM document_versions v
      LEFT JOIN users u ON v.uploader_id = u.id
      WHERE v.id = ?
    `, [id]);
    if (!row) return null;
    
    const version = DocumentVersion.fromRow(row);
    if (row.uploader_id) {
      version._uploader = {
        id: row.uploader_id,
        username: row.uploader_username,
        email: row.uploader_email,
        role_id: row.uploader_role_id
      };
    }
    return version;
  }

  static async findByDocumentId(document_id, options = {}) {
    const { status = VersionStatus.ACTIVE, limit = null, offset = null } = options;
    
    let sql = `SELECT * FROM document_versions WHERE document_id = ?`;
    const params = [document_id];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY version_number DESC`;

    if (limit !== null) {
      sql += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
      if (offset !== null) {
        sql += ` OFFSET ?`;
        params.push(parseInt(offset, 10));
      }
    }

    const rows = await db.all(sql, params);
    return rows.map(row => DocumentVersion.fromRow(row));
  }

  static async findByDocumentIdWithUploader(document_id, options = {}) {
    const { status = VersionStatus.ACTIVE, limit = null, offset = null } = options;
    
    let sql = `
      SELECT 
        v.*,
        u.username as uploader_username, u.email as uploader_email, u.role_id as uploader_role_id
      FROM document_versions v
      LEFT JOIN users u ON v.uploader_id = u.id
      WHERE v.document_id = ?
    `;
    const params = [document_id];

    if (status) {
      sql += ` AND v.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY v.version_number DESC`;

    if (limit !== null) {
      sql += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
      if (offset !== null) {
        sql += ` OFFSET ?`;
        params.push(parseInt(offset, 10));
      }
    }

    const rows = await db.all(sql, params);
    return rows.map(row => {
      const version = DocumentVersion.fromRow(row);
      if (row.uploader_id) {
        version._uploader = {
          id: row.uploader_id,
          username: row.uploader_username,
          email: row.uploader_email,
          role_id: row.uploader_role_id
        };
      }
      return version;
    });
  }

  static async countByDocumentId(document_id, status = VersionStatus.ACTIVE) {
    let sql = `SELECT COUNT(*) as total FROM document_versions WHERE document_id = ?`;
    const params = [document_id];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    const row = await db.get(sql, params);
    return row ? row.total : 0;
  }

  static async update(id, updates) {
    const version = await DocumentVersion.findById(id);
    if (!version) {
      throw new Error('版本不存在');
    }

    const allowedUpdates = ['version_label', 'change_summary', 'status', 'metadata'];
    const validUpdates = {};

    for (const key in updates) {
      if (allowedUpdates.includes(key)) {
        if (key === 'metadata') {
          validUpdates[key] = DocumentVersion.serializeMetadata(updates[key]);
        } else {
          validUpdates[key] = updates[key];
        }
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      return version;
    }

    const setClauses = Object.keys(validUpdates).map(key => `${key} = ?`);
    const values = Object.values(validUpdates);
    values.push(id);

    await db.run(
      `UPDATE document_versions SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    return DocumentVersion.findById(id);
  }

  static async archive(id) {
    return DocumentVersion.update(id, { status: VersionStatus.ARCHIVED });
  }

  static async restore(id) {
    return DocumentVersion.update(id, { status: VersionStatus.ACTIVE });
  }

  static async delete(id) {
    const version = await DocumentVersion.findById(id);
    if (!version) {
      throw new Error('版本不存在');
    }

    if (version.storage_path && fs.existsSync(version.storage_path)) {
      try {
        fs.unlinkSync(version.storage_path);
      } catch (err) {
        console.error('删除版本文件失败:', err.message);
      }
    }

    await db.run('DELETE FROM document_versions WHERE id = ?', [id]);
    return true;
  }

  static async restoreVersionToDocument(version_id) {
    const version = await DocumentVersion.findById(version_id);
    if (!version) {
      throw new Error('版本不存在');
    }

    const document = await Document.findById(version.document_id);
    if (!document) {
      throw new Error('关联文档不存在');
    }

    if (!version.storage_path || !fs.existsSync(version.storage_path)) {
      throw new Error('版本文件不存在');
    }

    const fileBuffer = fs.readFileSync(version.storage_path);
    fs.writeFileSync(document.storage_path, fileBuffer);

    const stats = fs.statSync(document.storage_path);
    const updatedDoc = await Document.update(document.id, {
      file_size: stats.size,
      metadata: {
        ...document.metadata,
        restored_from_version: version.version_number,
        restored_at: new Date().toISOString()
      }
    });

    return {
      success: true,
      document: updatedDoc,
      restoredFromVersion: version.version_number
    };
  }

  async getDocument() {
    if (this._document) {
      return this._document;
    }
    if (!this.document_id) {
      return null;
    }
    const doc = await Document.findById(this.document_id);
    if (doc) {
      this._document = doc;
    }
    return this._document;
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

  fileExists() {
    return this.storage_path && fs.existsSync(this.storage_path);
  }

  toJSON() {
    const json = {
      id: this.id,
      document_id: this.document_id,
      version_number: this.version_number,
      version_label: this.version_label,
      storage_path: this.storage_path,
      file_size: this.file_size,
      mime_type: this.mime_type,
      uploader_id: this.uploader_id,
      change_summary: this.change_summary,
      diff_statistics: this.diff_statistics,
      status: this.status,
      metadata: this.metadata,
      created_at: this.created_at
    };
    if (this._uploader) {
      json.uploader = this._uploader;
    }
    if (this._document) {
      json.document = this._document.toJSON ? this._document.toJSON() : this._document;
    }
    return json;
  }
}

function getFileCategory(filename) {
  const ext = path.extname(filename).toLowerCase();
  const FILE_CATEGORIES = {
    documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.html', '.htm', '.css', '.js', '.json', '.xml'],
    images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'],
    videos: ['.mp4', '.avi', '.mov'],
    audios: ['.mp3', '.wav', '.flac'],
    archives: ['.zip', '.rar', '.7z', '.tar', '.gz']
  };

  for (const [category, extensions] of Object.entries(FILE_CATEGORIES)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }
  return 'others';
}

function readTextContent(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const textExtensions = ['.txt', '.html', '.htm', '.css', '.js', '.json', '.xml', '.md', '.csv'];
    
    if (textExtensions.includes(ext)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    
    return '';
  } catch (err) {
    console.error('读取文件内容失败:', err.message);
    return '';
  }
}

module.exports = {
  DocumentVersion,
  VersionStatus,
  getFileCategory,
  readTextContent
};
