const { BaseParser, BrowserType, parseTimestamp, convertChromeTimestamp } = require('./BaseParser');

const ICON_PATTERNS = {
  dataUri: /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/,
  base64Only: /^[A-Za-z0-9+/=]+$/,
  pngHeader: /^iVBORw0KGgo/,
  icoHeader: /^AAABAA/
};

class ChromiumParser extends BaseParser {
  constructor(options = {}) {
    super(options);
    this.longAttrThreshold = options.longAttrThreshold || 1000;
    this.iconValidationEnabled = options.iconValidation !== false;
    this.maxIconSize = options.maxIconSize || 500 * 1024;
  }

  handleOpenTag(name, attrs) {
    if (name === 'a' && attrs) {
      attrs = this.processChromiumAttributes(attrs);
    }
    super.handleOpenTag(name, attrs);
  }

  processChromiumAttributes(attrs) {
    const processed = { ...attrs };

    if (processed.icon) {
      processed.icon = this.safeProcessIcon(processed.icon);
    }

    return processed;
  }

  safeProcessIcon(icon) {
    if (!icon) {
      return null;
    }

    if (typeof icon !== 'string') {
      return icon;
    }

    if (icon.length > this.maxIconSize) {
      console.warn(`ChromiumParser: Icon data too large (${icon.length} chars), truncating`);
      return null;
    }

    let processed = icon.trim();

    if (this.iconValidationEnabled) {
      processed = this.validateAndRepairIcon(processed);
    }

    return this.normalizeIconData(processed);
  }

  validateAndRepairIcon(icon) {
    if (!icon) {
      return null;
    }

    const dataUriMatch = icon.match(ICON_PATTERNS.dataUri);
    if (dataUriMatch) {
      const base64Part = dataUriMatch[2];
      const fixedBase64 = this.fixBase64Padding(base64Part);
      if (fixedBase64 !== base64Part) {
        return `data:${dataUriMatch[1]};base64,${fixedBase64}`;
      }
      return icon;
    }

    if (ICON_PATTERNS.base64Only.test(icon)) {
      return this.fixBase64Padding(icon);
    }

    return icon;
  }

  fixBase64Padding(base64) {
    if (!base64) {
      return base64;
    }

    const paddingNeeded = (4 - (base64.length % 4)) % 4;
    if (paddingNeeded > 0) {
      return base64 + '='.repeat(paddingNeeded);
    }
    return base64;
  }

  normalizeIconData(icon) {
    if (!icon) {
      return null;
    }

    if (typeof icon !== 'string') {
      return icon;
    }

    let normalized = icon.trim();

    if (normalized.startsWith('data:image/')) {
      return normalized;
    }

    if (ICON_PATTERNS.pngHeader.test(normalized)) {
      return `data:image/png;base64,${normalized}`;
    }

    if (ICON_PATTERNS.icoHeader.test(normalized)) {
      return `data:image/x-icon;base64,${normalized}`;
    }

    if (ICON_PATTERNS.base64Only.test(normalized)) {
      return `data:image/png;base64,${normalized}`;
    }

    return normalized;
  }

  extractBookmarkMeta(attrs) {
    const meta = super.extractBookmarkMeta(attrs);

    if (meta.icon) {
      meta.iconData = this.parseIconData(meta.icon);
      meta.iconMimeType = this.extractMimeType(meta.icon);
      meta.iconSize = this.calculateIconSize(meta.icon);
    }

    return meta;
  }

  parseIconData(icon) {
    if (!icon) {
      return null;
    }

    const base64Match = icon.match(ICON_PATTERNS.dataUri);
    if (base64Match) {
      return base64Match[2];
    }

    return icon;
  }

