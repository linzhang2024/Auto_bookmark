const User = require('../models/userModel');
const Document = require('../models/documentModel');

const ADMIN_PERMISSION = 'admin:access';
const ADMIN_STATS_PERMISSION = 'admin:stats';
const USER_LIST_PERMISSION = 'user:list';
const USER_UPDATE_PERMISSION = 'user:update';
const USER_DELETE_PERMISSION = 'user:delete';
const DOC_WRITE_PERMISSION = 'doc:write';
const DOC_READ_PERMISSION = 'doc:read';
const DOC_CREATE_PERMISSION = 'doc:create';
const DOC_UPDATE_PERMISSION = 'doc:update';
const DOC_DELETE_PERMISSION = 'doc:delete';

class AuthMiddleware {
  static async hasPermission(userId, permission) {
    if (!userId) {
      return false;
    }
    return User.checkPermissionByUserId(userId, permission);
  }

  static async hasAnyPermission(userId, permissions) {
    if (!userId || !permissions || !Array.isArray(permissions)) {
      return false;
    }
    return User.checkPermissionByUserId(userId, permissions);
  }

  static async hasAllPermissions(userId, permissions) {
    if (!userId || !permissions || !Array.isArray(permissions)) {
      return false;
    }
    return User.checkPermissionByUserId(userId, permissions, { requireAll: true });
  }

  static async isAdmin(userId) {
    return AuthMiddleware.hasPermission(userId, ADMIN_PERMISSION);
  }

  static async hasDocWritePermission(userId) {
    return AuthMiddleware.hasPermission(userId, DOC_WRITE_PERMISSION);
  }

  static async canModifyDocument(userId, document) {
    if (!userId || !document) {
      return false;
    }

    const isAdmin = await AuthMiddleware.isAdmin(userId);
    if (isAdmin) {
      return true;
    }

    if (document.isOwner(userId)) {
      return true;
    }

    return false;
  }

  static async canModifyDocumentById(userId, documentId) {
    if (!userId || !documentId) {
      return false;
    }

    const document = await Document.findById(documentId);
    if (!document) {
      return false;
    }

    return AuthMiddleware.canModifyDocument(userId, document);
  }

  static createRequirePermissionMiddleware(permission) {
    return async (req, res, next) => {
      try {
        const userId = req.user?.id || req.body?.user_id || req.query?.user_id;
        
        if (!userId) {
          return res.status(401).json({
            success: false,
            message: '未授权：缺少用户信息'
          });
        }

        const hasPermission = await AuthMiddleware.hasPermission(userId, permission);
        
        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            message: `禁止访问：缺少 ${permission} 权限`
          });
        }

        next();
      } catch (error) {
        console.error('权限检查错误:', error);
        return res.status(500).json({
          success: false,
          message: '权限检查失败'
        });
      }
    };
  }

  static createRequireDocWriteMiddleware() {
    return AuthMiddleware.createRequirePermissionMiddleware(DOC_WRITE_PERMISSION);
  }

  static createDocumentModificationMiddleware(documentIdParam = 'id') {
    return async (req, res, next) => {
      try {
        const userId = req.user?.id || req.body?.user_id || req.query?.user_id;
        
        if (!userId) {
          return res.status(401).json({
            success: false,
            message: '未授权：缺少用户信息'
          });
        }

        const documentId = parseInt(req.params[documentIdParam] || req.body?.document_id, 10);
        
        if (!documentId || isNaN(documentId)) {
          return res.status(400).json({
            success: false,
            message: '无效的文档 ID'
          });
        }

        const canModify = await AuthMiddleware.canModifyDocumentById(userId, documentId);
        
        if (!canModify) {
          return res.status(403).json({
            success: false,
            message: '禁止访问：仅文档所有者或管理员可以执行此操作'
          });
        }

        next();
      } catch (error) {
        console.error('文档权限检查错误:', error);
        return res.status(500).json({
          success: false,
          message: '文档权限检查失败'
        });
      }
    };
  }

  static async getDocumentPermissions(userId, document) {
    const permissions = {
      read: false,
      update: false,
      delete: false,
      isOwner: false,
      isAdmin: false
    };

    if (!userId || !document) {
      return permissions;
    }

    permissions.isAdmin = await AuthMiddleware.isAdmin(userId);
    permissions.isOwner = document.isOwner(userId) || document.isUploader(userId);

    if (permissions.isAdmin) {
      permissions.read = await AuthMiddleware.hasPermission(userId, DOC_READ_PERMISSION);
      permissions.update = await AuthMiddleware.hasPermission(userId, DOC_UPDATE_PERMISSION);
      permissions.delete = await AuthMiddleware.hasPermission(userId, DOC_DELETE_PERMISSION);
    } else if (permissions.isOwner) {
      permissions.read = true;
      permissions.update = true;
      permissions.delete = true;
    }

    return permissions;
  }
}

module.exports = {
  AuthMiddleware,
  ADMIN_PERMISSION,
  ADMIN_STATS_PERMISSION,
  USER_LIST_PERMISSION,
  USER_UPDATE_PERMISSION,
  USER_DELETE_PERMISSION,
  DOC_WRITE_PERMISSION,
  DOC_READ_PERMISSION,
  DOC_CREATE_PERMISSION,
  DOC_UPDATE_PERMISSION,
  DOC_DELETE_PERMISSION
};
