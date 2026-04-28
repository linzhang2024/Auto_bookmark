/**
 * 书签深度去重模块
 * 实现 URL 规范化、标题相似度计算和重复项检测
 */

const DEFAULT_OPTIONS = {
  urlSimilarityThreshold: 1.0,
  titleSimilarityThreshold: 0.9,
  ignoreUrlParams: true,
  ignoreUrlProtocol: true,
  ignoreUrlTrailingSlash: true,
  caseSensitive: false,
  keepNewer: true,
  keepMoreComplete: true
};

class BookmarkDeduplicator {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  normalizeUrl(url, options = {}) {
    if (!url || typeof url !== 'string') {
      return '';
    }

    let normalized = url.trim();
    const opts = { ...this.options, ...options };

    try {
      if (opts.ignoreUrlProtocol) {
        normalized = normalized.replace(/^https?:\/\//i, '');
        normalized = normalized.replace(/^www\./i, '');
      }

      if (opts.ignoreUrlParams) {
        const queryIndex = normalized.indexOf('?');
        if (queryIndex !== -1) {
          normalized = normalized.substring(0, queryIndex);
        }
        const hashIndex = normalized.indexOf('#');
        if (hashIndex !== -1) {
          normalized = normalized.substring(0, hashIndex);
        }
      }

      if (opts.ignoreUrlTrailingSlash) {
        normalized = normalized.replace(/\/+$/, '');
      }

      if (!opts.caseSensitive) {
        normalized = normalized.toLowerCase();
      }

      return normalized;
    } catch {
      return url;
    }
  }

  getUrlCorePath(url) {
    return this.normalizeUrl(url, {
      ignoreUrlParams: true,
      ignoreUrlProtocol: true,
      ignoreUrlTrailingSlash: true,
      caseSensitive: false
    });
  }

  levenshteinDistance(str1, str2, caseSensitive = false) {
    if (!str1 || !str2) {
      return str1 ? str1.length : str2 ? str2.length : 0;
    }

    let s1 = str1;
    let s2 = str2;

    if (!caseSensitive) {
      s1 = str1.toLowerCase();
      s2 = str2.toLowerCase();
    }

    const m = s1.length;
    const n = s2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const matrix = [];
    for (let i = 0; i <= m; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= n; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[m][n];
  }

  calculateTitleSimilarity(title1, title2) {
    if (!title1 || !title2) {
      return 0;
    }

    const t1 = String(title1).trim();
    const t2 = String(title2).trim();

    if (t1 === t2) {
      return 1.0;
    }

    const maxLength = Math.max(t1.length, t2.length);
    if (maxLength === 0) {
      return 1.0;
    }

    const distance = this.levenshteinDistance(t1, t2, this.options.caseSensitive);
    return 1 - (distance / maxLength);
  }

  calculateUrlSimilarity(url1, url2) {
    const core1 = this.getUrlCorePath(url1);
    const core2 = this.getUrlCorePath(url2);

    if (core1 === core2) {
      return 1.0;
    }

    const maxLength = Math.max(core1.length, core2.length);
    if (maxLength === 0) {
      return 0;
    }

    const distance = this.levenshteinDistance(core1, core2, false);
    return 1 - (distance / maxLength);
  }

  isDuplicate(bookmark1, bookmark2) {
    const urlSimilarity = this.calculateUrlSimilarity(bookmark1.url, bookmark2.url);
    const titleSimilarity = this.calculateTitleSimilarity(bookmark1.title, bookmark2.title);

    return (
      urlSimilarity >= this.options.urlSimilarityThreshold &&
      titleSimilarity >= this.options.titleSimilarityThreshold
    );
  }

  getSimilarityScore(bookmark1, bookmark2) {
    return {
      urlSimilarity: this.calculateUrlSimilarity(bookmark1.url, bookmark2.url),
      titleSimilarity: this.calculateTitleSimilarity(bookmark1.title, bookmark2.title),
      isDuplicate: this.isDuplicate(bookmark1, bookmark2)
    };
  }

  findDuplicates(bookmarks) {
    if (!Array.isArray(bookmarks) || bookmarks.length < 2) {
      return [];
    }

    const duplicates = [];
    const processed = new Set();

    const urlGroups = this.groupByUrlCore(bookmarks);

    for (const [corePath, group] of urlGroups) {
      if (group.length > 1) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const key1 = `${group[i].url}|${group[i].title}`;
            const key2 = `${group[j].url}|${group[j].title}`;
            const pairKey = [key1, key2].sort().join('|');

            if (!processed.has(pairKey)) {
              processed.add(pairKey);

              const similarity = this.getSimilarityScore(group[i], group[j]);
              if (similarity.isDuplicate) {
                duplicates.push({
                  bookmark1: group[i],
                  bookmark2: group[j],
                  similarity: similarity,
                  corePath: corePath
                });
              }
            }
          }
        }
      }
    }

