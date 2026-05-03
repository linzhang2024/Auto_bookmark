const User = require('../src/models/userModel');
const { initDatabase, closeDatabase, getDb } = require('../src/services/database');
const bcrypt = require('bcryptjs');

describe('User Model - 输入验证测试', () => {
  describe('用户名验证', () => {
    test('应该拒绝空用户名', () => {
      expect(User.validateUsername('').valid).toBe(false);
      expect(User.validateUsername(null).valid).toBe(false);
      expect(User.validateUsername(undefined).valid).toBe(false);
    });

    test('应该拒绝太短的用户名', () => {
      expect(User.validateUsername('ab').valid).toBe(false);
    });

    test('应该拒绝太长的用户名', () => {
      const longUsername = 'a'.repeat(51);
      expect(User.validateUsername(longUsername).valid).toBe(false);
    });

    test('应该拒绝包含特殊字符的用户名', () => {
      expect(User.validateUsername('user@name').valid).toBe(false);
      expect(User.validateUsername('user name').valid).toBe(false);
      expect(User.validateUsername('user#name').valid).toBe(false);
    });

    test('应该接受有效的用户名', () => {
      expect(User.validateUsername('valid_user').valid).toBe(true);
      expect(User.validateUsername('user123').valid).toBe(true);
      expect(User.validateUsername('User_123').valid).toBe(true);
    });
  });

  describe('密码验证', () => {
    test('应该拒绝空密码', () => {
      expect(User.validatePassword('').valid).toBe(false);
      expect(User.validatePassword(null).valid).toBe(false);
      expect(User.validatePassword(undefined).valid).toBe(false);
    });

    test('应该拒绝太短的密码', () => {
      expect(User.validatePassword('12345').valid).toBe(false);
    });

    test('应该拒绝太长的密码', () => {
      const longPassword = 'a'.repeat(129);
      expect(User.validatePassword(longPassword).valid).toBe(false);
    });

    test('应该接受有效的密码', () => {
      expect(User.validatePassword('password123').valid).toBe(true);
      expect(User.validatePassword('SecurePass1!').valid).toBe(true);
    });
  });

  describe('邮箱验证', () => {
    test('应该拒绝空邮箱', () => {
      expect(User.validateEmail('').valid).toBe(false);
      expect(User.validateEmail(null).valid).toBe(false);
      expect(User.validateEmail(undefined).valid).toBe(false);
    });

    test('应该拒绝格式不正确的邮箱', () => {
      expect(User.validateEmail('invalid').valid).toBe(false);
      expect(User.validateEmail('invalid@').valid).toBe(false);
      expect(User.validateEmail('@invalid.com').valid).toBe(false);
      expect(User.validateEmail('invalid@.com').valid).toBe(false);
      expect(User.validateEmail('invalid com@example.com').valid).toBe(false);
    });

    test('应该接受有效的邮箱格式', () => {
      expect(User.validateEmail('user@example.com').valid).toBe(true);
      expect(User.validateEmail('user.name@example.com').valid).toBe(true);
      expect(User.validateEmail('user+tag@example.co.uk').valid).toBe(true);
    });
  });
});

describe('User Model - 密码哈希测试', () => {
  test('应该正确哈希密码', async () => {
    const password = 'testPassword123';
    const hash = await User.hashPassword(password);
    
    expect(hash).not.toBe(password);
    expect(hash).toBeDefined();
    expect(hash.length).toBeGreaterThan(0);
  });

  test('应该正确比较密码和哈希', async () => {
    const password = 'testPassword123';
    const hash = await User.hashPassword(password);
    
    const isMatch = await User.comparePassword(password, hash);
    expect(isMatch).toBe(true);
    
    const isNotMatch = await User.comparePassword('wrongPassword', hash);
    expect(isNotMatch).toBe(false);
  });
});

