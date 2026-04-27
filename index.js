#!/usr/bin/env node

/**
 * 浏览器书签转换工具入口文件
 * 支持 Chrome、Edge、Firefox 导出的 HTML 书签
 * 功能：
 * 1. 将 HTML 格式的书签转换为 Markdown 格式
 * 2. 本地镜像同步功能：将书签同步到本地文件系统，包含文件夹映射、元数据持久化、图标缓存
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');
const {
  parseChromeBookmarks,
  parseBookmarks,
  convertToMarkdown,
  countBookmarks,
  countFolders
} = require('./bookmarkConverter');
const {
  syncToLocalMirror,
  checkSyncStatus
} = require('./localMirrorSync');

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
Chrome 书签转换工具 - 使用说明

基本用法:
  node index.js [选项] [输入文件]

选项:
  -h, --help                    显示此帮助信息
  
  Markdown 转换选项:
    -o, --output <文件>         指定输出 Markdown 文件路径
  
  本地镜像同步选项:
    -s, --sync                  启用本地镜像同步模式
    -d, --sync-dir <目录>       指定同步输出目录（默认: ./bookmarks_mirror）
    --check-status <目录>       检查指定目录的同步状态（无需输入文件）
    --skip-icon                 跳过图标下载（仅同步元数据）
    --force                     强制更新（忽略已存在的文件）
    -c, --concurrency <数字>    最大并发数（默认: 5）
    -t, --timeout <毫秒>        超时时间（默认: 10000）

示例:
  # 转换为 Markdown
  node index.js bookmarks.html -o bookmarks.md
  
  # 本地镜像同步（包含图标下载）
  node index.js bookmarks.html -s -d ./my_bookmarks
  
  # 检查同步状态
  node index.js --check-status ./my_bookmarks
  
  # 快速同步（跳过图标下载）
  node index.js bookmarks.html -s -d ./my_bookmarks --skip-icon
`);
}

/**
 * 格式化时间差
 * @param {number} ms - 毫秒数
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m${seconds}s`;
}

/**
 * 搜索指定目录下的所有 .html 文件
 * @param {string} directory - 目录路径
 * @returns {Array} - 文件路径列表（按修改时间排序，最新的在前）
 */
function findHtmlFiles(directory = process.cwd()) {
  try {
    const files = fs.readdirSync(directory);
    const htmlFiles = files
      .filter(file => file.toLowerCase().endsWith('.html'))
      .map(file => path.join(directory, file));

    htmlFiles.sort((a, b) => {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      return statB.mtimeMs - statA.mtimeMs;
    });

    return htmlFiles;
  } catch (error) {
    return [];
  }
}

/**
 * 从 HTML 文件列表中选择一个文件
 * @param {Array} htmlFiles - HTML 文件路径列表
 * @param {string} defaultName - 默认文件名
 * @returns {string|null} - 选中的文件路径
 */
async function selectHtmlFile(htmlFiles, defaultName = 'bookmarks.html') {
  if (!htmlFiles || htmlFiles.length === 0) {
    return null;
  }

  const defaultFiles = htmlFiles.filter(f =>
    path.basename(f).toLowerCase() === defaultName.toLowerCase()
  );
  if (defaultFiles.length > 0) {
    return defaultFiles[0];
  }

  if (htmlFiles.length === 1) {
    return htmlFiles[0];
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`找到 ${htmlFiles.length} 个 HTML 文件，请选择要转换的文件：`);
  htmlFiles.forEach((file, i) => {
    console.log(`  ${i + 1}. ${path.basename(file)}`);
  });
  console.log(`  ${htmlFiles.length + 1}. 取消`);

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(`请输入选择 (1-${htmlFiles.length + 1}): `, (choice) => {
        const choiceNum = parseInt(choice.trim(), 10);
        if (Number.isInteger(choiceNum) && choiceNum >= 1 && choiceNum <= htmlFiles.length) {
          rl.close();
          resolve(htmlFiles[choiceNum - 1]);
        } else if (choiceNum === htmlFiles.length + 1) {
          rl.close();
          resolve(null);
        } else {
          console.log(`请输入 1 到 ${htmlFiles.length + 1} 之间的数字`);
          ask();
        }
      });
    };
    ask();
  });
}

/**
 * 执行 Markdown 转换
 * @param {string} inputFile - 输入 HTML 文件路径
 * @param {string|null} outputFile - 输出 Markdown 文件路径
 */