    return duplicates;
  }

  groupByUrlCore(bookmarks) {
    const groups = new Map();

    for (const bookmark of bookmarks) {
      if (bookmark.type === 'link' && bookmark.url) {
        const corePath = this.getUrlCorePath(bookmark.url);
        if (!groups.has(corePath)) {
          groups.set(corePath, []);
        }
        groups.get(corePath).push(bookmark);
      }
    }

    return groups;
  }

  selectKeepBookmark(bookmark1, bookmark2) {
    const { keepNewer, keepMoreComplete } = this.options;

    if (keepNewer) {
      const date1 = bookmark1.addDate || bookmark1.lastModified || new Date(0);
      const date2 = bookmark2.addDate || bookmark2.lastModified || new Date(0);

      if (date1 > date2) {
        return { keep: bookmark1, remove: bookmark2 };
      } else if (date2 > date1) {
        return { keep: bookmark2, remove: bookmark1 };
      }
    }

    if (keepMoreComplete) {
      const score1 = this.calculateCompletenessScore(bookmark1);
      const score2 = this.calculateCompletenessScore(bookmark2);

      if (score1 > score2) {
        return { keep: bookmark1, remove: bookmark2 };
      } else if (score2 > score1) {
        return { keep: bookmark2, remove: bookmark1 };
      }
    }

    return { keep: bookmark1, remove: bookmark2 };
  }

  calculateCompletenessScore(bookmark) {
    let score = 0;

    if (bookmark.title && bookmark.title.length > 0) {
      score += 2;
    }
    if (bookmark.icon || bookmark.iconUri) {
      score += 1;
    }
    if (bookmark.addDate) {
      score += 1;
    }
    if (bookmark.lastVisit) {
      score += 1;
    }
    if (bookmark.folderPath && bookmark.folderPath.length > 0) {
      score += 1;
    }

    return score;
  }

  mergeBookmarkMetadata(keepBookmark, removeBookmark) {
    const merged = { ...keepBookmark };

    if (!merged.addDate && removeBookmark.addDate) {
      merged.addDate = removeBookmark.addDate;
    }
    if (!merged.lastModified && removeBookmark.lastModified) {
      merged.lastModified = removeBookmark.lastModified;
    }
    if (!merged.lastVisit && removeBookmark.lastVisit) {
      merged.lastVisit = removeBookmark.lastVisit;
    }
    if (!merged.icon && removeBookmark.icon) {
      merged.icon = removeBookmark.icon;
    }
    if (!merged.iconUri && removeBookmark.iconUri) {
      merged.iconUri = removeBookmark.iconUri;
    }

    if (!merged.meta) {
      merged.meta = {};
    }
    if (removeBookmark.meta) {
      merged.meta = { ...removeBookmark.meta, ...merged.meta };
    }

    merged.duplicatesMerged = (keepBookmark.duplicatesMerged || 0) + 1;
    merged.originalTitles = [
      ...(keepBookmark.originalTitles || [keepBookmark.title]),
      removeBookmark.title
    ].filter((title, index, self) => self.indexOf(title) === index);

    return merged;
  }

  generateDeduplicationReport(bookmarks) {
    const links = bookmarks.filter(b => b.type === 'link');
    const duplicates = this.findDuplicates(links);

    const duplicateGroups = new Map();
    for (const dup of duplicates) {
      const key = dup.corePath;
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, {
          corePath: key,
          bookmarks: new Set(),
          similarity: dup.similarity
        });
      }
      duplicateGroups.get(key).bookmarks.add(dup.bookmark1);
      duplicateGroups.get(key).bookmarks.add(dup.bookmark2);
    }

    const groups = [];
    const allInDuplicateGroups = new Set();
    const toRemove = [];
    const mergedBookmarks = [];

    for (const [_, group] of duplicateGroups) {
      const bookmarkList = Array.from(group.bookmarks);
      let keepBookmark = bookmarkList[0];
      const removeList = [];

      for (const bm of bookmarkList) {
        allInDuplicateGroups.add(bm);
      }

      for (let i = 1; i < bookmarkList.length; i++) {
        const selection = this.selectKeepBookmark(keepBookmark, bookmarkList[i]);
        if (selection.keep !== keepBookmark) {
          removeList.push(keepBookmark);
          keepBookmark = this.mergeBookmarkMetadata(selection.keep, keepBookmark);
        } else {
          removeList.push(bookmarkList[i]);
          keepBookmark = this.mergeBookmarkMetadata(keepBookmark, bookmarkList[i]);
        }
      }

      toRemove.push(...removeList);

      groups.push({
        corePath: group.corePath,
        keep: keepBookmark,
        remove: removeList,
        similarity: group.similarity,
        bookmarkCount: bookmarkList.length
      });

      mergedBookmarks.push(keepBookmark);
    }

    const remainingBookmarks = links.filter(b => !allInDuplicateGroups.has(b));
    const finalBookmarks = [...remainingBookmarks, ...mergedBookmarks];

    return {
      totalBookmarks: links.length,
      duplicateGroups: groups.length,
      duplicatesFound: toRemove.length,
      groups: groups,
      toRemove: toRemove,
      toKeep: finalBookmarks,
      statistics: {
        urlSimilarityThreshold: this.options.urlSimilarityThreshold,
        titleSimilarityThreshold: this.options.titleSimilarityThreshold,
        beforeCount: links.length,
        afterCount: finalBookmarks.length,
        removedCount: toRemove.length
      }
    };
  }

  deduplicate(bookmarks) {
    const report = this.generateDeduplicationReport(bookmarks);

    const folders = bookmarks.filter(b => b.type === 'folder');
    const result = [...folders, ...report.toKeep];

    return {
      deduplicated: result,
      report: report
    };
  }
}

module.exports = {
  BookmarkDeduplicator,
  DEFAULT_OPTIONS
};
