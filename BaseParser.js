const { Parser } = require('htmlparser2');
const config = require('./config');

const BrowserType = {
  CHROME: 'chrome',
  EDGE: 'edge',
  FIREFOX: 'firefox',
  UNKNOWN: 'unknown'
};

function parseTimestamp(value) {
  if (!value) {
    return null;
  }
  try {
    const ts = parseInt(String(value), 10);
    if (isNaN(ts) || ts <= 0) {
      return null;
    }
    return new Date(ts * 1000);
  } catch {
    return null;
  }
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
      batchSize: options.batchSize || 100,
      ...options
    };
    
    this.reset();
  }

  reset() {
    this.items = [];
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
  }

  parse(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') {
      return [];
    }

    this.reset();

    const parser = new Parser({
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

    try {
      parser.write(htmlContent);
      parser.end();
      this.flushBatch();
    } catch (error) {
      console.error('BaseParser: Fatal parse error:', error.message);
    }

    return this.items;
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

    return {
      addDate: parseTimestamp(addDateStr),
      lastModified: parseTimestamp(lastModifiedStr),
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

    return {
      href,
      addDate: parseTimestamp(addDateStr),
      lastModified: parseTimestamp(lastModifiedStr),
      lastVisit: parseTimestamp(lastVisitStr),
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

    if (this.folderStack.length > 0) {
      const parentFolder = this.folderStack[this.folderStack.length - 1];
      if (parentFolder && parentFolder.children) {
        parentFolder.children.push(item);
      }
    } else {
      this.items.push(item);
    }

    this.itemCount++;
    this.batchItems.push(item);

    if (this.batchItems.length >= this.options.batchSize) {
      this.flushBatch();
    }
  }

  flushBatch() {
    if (this.batchItems.length > 0 && this.options.emitEvent && this.options.onBatch) {
      this.options.onBatch(this.batchItems);
    }
    this.batchItems = [];
  }

  static parse(htmlContent, options = {}) {
    const parser = new BaseParser(options);
    return parser.parse(htmlContent);
  }

  static parseStream(readStream, options = {}) {
    return new Promise((resolve, reject) => {
      const parser = new BaseParser({
        ...options,
        emitEvent: true
      });

      const htmlParser = new Parser({
        onopentag: (name, attrs) => parser.handleOpenTag(name.toLowerCase(), attrs),
        onclosetag: (name) => parser.handleCloseTag(name.toLowerCase()),
        ontext: (text) => parser.handleText(text),
        onerror: (error) => console.warn('BaseParser: Stream parse error:', error.message)
      }, {
        decodeEntities: false,
        lowerCaseTags: true,
        lowerCaseAttributeNames: true,
        recognizeSelfClosing: true
      });

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
          parser.flushBatch();
          resolve(parser.items);
        } catch (error) {
          reject(error);
        }
      });

      readStream.on('error', reject);
    });
  }
}

module.exports = {
  BaseParser,
  BrowserType,
  parseTimestamp,
  extractDomainFromUrl
};