describe('User Model - CRUD 操作测试', () => {
  let db;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    db = await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  afterEach(async () => {
    await db.run('DELETE FROM users');
  });

  describe('用户创建（注册）', () => {
    test('应该成功创建新用户', async () => {
      const userData = {
        username: 'testuser',
        password: 'testPassword123',
        email: 'test@example.com'
      };

      const user = await User.create(
        userData.username,
        userData.password,
        userData.email
      );

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.username).toBe(userData.username);
      expect(user.email).toBe(userData.email);
      expect(user.password).not.toBe(userData.password);
      expect(user.created_at).toBeDefined();
      expect(user.updated_at).toBeDefined();
    });

    test('应该拒绝用户名已存在的用户', async () => {
      const userData1 = {
        username: 'testuser',
        password: 'password123',
        email: 'user1@example.com'
      };

      const userData2 = {
        username: 'testuser',
        password: 'password456',
        email: 'user2@example.com'
      };

      await User.create(userData1.username, userData1.password, userData1.email);
      
      await expect(
        User.create(userData2.username, userData2.password, userData2.email)
      ).rejects.toThrow('用户名已存在');
    });

    test('应该拒绝邮箱已被注册的用户', async () => {
      const userData1 = {
        username: 'user1',
        password: 'password123',
        email: 'test@example.com'
      };

      const userData2 = {
        username: 'user2',
        password: 'password456',
        email: 'test@example.com'
      };

      await User.create(userData1.username, userData1.password, userData1.email);
      
      await expect(
        User.create(userData2.username, userData2.password, userData2.email)
      ).rejects.toThrow('邮箱已被注册');
    });

    test('应该拒绝无效的用户名', async () => {
      await expect(
        User.create('ab', 'password123', 'test@example.com')
      ).rejects.toThrow('用户名至少需要 3 个字符');
    });

    test('应该拒绝无效的密码', async () => {
      await expect(
        User.create('validuser', '12345', 'test@example.com')
      ).rejects.toThrow('密码至少需要 6 个字符');
    });

    test('应该拒绝无效的邮箱', async () => {
      await expect(
        User.create('validuser', 'password123', 'invalid-email')
      ).rejects.toThrow('邮箱格式不正确');
    });
  });

  describe('用户查询', () => {
    test('应该通过 ID 找到用户', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      };

      const createdUser = await User.create(
        userData.username,
        userData.password,
        userData.email
      );

      const foundUser = await User.findById(createdUser.id);
      
      expect(foundUser).not.toBeNull();
      expect(foundUser.id).toBe(createdUser.id);
      expect(foundUser.username).toBe(createdUser.username);
      expect(foundUser.email).toBe(createdUser.email);
    });

    test('通过不存在的 ID 查找应该返回 null', async () => {
      const foundUser = await User.findById(999999);
      expect(foundUser).toBeNull();
    });

    test('应该通过用户名找到用户', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      };

      await User.create(userData.username, userData.password, userData.email);

      const foundUser = await User.findByUsername(userData.username);
      
      expect(foundUser).not.toBeNull();
      expect(foundUser.username).toBe(userData.username);
      expect(foundUser.email).toBe(userData.email);
    });

    test('应该通过邮箱找到用户', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      };

      await User.create(userData.username, userData.password, userData.email);

      const foundUser = await User.findByEmail(userData.email);
      
      expect(foundUser).not.toBeNull();
      expect(foundUser.username).toBe(userData.username);
      expect(foundUser.email).toBe(userData.email);
    });

    test('toJSON 方法不应该包含密码', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      };

      const user = await User.create(
        userData.username,
        userData.password,
        userData.email
      );

      const userJson = user.toJSON();
      
      expect(userJson.password).toBeUndefined();
      expect(userJson.id).toBe(user.id);
      expect(userJson.username).toBe(user.username);
      expect(userJson.email).toBe(user.email);
    });
  });

  describe('用户信息更新', () => {
    test('应该成功更新用户信息', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      };

      const createdUser = await User.create(
        userData.username,
        userData.password,
        userData.email
      );

      const updates = {
        username: 'newusername',
        email: 'newemail@example.com'
      };

      const updatedUser = await User.update(createdUser.id, updates);
      
      expect(updatedUser.username).toBe(updates.username);
      expect(updatedUser.email).toBe(updates.email);
    });

    test('应该成功更新密码', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      };

      const createdUser = await User.create(
        userData.username,
        userData.password,
        userData.email
      );

      const newPassword = 'newPassword456';
      const updatedUser = await User.update(createdUser.id, { password: newPassword });
      
      const isMatch = await User.comparePassword(newPassword, updatedUser.password);
      expect(isMatch).toBe(true);
    });

    test('应该拒绝更新为已存在的用户名', async () => {
      const userData1 = {
        username: 'user1',
        password: 'password123',
        email: 'user1@example.com'
      };

      const userData2 = {
        username: 'user2',
        password: 'password123',
        email: 'user2@example.com'
      };

      const user1 = await User.create(userData1.username, userData1.password, userData1.email);
      await User.create(userData2.username, userData2.password, userData2.email);

      await expect(
        User.update(user1.id, { username: userData2.username })
      ).rejects.toThrow('用户名已存在');
    });

    test('应该拒绝更新为已存在的邮箱', async () => {
      const userData1 = {
        username: 'user1',
        password: 'password123',
        email: 'user1@example.com'
      };

      const userData2 = {
        username: 'user2',
        password: 'password123',
        email: 'user2@example.com'
      };

      const user1 = await User.create(userData1.username, userData1.password, userData1.email);
      await User.create(userData2.username, userData2.password, userData2.email);

      await expect(
        User.update(user1.id, { email: userData2.email })
      ).rejects.toThrow('邮箱已被注册');
    });

    test('更新不存在的用户应该抛出错误', async () => {
      await expect(
        User.update(999999, { username: 'newname' })
      ).rejects.toThrow('用户不存在');
    });

    test('没有提供更新字段时应该返回原用户', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      };

      const createdUser = await User.create(
        userData.username,
        userData.password,
        userData.email
      );

      const updatedUser = await User.update(createdUser.id, {});
      
      expect(updatedUser.id).toBe(createdUser.id);
      expect(updatedUser.username).toBe(createdUser.username);
    });
  });

  describe('用户删除（注销）', () => {
    test('应该成功删除用户', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com'
      };

      const createdUser = await User.create(
        userData.username,
        userData.password,
        userData.email
      );

      const result = await User.delete(createdUser.id);
      expect(result).toBe(true);

      const foundUser = await User.findById(createdUser.id);
      expect(foundUser).toBeNull();
    });

    test('删除不存在的用户应该抛出错误', async () => {
      await expect(
        User.delete(999999)
      ).rejects.toThrow('用户不存在');
    });
  });

  describe('列出所有用户', () => {
    test('应该列出所有用户', async () => {
      const users = await User.listAll();
      expect(users).toEqual([]);

      const userData1 = {
        username: 'user1',
        password: 'password123',
        email: 'user1@example.com'
      };

      const userData2 = {
        username: 'user2',
        password: 'password123',
        email: 'user2@example.com'
      };

      await User.create(userData1.username, userData1.password, userData1.email);
      await User.create(userData2.username, userData2.password, userData2.email);

      const allUsers = await User.listAll();
      expect(allUsers.length).toBe(2);
    });
  });
});

