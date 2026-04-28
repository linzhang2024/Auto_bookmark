const Role = require('./roleModel');
const { initDatabase, closeDatabase, getDb, run } = require('./database');

describe('Role Model - 输入验证测试', () => {
  describe('角色名称验证', () => {
    test('应该拒绝空角色名称', () => {
      expect(Role.validateName('').valid).toBe(false);
      expect(Role.validateName(null).valid).toBe(false);
      expect(Role.validateName(undefined).valid).toBe(false);
    });

    test('应该拒绝太长的角色名称', () => {
      const longName = 'a'.repeat(51);
      expect(Role.validateName(longName).valid).toBe(false);
    });

    test('应该接受有效的角色名称', () => {
      expect(Role.validateName('admin').valid).toBe(true);
      expect(Role.validateName('super_admin').valid).toBe(true);
      expect(Role.validateName('测试角色').valid).toBe(true);
    });
  });

  describe('权限标识验证', () => {
    test('应该接受空权限数组', () => {
      expect(Role.validatePermissions([]).valid).toBe(true);
      expect(Role.validatePermissions(undefined).valid).toBe(true);
      expect(Role.validatePermissions(null).valid).toBe(true);
    });

    test('应该拒绝非数组的权限', () => {
      expect(Role.validatePermissions('not-array').valid).toBe(false);
      expect(Role.validatePermissions(123).valid).toBe(false);
    });

    test('应该拒绝空字符串权限', () => {
      expect(Role.validatePermissions(['']).valid).toBe(false);
      expect(Role.validatePermissions(['valid', '']).valid).toBe(false);
    });

    test('应该接受有效的权限数组', () => {
      expect(Role.validatePermissions(['user:read', 'user:write']).valid).toBe(true);
    });
  });

  describe('权限序列化和反序列化', () => {
    test('应该正确序列化权限数组', () => {
      const permissions = ['user:read', 'user:write', 'admin:access'];
      const serialized = Role.serializePermissions(permissions);
      expect(typeof serialized).toBe('string');
      
      const deserialized = JSON.parse(serialized);
      expect(deserialized).toEqual(permissions);
    });

    test('应该正确反序列化权限字符串', () => {
      const permissions = ['user:read', 'user:write'];
      const serialized = JSON.stringify(permissions);
      const deserialized = Role.deserializePermissions(serialized);
      expect(deserialized).toEqual(permissions);
    });

    test('空或无效序列化应该返回空数组', () => {
      expect(Role.deserializePermissions(null)).toEqual([]);
      expect(Role.deserializePermissions(undefined)).toEqual([]);
      expect(Role.deserializePermissions('invalid-json')).toEqual([]);
    });
  });
});

