const DiffType = {
  CHAR: 'char',
  WORD: 'word',
  LINE: 'line'
};

const ChangeType = {
  SAME: 'same',
  ADDED: 'added',
  REMOVED: 'removed'
};

function tokenizeByChar(text) {
  return text.split('');
}

function tokenizeByWord(text) {
  const tokens = [];
  let current = '';
  let inWhitespace = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (/\s/.test(char)) {
      if (!inWhitespace && current) {
        tokens.push(current);
        current = '';
      }
      inWhitespace = true;
      current += char;
    } else if (/[\.,;:\!\?\(\)\[\]\{\}\<\>\'\"\/\\@#\$%\^&\*\-_\+=\|]/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
      inWhitespace = false;
    } else {
      if (inWhitespace && current) {
        tokens.push(current);
        current = '';
      }
      inWhitespace = false;
      current += char;
    }
  }
  
  if (current) {
    tokens.push(current);
  }
  
  return tokens;
}

function tokenizeByLine(text) {
  const lines = text.split(/(\r?\n)/);
  const result = [];
  
  for (let i = 0; i < lines.length; i += 2) {
    if (i + 1 < lines.length) {
      result.push(lines[i] + lines[i + 1]);
    } else if (lines[i]) {
      result.push(lines[i]);
    }
  }
  
  return result;
}

function tokenize(text, type = DiffType.LINE) {
  if (!text) return [];
  
  switch (type) {
    case DiffType.CHAR:
      return tokenizeByChar(text);
    case DiffType.WORD:
      return tokenizeByWord(text);
    case DiffType.LINE:
    default:
      return tokenizeByLine(text);
  }
}

function computeLCS(oldTokens, newTokens) {
  const m = oldTokens.length;
  const n = newTokens.length;
  
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const lcs = [];
  let i = m, j = n;
  
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1] === newTokens[j - 1]) {
      lcs.unshift({
        value: oldTokens[i - 1],
        oldIndex: i - 1,
        newIndex: j - 1
      });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return lcs;
}

function computeDiff(oldTokens, newTokens) {
  const lcs = computeLCS(oldTokens, newTokens);
  const diffs = [];
  
  let oldIdx = 0;
  let newIdx = 0;
  
  for (const lcsItem of lcs) {
    while (oldIdx < lcsItem.oldIndex) {
      diffs.push({
        type: ChangeType.REMOVED,
        value: oldTokens[oldIdx],
        position: oldIdx
      });
      oldIdx++;
    }
    
    while (newIdx < lcsItem.newIndex) {
      diffs.push({
        type: ChangeType.ADDED,
        value: newTokens[newIdx],
        position: newIdx
      });
      newIdx++;
    }
    
    diffs.push({
      type: ChangeType.SAME,
      value: lcsItem.value,
      oldPosition: oldIdx,
      newPosition: newIdx
    });
    
    oldIdx++;
    newIdx++;
  }
  
  while (oldIdx < oldTokens.length) {
    diffs.push({
      type: ChangeType.REMOVED,
      value: oldTokens[oldIdx],
      position: oldIdx
    });
    oldIdx++;
  }
  
  while (newIdx < newTokens.length) {
    diffs.push({
      type: ChangeType.ADDED,
      value: newTokens[newIdx],
      position: newIdx
    });
    newIdx++;
  }
  
  return diffs;
}

function mergeAdjacentDiffs(diffs) {
  const merged = [];
  let current = null;
  
  for (const diff of diffs) {
    if (!current) {
      current = { ...diff, values: [diff.value] };
    } else if (current.type === diff.type) {
      current.values.push(diff.value);
    } else {
      current.content = current.values.join('');
      delete current.values;
      delete current.value;
      merged.push(current);
      current = { ...diff, values: [diff.value] };
    }
  }
  
  if (current) {
    current.content = current.values.join('');
    delete current.values;
    delete current.value;
    merged.push(current);
  }
  
  return merged;
}