async function executeMarkdownConversion(inputFile, outputFile) {
  console.log(`正在处理文件: ${inputFile}`);

  let htmlContent;
  try {
    htmlContent = fs.readFileSync(inputFile, 'utf-8');
  } catch (error) {
    console.log(`错误: 无法读取文件 '${inputFile}' - ${error.message}`);
    process.exit(1);
  }

  const bookmarks = parseBookmarks(htmlContent);
  const folderCount = countFolders(bookmarks);
  const linkCount = countBookmarks(bookmarks);

  if (folderCount === 0 && linkCount === 0) {
    console.log('警告: 没有找到任何有效的书签');
    process.exit(0);
  }

  const markdownContent = convertToMarkdown(bookmarks);

  if (outputFile) {
    try {
      fs.writeFileSync(outputFile, markdownContent, 'utf-8');
      console.log('成功转换！');
      console.log(`  文件夹数量: ${folderCount}`);
      console.log(`  链接数量: ${linkCount}`);
      console.log(`输出文件: ${outputFile}`);
    } catch (error) {
      console.log(`错误: 无法写入文件 '${outputFile}' - ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log(markdownContent);
    console.log('\n成功转换！');
    console.log(`  文件夹数量: ${folderCount}`);
    console.log(`  链接数量: ${linkCount}`);
  }
}

/**
 * 执行本地镜像同步
 * @param {string} inputFile - 输入 HTML 文件路径
 * @param {Object} options - 同步选项
 */
async function executeLocalSync(inputFile, options) {
  const {
    syncDir,
    skipIcon,
    force,
    concurrency,
    timeout
  } = options;

  console.log(`正在处理文件: ${inputFile}`);
  console.log(`同步输出目录: ${syncDir}`);

  let htmlContent;
  try {
    htmlContent = fs.readFileSync(inputFile, 'utf-8');
  } catch (error) {
    console.log(`错误: 无法读取文件 '${inputFile}' - ${error.message}`);
    process.exit(1);
  }

  const bookmarks = parseBookmarks(htmlContent);
  const folderCount = countFolders(bookmarks);
  const linkCount = countBookmarks(bookmarks);

  if (folderCount === 0 && linkCount === 0) {
    console.log('警告: 没有找到任何有效的书签');
    process.exit(0);
  }

  console.log(`发现 ${folderCount} 个文件夹，${linkCount} 个书签`);
  
  if (skipIcon) {
    console.log('模式: 仅同步元数据（跳过图标下载）');
  } else {
    console.log('模式: 完整同步（包含图标下载）');
  }

  const startTime = Date.now();
  let lastProgressTime = startTime;

  const result = await syncToLocalMirror(bookmarks, syncDir, {
    maxConcurrent: concurrency,
    timeout: timeout,
    skipIconDownload: skipIcon,
    forceUpdate: force,
    onProgress: (current, total, message) => {
      const now = Date.now();
      if (now - lastProgressTime > 500 || current === total) {
        const progress = total > 0 ? Math.round((current / total) * 100) : 0;
        process.stdout.write(`\r[${'='.repeat(Math.floor(progress / 10))}${' '.repeat(10 - Math.floor(progress / 10))}] ${progress}% - ${message}`);
        lastProgressTime = now;
      }
    }
  });

  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log('\n');
  console.log('═══════════════════════════════════════════');
  console.log('           同步完成！');
  console.log('═══════════════════════════════════════════');
  console.log(`同步 ID: ${result.syncId}`);
  console.log(`总文件夹数: ${result.totalFolders}`);
  console.log(`总书签数: ${result.totalBookmarks}`);
  console.log(`新建文件夹: ${result.foldersCreated}`);
  console.log(`新同步书签: ${result.bookmarksSynced}`);
  console.log(`已同步书签: ${result.bookmarksAlreadySynced}`);
  console.log(`失败书签: ${result.bookmarksFailed}`);
  console.log(`处理冲突: ${result.bookmarksWithConflicts}`);
  console.log(`耗时: ${formatDuration(duration)}`);
  console.log('═══════════════════════════════════════════');

  if (result.failedBookmarks.length > 0) {
    console.log('\n失败的书签:');
    for (const bm of result.failedBookmarks) {
      console.log(`  - ${bm.title}: ${bm.url}`);
    }
  }
}

/**
 * 执行同步状态检查
 * @param {string} syncDir - 同步目录
 */
function executeCheckStatus(syncDir) {
  console.log(`正在检查同步状态: ${syncDir}`);
  console.log('');

  const status = checkSyncStatus(syncDir);

  if (status.totalFolders === 0 && status.totalBookmarks === 0) {
    console.log('该目录尚未进行过同步操作，或未找到有效的元数据文件。');
    return;
  }

  console.log('═══════════════════════════════════════════');
  console.log('           同步状态摘要');
  console.log('═══════════════════════════════════════════');
  console.log(`总文件夹数: ${status.totalFolders}`);
  console.log(`总书签数: ${status.totalBookmarks}`);
  console.log(`已完成: ${status.completedBookmarks}`);
  console.log(`待处理: ${status.pendingBookmarks}`);
  console.log(`失败: ${status.failedBookmarks}`);
  
  const progress = status.totalBookmarks > 0 
    ? Math.round((status.completedBookmarks / status.totalBookmarks) * 100) 
    : 0;
  console.log(`\n整体进度: ${progress}%`);
  console.log(`[${'='.repeat(Math.floor(progress / 10))}${' '.repeat(10 - Math.floor(progress / 10))}]`);

  if (status.folders.length > 0) {
    console.log('\n═══════════════════════════════════════════');
    console.log('           各文件夹详情');
    console.log('═══════════════════════════════════════════');
    
    for (const folder of status.folders) {
      const folderProgress = folder.totalBookmarks > 0 
        ? Math.round((folder.completedBookmarks / folder.totalBookmarks) * 100) 
        : 0;
      
      console.log(`\n📁 ${folder.name}`);
      console.log(`   路径: ${folder.path}`);
      console.log(`   书签数: ${folder.totalBookmarks}`);
      console.log(`   进度: ${folderProgress}% (${folder.completedBookmarks}/${folder.totalBookmarks})`);
      
      if (folder.failedBookmarks > 0) {
        console.log(`   ⚠ 失败: ${folder.failedBookmarks}`);
      }
      if (folder.pendingBookmarks > 0) {
        console.log(`   ⏳ 待处理: ${folder.pendingBookmarks}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════');
  if (status.pendingBookmarks > 0 || status.failedBookmarks > 0) {
    console.log(`提示: 可以重新运行同步命令来继续处理剩余的 ${status.pendingBookmarks + status.failedBookmarks} 个书签。`);
  } else {
    console.log('所有书签已同步完成！');
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  
  let inputFile = config.inputBookmarksPath;
  let outputFile = null;
  let enableSync = false;
  let syncDir = null;
  let checkStatusDir = null;
  let skipIcon = false;
  let force = false;
  let concurrency = config.maxConcurrency;
  let timeout = config.iconTimeout;
  let showHelpFlag = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-h' || arg === '--help') {
      showHelpFlag = true;
    } else if (arg === '-s' || arg === '--sync') {
      enableSync = true;
    } else if ((arg === '-o' || arg === '--output') && i + 1 < args.length) {
      outputFile = args[i + 1];
      i++;
    } else if ((arg === '-d' || arg === '--sync-dir') && i + 1 < args.length) {
      syncDir = args[i + 1];
      i++;
    } else if (arg === '--check-status' && i + 1 < args.length) {
      checkStatusDir = args[i + 1];
      i++;
    } else if (arg === '--skip-icon') {
      skipIcon = true;
    } else if (arg === '--force') {
      force = true;
    } else if ((arg === '-c' || arg === '--concurrency') && i + 1 < args.length) {
      const num = parseInt(args[i + 1], 10);
      if (!isNaN(num) && num > 0) {
        concurrency = num;
      }
      i++;
    } else if ((arg === '-t' || arg === '--timeout') && i + 1 < args.length) {
      const num = parseInt(args[i + 1], 10);
      if (!isNaN(num) && num > 0) {
        timeout = num;
      }
      i++;
    } else if (!inputFile) {
      inputFile = arg;
    }
  }

  if (showHelpFlag) {
    showHelp();
    return;
  }

  if (checkStatusDir) {
    executeCheckStatus(path.resolve(checkStatusDir));
    return;
  }

  if (!inputFile || !fs.existsSync(inputFile)) {
    if (inputFile && !fs.existsSync(inputFile)) {
      console.log(`警告: 输入文件 '${inputFile}' 不存在`);
    }

    console.log('正在搜索当前目录下的 HTML 文件...');
    const htmlFiles = findHtmlFiles();

    if (htmlFiles.length === 0) {
      console.log('错误: 当前目录下没有找到任何 HTML 文件');
      console.log('使用 --help 查看帮助信息');
      process.exit(1);
    }

    inputFile = await selectHtmlFile(htmlFiles);
    if (!inputFile) {
      console.log('已取消操作');
      process.exit(0);
    }
  }

  if (enableSync) {
    const resolvedSyncDir = syncDir 
      ? path.resolve(syncDir) 
      : config.syncDir;
    
    await executeLocalSync(inputFile, {
      syncDir: resolvedSyncDir,
      skipIcon,
      force,
      concurrency,
      timeout
    });
  } else {
    await executeMarkdownConversion(inputFile, outputFile);
  }
}

main().catch(error => {
  console.error('发生错误:', error);
  process.exit(1);
});