describe('Role Model - CRUD 操作测试', () => {
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

  describe('角色创建', () => {
    test('应该成功创建新角色', async () => {
      const roleData = {
        name: 'test_role',
        description: '测试角色',
        permissions: ['user:read', 'bookmark:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      expect(role).toBeDefined();
      expect(role.id).toBeDefined();
      expect(role.name).toBe(roleData.name);
      expect(role.description).toBe(roleData.description);
      expect(role.permissions).toEqual(roleData.permissions);
      expect(role.created_at).toBeDefined();
      expect(role.updated_at).toBeDefined();
    });

    test('应该拒绝名称已存在的角色', async () => {
      const roleData1 = {
        name: 'duplicate_role',
        description: '第一个角色',
        permissions: []
      };

      const roleData2 = {
        name: 'duplicate_role',
        description: '第二个角色',
        permissions: ['user:read']
      };

      await Role.create(roleData1.name, roleData1.description, roleData1.permissions);
      
      await expect(
        Role.create(roleData2.name, roleData2.description, roleData2.permissions)
      ).rejects.toThrow('角色名称已存在');
    });

    test('应该拒绝无效的角色名称', async () => {
      await expect(
        Role.create('', '描述', [])
      ).rejects.toThrow('角色名称不能为空');
    });
  });

  describe('角色查询', () => {
    test('应该通过 ID 找到角色', async () => {
      const roleData = {
        name: 'find_by_id_role',
        description: '测试通过ID查找',
        permissions: ['user:read']
      };

      const createdRole = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const foundRole = await Role.findById(createdRole.id);
      
      expect(foundRole).not.toBeNull();
      expect(foundRole.id).toBe(createdRole.id);
      expect(foundRole.name).toBe(createdRole.name);
      expect(foundRole.description).toBe(createdRole.description);
    });

    test('通过不存在的 ID 查找应该返回 null', async () => {
      const foundRole = await Role.findById(999999);
      expect(foundRole).toBeNull();
    });

    test('应该通过名称找到角色', async () => {
      const roleData = {
        name: 'find_by_name_role',
        description: '测试通过名称查找',
        permissions: ['user:read']
      };

      await Role.create(roleData.name, roleData.description, roleData.permissions);

      const foundRole = await Role.findByName(roleData.name);
      
      expect(foundRole).not.toBeNull();
      expect(foundRole.name).toBe(roleData.name);
    });

    test('toJSON 方法应该返回正确的对象', async () => {
      const roleData = {
        name: 'json_test_role',
        description: '测试 toJSON 方法',
        permissions: ['user:read', 'user:write']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const roleJson = role.toJSON();
      
      expect(roleJson.id).toBe(role.id);
      expect(roleJson.name).toBe(roleData.name);
      expect(roleJson.description).toBe(roleData.description);
      expect(roleJson.permissions).toEqual(roleData.permissions);
      expect(roleJson.created_at).toBeDefined();
    });
  });

  describe('角色信息更新', () => {
    test('应该成功更新角色信息', async () => {
      const roleData = {
        name: 'update_test_role',
        description: '初始描述',
        permissions: ['user:read']
      };

      const createdRole = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const updates = {
        name: 'updated_role_name',
        description: '更新后的描述',
        permissions: ['user:read', 'user:write', 'user:delete']
      };

      const updatedRole = await Role.update(createdRole.id, updates);
      
      expect(updatedRole.name).toBe(updates.name);
      expect(updatedRole.description).toBe(updates.description);
      expect(updatedRole.permissions).toEqual(updates.permissions);
    });

    test('应该拒绝更新为已存在的名称', async () => {
      const roleData1 = {
        name: 'role1',
        description: '角色1',
        permissions: []
      };

      const roleData2 = {
        name: 'role2',
        description: '角色2',
        permissions: []
      };

      const role1 = await Role.create(roleData1.name, roleData1.description, roleData1.permissions);
      await Role.create(roleData2.name, roleData2.description, roleData2.permissions);

      await expect(
        Role.update(role1.id, { name: roleData2.name })
      ).rejects.toThrow('角色名称已存在');
    });

    test('更新不存在的角色应该抛出错误', async () => {
      await expect(
        Role.update(999999, { name: 'newname' })
      ).rejects.toThrow('角色不存在');
    });

    test('没有提供更新字段时应该返回原角色', async () => {
      const roleData = {
        name: 'no_update_role',
        description: '描述',
        permissions: []
      };

      const createdRole = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const updatedRole = await Role.update(createdRole.id, {});
      
      expect(updatedRole.id).toBe(createdRole.id);
      expect(updatedRole.name).toBe(createdRole.name);
    });
  });

  describe('角色删除', () => {
    test('应该成功删除角色', async () => {
      const roleData = {
        name: 'delete_test_role',
        description: '测试删除角色',
        permissions: []
      };

      const createdRole = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const result = await Role.delete(createdRole.id);
      expect(result).toBe(true);

      const foundRole = await Role.findById(createdRole.id);
      expect(foundRole).toBeNull();
    });

    test('删除不存在的角色应该抛出错误', async () => {
      await expect(
        Role.delete(999999)
      ).rejects.toThrow('角色不存在');
    });

    test('无法删除已有用户关联的角色', async () => {
      const User = require('./userModel');
      
      const roleData = {
        name: 'has_users_role',
        description: '有用户关联的角色',
        permissions: ['user:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      await User.create('testuser', 'password123', 'test@example.com', role.id);

      await expect(
        Role.delete(role.id)
      ).rejects.toThrow('无法删除已有用户关联的角色');
    });
  });

  describe('列出所有角色', () => {
    test('应该列出所有角色（包括预置角色）', async () => {
      const roles = await Role.listAll();
      expect(roles.length).toBeGreaterThanOrEqual(3);
      
      const roleNames = roles.map(r => r.name);
      expect(roleNames).toContain('admin');
      expect(roleNames).toContain('user');
      expect(roleNames).toContain('guest');
    });

    test('应该包含新创建的角色', async () => {
      const roleData = {
        name: 'list_test_role',
        description: '测试列表',
        permissions: []
      };

      await Role.create(roleData.name, roleData.description, roleData.permissions);

      const roles = await Role.listAll();
      const roleNames = roles.map(r => r.name);
      expect(roleNames).toContain(roleData.name);
    });
  });

  describe('权限检查', () => {
    test('hasPermission 应该正确检查权限', async () => {
      const roleData = {
        name: 'perm_test_role',
        description: '权限测试角色',
        permissions: ['user:read', 'bookmark:read', 'bookmark:write']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      expect(role.hasPermission('user:read')).toBe(true);
      expect(role.hasPermission('bookmark:write')).toBe(true);
      expect(role.hasPermission('user:delete')).toBe(false);
      expect(role.hasPermission('nonexistent')).toBe(false);
    });

    test('空权限数组应该返回 false', async () => {
      const role = await Role.create('empty_perm_role', '空权限角色', []);
      expect(role.hasPermission('any:perm')).toBe(false);
    });

    test('hasAllPermissions 应该正确检查是否拥有所有权限', async () => {
      const roleData = {
        name: 'has_all_perm_role',
        description: '测试hasAllPermissions',
        permissions: ['user:read', 'bookmark:read', 'bookmark:write']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      expect(role.hasAllPermissions(['user:read', 'bookmark:read'])).toBe(true);
      expect(role.hasAllPermissions(['user:read', 'bookmark:write'])).toBe(true);
      expect(role.hasAllPermissions(['user:read', 'user:delete'])).toBe(false);
      expect(role.hasAllPermissions([])).toBe(false);
      expect(role.hasAllPermissions(null)).toBe(false);
    });

    test('hasAnyPermission 应该正确检查是否拥有任意权限', async () => {
      const roleData = {
        name: 'has_any_perm_role',
        description: '测试hasAnyPermission',
        permissions: ['user:read', 'bookmark:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      expect(role.hasAnyPermission(['user:read', 'user:delete'])).toBe(true);
      expect(role.hasAnyPermission(['bookmark:read', 'bookmark:write'])).toBe(true);
      expect(role.hasAnyPermission(['user:delete', 'bookmark:delete'])).toBe(false);
      expect(role.hasAnyPermission([])).toBe(false);
      expect(role.hasAnyPermission(null)).toBe(false);
    });
  });

  describe('细粒度权限管理', () => {
    test('addPermission 应该成功添加单个权限', async () => {
      const roleData = {
        name: 'add_perm_role',
        description: '测试添加权限',
        permissions: ['user:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      expect(role.hasPermission('bookmark:read')).toBe(false);

      const updatedRole = await Role.addPermission(role.id, 'bookmark:read');
      
      expect(updatedRole.hasPermission('bookmark:read')).toBe(true);
      expect(updatedRole.permissions).toContain('user:read');
      expect(updatedRole.permissions).toContain('bookmark:read');
    });

    test('addPermission 添加已存在的权限应该不做修改', async () => {
      const roleData = {
        name: 'add_existing_perm_role',
        description: '测试添加已存在权限',
        permissions: ['user:read', 'bookmark:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const originalPermissions = [...role.permissions];
      const updatedRole = await Role.addPermission(role.id, 'user:read');
      
      expect(updatedRole.permissions).toEqual(originalPermissions);
    });

    test('addPermission 对不存在的角色应该抛出错误', async () => {
      await expect(
        Role.addPermission(999999, 'new:perm')
      ).rejects.toThrow('角色不存在');
    });

    test('addPermission 添加无效权限应该抛出错误', async () => {
      const role = await Role.create('invalid_perm_role', '测试无效权限', ['user:read']);
      
      await expect(
        Role.addPermission(role.id, '')
      ).rejects.toThrow('权限标识必须是非空字符串');
    });

    test('addPermissions 应该成功添加多个权限', async () => {
      const roleData = {
        name: 'add_multi_perm_role',
        description: '测试添加多个权限',
        permissions: ['user:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const newPermissions = ['bookmark:read', 'bookmark:write', 'user:update'];
      const updatedRole = await Role.addPermissions(role.id, newPermissions);
      
      expect(updatedRole.hasPermission('user:read')).toBe(true);
      expect(updatedRole.hasPermission('bookmark:read')).toBe(true);
      expect(updatedRole.hasPermission('bookmark:write')).toBe(true);
      expect(updatedRole.hasPermission('user:update')).toBe(true);
    });

    test('addPermissions 添加混合存在和不存在的权限', async () => {
      const roleData = {
        name: 'add_mixed_perm_role',
        description: '测试添加混合权限',
        permissions: ['user:read', 'bookmark:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const mixedPermissions = ['bookmark:read', 'bookmark:write', 'user:update'];
      const updatedRole = await Role.addPermissions(role.id, mixedPermissions);
      
      expect(updatedRole.permissions.length).toBe(4);
      expect(updatedRole.permissions).toContain('user:read');
      expect(updatedRole.permissions).toContain('bookmark:read');
      expect(updatedRole.permissions).toContain('bookmark:write');
      expect(updatedRole.permissions).toContain('user:update');
    });

    test('removePermission 应该成功移除单个权限', async () => {
      const roleData = {
        name: 'remove_perm_role',
        description: '测试移除权限',
        permissions: ['user:read', 'user:write', 'bookmark:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      expect(role.hasPermission('user:write')).toBe(true);

      const updatedRole = await Role.removePermission(role.id, 'user:write');
      
      expect(updatedRole.hasPermission('user:write')).toBe(false);
      expect(updatedRole.hasPermission('user:read')).toBe(true);
      expect(updatedRole.hasPermission('bookmark:read')).toBe(true);
    });

    test('removePermission 移除不存在的权限应该不做修改', async () => {
      const roleData = {
        name: 'remove_nonexistent_role',
        description: '测试移除不存在权限',
        permissions: ['user:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const originalPermissions = [...role.permissions];
      const updatedRole = await Role.removePermission(role.id, 'nonexistent:perm');
      
      expect(updatedRole.permissions).toEqual(originalPermissions);
    });

    test('removePermission 对不存在的角色应该抛出错误', async () => {
      await expect(
        Role.removePermission(999999, 'some:perm')
      ).rejects.toThrow('角色不存在');
    });

    test('removePermissions 应该成功移除多个权限', async () => {
      const roleData = {
        name: 'remove_multi_perm_role',
        description: '测试移除多个权限',
        permissions: ['user:read', 'user:write', 'user:delete', 'bookmark:read', 'bookmark:write']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const permissionsToRemove = ['user:write', 'user:delete', 'bookmark:write'];
      const updatedRole = await Role.removePermissions(role.id, permissionsToRemove);
      
      expect(updatedRole.hasPermission('user:read')).toBe(true);
      expect(updatedRole.hasPermission('bookmark:read')).toBe(true);
      expect(updatedRole.hasPermission('user:write')).toBe(false);
      expect(updatedRole.hasPermission('user:delete')).toBe(false);
      expect(updatedRole.hasPermission('bookmark:write')).toBe(false);
    });

    test('removePermissions 移除混合存在和不存在的权限', async () => {
      const roleData = {
        name: 'remove_mixed_perm_role',
        description: '测试移除混合权限',
        permissions: ['user:read', 'bookmark:read']
      };

      const role = await Role.create(
        roleData.name,
        roleData.description,
        roleData.permissions
      );

      const mixedPermissions = ['user:read', 'nonexistent:perm', 'another:none'];
      const updatedRole = await Role.removePermissions(role.id, mixedPermissions);
      
      expect(updatedRole.hasPermission('user:read')).toBe(false);
      expect(updatedRole.hasPermission('bookmark:read')).toBe(true);
    });
  });

  describe('预置角色测试', () => {
    test('admin 角色应该拥有所有权限', async () => {
      const adminRole = await Role.findByName('admin');
      expect(adminRole).not.toBeNull();
      expect(adminRole.name).toBe('admin');
      expect(adminRole.permissions).toContain('admin:access');
      expect(adminRole.permissions).toContain('user:create');
      expect(adminRole.permissions).toContain('user:delete');
      expect(adminRole.permissions).toContain('role:create');
      expect(adminRole.permissions).toContain('role:delete');
    });

    test('user 角色应该拥有基本权限', async () => {
      const userRole = await Role.findByName('user');
      expect(userRole).not.toBeNull();
      expect(userRole.name).toBe('user');
      expect(userRole.permissions).toContain('user:read');
      expect(userRole.permissions).toContain('bookmark:create');
      expect(userRole.permissions).not.toContain('admin:access');
      expect(userRole.permissions).not.toContain('user:delete');
    });

    test('guest 角色应该只有只读权限', async () => {
      const guestRole = await Role.findByName('guest');
      expect(guestRole).not.toBeNull();
      expect(guestRole.name).toBe('guest');
      expect(guestRole.permissions).toEqual(['bookmark:read']);
    });
  });
});
