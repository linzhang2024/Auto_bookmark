const db = require('../services/database');
const diffEngine = require('../services/diffEngine');

class BookmarkSnapshot {
  constructor(
    id,
    sync_id,
    version_number,
    browser_source,
    total_bookmarks,
    total_folders,
    bookmarks_data,
    diff_statistics,
    change_summary,
    created_at,
    updated_at
  ) {
    this.id = id;
    this.sync_id = sync_id;
    this.version_number = version_number;
    this.browser_source = browser_source;
    this.total_bookmarks = total_bookmarks || 0;
    this.total_folders = total_folders || 0;
    this.bookmarks_data = bookmarks_data;
    this.diff_statistics = diff_statistics || {};
    this.change_summary = change_summary || '';
    this.created_at = created_at;
    this.updated_at = updated_at;
    this._bookmarks = null;
  }

  static serializeBookmarksData(bookmarks) {
    if (!bookmarks) return '[]';
    return JSON.stringify(bookmarks);
  }

  static deserializeBookmarksData(dataStr) {
    if (!dataStr) return [];
    try {
      return JSON.parse(dataStr);
    } catch (err) {
      console.error('反序列化书签数据失败:', err.message);
      return [];
    }
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

  static fromRow(row) {
    return new BookmarkSnapshot(
      row.id,
      row.sync_id,
      row.version_number,
      row.browser_source,
      row.total_bookmarks,
      row.total_folders,
      BookmarkSnapshot.deserializeBookmarksData(row.bookmarks_data),
      BookmarkSnapshot.deserializeDiffStatistics(row.diff_statistics),
      row.change_summary,
      row.created_at,
      row.updated_at
    );
  }

  getBookmarks() {
    if (this._bookmarks !== null) {
      return this._bookmarks;
    }
    if (typeof this.bookmarks_data === 'string') {
      this._bookmarks = BookmarkSnapshot.deserializeBookmarksData(this.bookmarks_data);
    } else {
      this._bookmarks = this.bookmarks_data || [];
    }
    return this._bookmarks;
  }

  static async getNextVersionNumber() {
    const row = await db.get(
      `SELECT MAX(version_number) as max_version FROM bookmark_snapshots`,
      []
    );
    return (row && row.max_version) ? row.max_version + 1 : 1;
  }

  static async create(options = {}) {
    const {
      sync_id,
      browser_source,
      bookmarks = [],
      total_bookmarks = 0,
      total_folders = 0,
      compareWithPrevious = true
    } = options;

    if (!sync_id) {
      throw new Error('sync_id 不能为空');
    }

    const version_number = await BookmarkSnapshot.getNextVersionNumber();

    const actual_total_bookmarks = total_bookmarks || BookmarkSnapshot.countBookmarks(bookmarks);
    const actual_total_folders = total_folders || BookmarkSnapshot.countFolders(bookmarks);

    let diff_statistics = {};
    let change_summary = '';

    if (compareWithPrevious && version_number > 1) {
      const previousSnapshot = await BookmarkSnapshot.getLatest();
      if (previousSnapshot) {
        diff_statistics = await BookmarkSnapshot.compareSnapshots(previousSnapshot, {
          bookmarks: bookmarks,
          total_bookmarks: actual_total_bookmarks,
          total_folders: actual_total_folders
        });
        change_summary = BookmarkSnapshot.generateChangeSummary(diff_statistics, previousSnapshot);
      }
    }

    const result = await db.run(
      `INSERT INTO bookmark_snapshots (
        sync_id, version_number, browser_source, total_bookmarks, 
        total_folders, bookmarks_data, diff_statistics, change_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sync_id,
        version_number,
        browser_source,
        actual_total_bookmarks,
        actual_total_folders,
        BookmarkSnapshot.serializeBookmarksData(bookmarks),
        BookmarkSnapshot.serializeDiffStatistics(diff_statistics),
        change_summary
      ]
    );

    await db.run(
      `UPDATE sync_history SET version_number = ? WHERE sync_id = ?`,
      [version_number, sync_id]
    );

    return BookmarkSnapshot.findById(result.lastID);
  }

  static async compareSnapshots(snapshotA, snapshotB) {
    if (!snapshotA || !snapshotB) {
      return {};
    }

    const bookmarksA = snapshotA.getBookmarks ? snapshotA.getBookmarks() : (snapshotA.bookmarks || []);
    const bookmarksB = snapshotB.getBookmarks ? snapshotB.getBookmarks() : (snapshotB.bookmarks || []);

    const flatA = BookmarkSnapshot.flattenBookmarks(bookmarksA);
    const flatB = BookmarkSnapshot.flattenBookmarks(bookmarksB);

    const urlSetA = new Set(flatA.map(b => b.url).filter(url => url));
    const urlSetB = new Set(flatB.map(b => b.url).filter(url => url));

    const addedUrls = [...urlSetB].filter(url => !urlSetA.has(url));
    const removedUrls = [...urlSetA].filter(url => !urlSetB.has(url));
    const commonUrls = [...urlSetA].filter(url => urlSetB.has(url));

    const urlMapA = new Map(flatA.filter(b => b.url).map(b => [b.url, b]));
    const urlMapB = new Map(flatB.filter(b => b.url).map(b => [b.url, b]));

    let changedCount = 0;
    for (const url of commonUrls) {
      const bmA = urlMapA.get(url);
      const bmB = urlMapB.get(url);
      if (bmA && bmB) {
        if (bmA.title !== bmB.title || bmA.folderPath !== bmB.folderPath) {
          changedCount++;
        }
      }
    }

    const totalA = snapshotA.total_bookmarks || flatA.length;
    const totalB = snapshotB.total_bookmarks || flatB.length;

    const foldersA = snapshotA.total_folders || BookmarkSnapshot.countFolders(bookmarksA);
    const foldersB = snapshotB.total_folders || BookmarkSnapshot.countFolders(bookmarksB);

    return {
      bookmarks: {
        old: totalA,
        new: totalB,
        added: addedUrls.length,
        removed: removedUrls.length,
        changed: changedCount,
        unchanged: commonUrls.length - changedCount
      },
      folders: {
        old: foldersA,
        new: foldersB,
        delta: foldersB - foldersA
      },
      changePercentage: {
        bookmarks: totalA > 0 ? Math.round(((addedUrls.length + removedUrls.length + changedCount) / totalA) * 100) : 0
      }
    };
  }

  static generateChangeSummary(diffStats, previousSnapshot) {
    if (!diffStats || !diffStats.bookmarks) {
      return '首次版本，无变更历史';
    }

    const bm = diffStats.bookmarks;
    const folders = diffStats.folders;
    const parts = [];

    if (bm.added > 0) {
      parts.push(`新增 ${bm.added} 个书签`);
    }
    if (bm.removed > 0) {
      parts.push(`移除 ${bm.removed} 个书签`);
    }
    if (bm.changed > 0) {
      parts.push(`修改 ${bm.changed} 个书签`);
    }
    if (folders && folders.delta !== 0) {
      if (folders.delta > 0) {
        parts.push(`新增 ${folders.delta} 个文件夹`);
      } else {
        parts.push(`移除 ${Math.abs(folders.delta)} 个文件夹`);
      }
    }

    if (parts.length === 0) {
      return '与上一版本无显著变化';
    }

    return parts.join('；');
  }

  static flattenBookmarks(items, folderPath = '') {
    const result = [];

    function traverse(itemsList, currentPath) {
      if (!Array.isArray(itemsList)) return;

      for (const item of itemsList) {
        if (!item) continue;

        if (item.type === 'folder') {
          const newPath = currentPath ? `${currentPath}/${item.name}` : item.name;
          if (item.children) {
            traverse(item.children, newPath);
          }
        } else if (item.type === 'link') {
          result.push({
            ...item,
            folderPath: currentPath
          });
        }
      }
    }

    traverse(items, folderPath);
    return result;
  }

  static countBookmarks(items) {
    const flat = BookmarkSnapshot.flattenBookmarks(items);
    return flat.length;
  }

  static countFolders(items) {
    let count = 0;

    function traverse(itemsList) {
      if (!Array.isArray(itemsList)) return;

      for (const item of itemsList) {
        if (item && item.type === 'folder') {
          count++;
          if (item.children) {
            traverse(item.children);
          }
        }
      }
    }

    traverse(items);
    return count;
  }

  static async findById(id) {
    const row = await db.get('SELECT * FROM bookmark_snapshots WHERE id = ?', [id]);
    return row ? BookmarkSnapshot.fromRow(row) : null;
  }

  static async findBySyncId(sync_id) {
    const row = await db.get('SELECT * FROM bookmark_snapshots WHERE sync_id = ?', [sync_id]);
    return row ? BookmarkSnapshot.fromRow(row) : null;
  }

  static async findByVersionNumber(version_number) {
    const row = await db.get('SELECT * FROM bookmark_snapshots WHERE version_number = ?', [version_number]);
    return row ? BookmarkSnapshot.fromRow(row) : null;
  }

  static async getLatest() {
    const row = await db.get(
      `SELECT * FROM bookmark_snapshots ORDER BY version_number DESC LIMIT 1`,
      []
    );
    return row ? BookmarkSnapshot.fromRow(row) : null;
  }

  static async listAll(options = {}) {
    const { limit = 50, offset = 0 } = options;

    const rows = await db.all(
      `SELECT * FROM bookmark_snapshots ORDER BY version_number DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return rows.map(row => BookmarkSnapshot.fromRow(row));
  }

  static async countAll() {
    const row = await db.get(
      `SELECT COUNT(*) as total FROM bookmark_snapshots`,
      []
    );
    return row ? row.total : 0;
  }

  static async getStats() {
    const totalVersions = await BookmarkSnapshot.countAll();
    const latest = await BookmarkSnapshot.getLatest();

    return {
      totalVersions,
      latestVersion: latest ? latest.id : 0,
      latestVersionNumber: latest ? latest.version_number : 0,
      latestCreatedAt: latest ? latest.created_at : null,
      currentBookmarks: latest ? latest.total_bookmarks : 0,
      currentFolders: latest ? latest.total_folders : 0,
      latestBookmarks: latest ? latest.total_bookmarks : 0,
      latestFolders: latest ? latest.total_folders : 0
    };
  }

  static async delete(id) {
    const snapshot = await BookmarkSnapshot.findById(id);
    if (!snapshot) {
      throw new Error('快照不存在');
    }

    await db.run('DELETE FROM bookmark_snapshots WHERE id = ?', [id]);
    return true;
  }

  toJSON() {
    const json = {
      id: this.id,
      sync_id: this.sync_id,
      version_number: this.version_number,
      version_label: `v${this.version_number}`,
      browser_source: this.browser_source,
      total_bookmarks: this.total_bookmarks,
      total_folders: this.total_folders,
      diff_statistics: this.diff_statistics,
      change_summary: this.change_summary,
      created_at: this.created_at,
      updated_at: this.updated_at
    };

    if (this._bookmarks) {
      json.bookmarks = this._bookmarks;
    }

    return json;
  }

  toJSONWithBookmarks() {
    return {
      ...this.toJSON(),
      bookmarks: this.getBookmarks()
    };
  }
}

module.exports = {
  BookmarkSnapshot
};
