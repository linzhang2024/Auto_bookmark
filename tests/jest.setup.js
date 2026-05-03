/**
 * Jest 测试环境配置
 * 在测试运行前执行，确保测试环境正确初始化
 */

const path = require('path');
const fs = require('fs');

const envTestPath = path.join(__dirname, '.env.test');
const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envTestPath)) {
  require('dotenv').config({ path: envTestPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  console.log('[Jest Setup] No .env file found, using default configuration');
}
