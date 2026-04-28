const bcrypt = require('bcryptjs');
const db = require('./database');

const SALT_ROUNDS = 10;

class User {
  constructor(id, username, password, email, created_at, updated_at) {
    this.id = id;
    this.username = username;
    this.password = password;
    this.email = email;
    this.created_at = created_at;
    this.updated_at = updated_at;
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

  static async hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  static async create(username, password, email) {
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
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      [username, hashedPassword, email]
    );

    return User.findById(result.lastID);
  }

  static async findById(id) {
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) {
      return null;
    }
    return new User(row.id, row.username, row.password, row.email, row.created_at, row.updated_at);
  }

  static async findByUsername(username) {
    const row = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!row) {
      return null;
    }
    return new User(row.id, row.username, row.password, row.email, row.created_at, row.updated_at);
  }

  static async findByEmail(email) {
    const row = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!row) {
      return null;
    }
    return new User(row.id, row.username, row.password, row.email, row.created_at, row.updated_at);
  }

  static async update(id, updates) {
    const user = await User.findById(id);
    if (!user) {
      throw new Error('用户不存在');
    }

    const allowedUpdates = ['username', 'email', 'password'];
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
    return rows.map(row => new User(row.id, row.username, row.password, row.email, row.created_at, row.updated_at));
  }

  toJSON() {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = User;
