import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      throw new Error('No authentication token provided');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ 
      message: 'Authentication failed: ' + error.message 
    });
  }
};

export const adminAuth = async (req, res, next) => {
  console.log('adminAuth middleware called for:', req.method, req.path);
  console.log('Authorization header:', req.header('Authorization'));
  
  try {
    await auth(req, res, () => {
      console.log('User role check:', req.user?.role);
      if (req.user?.role !== 'admin') {
        console.log('User is not admin, rejecting request');
        return res.status(403).json({ 
          message: 'Admin access required' 
        });
      }
      console.log('Admin auth successful, proceeding to controller');
      next();
    });
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(403).json({ 
      message: 'Admin access required' 
    });
  }
};

// Allow both full admins and category managers to access, and attach category scope
export const adminOrCategoryManager = async (req, res, next) => {
  try {
    await auth(req, res, async () => {
      const role = req.user?.role;
      if (role !== 'admin' && role !== 'categoryManager') {
        return res.status(403).json({ message: 'Admin or CategoryManager access required' });
      }
      // Attach scope for category managers
      if (role === 'categoryManager') {
        const ids = Array.isArray(req.user.assignedCategories) ? req.user.assignedCategories.map((c)=> c?.toString ? c.toString() : String(c)) : [];
        req.categoryScopeIds = ids;
      } else {
        req.categoryScopeIds = null;
      }
      next();
    });
  } catch (error) {
    console.error('adminOrCategoryManager error:', error);
    res.status(403).json({ message: 'Admin or CategoryManager access required' });
  }
};

// Middleware factory to enforce that a target category id is within the manager's scope
export const enforceCategoryScopeByParam = (paramName = 'id') => async (req, res, next) => {
  try {
    if (!req.user || req.user.role === 'admin') return next();
    if (req.user.role !== 'categoryManager') return res.status(403).json({ message: 'Forbidden' });
    const allowed = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds : (Array.isArray(req.user.assignedCategories) ? req.user.assignedCategories.map(x=>x.toString()) : []);
    const targetId = String(req.params[paramName] || '');
    if (!allowed.includes(targetId)) {
      return res.status(403).json({ message: 'Category out of scope' });
    }
    next();
  } catch (e) {
    console.error('enforceCategoryScopeByParam error:', e);
    res.status(500).json({ message: 'Scope enforcement error' });
  }
};

// For create/reorder operations that reference category ids in body
export const enforceCategoryScopeByBodyIds = (picker) => async (req, res, next) => {
  try {
    if (!req.user || req.user.role === 'admin') return next();
    if (req.user.role !== 'categoryManager') return res.status(403).json({ message: 'Forbidden' });
    const ids = picker(req);
    const allowed = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds : (Array.isArray(req.user.assignedCategories) ? req.user.assignedCategories.map(x=>x.toString()) : []);
    const allIn = ids.every(id => allowed.includes(String(id)));
    if (!allIn) return res.status(403).json({ message: 'One or more categories out of scope' });
    next();
  } catch (e) {
    console.error('enforceCategoryScopeByBodyIds error:', e);
    res.status(500).json({ message: 'Scope enforcement error' });
  }
};

// Ensure a product id is within the manager's category scope
import Product from '../models/Product.js';
export const enforceProductScopeById = async (req, res, next) => {
  try {
    if (!req.user || req.user.role === 'admin') return next();
    if (req.user.role !== 'categoryManager') return res.status(403).json({ message: 'Forbidden' });
    const allowed = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds : (Array.isArray(req.user.assignedCategories) ? req.user.assignedCategories.map(x=>x.toString()) : []);
    const pid = String(req.params.id || '');
    if (!pid) return res.status(400).json({ message: 'Missing product id' });
    const prod = await Product.findById(pid).select('category categories');
    if (!prod) return res.status(404).json({ message: 'Product not found' });
    const catIds = [prod.category, ...(Array.isArray(prod.categories) ? prod.categories : [])].filter(Boolean).map(x=>x.toString());
    const intersects = catIds.some(id => allowed.includes(id));
    if (!intersects) return res.status(403).json({ message: 'Product out of scope' });
    next();
  } catch (e) {
    console.error('enforceProductScopeById error:', e);
    res.status(500).json({ message: 'Scope enforcement error' });
  }
};

// Constrain list queries for category managers by injecting categories filter
export const constrainQueryToAssignedCategories = (req, res, next) => {
  try {
    if (!req.user || req.user.role === 'admin') return next();
    if (req.user.role !== 'categoryManager') return res.status(403).json({ message: 'Forbidden' });
    const allowed = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds : (Array.isArray(req.user.assignedCategories) ? req.user.assignedCategories.map(x=>x.toString()) : []);
    if (!allowed.length) {
      // No access to any products/categories
      // Use a sentinel that yields no results
      req.query.categories = '000000000000000000000000';
    } else {
      const existing = String(req.query.categories || '').trim();
      const merged = [existing, ...allowed].filter(Boolean).join(',');
      req.query.categories = merged;
    }
    next();
  } catch (e) {
    console.error('constrainQueryToAssignedCategories error:', e);
    res.status(500).json({ message: 'Scope enforcement error' });
  }
};

// Ensure a product creation/update payload references only categories in scope
export const enforceProductScopeByBody = (req, res, next) => {
  try {
    if (!req.user || req.user.role === 'admin') return next();
    if (req.user.role !== 'categoryManager') return res.status(403).json({ message: 'Forbidden' });
    const allowed = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds : (Array.isArray(req.user.assignedCategories) ? req.user.assignedCategories.map(x=>x.toString()) : []);
    const primary = req.body?.category ? [String(req.body.category)] : [];
    const extras = Array.isArray(req.body?.categories) ? req.body.categories.map((x)=> String(x)) : [];
    const all = [...new Set([...primary, ...extras])];
    if (!all.length) return res.status(400).json({ message: 'Product must specify category/categories' });
    const ok = all.every(id => allowed.includes(id));
    if (!ok) return res.status(403).json({ message: 'Product categories out of scope' });
    next();
  } catch (e) {
    console.error('enforceProductScopeByBody error:', e);
    res.status(500).json({ message: 'Scope enforcement error' });
  }
};