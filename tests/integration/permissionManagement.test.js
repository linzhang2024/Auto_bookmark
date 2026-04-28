const Role = require('../../roleModel');
const User = require('../../userModel');
const { initDatabase, closeDatabase, run } = require('../../database');

describe('权限管理集成测试 - 完整业务闭环', () => {
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

  describe('场景1: 权限分配与校验完整闭环', () => {
    test('完整流程：为角色分配权限 -> 创建用户并分配角色 -> 校验权限成功 -> 移除权限 -> 校验失败', async () => {
      const editorRole = await Role.create(
        'doc_editor',
        '文档编辑角色',
        ['doc:read']
      );

      expect(editorRole.hasPermission('doc:read')).toBe(true);
      expect(editorRole.hasPermission('doc:create')).toBe(false);

      const editorUser = await User.create(
        'editor_user',
        'password123',
        'editor@example.com',
        editorRole.id
      );

      let hasDocRead = await editorUser.hasPermission('doc:read');
      let hasDocCreate = await editorUser.hasPermission('doc:create');
      
      expect(hasDocRead).toBe(true);
      expect(hasDocCreate).toBe(false);

      await Role.addPermission(editorRole.id, 'doc:create');

      const updatedRole = await Role.findById(editorRole.id);
      expect(updatedRole.hasPermission('doc:create')).toBe(true);

      const userWithNewPerm = await User.findByIdWithRole(editorUser.id);
      hasDocCreate = await userWithNewPerm.hasPermission('doc:create');
      expect(hasDocCreate).toBe(true);

      await Role.removePermission(editorRole.id, 'doc:read');

      const roleAfterRemove = await Role.findById(editorRole.id);
      expect(roleAfterRemove.hasPermission('doc:read')).toBe(false);
      expect(roleAfterRemove.hasPermission('doc:create')).toBe(true);

      const userAfterRemove = await User.findByIdWithRole(editorUser.id);
      hasDocRead = await userAfterRemove.hasPermission('doc:read');
      let hasDocCreateAfter = await userAfterRemove.hasPermission('doc:create');
      
      expect(hasDocRead).toBe(false);
      expect(hasDocCreateAfter).toBe(true);
    });

    test('使用 checkPermission 方法进行统一权限校验', async () => {
      const customRole = await Role.create(
        'content_manager',
        '内容管理员',
        ['doc:read', 'doc:create', 'doc:update']
      );

      const user = await User.create(
        'content_user',
        'password123',
        'content@example.com',
        customRole.id
      );

      const userWithRole = await User.findByIdWithRole(user.id);

      const canRead = await userWithRole.checkPermission('doc:read');
      expect(canRead).toBe(true);

      const canDelete = await userWithRole.checkPermission('doc:delete');
      expect(canDelete).toBe(false);

      const canReadOrCreate = await userWithRole.checkPermission(['doc:read', 'doc:create']);
      expect(canReadOrCreate).toBe(true);

      const canReadOrDelete = await userWithRole.checkPermission(['doc:read', 'doc:delete']);
      expect(canReadOrDelete).toBe(true);

      const canReadAndCreate = await userWithRole.checkPermission(
        ['doc:read', 'doc:create'],
        { requireAll: true }
      );
      expect(canReadAndCreate).toBe(true);

      const canReadAndDelete = await userWithRole.checkPermission(
        ['doc:read', 'doc:delete'],
        { requireAll: true }
      );
      expect(canReadAndDelete).toBe(false);
    });
  });

  describe('场景2: 批量权限管理', () => {
    test('批量添加和移除权限', async () => {
      const limitedRole = await Role.create(
        'limited_role',
        '受限角色',
        ['doc:read']
      );

      expect(limitedRole.permissions.length).toBe(1);

      await Role.addPermissions(limitedRole.id, ['doc:create', 'doc:update', 'doc:delete']);

      const roleWithMorePerms = await Role.findById(limitedRole.id);
      expect(roleWithMorePerms.permissions.length).toBe(4);
      expect(roleWithMorePerms.hasPermission('doc:read')).toBe(true);
      expect(roleWithMorePerms.hasPermission('doc:create')).toBe(true);
      expect(roleWithMorePerms.hasPermission('doc:update')).toBe(true);
      expect(roleWithMorePerms.hasPermission('doc:delete')).toBe(true);

      await Role.removePermissions(limitedRole.id, ['doc:create', 'doc:delete']);

      const roleAfterRemove = await Role.findById(limitedRole.id);
      expect(roleAfterRemove.permissions.length).toBe(2);
      expect(roleAfterRemove.hasPermission('doc:read')).toBe(true);
      expect(roleAfterRemove.hasPermission('doc:update')).toBe(true);
      expect(roleAfterRemove.hasPermission('doc:create')).toBe(false);
      expect(roleAfterRemove.hasPermission('doc:delete')).toBe(false);
    });

    test('批量权限检查', async () => {
      const fullAccessRole = await Role.create(
        'full_access',
        '完全访问角色',
        ['doc:read', 'doc:create', 'doc:update', 'doc:delete']
      );

      const user = await User.create(
        'full_access_user',
        'password123',
        'fullaccess@example.com',
        fullAccessRole.id
      );

      const userWithRole = await User.findByIdWithRole(user.id);

      const hasAllDocPerms = await userWithRole.hasAllPermissions([
        'doc:read',
        'doc:create',
        'doc:update',
        'doc:delete'
      ]);
      expect(hasAllDocPerms).toBe(true);

      const hasAllWithExtra = await userWithRole.hasAllPermissions([
        'doc:read',
        'nonexistent:perm'
      ]);
      expect(hasAllWithExtra).toBe(false);

      const hasAnySpecial = await userWithRole.hasAnyPermission([
        'nonexistent:perm1',
        'nonexistent:perm2',
        'doc:read'
      ]);
      expect(hasAnySpecial).toBe(true);

      const hasAnyNonexistent = await userWithRole.hasAnyPermission([
        'nonexistent:perm1',
        'nonexistent:perm2'
      ]);
      expect(hasAnyNonexistent).toBe(false);
    });
  });

  describe('场景3: 静态方法权限校验', () => {
    test('checkPermissionByUserId 应该通过用户ID进行权限校验', async () => {
      const userRole = await Role.findByName('user');
      
      const user = await User.create(
        'static_test_user',
        'password123',
        'statictest@example.com',
        userRole.id
      );

      const canReadUser = await User.checkPermissionByUserId(user.id, 'user:read');
      expect(canReadUser).toBe(true);

      const hasAdminAccess = await User.checkPermissionByUserId(user.id, 'admin:access');
      expect(hasAdminAccess).toBe(false);

      const canReadOrWrite = await User.checkPermissionByUserId(
        user.id,
        ['user:read', 'user:update']
      );
      expect(canReadOrWrite).toBe(true);

      const canReadAndWrite = await User.checkPermissionByUserId(
        user.id,
        ['user:read', 'user:update'],
        { requireAll: true }
      );
      expect(canReadAndWrite).toBe(true);
    });

    test('checkPermissionByUserId 对不存在的用户返回 false', async () => {
      const result = await User.checkPermissionByUserId(999999, 'any:perm');
      expect(result).toBe(false);
    });
  });

  describe('场景4: 权限变更对用户的实时影响', () => {
    test('角色权限变更后，用户权限检查应该实时生效', async () => {
      const dynamicRole = await Role.create(
        'dynamic_role',
        '动态权限测试角色',
        ['doc:read']
      );

      const user = await User.create(
        'dynamic_user',
        'password123',
        'dynamic@example.com',
        dynamicRole.id
      );

      let userWithRole = await User.findByIdWithRole(user.id);
      let canCreate = await userWithRole.hasPermission('doc:create');
      expect(canCreate).toBe(false);

      await Role.addPermission(dynamicRole.id, 'doc:create');

      userWithRole = await User.findByIdWithRole(user.id);
      canCreate = await userWithRole.hasPermission('doc:create');
      expect(canCreate).toBe(true);

      await Role.removePermission(dynamicRole.id, 'doc:read');

      userWithRole = await User.findByIdWithRole(user.id);
      let canRead = await userWithRole.hasPermission('doc:read');
      canCreate = await userWithRole.hasPermission('doc:create');
      
      expect(canRead).toBe(false);
      expect(canCreate).toBe(true);
    });
  });

  describe('场景5: 空权限和无角色用户', () => {
    test('没有角色的用户应该没有任何权限', async () => {
      const noRoleUser = await User.create(
        'no_role_perm_user',
        'password123',
        'noroleperm@example.com'
      );

      const hasRead = await noRoleUser.hasPermission('doc:read');
      expect(hasRead).toBe(false);

      const hasAny = await noRoleUser.hasAnyPermission(['doc:read', 'any:other']);
      expect(hasAny).toBe(false);

      const hasAll = await noRoleUser.hasAllPermissions(['doc:read']);
      expect(hasAll).toBe(false);

      const checkResult = await noRoleUser.checkPermission('doc:read');
      expect(checkResult).toBe(false);
    });

    test('空权限角色的用户应该没有任何权限', async () => {
      const emptyPermRole = await Role.create(
        'empty_perm_role',
        '空权限角色',
        []
      );

      const user = await User.create(
        'empty_perm_user',
        'password123',
        'emptyperm@example.com',
        emptyPermRole.id
      );

      const hasRead = await user.hasPermission('doc:read');
      expect(hasRead).toBe(false);

      const hasAny = await user.hasAnyPermission(['doc:read', 'any:other']);
      expect(hasAny).toBe(false);
    });
  });
});
