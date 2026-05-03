const http = require('http');

const TEST_SERVER = 'localhost';
const TEST_PORT = 4000;

async function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: TEST_SERVER,
      port: TEST_PORT,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: jsonData
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data,
            parseError: e.message
          });
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function testUpload() {
  console.log('========================================');
  console.log('  文档上传功能测试');
  console.log('========================================\n');

  console.log('[步骤 1] 登录获取 token...');
  try {
    const loginResponse = await httpRequest({
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      username: 'admin',
      password: 'admin123'
    }));

    console.log('  登录响应状态:', loginResponse.status);
    console.log('  登录响应数据:', JSON.stringify(loginResponse.data, null, 2));

    if (loginResponse.status !== 200 || !loginResponse.data.success) {
      console.error('\n❌ 登录失败!');
      process.exit(1);
    }

    const token = loginResponse.data.token;
    const userId = loginResponse.data.user.id;
    console.log('\n  ✓ 登录成功!');
    console.log('  Token:', token.substring(0, 30) + '...');
    console.log('  用户 ID:', userId);

    console.log('\n[步骤 2] 准备测试文件...');
    
    const testContent = '这是一个测试文件内容，用于验证文档上传功能。\nCreated: ' + new Date().toISOString();
    const testBuffer = Buffer.from(testContent, 'utf-8');
    const testBase64 = testBuffer.toString('base64');
    
    console.log('  测试文件名: test_upload_' + Date.now() + '.txt');
    console.log('  测试内容长度:', testContent.length, '字符');
    console.log('  Base64 长度:', testBase64.length, '字符');

    console.log('\n[步骤 3] 发送上传请求...');
    
    const uploadBody = {
      filename: 'test_upload_' + Date.now() + '.txt',
      file_base64: testBase64,
      uploader_id: userId,
      metadata: {
        original_name: 'test_upload.txt',
        mime_type: 'text/plain',
        test_upload: true
      }
    };

    const uploadResponse = await httpRequest({
      path: '/api/documents/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    }, JSON.stringify(uploadBody));

    console.log('  上传响应状态:', uploadResponse.status);
    console.log('  上传响应数据:');
    console.log(JSON.stringify(uploadResponse.data, null, 2));

    if (uploadResponse.status === 201 && uploadResponse.data.success) {
      console.log('\n  ✓ 上传成功!');
      console.log('  文档 ID:', uploadResponse.data.document.id);
      console.log('  存储路径:', uploadResponse.data.document.storage_path);
      console.log('  文件大小:', uploadResponse.data.document.file_size, '字节');
    } else {
      console.error('\n❌ 上传失败!');
      console.error('  错误信息:', uploadResponse.data.message || '未知错误');
    }

    console.log('\n[步骤 4] 获取文档列表验证...');
    
    const listResponse = await httpRequest({
      path: '/api/documents',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    console.log('  列表响应状态:', listResponse.status);
    if (listResponse.data.success) {
      console.log('  文档数量:', listResponse.data.documents ? listResponse.data.documents.length : 0);
      if (listResponse.data.documents && listResponse.data.documents.length > 0) {
        console.log('\n  最新文档:');
        const latest = listResponse.data.documents[0];
        console.log('    - 文件名:', latest.filename);
        console.log('    - 大小:', latest.file_size, '字节');
        console.log('    - 状态:', latest.status);
        console.log('    - 创建时间:', latest.created_at);
      }
    }

    console.log('\n========================================');
    console.log('  测试完成');
    console.log('========================================');

  } catch (error) {
    console.error('\n❌ 测试过程中发生错误:');
    console.error('  错误类型:', error.constructor.name);
    console.error('  错误消息:', error.message);
    console.error('  错误堆栈:', error.stack);
    process.exit(1);
  }
}

testUpload();
