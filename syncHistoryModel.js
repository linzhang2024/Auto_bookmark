const db = require('./database');

const SyncStatus = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  PARTIAL: 'partial'
};

const ErrorType = {
  ICON_DOWNLOAD_FAILED: 'icon_download_failed',
  URL_INVALID: 'url_invalid',
  NETWORK_ERROR: 'network_error',
  TIMEOUT: 'timeout',
  PERMISSION_ERROR: 'permission_error',
  UNKNOWN: 'unknown'
};

function mapSyncErrorToType(errorMessage) {
  if (!errorMessage) return ErrorType.UNKNOWN;
  
  const lowerMsg = errorMessage.toLowerCase();
  
  if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || lowerMsg.includes('超时')) {
    return ErrorType.TIMEOUT;
  }
  if (lowerMsg.includes('network') || lowerMsg.includes('connection') || lowerMsg.includes('econnrefused') || 
      lowerMsg.includes('网络') || lowerMsg.includes('连接')) {
    return ErrorType.NETWORK_ERROR;
  }
  if (lowerMsg.includes('permission') || lowerMsg.includes('access denied') || lowerMsg.includes('eacces') ||
      lowerMsg.includes('权限')) {
    return ErrorType.PERMISSION_ERROR;
  }
  if (lowerMsg.includes('invalid') || lowerMsg.includes('malformed') ||
      lowerMsg.includes('无效') || lowerMsg.includes('非法')) {
    return ErrorType.URL_INVALID;
  }
  if (lowerMsg.includes('favicon') || lowerMsg.includes('icon') || lowerMsg.includes('download') ||
      lowerMsg.includes('图标') || lowerMsg.includes('下载')) {
    return ErrorType.ICON_DOWNLOAD_FAILED;
  }
  
  return ErrorType.UNKNOWN;
}

function getErrorTypeDescription(errorType) {
  const descriptions = {
    [ErrorType.ICON_DOWNLOAD_FAILED]: '图标下载失败：网站 favicon 无法访问或不存在',
    [ErrorType.URL_INVALID]: 'URL 格式无效：书签地址格式不正确',
    [ErrorType.NETWORK_ERROR]: '网络错误：无法连接到目标网站',
    [ErrorType.TIMEOUT]: '连接超时：网站响应时间过长',
    [ErrorType.PERMISSION_ERROR]: '权限错误：无法访问本地文件或网络资源',
    [ErrorType.UNKNOWN]: '未知错误'
  };
  return descriptions[errorType] || '未知错误';
}

class SyncHistory {
  constructor(
    id,
    sync_id,
    executed_at,
    browser_source,
    total_count,
    success_count,
    failed_count,
    status,
    error_message,
    sync_dir,
    total_folders,
    folders_created,
    duplicates_found,
    duration_ms,
    backup_file_path,
    created_at,
    updated_at
  ) {
    this.id = id;
    this.sync_id = sync_id;
    this.executed_at = executed_at;
    this.browser_source = browser_source;
    this.total_count = total_count || 0;
    this.success_count = success_count || 0;
    this.failed_count = failed_count || 0;
    this.status = status || SyncStatus.COMPLETED;
    this.error_message = error_message;
    this.sync_dir = sync_dir;
    this.total_folders = total_folders || 0;
    this.folders_created = folders_created || 0;
    this.duplicates_found = duplicates_found || 0;
    this.duration_ms = duration_ms;
    this.backup_file_path = backup_file_path;
    this.created_at = created_at;
    this.updated_at = updated_at;
    this._failures = null;
  }

  static fromRow(row) {
    return new SyncHistory(
      row.id,
      row.sync_id,
      row.executed_at,
      row.browser_source,
      row.total_count,
      row.success_count,
      row.failed_count,
      row.status,
      row.error_message,
      row.sync_dir,
      row.total_folders,
      row.folders_created,
      row.duplicates_found,
      row.duration_ms,
      row.backup_file_path,
      row.created_at,
      row.updated_at
    );
  }

