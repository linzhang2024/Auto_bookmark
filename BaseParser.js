const fs = require('fs');
const { Parser } = require('htmlparser2');
const config = require('./config');

const BrowserType = {
  CHROME: 'chrome',
  EDGE: 'edge',
  FIREFOX: 'firefox',
  UNKNOWN: 'unknown'
};

const EPOCH_DIFF = 11644473600000000;
const NANOSECONDS_100_TO_MILLISECONDS = 10000;

function parseTimestamp(value, options = {}) {
  if (!value) {
    return null;
  }
  try {
    const ts = parseInt(String(value), 10);
    if (isNaN(ts) || ts <= 0) {
      return null;
    }

    const { browserType = BrowserType.UNKNOWN } = options;

    if (isChromeMicroseconds(ts, browserType)) {
      return convertChromeTimestamp(ts);
    }

    if (isSeconds(ts)) {
      return new Date(ts * 1000);
    }

    if (isMilliseconds(ts)) {
      return new Date(ts);
    }

    return new Date(ts * 1000);
  } catch {
    return null;
  }
}

function isChromeMicroseconds(ts, browserType) {
  if (browserType === BrowserType.CHROME || browserType === BrowserType.EDGE) {
    return ts >= EPOCH_DIFF;
  }
  return ts >= 10000000000000000;
}

function convertChromeTimestamp(ts) {
  const tsNum = typeof ts === 'bigint' ? Number(ts) : Number(ts);
  const milliseconds = (tsNum - EPOCH_DIFF) / NANOSECONDS_100_TO_MILLISECONDS;
  return new Date(milliseconds);
}

function isSeconds(ts) {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  return ts <= nowSeconds + 315360000 && ts >= 631152000;
}

function isMilliseconds(ts) {
  const now = Date.now();
  return ts <= now + 315360000000 && ts >= 631152000000;
}

function chromeTimestampToDate(ts) {
  return convertChromeTimestamp(ts);
}

function dateToChromeTimestamp(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return null;
  }
  return BigInt(date.getTime()) * BigInt(NANOSECONDS_100_TO_MILLISECONDS) + BigInt(EPOCH_DIFF);
}

function extractDomainFromUrl(url) {
  if (!url) {
    return '';
  }

  try {
    const urlObj = new URL(url);
    return urlObj.hostname || url;
  } catch {
    return url;
  }
}

class BaseParser {
  constructor(options = {}) {
    this.options = {
      emitEvent: options.emitEvent || false,
      onItem: options.onItem || null,
      onBatch: options.onBatch || null,
      onFolder: options.onFolder || null,
      onLink: options.onLink || null,
      batchSize: options.batchSize || 100,
      flatten: options.flatten || false,
      ...options
    };
    
    this.reset();
  }

  reset() {
    this.items = [];
    this.flatItems = [];
    this.folderStack = [];
    this.currentLevel = -1;
    this.browserType = BrowserType.UNKNOWN;
    this.dlCount = 0;
    this.inH3 = false;
    this.inA = false;
    this.currentH3Text = '';
    this.currentH3Attrs = {};
    this.currentAText = '';
    this.currentAAttrs = {};
    this.pendingFolder = null;
    this.itemCount = 0;
    this.batchItems = [];
    this.isParsing = false;
  }

  createHtmlParser() {
    return new Parser({
      onopentag: (name, attrs) => {
        try {
          this.handleOpenTag(name.toLowerCase(), attrs);
        } catch (error) {
          console.warn('BaseParser: Error handling open tag:', error.message);
        }
      },
      onclosetag: (name) => {
        try {
          this.handleCloseTag(name.toLowerCase());
        } catch (error) {
          console.warn('BaseParser: Error handling close tag:', error.message);
        }
      },
      ontext: (text) => {
        try {
          this.handleText(text);
        } catch (error) {
          console.warn('BaseParser: Error handling text:', error.message);
        }
      },
      onerror: (error) => {
        console.warn('BaseParser: Parse error:', error.message);
      }
    }, {
      decodeEntities: false,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
      recognizeSelfClosing: true
    });
  }

  parse(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') {
      return [];
    }

    this.reset();
    this.isParsing = true;

