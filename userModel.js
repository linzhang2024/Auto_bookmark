const bcrypt = require('bcryptjs');
const db = require('./database');
const Role = require('./roleModel');

const SALT_ROUNDS = 10;

class User {
  constructor(id, username, password, email, role_id, is_enabled, created_at, updated_at) {
    this.id = id;
    this.username = username;
    this.password = password;
    this.email = email;
    this.role_id = role_id;
    this.is_enabled = is_enabled === undefined ? true : Boolean(is_enabled);
    this.created_at = created_at;
    this.updated_at = updated_at;
    this._role = null;
  }

  static validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, message: '用户名不能为空' };
    }
    if (username.length < 3) {
      return { valid: false, message: '用户名至少需要 3 个字符' };
    }
    if (username.length > 50) {
      return { valid: false, message: '用户名最多 50 个字符' };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return { valid: false, message: '用户名只能包含字母、数字和下划线' };
    }
    return { valid: true };
  }

  static validatePassword(password) {
    if (!password || typeof password !== 'string') {
      return { valid: false, message: '密码不能为空' };
    }
    if (password.length < 6) {
      return { valid: false, message: '密码至少需要 6 个字符' };
    }
    if (password.length > 128) {
      return { valid: false, message: '密码最多 128 个字符' };
    }
    return { valid: true };
  }

  static validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return { valid: false, message: '邮箱不能为空' };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { valid: false, message: '邮箱格式不正确' };
    }
    return { valid: true };
  }

  static async validateRoleId(role_id) {
    if (role_id === null || role_id === undefined) {
      return { valid: true };
    }
    if (typeof role_id !== 'number' || !Number.isInteger(role_id) || role_id <= 0) {
      return { valid: false, message: '角色 ID 必须是正整数' };
    }
    const role = await Role.findById(role_id);
    if (!role) {
      return { valid: false, message: '角色不存在' };
    }
    return { valid: true };
  }

  static async hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  static fromRow(row) {
    return new User(
      row.id,
      row.username,
      row.password,
      row.email,
      row.role_id,
      row.is_enabled,
      row.created_at,
      row.updated_at
    );
  }

  static async create(username, password, email, role_id = null) {
    const usernameValidation = User.validateUsername(username);
    if (!usernameValidation.valid) {
      throw new Error(usernameValidation.message);
    }

    const passwordValidation = User.validatePassword(password);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.message);
    }

    const emailValidation = User.validateEmail(email);
    if (!emailValidation.valid) {
      throw new Error(emailValidation.message);
    }

    const roleValidation = await User.validateRoleId(role_id);
    if (!roleValidation.valid) {
      throw new Error(roleValidation.message);
    }

    const existingUserByUsername = await User.findByUsername(username);
    if (existingUserByUsername) {
      throw new Error('用户名已存在');
    }

    const existingUserByEmail = await User.findByEmail(email);
    if (existingUserByEmail) {
      throw new Error('邮箱已被注册');
    }

    const hashedPassword = await User.hashPassword(password);
    const result = await db.run(
      'INSERT INTO users (username, password, email, role_id) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, email, role_id]
    );

    return User.findById(result.lastID);
  }

  static async findById(id) {
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) {
      return null;
    }
    return User.fromRow(row);
  }

  static async findByIdWithRole(id) {
    const row = await db.get(`
      SELECT 
        u.id, u.username, u.password, u.email, u.role_id, 
        u.created_at, u.updated_at,
        r.name as role_name, r.description as role_description, r.permissions as role_permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [id]);
    if (!row) {
      return null;
    }
    const user = User.fromRow(row);
    if (row.role_id) {
      user._role = new Role(
        row.role_id,
        row.role_name,
        row.role_description,
        Role.deserializePermissions(row.role_permissions),
        null,
        null
      );
    }
    return user;
  }

  static async findByUsername(username) {
    const row = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!row) {
      return null;
    }
    return User.fromRow(row);
  }

  static async findByUsernameWithRole(username) {
    const row = await db.get(`
      SELECT 
        u.id, u.username, u.password, u.email, u.role_id, 
        u.created_at, u.updated_at,
        r.name as role_name, r.description as role_description, r.permissions as role_permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.username = ?
    `, [username]);
    if (!row) {
      return null;
    }
    const user = User.fromRow(row);
    if (row.role_id) {
      user._role = new Role(
        row.role_id,
        row.role_name,
        row.role_description,
        Role.deserializePermissions(row.role_permissions),
        null,
        null
      );
    }
    return user;
  }

  static async findByEmail(email) {
    const row = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!row) {
      return null;
    }
    return User.fromRow(row);
  }

  static async findByEmailWithRole(email) {
    const row = await db.get(`
      SELECT 
        u.id, u.username, u.password, u.email, u.role_id, 
        u.created_at, u.updated_at,
        r.name as role_name, r.description as role_description, r.permissions as role_permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = ?
    `, [email]);
    if (!row) {
      return null;
    }
    const user = User.fromRow(row);
    if (row.role_id) {
      user._role = new Role(
        row.role_id,
        row.role_name,
        row.role_description,
        Role.deserializePermissions(row.role_permissions),
        null,
        null
      );
    }
    return user;
  }

  static async update(id, updates) {
    const user = await User.findById(id);
    if (!user) {
      throw new Error('用户不存在');
    }

    const allowedUpdates = ['username', 'email', 'password', 'role_id', 'is_enabled'];
    const validUpdates = {};

    for (const key in updates) {
      if (allowedUpdates.includes(key)) {
        if (key === 'username') {
          const validation = User.validateUsername(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          const existingUser = await User.findByUsername(updates[key]);
          if (existingUser && existingUser.id !== id) {
            throw new Error('用户名已存在');
          }
          validUpdates.username = updates[key];
        } else if (key === 'email') {
          const validation = User.validateEmail(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          const existingUser = await User.findByEmail(updates[key]);
          if (existingUser && existingUser.id !== id) {
            throw new Error('邮箱已被注册');
          }
          validUpdates.email = updates[key];
        } else if (key === 'password') {
          const validation = User.validatePassword(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.password = await User.hashPassword(updates[key]);
        } else if (key === 'role_id') {
          const validation = await User.validateRoleId(updates[key]);
          if (!validation.valid) {
            throw new Error(validation.message);
          }
          validUpdates.role_id = updates[key];
        } else if (key === 'is_enabled') {
          validUpdates.is_enabled = updates[key] ? 1 : 0;
        }
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      return user;
    }

    const setClauses = Object.keys(validUpdates).map(key => `${key} = ?`);
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    const values = Object.values(validUpdates);
    values.push(id);

    await db.run(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    return User.findById(id);
  }

  static async delete(id) {
    const user = await User.findById(id);
    if (!user) {
      throw new Error('用户不存在');
    }

    await db.run('DELETE FROM users WHERE id = ?', [id]);
    return true;
  }

  static async listAll() {
    const rows = await db.all('SELECT * FROM users ORDER BY created_at DESC');
    return rows.map(row => User.fromRow(row));
  }

  static async listAllWithRole() {
    const rows = await db.all(`
      SELECT 
        u.id, u.username, u.password, u.email, u.role_id, 
        u.created_at, u.updated_at,
        r.name as role_name, r.description as role_description, r.permissions as role_permissions
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      ORDER BY u.created_at DESC
    `);
    return rows.map(row => {
      const user = User.fromRow(row);
      if (row.role_id) {
        user._role = new Role(
          row.role_id,
          row.role_name,
          row.role_description,
          Role.deserializePermissions(row.role_permissions),
          null,
          null
        );
      }
      return user;
    });
  }

  async getRole() {
    if (this._role) {
      return this._role;
    }
    if (!this.role_id) {
      return null;
    }
    const role = await Role.findById(this.role_id);
    this._role = role;
    return role;
  }

  async hasPermission(permission) {
    const role = await this.getRole();
    if (!role) {
      return false;
    }
    return role.hasPermission(permission);
  }

  async hasAllPermissions(permissions) {
    const role = await this.getRole();
    if (!role) {
      return false;
    }
    return role.hasAllPermissions(permissions);
  }

  async hasAnyPermission(permissions) {
    const role = await this.getRole();
    if (!role) {
      return false;
    }
    return role.hasAnyPermission(permissions);
  }

  async checkPermission(permission, options = {}) {
    const { requireAll = false } = options;
    
    if (Array.isArray(permission)) {
      if (requireAll) {
        return this.hasAllPermissions(permission);
      } else {
        return this.hasAnyPermission(permission);
      }
    }
    
    return this.hasPermission(permission);
  }

  static async checkPermissionByUserId(userId, permission, options = {}) {
    const user = await User.findByIdWithRole(userId);
    if (!user) {
      return false;
    }
    return user.checkPermission(permission, options);
  }

  toJSON() {
    const json = {
      id: this.id,
      username: this.username,
      email: this.email,
      role_id: this.role_id,
      is_enabled: this.is_enabled,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
    if (this._role) {
      json.role = this._role.toJSON();
    }
    return json;
  }
}

module.exports = User;
