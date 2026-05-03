const db = require('../services/database');

class Role {
  constructor(id, name, description, permissions, created_at, updated_at) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.permissions = permissions;
    this.created_at = created_at;
    this.updated_at = updated_at;
  }

  static validateName(name) {
    if (!name || typeof name !== 'string') {
      return { valid: false, message: '角色名称不能为空' };
    }
    if (name.length < 1) {
      return { valid: false, message: '角色名称至少需要 1 个字符' };
    }
    if (name.length > 50) {
      return { valid: false, message: '角色名称最多 50 个字符' };
    }
    return { valid: true };
  }

  static validatePermissions(permissions) {
    if (permissions !== undefined && permissions !== null) {
      if (!Array.isArray(permissions)) {
        return { valid: false, message: '权限标识必须是数组' };
      }
      for (const perm of permissions) {
        if (typeof perm !== 'string' || perm.length === 0) {
          return { valid: false, message: '权限标识必须是非空字符串' };
        }
        if (perm.length > 100) {
          return { valid: false, message: '单个权限标识最多 100 个字符' };
        }
      }
    }
    return { valid: true };
  }

  static serializePermissions(permissions) {
    if (!permissions || permissions.length === 0) {
      return '[]';
    }
    return JSON.stringify(permissions);
  }

  static deserializePermissions(permissionsStr) {
    if (!permissionsStr) {
      return [];
    }
    try {
      return JSON.parse(permissionsStr);
    } catch (err) {
      return [];
    }
  }

  static fromRow(row) {
    return new Role(
      row.id,
      row.name,
      row.description,
      Role.deserializePermissions(row.permissions),
      row.created_at,
      row.updated_at
    );
  }

  static async create(name, description, permissions = []) {
    const nameValidation = Role.validateName(name);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.message);
    }

    const permissionsValidation = Role.validatePermissions(permissions);
    if (!permissionsValidation.valid) {
      throw new Error(permissionsValidation.message);
    }

    const existingRole = await Role.findByName(name);
    if (existingRole) {
      throw new Error('角色名称已存在');
    }

    const serializedPermissions = Role.serializePermissions(permissions);
    const result = await db.run(
      'INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)',
      [name, description || '', serializedPermissions]
    );

    return Role.findById(result.lastID);
  }

  static async findById(id) {
    const row = await db.get('SELECT * FROM roles WHERE id = ?', [id]);
    if (!row) {
      return null;
    }
    return Role.fromRow(row);
  }

  static async findByName(name) {
    const row = await db.get('SELECT * FROM roles WHERE name = ?', [name]);
    if (!row) {
      return null;
    }
    return Role.fromRow(row);
  }

  static async update(id, updates) {
    const role = await Role.findById(id);
    if (!role) {
      throw new Error('角色不存在');
    }

    const allowedUpdates = ['name', 'description', 'permissions'];
    const validUpdates = {};

    for (const key in updates) {
      if (allowedUpdates.includes(key)) {
        if (key === 'name') {
          const validation = Role.validateName(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          const existingRole = await Role.findByName(updates[key]);
          if (existingRole && existingRole.id !== id) {
            throw new Error('角色名称已存在');
          }
          validUpdates.name = updates[key];
        } else if (key === 'description') {
            validUpdates.description = updates[key] || '';
        } else if (key === 'permissions') {
          const validation = Role.validatePermissions(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.permissions = Role.serializePermissions(updates[key]);
        }
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      return role;
    }

    const setClauses = Object.keys(validUpdates).map(key => `${key} = ?`);
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    const values = Object.values(validUpdates);
    values.push(id);

    await db.run(
      `UPDATE roles SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    return Role.findById(id);
  }

  static async delete(id) {
    if (id === null || id === undefined) {
      throw new Error('角色不存在');
    }
    
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new Error('角色不存在');
    }

    const role = await Role.findById(id);
    if (!role) {
      throw new Error('角色不存在');
    }

    const usersWithRole = await db.all(
      'SELECT id FROM users WHERE role_id = ?',
      [id]
    );
    if (usersWithRole.length > 0) {
      throw new Error('无法删除已有用户关联的角色');
    }

    await db.run('DELETE FROM roles WHERE id = ?', [id]);
    return true;
  }

  static async listAll() {
    const rows = await db.all('SELECT * FROM roles ORDER BY created_at DESC');
    return rows.map(row => Role.fromRow(row));
  }

  hasPermission(permission) {
    if (!this.permissions || this.permissions.length === 0) {
      return false;
    }
    return this.permissions.includes(permission);
  }

  hasAllPermissions(permissions) {
    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return false;
    }
    return permissions.every(perm => this.hasPermission(perm));
  }

  hasAnyPermission(permissions) {
    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return false;
    }
    return permissions.some(perm => this.hasPermission(perm));
  }

  static async addPermission(roleId, permission) {
    const validation = Role.validatePermissions([permission]);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const role = await Role.findById(roleId);
    if (!role) {
      throw new Error('角色不存在');
    }

    if (role.hasPermission(permission)) {
      return role;
    }

    const newPermissions = [...role.permissions, permission];
    return Role.update(roleId, { permissions: newPermissions });
  }

  static async addPermissions(roleId, permissions) {
    const validation = Role.validatePermissions(permissions);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const role = await Role.findById(roleId);
    if (!role) {
      throw new Error('角色不存在');
    }

    const newPermissions = [...role.permissions];
    for (const perm of permissions) {
      if (!newPermissions.includes(perm)) {
        newPermissions.push(perm);
      }
    }

    return Role.update(roleId, { permissions: newPermissions });
  }

  static async removePermission(roleId, permission) {
    const role = await Role.findById(roleId);
    if (!role) {
      throw new Error('角色不存在');
    }

    if (!role.hasPermission(permission)) {
      return role;
    }

    const newPermissions = role.permissions.filter(p => p !== permission);
    return Role.update(roleId, { permissions: newPermissions });
  }

  static async removePermissions(roleId, permissions) {
    const role = await Role.findById(roleId);
    if (!role) {
      throw new Error('角色不存在');
    }

    const permissionsToRemove = new Set(permissions);
    const newPermissions = role.permissions.filter(p => !permissionsToRemove.has(p));
    return Role.update(roleId, { permissions: newPermissions });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      permissions: this.permissions,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = Role;