    const parser = this.createHtmlParser();

    try {
      parser.write(htmlContent);
      parser.end();
      this.flushBatch();
    } catch (error) {
      console.error('BaseParser: Fatal parse error:', error.message);
    }

    this.isParsing = false;
    return this.options.flatten ? this.flatItems : this.items;
  }

  async parseFromStream(readStream) {
    return new Promise((resolve, reject) => {
      this.reset();
      this.isParsing = true;

      const htmlParser = this.createHtmlParser();

      readStream.on('data', (chunk) => {
        try {
          htmlParser.write(chunk.toString());
        } catch (error) {
          console.warn('BaseParser: Error processing chunk:', error.message);
        }
      });

      readStream.on('end', () => {
        try {
          htmlParser.end();
          this.flushBatch();
          this.isParsing = false;
          resolve(this.options.flatten ? this.flatItems : this.items);
        } catch (error) {
          reject(error);
        }
      });

      readStream.on('error', reject);
    });
  }

  async parseFile(filePath, options = {}) {
    return new Promise((resolve, reject) => {
      const mergedOptions = { ...this.options, ...options };
      
      try {
        const readStream = fs.createReadStream(filePath, {
          encoding: 'utf-8',
          highWaterMark: mergedOptions.chunkSize || 64 * 1024
        });
        
        const tempOptions = this.options;
        this.options = mergedOptions;
        
        this.parseFromStream(readStream)
          .then((result) => {
            this.options = tempOptions;
            resolve(result);
          })
          .catch((error) => {
            this.options = tempOptions;
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  handleOpenTag(name, attrs) {
    switch (name) {
      case 'h1':
      case 'title':
        this.inH3 = true;
        this.currentH3Text = '';
        this.currentH3Attrs = attrs;
        break;
      case 'h3':
        this.inH3 = true;
        this.currentH3Text = '';
        this.currentH3Attrs = attrs;
        break;
      case 'a':
        this.inA = true;
        this.currentAText = '';
        this.currentAAttrs = attrs;
        break;
      case 'dl':
        this.dlCount++;
        this.currentLevel++;
        
        if (this.pendingFolder) {
          this.folderStack.push(this.pendingFolder);
          this.pendingFolder = null;
        }
        break;
      case 'meta':
        if (attrs['http-equiv'] && attrs['http-equiv'].toLowerCase() === 'content-type') {
          const content = attrs.content || '';
          if (content.toLowerCase().includes('utf')) {
            this.browserType = BrowserType.CHROME;
          }
        }
        break;
    }
  }

  handleCloseTag(name) {
    switch (name) {
      case 'h1':
      case 'title':
        if (this.inH3) {
          const text = this.currentH3Text.trim();
          if (text === '收藏夹') {
            this.browserType = BrowserType.EDGE;
          } else if (text === 'Bookmarks Menu' || text.includes('Menu')) {
            this.browserType = BrowserType.FIREFOX;
          } else if (text === 'Bookmarks') {
            this.browserType = BrowserType.CHROME;
          }
          this.inH3 = false;
          this.currentH3Text = '';
        }
        break;
      case 'h3':
        if (this.inH3) {
          const folderName = this.currentH3Text.trim();
          if (folderName) {
            const folderMeta = this.extractFolderMeta(this.currentH3Attrs);
            
            this.pendingFolder = {
              type: 'folder',
              name: folderName,
              level: this.currentLevel + 1,
              children: [],
              addDate: folderMeta.addDate,
              lastModified: folderMeta.lastModified,
              isPersonalToolbar: folderMeta.isPersonalToolbar,
              isUnfiled: folderMeta.isUnfiled,
              meta: folderMeta,
              browserType: this.browserType,
              folderPath: this.getCurrentFolderPath()
            };
          }
          this.inH3 = false;
          this.currentH3Text = '';
          this.currentH3Attrs = {};
        }
        break;
      case 'a':
        if (this.inA) {
          const bookmarkMeta = this.extractBookmarkMeta(this.currentAAttrs);
          const url = bookmarkMeta.href;
          
          if (!config.shouldFilter(url)) {
            let title = this.currentAText.trim();
            if (!title) {
              title = extractDomainFromUrl(url);
            }

            const item = {
              type: 'link',
              title: title,
              url: url,
              level: this.currentLevel,
              addDate: bookmarkMeta.addDate,
              lastModified: bookmarkMeta.lastModified,
              lastVisit: bookmarkMeta.lastVisit,
              icon: bookmarkMeta.icon,
              iconUri: bookmarkMeta.iconUri,
              meta: bookmarkMeta,
              browserType: this.browserType,
              folderPath: this.getCurrentFolderPath()
            };

            this.addItem(item);
          }
          this.inA = false;
          this.currentAText = '';
          this.currentAAttrs = {};
        }
        break;
      case 'dl':
        if (this.dlCount > 0) {
          this.dlCount--;
          this.currentLevel--;
          
          if (this.folderStack.length > 0) {
            const folder = this.folderStack.pop();
            this.addItem(folder);
          }
        }
        break;
    }
  }

  handleText(text) {
    if (this.inH3) {
      this.currentH3Text += text;
    }
    if (this.inA) {
      this.currentAText += text;
    }
  }

  extractFolderMeta(attrs) {
    const addDateStr = attrs.add_date;
    const lastModifiedStr = attrs.last_modified;
    const isPersonalToolbar = attrs.personal_toolbar_folder === 'true';
    const isUnfiled = attrs.unfiled_bookmarks_folder === 'true';

    const timestampOptions = { browserType: this.browserType };

    return {
      addDate: parseTimestamp(addDateStr, timestampOptions),
      lastModified: parseTimestamp(lastModifiedStr, timestampOptions),
      isPersonalToolbar,
      isUnfiled,
      addDateStr,
      lastModifiedStr
    };
  }

  extractBookmarkMeta(attrs) {
    const href = attrs.href || '';
    const addDateStr = attrs.add_date;
    const lastModifiedStr = attrs.last_modified;
    const lastVisitStr = attrs.last_visit;
    const icon = attrs.icon || null;
    const iconUri = attrs.icon_uri || null;

    const timestampOptions = { browserType: this.browserType };

    return {
      href,
      addDate: parseTimestamp(addDateStr, timestampOptions),
      lastModified: parseTimestamp(lastModifiedStr, timestampOptions),
      lastVisit: parseTimestamp(lastVisitStr, timestampOptions),
      icon,
      iconUri,
      addDateStr,
      lastModifiedStr,
      lastVisitStr
    };
  }

  getCurrentFolderPath() {
    return this.folderStack.map(f => f.name);
  }

  addItem(item) {
    if (this.options.emitEvent && this.options.onItem) {
      this.options.onItem(item);
    }

    if (this.options.emitEvent) {
      if (item.type === 'folder' && this.options.onFolder) {
        this.options.onFolder(item);
      }
      if (item.type === 'link' && this.options.onLink) {
        this.options.onLink(item);
      }
    }

    if (this.options.flatten) {
      this.flatItems.push(item);
    } else {
      if (this.folderStack.length > 0) {
        const parentFolder = this.folderStack[this.folderStack.length - 1];
        if (parentFolder && parentFolder.children) {
          parentFolder.children.push(item);
        }
      } else {
        this.items.push(item);
      }
    }

    this.itemCount++;
    this.batchItems.push(item);

    if (this.batchItems.length >= this.options.batchSize) {
      this.flushBatch();
    }
  }

  flushBatch() {
    if (this.batchItems.length > 0 && this.options.emitEvent && this.options.onBatch) {
      this.options.onBatch([...this.batchItems]);
    }
    this.batchItems = [];
  }

  static parse(htmlContent, options = {}) {
    const parser = new BaseParser(options);
    return parser.parse(htmlContent);
  }

  static async parseFromStream(readStream, options = {}) {
    const parser = new BaseParser(options);
    return parser.parseFromStream(readStream);
  }

  static async parseFile(filePath, options = {}) {
    const parser = new BaseParser(options);
    return parser.parseFile(filePath, options);
  }
}

module.exports = {
  BaseParser,
  BrowserType,
  parseTimestamp,
  extractDomainFromUrl,
  chromeTimestampToDate,
  dateToChromeTimestamp,
  convertChromeTimestamp
};