  extractMimeType(icon) {
    if (!icon) {
      return null;
    }

    const mimeMatch = icon.match(/^data:([^;]+);/);
    if (mimeMatch) {
      return mimeMatch[1];
    }

    if (ICON_PATTERNS.pngHeader.test(icon)) {
      return 'image/png';
    }

    if (ICON_PATTERNS.icoHeader.test(icon)) {
      return 'image/x-icon';
    }

    return 'image/png';
  }

  calculateIconSize(icon) {
    if (!icon) {
      return 0;
    }

    const base64Data = this.parseIconData(icon);
    if (!base64Data) {
      return icon.length;
    }

    return Math.floor((base64Data.length * 3) / 4);
  }

  isValidBase64(str) {
    if (!str) {
      return false;
    }
    try {
      const base64Match = str.match(ICON_PATTERNS.dataUri);
      const toTest = base64Match ? base64Match[2] : str;
      return ICON_PATTERNS.base64Only.test(toTest);
    } catch {
      return false;
    }
  }

  isChromiumBrowser() {
    return this.browserType === BrowserType.CHROME || this.browserType === BrowserType.EDGE;
  }
}

class ChromeParser extends ChromiumParser {
  constructor(options = {}) {
    super(options);
    this.browserType = BrowserType.CHROME;
  }

  handleCloseTag(name) {
    if (name === 'h1' || name === 'title') {
      if (this.inH3) {
        const text = this.currentH3Text.trim();
        if (text === 'Bookmarks') {
          this.browserType = BrowserType.CHROME;
        }
      }
    }
    super.handleCloseTag(name);
  }

  static parse(htmlContent, options = {}) {
    const parser = new ChromeParser(options);
    return parser.parse(htmlContent);
  }

  static async parseFromStream(readStream, options = {}) {
    const parser = new ChromeParser(options);
    return parser.parseFromStream(readStream);
  }

  static async parseFile(filePath, options = {}) {
    const parser = new ChromeParser(options);
    return parser.parseFile(filePath, options);
  }
}

class EdgeParser extends ChromiumParser {
  constructor(options = {}) {
    super(options);
    this.browserType = BrowserType.EDGE;
  }

  handleCloseTag(name) {
    if (name === 'h1' || name === 'title') {
      if (this.inH3) {
        const text = this.currentH3Text.trim();
        if (text === '收藏夹') {
          this.browserType = BrowserType.EDGE;
        }
      }
    }
    super.handleCloseTag(name);
  }

  static parse(htmlContent, options = {}) {
    const parser = new EdgeParser(options);
    return parser.parse(htmlContent);
  }

  static async parseFromStream(readStream, options = {}) {
    const parser = new EdgeParser(options);
    return parser.parseFromStream(readStream);
  }

  static async parseFile(filePath, options = {}) {
    const parser = new EdgeParser(options);
    return parser.parseFile(filePath, options);
  }
}

function detectBrowserType(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return BrowserType.UNKNOWN;
  }

  const lowerHtml = htmlContent.toLowerCase();

  if (lowerHtml.includes('<title>收藏夹</title>') || 
      lowerHtml.includes('<h1>收藏夹</h1>')) {
    return BrowserType.EDGE;
  }

  if (lowerHtml.includes('bookmarks menu')) {
    return BrowserType.FIREFOX;
  }

  if (lowerHtml.includes('<title>bookmarks</title>') || 
      lowerHtml.includes('<h1>bookmarks</h1>')) {
    return BrowserType.CHROME;
  }

  return BrowserType.UNKNOWN;
}

function autoParse(htmlContent, options = {}) {
  const browserType = detectBrowserType(htmlContent);
  
  switch (browserType) {
    case BrowserType.CHROME:
      return ChromeParser.parse(htmlContent, options);
    case BrowserType.EDGE:
      return EdgeParser.parse(htmlContent, options);
    default:
      return BaseParser.parse(htmlContent, options);
  }
}

module.exports = {
  ChromiumParser,
  ChromeParser,
  EdgeParser,
  detectBrowserType,
  autoParse,
  ICON_PATTERNS
};