describe('User Model - 权限检查测试', () => {
  const Role = require('../src/models/roleModel');
  const { initDatabase, closeDatabase, run } = require('../src/services/database');
  let db;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    db = await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  afterEach(async () => {
    await run('DELETE FROM users');
    await run('DELETE FROM roles WHERE name NOT IN (?, ?, ?)', ['admin', 'user', 'guest']);
  });

  describe('hasAllPermissions 方法', () => {
    test('应该正确检查用户是否拥有所有指定权限', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'has_all_user',
        'password123',
        'hasall@example.com',
        userRole.id
      );

      const hasAll = await user.hasAllPermissions(['user:read', 'bookmark:read']);
      expect(hasAll).toBe(true);

      const hasNotAll = await user.hasAllPermissions(['user:read', 'admin:access']);
      expect(hasNotAll).toBe(false);
    });

    test('没有角色的用户应该返回 false', async () => {
      const user = await User.create(
        'no_role_user',
        'password123',
        'norole@example.com'
      );

      const result = await user.hasAllPermissions(['user:read']);
      expect(result).toBe(false);
    });

    test('空权限数组应该返回 false', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'empty_perm_user',
        'password123',
        'emptyperm@example.com',
        userRole.id
      );

      const result = await user.hasAllPermissions([]);
      expect(result).toBe(false);
    });
  });

  describe('hasAnyPermission 方法', () => {
    test('应该正确检查用户是否拥有任意指定权限', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'has_any_user',
        'password123',
        'hasany@example.com',
        userRole.id
      );

      const hasAny = await user.hasAnyPermission(['user:read', 'nonexistent:perm']);
      expect(hasAny).toBe(true);

      const hasNotAny = await user.hasAnyPermission(['admin:access', 'nonexistent:perm']);
      expect(hasNotAny).toBe(false);
    });

    test('没有角色的用户应该返回 false', async () => {
      const user = await User.create(
        'no_role_any',
        'password123',
        'noroleany@example.com'
      );

      const result = await user.hasAnyPermission(['user:read']);
      expect(result).toBe(false);
    });
  });

  describe('checkPermission 方法', () => {
    test('单个权限检查应该正确工作', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'check_single_user',
        'password123',
        'checksingle@example.com',
        userRole.id
      );

      const hasRead = await user.checkPermission('user:read');
      expect(hasRead).toBe(true);

      const hasAdminAccess = await user.checkPermission('admin:access');
      expect(hasAdminAccess).toBe(false);
    });

    test('多权限检查默认应该检查是否有任意权限', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'check_multi_user',
        'password123',
        'checkmulti@example.com',
        userRole.id
      );

      const result = await user.checkPermission(['user:read', 'admin:access']);
      expect(result).toBe(true);
    });

    test('多权限检查 requireAll=true 应该检查是否拥有所有权限', async () => {
      const adminRole = await Role.findByName('admin');
      
      const user = await User.create(
        'check_all_user',
        'password123',
        'checkall@example.com',
        adminRole.id
      );

      const hasAll = await user.checkPermission(
        ['user:read', 'admin:access'],
        { requireAll: true }
      );
      expect(hasAll).toBe(true);

      const hasNotAll = await user.checkPermission(
        ['user:read', 'nonexistent:perm'],
        { requireAll: true }
      );
      expect(hasNotAll).toBe(false);
    });

    test('没有角色的用户应该返回 false', async () => {
      const user = await User.create(
        'no_role_check',
        'password123',
        'norolecheck@example.com'
      );

      const result = await user.checkPermission('user:read');
      expect(result).toBe(false);
    });
  });

  describe('checkPermissionByUserId 静态方法', () => {
    test('应该通过用户ID正确检查权限', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'static_check_user',
        'password123',
        'staticcheck@example.com',
        userRole.id
      );

      const hasRead = await User.checkPermissionByUserId(user.id, 'user:read');
      expect(hasRead).toBe(true);

      const hasAdminAccess = await User.checkPermissionByUserId(user.id, 'admin:access');
      expect(hasAdminAccess).toBe(false);
    });

    test('应该支持多权限检查', async () => {
      const adminRole = await Role.findByName('admin');
      
      const user = await User.create(
        'static_multi_user',
        'password123',
        'staticmulti@example.com',
        adminRole.id
      );

      const hasAny = await User.checkPermissionByUserId(
        user.id,
        ['user:read', 'nonexistent:perm']
      );
      expect(hasAny).toBe(true);

      const hasAll = await User.checkPermissionByUserId(
        user.id,
        ['user:read', 'admin:access'],
        { requireAll: true }
      );
      expect(hasAll).toBe(true);
    });

    test('不存在的用户应该返回 false', async () => {
      const result = await User.checkPermissionByUserId(999999, 'user:read');
      expect(result).toBe(false);
    });
  });
});