function computeLineByLineDiff(oldText, newText, options = {}) {
  const { ignoreWhitespace = false, ignoreCase = false } = options;
  
  const oldLines = oldText ? oldText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];
  
  const normalizedOld = oldLines.map(line => {
    let normalized = line;
    if (ignoreWhitespace) {
      normalized = normalized.trim();
      normalized = normalized.replace(/\s+/g, ' ');
    }
    if (ignoreCase) normalized = normalized.toLowerCase();
    return normalized;
  });
  
  const normalizedNew = newLines.map(line => {
    let normalized = line;
    if (ignoreWhitespace) {
      normalized = normalized.trim();
      normalized = normalized.replace(/\s+/g, ' ');
    }
    if (ignoreCase) normalized = normalized.toLowerCase();
    return normalized;
  });
  
  const diffs = [];
  const lcs = computeLCS(normalizedOld, normalizedNew);
  
  let oldIdx = 0;
  let newIdx = 0;
  let oldLineNum = 1;
  let newLineNum = 1;
  
  for (const lcsItem of lcs) {
    while (oldIdx < lcsItem.oldIndex) {
      diffs.push({
        type: ChangeType.REMOVED,
        content: oldLines[oldIdx],
        oldLineNumber: oldLineNum++,
        newLineNumber: null
      });
      oldIdx++;
    }
    
    while (newIdx < lcsItem.newIndex) {
      diffs.push({
        type: ChangeType.ADDED,
        content: newLines[newIdx],
        oldLineNumber: null,
        newLineNumber: newLineNum++
      });
      newIdx++;
    }
    
    diffs.push({
      type: ChangeType.SAME,
      content: oldLines[oldIdx],
      oldLineNumber: oldLineNum++,
      newLineNumber: newLineNum++
    });
    
    oldIdx++;
    newIdx++;
  }
  
  while (oldIdx < oldLines.length) {
    diffs.push({
      type: ChangeType.REMOVED,
      content: oldLines[oldIdx],
      oldLineNumber: oldLineNum++,
      newLineNumber: null
    });
    oldIdx++;
  }
  
  while (newIdx < newLines.length) {
    diffs.push({
      type: ChangeType.ADDED,
      content: newLines[newIdx],
      oldLineNumber: null,
      newLineNumber: newLineNum++
    });
    newIdx++;
  }
  
  return diffs;
}

function computeSideBySideDiff(oldText, newText, options = {}) {
  const lineDiffs = computeLineByLineDiff(oldText, newText, options);
  const left = [];
  const right = [];
  
  for (const diff of lineDiffs) {
    if (diff.type === ChangeType.SAME) {
      left.push({
        type: ChangeType.SAME,
        content: diff.content,
        lineNumber: diff.oldLineNumber
      });
      right.push({
        type: ChangeType.SAME,
        content: diff.content,
        lineNumber: diff.newLineNumber
      });
    } else if (diff.type === ChangeType.REMOVED) {
      left.push({
        type: ChangeType.REMOVED,
        content: diff.content,
        lineNumber: diff.oldLineNumber
      });
      right.push({
        type: ChangeType.SAME,
        content: '',
        lineNumber: null
      });
    } else if (diff.type === ChangeType.ADDED) {
      left.push({
        type: ChangeType.SAME,
        content: '',
        lineNumber: null
      });
      right.push({
        type: ChangeType.ADDED,
        content: diff.content,
        lineNumber: diff.newLineNumber
      });
    }
  }
  
  return { left, right };
}

function computeUnifiedDiff(oldText, newText, options = {}) {
  const { contextLines = 3, format = 'standard' } = options;
  const lineDiffs = computeLineByLineDiff(oldText, newText, options);
  
  const hunkGroups = [];
  let currentHunk = null;
  let contextCount = 0;
  
  for (let i = 0; i < lineDiffs.length; i++) {
    const diff = lineDiffs[i];
    
    if (diff.type !== ChangeType.SAME) {
      if (!currentHunk) {
        const startIdx = Math.max(0, i - contextLines);
        currentHunk = {
          start: startIdx,
          lines: [],
          oldStart: null,
          oldCount: 0,
          newStart: null,
          newCount: 0
        };
        
        for (let j = startIdx; j < i; j++) {
          currentHunk.lines.push({
            type: ChangeType.SAME,
            content: lineDiffs[j].content
          });
          if (lineDiffs[j].oldLineNumber !== null) {
            if (currentHunk.oldStart === null) currentHunk.oldStart = lineDiffs[j].oldLineNumber;
            currentHunk.oldCount++;
          }
          if (lineDiffs[j].newLineNumber !== null) {
            if (currentHunk.newStart === null) currentHunk.newStart = lineDiffs[j].newLineNumber;
            currentHunk.newCount++;
          }
        }
      }
      
      currentHunk.lines.push({
        type: diff.type,
        content: diff.content
      });
      
      if (diff.type === ChangeType.REMOVED) {
        if (currentHunk.oldStart === null) currentHunk.oldStart = diff.oldLineNumber;
        currentHunk.oldCount++;
      } else if (diff.type === ChangeType.ADDED) {
        if (currentHunk.newStart === null) currentHunk.newStart = diff.newLineNumber;
        currentHunk.newCount++;
      }
      
      contextCount = 0;
    } else if (currentHunk) {
      currentHunk.lines.push({
        type: ChangeType.SAME,
        content: diff.content
      });
      if (diff.oldLineNumber !== null) {
        if (currentHunk.oldStart === null) currentHunk.oldStart = diff.oldLineNumber;
        currentHunk.oldCount++;
      }
      if (diff.newLineNumber !== null) {
        if (currentHunk.newStart === null) currentHunk.newStart = diff.newLineNumber;
        currentHunk.newCount++;
      }
      
      contextCount++;
      
      if (contextCount >= contextLines) {
        hunkGroups.push(currentHunk);
        currentHunk = null;
        contextCount = 0;
      }
    }
  }
  
  if (currentHunk) {
    hunkGroups.push(currentHunk);
  }
  
  if (format === 'standard') {
    let unifiedOutput = '';
    
    for (const hunk of hunkGroups) {
      unifiedOutput += `@@ -${hunk.oldStart || 0},${hunk.oldCount} +${hunk.newStart || 0},${hunk.newCount} @@\n`;
      
      for (const line of hunk.lines) {
        if (line.type === ChangeType.REMOVED) {
          unifiedOutput += `-${line.content}\n`;
        } else if (line.type === ChangeType.ADDED) {
          unifiedOutput += `+${line.content}\n`;
        } else {
          unifiedOutput += ` ${line.content}\n`;
        }
      }
    }
    
    return {
      hunks: hunkGroups,
      unifiedText: unifiedOutput,
      lineDiffs: hunkGroups.flatMap(h => h.lines)
    };
  }
  
  return {
    hunks: hunkGroups,
    lineDiffs: hunkGroups.flatMap(h => h.lines)
  };
}

