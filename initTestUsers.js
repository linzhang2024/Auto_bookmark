const db = require('./database');
const User = require('./userModel');
const Role = require('./roleModel');

async function initTestUsers() {
  try {
    console.log('正在初始化数据库...');
    await db.initDatabase();
    
    console.log('查找角色...');
    const adminRole = await Role.findByName('admin');
    const userRole = await Role.findByName('user');
    
    if (!adminRole) {
      console.error('管理员角色不存在，请先启动服务器初始化数据库');
      process.exit(1);
    }
    
    if (!userRole) {
      console.error('普通用户角色不存在，请先启动服务器初始化数据库');
      process.exit(1);
    }
    
    console.log('检查测试用户是否已存在...');
    
    let adminUser = await User.findByUsername('admin');
    if (!adminUser) {
      console.log('创建管理员账户...');
      adminUser = await User.create(
        'admin',
        'admin123',
        'admin@example.com',
        adminRole.id
      );
      console.log('✓ 管理员账户创建成功');
      console.log('  用户名: admin');
      console.log('  密码: admin123');
      console.log('  邮箱: admin@example.com');
    } else {
      console.log('✓ 管理员账户已存在');
      console.log('  用户名: admin');
      console.log('  密码: admin123（如果已修改请使用新密码）');
    }
    
    let testUser = await User.findByUsername('user');
    if (!testUser) {
      console.log('创建普通用户账户...');
      testUser = await User.create(
        'user',
        'user123',
        'user@example.com',
        userRole.id
      );
      console.log('✓ 普通用户账户创建成功');
      console.log('  用户名: user');
      console.log('  密码: user123');
      console.log('  邮箱: user@example.com');
    } else {
      console.log('✓ 普通用户账户已存在');
      console.log('  用户名: user');
      console.log('  密码: user123（如果已修改请使用新密码）');
    }
    
    console.log('\n═══════════════════════════════════════════');
    console.log('  测试用户初始化完成');
    console.log('═══════════════════════════════════════════');
    console.log('\n  可用的测试账户:');
    console.log('\n  管理员账户:');
    console.log('    用户名: admin');
    console.log('    密码: admin123');
    console.log('    权限: 系统管理员，可管理所有用户');
    console.log('\n  普通用户账户:');
    console.log('    用户名: user');
    console.log('    密码: user123');
    console.log('    权限: 普通用户，可上传和管理自己的文档');
    console.log('\n═══════════════════════════════════════════\n');
    
    await db.closeDatabase();
    process.exit(0);
    
  } catch (error) {
    console.error('初始化测试用户失败:', error.message);
    console.error(error.stack);
    try {
      await db.closeDatabase();
    } catch (e) {}
    process.exit(1);
  }
}

initTestUsers();
