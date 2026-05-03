const Role = require('../src/models/roleModel');
const User = require('../src/models/userModel');
const { initDatabase, closeDatabase, getDb, run } = require('../src/services/database');

describe('角色管理集成测试 - 完整业务链路', () => {
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

  describe('场景1: 角色创建与用户关联', () => {
    test('应该能够创建自定义角色并分配给用户', async () => {
      const customRole = await Role.create(
        'content_manager',
        '内容管理员，可以管理所有书签',
        ['bookmark:read', 'bookmark:create', 'bookmark:update', 'bookmark:delete']
      );

      expect(customRole.id).toBeDefined();
      expect(customRole.name).toBe('content_manager');

      const user = await User.create(
        'content_user',
        'password123',
        'content@example.com',
        customRole.id
      );

      expect(user.role_id).toBe(customRole.id);
    });

    test('创建用户时不指定角色应该 role_id 为 null', async () => {
      const user = await User.create(
        'no_role_user',
        'password123',
        'norole@example.com'
      );

      expect(user.role_id).toBeNull();
    });

    test('创建用户时指定不存在的角色应该抛出错误', async () => {
      await expect(
        User.create(
          'bad_role_user',
          'password123',
          'badrole@example.com',
          999999
        )
      ).rejects.toThrow('角色不存在');
    });
  });

  describe('场景2: 用户权限判定', () => {
    test('管理员用户应该拥有 admin:access 权限', async () => {
      const adminRole = await Role.findByName('admin');
      expect(adminRole).not.toBeNull();

      const adminUser = await User.create(
        'admin_user',
        'password123',
        'admin@example.com',
        adminRole.id
      );

      const hasAdminAccess = await adminUser.hasPermission('admin:access');
      expect(hasAdminAccess).toBe(true);

      const hasUserCreate = await adminUser.hasPermission('user:create');
      expect(hasUserCreate).toBe(true);

      const hasBookmarkDelete = await adminUser.hasPermission('bookmark:delete');
      expect(hasBookmarkDelete).toBe(true);
    });

    test('普通用户应该没有 admin:access 权限', async () => {
      const userRole = await Role.findByName('user');
      expect(userRole).not.toBeNull();

      const regularUser = await User.create(
        'regular_user',
        'password123',
        'regular@example.com',
        userRole.id
      );

      const hasAdminAccess = await regularUser.hasPermission('admin:access');
      expect(hasAdminAccess).toBe(false);

      const hasBookmarkRead = await regularUser.hasPermission('bookmark:read');
      expect(hasBookmarkRead).toBe(true);
    });

    test('没有角色的用户应该没有任何权限', async () => {
      const user = await User.create(
        'no_perm_user',
        'password123',
        'noperm@example.com'
      );

      const hasAnyPermission = await user.hasPermission('any:permission');
      expect(hasAnyPermission).toBe(false);
    });
  });

  describe('场景3: 两表联查逻辑', () => {
    test('findByIdWithRole 应该返回带有角色信息的用户', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'join_test_user',
        'password123',
        'join@example.com',
        userRole.id
      );

      const userWithRole = await User.findByIdWithRole(user.id);
      
      expect(userWithRole).not.toBeNull();
      expect(userWithRole.id).toBe(user.id);
      expect(userWithRole._role).not.toBeNull();
      expect(userWithRole._role.name).toBe('user');
      expect(userWithRole._role.permissions).toEqual(userRole.permissions);
    });

    test('findByUsernameWithRole 应该返回带有角色信息的用户', async () => {
      const adminRole = await Role.findByName('admin');
      
      await User.create(
        'admin_join_test',
        'password123',
        'adminjoin@example.com',
        adminRole.id
      );

      const userWithRole = await User.findByUsernameWithRole('admin_join_test');
      
      expect(userWithRole).not.toBeNull();
      expect(userWithRole._role).not.toBeNull();
      expect(userWithRole._role.name).toBe('admin');
    });

    test('findByEmailWithRole 应该返回带有角色信息的用户', async () => {
      const guestRole = await Role.findByName('guest');
      
      await User.create(
        'guest_join_test',
        'password123',
        'guestjoin@example.com',
        guestRole.id
      );

      const userWithRole = await User.findByEmailWithRole('guestjoin@example.com');
      
      expect(userWithRole).not.toBeNull();
      expect(userWithRole._role).not.toBeNull();
      expect(userWithRole._role.name).toBe('guest');
    });

    test('listAllWithRole 应该返回所有用户及其角色信息', async () => {
      const adminRole = await Role.findByName('admin');
      const userRole = await Role.findByName('user');

      await User.create('user1', 'password123', 'user1@example.com', adminRole.id);
      await User.create('user2', 'password123', 'user2@example.com', userRole.id);
      await User.create('user3', 'password123', 'user3@example.com');

      const allUsersWithRole = await User.listAllWithRole();
      
      expect(allUsersWithRole.length).toBe(3);
      
      const adminUser = allUsersWithRole.find(u => u.username === 'user1');
      expect(adminUser._role.name).toBe('admin');
      
      const regularUser = allUsersWithRole.find(u => u.username === 'user2');
      expect(regularUser._role.name).toBe('user');
      
      const noRoleUser = allUsersWithRole.find(u => u.username === 'user3');
      expect(noRoleUser._role).toBeNull();
    });

    test('toJSON 方法在有角色时应该包含角色信息', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'json_role_user',
        'password123',
        'jsonrole@example.com',
        userRole.id
      );

      const userWithRole = await User.findByIdWithRole(user.id);
      const userJson = userWithRole.toJSON();

      expect(userJson.role).toBeDefined();
      expect(userJson.role.name).toBe('user');
      expect(userJson.role.permissions).toEqual(userRole.permissions);
      expect(userJson.role_id).toBe(userRole.id);
    });
  });

  describe('场景4: 角色分配更新逻辑', () => {
    test('应该能够通过 update 方法更改用户角色', async () => {
      const userRole = await Role.findByName('user');
      const adminRole = await Role.findByName('admin');

      const user = await User.create(
        'update_role_user',
        'password123',
        'updaterole@example.com',
        userRole.id
      );

      expect(user.role_id).toBe(userRole.id);

      const updatedUser = await User.update(user.id, {
        role_id: adminRole.id
      });

      expect(updatedUser.role_id).toBe(adminRole.id);

      const hasAdminAccess = await updatedUser.hasPermission('admin:access');
      expect(hasAdminAccess).toBe(true);
    });

    test('应该能够将用户角色设置为 null（移除角色）', async () => {
      const userRole = await Role.findByName('user');

      const user = await User.create(
        'remove_role_user',
        'password123',
        'removerole@example.com',
        userRole.id
      );

      expect(user.role_id).toBe(userRole.id);

      const updatedUser = await User.update(user.id, {
        role_id: null
      });

      expect(updatedUser.role_id).toBeNull();

      const hasPermission = await updatedUser.hasPermission('bookmark:read');
      expect(hasPermission).toBe(false);
    });

    test('更新为不存在的角色应该抛出错误', async () => {
      const userRole = await Role.findByName('user');

      const user = await User.create(
        'bad_update_user',
        'password123',
        'badupdate@example.com',
        userRole.id
      );

      await expect(
        User.update(user.id, { role_id: 999999 })
      ).rejects.toThrow('角色不存在');
    });
  });

  describe('场景5: 完整业务流程测试', () => {
    test('完整流程：创建角色 -> 创建用户 -> 分配角色 -> 检查权限 -> 更新角色 -> 再次检查权限', async () => {
      const editorRole = await Role.create(
        'editor',
        '编辑人员，可以创建和编辑内容',
        ['bookmark:read', 'bookmark:create', 'bookmark:update']
      );

      expect(editorRole.id).toBeDefined();

      const user = await User.create(
        'editor_user',
        'password123',
        'editor@example.com',
        editorRole.id
      );

      expect(user.role_id).toBe(editorRole.id);

      let canRead = await user.hasPermission('bookmark:read');
      let canCreate = await user.hasPermission('bookmark:create');
      let canDelete = await user.hasPermission('bookmark:delete');
      
      expect(canRead).toBe(true);
      expect(canCreate).toBe(true);
      expect(canDelete).toBe(false);

      const adminRole = await Role.findByName('admin');
      await User.update(user.id, { role_id: adminRole.id });

      const userWithNewRole = await User.findByIdWithRole(user.id);
      
      canDelete = await userWithNewRole.hasPermission('bookmark:delete');
      const hasAdminAccess = await userWithNewRole.hasPermission('admin:access');
      
      expect(canDelete).toBe(true);
      expect(hasAdminAccess).toBe(true);

      const userJson = userWithNewRole.toJSON();
      expect(userJson.role.name).toBe('admin');
      expect(userJson.role_id).toBe(adminRole.id);
    });

    test('getRole 方法应该正确获取用户角色信息', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'get_role_test',
        'password123',
        'getrole@example.com',
        userRole.id
      );

      const role = await user.getRole();
      
      expect(role).not.toBeNull();
      expect(role.name).toBe('user');
      expect(role.permissions).toEqual(userRole.permissions);
    });

    test('getRole 方法对无角色用户应该返回 null', async () => {
      const user = await User.create(
        'no_role_get_test',
        'password123',
        'noroleget@example.com'
      );

      const role = await user.getRole();
      
      expect(role).toBeNull();
    });
  });

  describe('场景6: 角色权限更新影响用户', () => {
    test('更新角色权限后，用户应该获得新权限', async () => {
      const customRole = await Role.create(
        'limited_role',
        '受限角色',
        ['bookmark:read']
      );

      const user = await User.create(
        'perm_update_user',
        'password123',
        'permupdate@example.com',
        customRole.id
      );

      let canWrite = await user.hasPermission('bookmark:write');
      expect(canWrite).toBe(false);

      await Role.update(customRole.id, {
        permissions: ['bookmark:read', 'bookmark:write']
      });

      const userWithRole = await User.findByIdWithRole(user.id);
      canWrite = await userWithRole.hasPermission('bookmark:write');
      expect(canWrite).toBe(true);
    });
  });
});