function computeCharLevelDiff(oldText, newText) {
  const oldTokens = tokenize(oldText, DiffType.CHAR);
  const newTokens = tokenize(newText, DiffType.CHAR);
  const diffs = computeDiff(oldTokens, newTokens);
  return mergeAdjacentDiffs(diffs);
}

function computeWordLevelDiff(oldText, newText) {
  const oldTokens = tokenize(oldText, DiffType.WORD);
  const newTokens = tokenize(newText, DiffType.WORD);
  const diffs = computeDiff(oldTokens, newTokens);
  return mergeAdjacentDiffs(diffs);
}

function computeLineLevelDiff(oldText, newText, options = {}) {
  return computeLineByLineDiff(oldText, newText, options);
}

function computeDiffStatistics(oldText, newText) {
  const lineDiffs = computeLineByLineDiff(oldText, newText);
  
  let addedLines = 0;
  let removedLines = 0;
  let unchangedLines = 0;
  
  for (const diff of lineDiffs) {
    if (diff.type === ChangeType.ADDED) addedLines++;
    else if (diff.type === ChangeType.REMOVED) removedLines++;
    else unchangedLines++;
  }
  
  const oldLines = oldText ? oldText.split(/\r?\n/).length : 0;
  const newLines = newText ? newText.split(/\r?\n/).length : 0;
  
  const oldSize = oldText ? Buffer.byteLength(oldText, 'utf8') : 0;
  const newSize = newText ? Buffer.byteLength(newText, 'utf8') : 0;
  
  return {
    lines: {
      old: oldLines,
      new: newLines,
      added: addedLines,
      removed: removedLines,
      unchanged: unchangedLines
    },
    bytes: {
      old: oldSize,
      new: newSize,
      delta: newSize - oldSize
    },
    changePercentage: {
      lines: oldLines > 0 ? Math.round(((addedLines + removedLines) / oldLines) * 100) : 0,
      bytes: oldSize > 0 ? Math.round((Math.abs(newSize - oldSize) / oldSize) * 100) : 0
    }
  };
}

function generateHtmlDiff(diffs, type = 'inline') {
  if (type === 'inline') {
    return diffs.map(diff => {
      if (diff.type === ChangeType.REMOVED) {
        return `<span class="diff-removed">${escapeHtml(diff.content)}</span>`;
      } else if (diff.type === ChangeType.ADDED) {
        return `<span class="diff-added">${escapeHtml(diff.content)}</span>`;
      } else {
        return `<span class="diff-same">${escapeHtml(diff.content)}</span>`;
      }
    }).join('');
  }
  
  if (type === 'side-by-side') {
    const { left, right } = diffs;
    return {
      leftHtml: left.map(item => {
        if (item.type === ChangeType.REMOVED) {
          return `<div class="diff-line diff-line-removed"><span class="line-num">${item.lineNumber || ''}</span><span class="line-content">${escapeHtml(item.content)}</span></div>`;
        } else {
          return `<div class="diff-line diff-line-same"><span class="line-num">${item.lineNumber || ''}</span><span class="line-content">${escapeHtml(item.content)}</span></div>`;
        }
      }).join(''),
      rightHtml: right.map(item => {
        if (item.type === ChangeType.ADDED) {
          return `<div class="diff-line diff-line-added"><span class="line-num">${item.lineNumber || ''}</span><span class="line-content">${escapeHtml(item.content)}</span></div>`;
        } else {
          return `<div class="diff-line diff-line-same"><span class="line-num">${item.lineNumber || ''}</span><span class="line-content">${escapeHtml(item.content)}</span></div>`;
        }
      }).join('')
    };
  }
  
  return '';
}

function escapeHtml(text) {
  if (!text) return '';
  if (typeof document !== 'undefined' && document.createElement) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  DiffType,
  ChangeType,
  tokenize,
  tokenizeByChar,
  tokenizeByWord,
  tokenizeByLine,
  computeLCS,
  computeDiff,
  computeCharLevelDiff,
  computeWordLevelDiff,
  computeLineLevelDiff,
  computeLineByLineDiff,
  computeSideBySideDiff,
  computeUnifiedDiff,
  computeDiffStatistics,
  generateHtmlDiff,
  mergeAdjacentDiffs,
  escapeHtml
};