  static async create(options) {
    const {
      sync_id,
      browser_source,
      total_count = 0,
      success_count = 0,
      failed_count = 0,
      status = SyncStatus.COMPLETED,
      error_message = null,
      sync_dir = null,
      total_folders = 0,
      folders_created = 0,
      duplicates_found = 0,
      duration_ms = null,
      backup_file_path = null,
      failures = []
    } = options;

    if (!sync_id) {
      throw new Error('sync_id 不能为空');
    }

    const actualStatus = failed_count > 0 && success_count > 0 
      ? SyncStatus.PARTIAL 
      : (failed_count > 0 ? SyncStatus.FAILED : SyncStatus.COMPLETED);

    const result = await db.run(
      `INSERT INTO sync_history 
       (sync_id, browser_source, total_count, success_count, failed_count, 
        status, error_message, sync_dir, total_folders, folders_created, 
        duplicates_found, duration_ms, backup_file_path) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sync_id,
        browser_source,
        total_count,
        success_count,
        failed_count,
        actualStatus,
        error_message,
        sync_dir,
        total_folders,
        folders_created,
        duplicates_found,
        duration_ms,
        backup_file_path
      ]
    );

    if (failures && Array.isArray(failures) && failures.length > 0) {
      for (const failure of failures) {
        await SyncFailureDetail.create({
          sync_id,
          bookmark_title: failure.title,
          bookmark_url: failure.url,
          folder_path: failure.folderPath,
          error_type: mapSyncErrorToType(failure.errorMessage),
          error_message: failure.errorMessage
        });
      }
    }

    return SyncHistory.findById(result.lastID);
  }

  static async recordSyncStart(sync_id, browser_source, sync_dir) {
    const result = await db.run(
      `INSERT INTO sync_history (sync_id, browser_source, sync_dir, status, total_count) 
       VALUES (?, ?, ?, 'in_progress', 0)`,
      [sync_id, browser_source, sync_dir]
    );
    return SyncHistory.findById(result.lastID);
  }

  static async updateSyncResult(sync_id, result, browser_source, backup_file_path = null) {
    const totalCount = (result.bookmarksSynced || 0) + 
                       (result.bookmarksAlreadySynced || 0) + 
                       (result.bookmarksFailed || 0);
    const successCount = (result.bookmarksSynced || 0) + 
                         (result.bookmarksAlreadySynced || 0);
    const failedCount = result.bookmarksFailed || 0;

    let durationMs = null;
    if (result.startTime && result.endTime) {
      try {
        durationMs = new Date(result.endTime) - new Date(result.startTime);
      } catch {}
    }

    const status = failedCount > 0 && successCount > 0 
      ? SyncStatus.PARTIAL 
      : (failedCount > 0 ? SyncStatus.FAILED : SyncStatus.COMPLETED);

    if (backup_file_path) {
      await db.run(
        `UPDATE sync_history 
         SET total_count = ?, success_count = ?, failed_count = ?, 
             status = ?, total_folders = ?, folders_created = ?, 
             duplicates_found = ?, duration_ms = ?, executed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP, backup_file_path = ?
         WHERE sync_id = ?`,
        [
          totalCount,
          successCount,
          failedCount,
          status,
          result.totalFolders || 0,
          result.foldersCreated || 0,
          result.duplicatesFound || 0,
          durationMs,
          backup_file_path,
          sync_id
        ]
      );
    } else {
      await db.run(
        `UPDATE sync_history 
         SET total_count = ?, success_count = ?, failed_count = ?, 
             status = ?, total_folders = ?, folders_created = ?, 
             duplicates_found = ?, duration_ms = ?, executed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE sync_id = ?`,
        [
          totalCount,
          successCount,
          failedCount,
          status,
          result.totalFolders || 0,
          result.foldersCreated || 0,
          result.duplicatesFound || 0,
          durationMs,
          sync_id
        ]
      );
    }

    if (result.failedBookmarks && Array.isArray(result.failedBookmarks) && result.failedBookmarks.length > 0) {
      for (const failure of result.failedBookmarks) {
        await SyncFailureDetail.create({
          sync_id,
          bookmark_title: failure.title,
          bookmark_url: failure.url,
          folder_path: failure.folderPath,
          error_type: mapSyncErrorToType(failure.errorMessage),
          error_message: failure.errorMessage || '未知错误'
        });
      }
    }

    return SyncHistory.findBySyncId(sync_id);
  }

  static async findById(id) {
    const row = await db.get('SELECT * FROM sync_history WHERE id = ?', [id]);
    if (!row) return null;
    return SyncHistory.fromRow(row);
  }

  static async findBySyncId(sync_id) {
    const row = await db.get('SELECT * FROM sync_history WHERE sync_id = ?', [sync_id]);
    if (!row) return null;
    return SyncHistory.fromRow(row);
  }

  static async listAll(limit = 50, offset = 0) {
    const rows = await db.all(
      `SELECT * FROM sync_history ORDER BY executed_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows.map(row => SyncHistory.fromRow(row));
  }

  static async listRecent(count = 20) {
    const rows = await db.all(
      `SELECT * FROM sync_history ORDER BY executed_at DESC LIMIT ?`,
      [count]
    );
    return rows.map(row => SyncHistory.fromRow(row));
  }

  static async getStats() {
    const row = await db.get(`
      SELECT 
        COUNT(*) as total_syncs,
        SUM(total_count) as total_bookmarks,
        SUM(success_count) as total_successes,
        SUM(failed_count) as total_failures,
        AVG(duration_ms) as avg_duration_ms
      FROM sync_history
    `);
    return {
      totalSyncs: row.total_syncs || 0,
      totalBookmarks: row.total_bookmarks || 0,
      totalSuccesses: row.total_successes || 0,
      totalFailures: row.total_failures || 0,
      avgDurationMs: row.avg_duration_ms || 0,
      successRate: row.total_bookmarks > 0 
        ? Math.round((row.total_successes / row.total_bookmarks) * 100) 
        : 0
    };
  }

  static async delete(id) {
    await db.run('DELETE FROM sync_failure_details WHERE sync_id = (SELECT sync_id FROM sync_history WHERE id = ?)', [id]);
    const result = await db.run('DELETE FROM sync_history WHERE id = ?', [id]);
    return result.changes > 0;
  }

  static async clearAll() {
    await db.run('DELETE FROM sync_failure_details');
    await db.run('DELETE FROM sync_history');
    return true;
  }

  async getFailures() {
    if (this._failures !== null) {
      return this._failures;
    }
    this._failures = await SyncFailureDetail.findBySyncId(this.sync_id);
    return this._failures;
  }

  getSuccessRate() {
    if (this.total_count === 0) return 0;
    return Math.round((this.success_count / this.total_count) * 100);
  }

  getDurationFormatted() {
    if (!this.duration_ms) return null;
    
    const ms = this.duration_ms;
    if (ms < 1000) {
      return `${ms} 毫秒`;
    } else if (ms < 60000) {
      return `${Math.round(ms / 1000)} 秒`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.round((ms % 60000) / 1000);
      return `${minutes} 分 ${seconds} 秒`;
    }
  }

  toJSON() {
    return {
      id: this.id,
      sync_id: this.sync_id,
      executed_at: this.executed_at,
      browser_source: this.browser_source,
      total_count: this.total_count,
      success_count: this.success_count,
      failed_count: this.failed_count,
      status: this.status,
      error_message: this.error_message,
      sync_dir: this.sync_dir,
      total_folders: this.total_folders,
      folders_created: this.folders_created,
      duplicates_found: this.duplicates_found,
      duration_ms: this.duration_ms,
      backup_file_path: this.backup_file_path,
      duration_formatted: this.getDurationFormatted(),
      success_rate: this.getSuccessRate(),
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  static async updateBackupFilePath(sync_id, backup_file_path) {
    if (!sync_id) {
      throw new Error('sync_id 不能为空');
    }

    const result = await db.run(
      `UPDATE sync_history 
       SET backup_file_path = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE sync_id = ?`,
      [backup_file_path, sync_id]
    );

    return result.changes > 0;
  }

  async updateBackupPath(backup_file_path) {
    const success = await SyncHistory.updateBackupFilePath(this.sync_id, backup_file_path);
    if (success) {
      this.backup_file_path = backup_file_path;
    }
    return success;
  }
}

class SyncFailureDetail {
  constructor(
    id,
    sync_id,
    bookmark_title,
    bookmark_url,
    folder_path,
    error_type,
    error_message,
    failed_at,
    created_at
  ) {
    this.id = id;
    this.sync_id = sync_id;
    this.bookmark_title = bookmark_title;
    this.bookmark_url = bookmark_url;
    this.folder_path = folder_path;
    this.error_type = error_type;
    this.error_message = error_message;
    this.failed_at = failed_at;
    this.created_at = created_at;
  }

  static fromRow(row) {
    return new SyncFailureDetail(
      row.id,
      row.sync_id,
      row.bookmark_title,
      row.bookmark_url,
      row.folder_path,
      row.error_type,
      row.error_message,
      row.failed_at,
      row.created_at
    );
  }

  static async create(options) {
    const {
      sync_id,
      bookmark_title,
      bookmark_url,
      folder_path,
      error_type,
      error_message
    } = options;

    if (!sync_id) {
      throw new Error('sync_id 不能为空');
    }

    const result = await db.run(
      `INSERT INTO sync_failure_details 
       (sync_id, bookmark_title, bookmark_url, folder_path, error_type, error_message) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sync_id,
        bookmark_title,
        bookmark_url,
        folder_path,
        error_type,
        error_message
      ]
    );

    return SyncFailureDetail.findById(result.lastID);
  }

  static async findById(id) {
    const row = await db.get('SELECT * FROM sync_failure_details WHERE id = ?', [id]);
    if (!row) return null;
    return SyncFailureDetail.fromRow(row);
  }

  static async findBySyncId(sync_id) {
    const rows = await db.all(
      'SELECT * FROM sync_failure_details WHERE sync_id = ? ORDER BY id ASC',
      [sync_id]
    );
    return rows.map(row => SyncFailureDetail.fromRow(row));
  }

  static async findByErrorType(error_type, limit = 100) {
    const rows = await db.all(
      'SELECT * FROM sync_failure_details WHERE error_type = ? ORDER BY failed_at DESC LIMIT ?',
      [error_type, limit]
    );
    return rows.map(row => SyncFailureDetail.fromRow(row));
  }

  static async getErrorDistribution() {
    const rows = await db.all(`
      SELECT error_type, COUNT(*) as count 
      FROM sync_failure_details 
      GROUP BY error_type 
      ORDER BY count DESC
    `);
    return rows.map(row => ({
      error_type: row.error_type,
      count: row.count,
      description: getErrorTypeDescription(row.error_type)
    }));
  }

  static async getBatchFailures(sync_id) {
    const rows = await db.all(
      'SELECT * FROM sync_failure_details WHERE sync_id = ? ORDER BY id ASC',
      [sync_id]
    );
    return rows.map(row => SyncFailureDetail.fromRow(row));
  }

  static async getFailuresByErrorType(error_type) {
    const rows = await db.all(
      'SELECT * FROM sync_failure_details WHERE error_type = ? ORDER BY failed_at DESC',
      [error_type]
    );
    return rows.map(row => SyncFailureDetail.fromRow(row));
  }

  static async deleteBySyncId(sync_id) {
    const result = await db.run(
      'DELETE FROM sync_failure_details WHERE sync_id = ?',
      [sync_id]
    );
    return result.changes;
  }

  getErrorDescription() {
    return getErrorTypeDescription(this.error_type);
  }

  toJSON() {
    return {
      id: this.id,
      sync_id: this.sync_id,
      bookmark_title: this.bookmark_title,
      bookmark_url: this.bookmark_url,
      folder_path: this.folder_path,
      error_type: this.error_type,
      error_message: this.error_message,
      error_description: this.getErrorDescription(),
      failed_at: this.failed_at,
      created_at: this.created_at
    };
  }
}

module.exports = {
  SyncHistory,
  SyncFailureDetail,
  SyncStatus,
  ErrorType,
  getErrorTypeDescription,
  mapSyncErrorToType
};
