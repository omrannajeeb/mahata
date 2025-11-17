import express from 'express';
import { adminAuth, adminOrCategoryManager, enforceCategoryScopeByParam, enforceCategoryScopeByBodyIds } from '../middleware/auth.js';
import {
  getAllCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  getSubcategories,
  getCategoryTree,
  translateAllCategories
} from '../controllers/categoryController.js';

const router = express.Router();

// Public routes
// Alias handler: support query params active and parent used by mobile
router.get('/', (req, res, next) => {
  // If parent query is provided, redirect to /parent/:parentId
  if (typeof req.query.parent === 'string') {
    req.params.parentId = req.query.parent || 'root';
    return getSubcategories(req, res, next);
  }
  // If active=true, filter via controller (add query; controller already returns all)
  // For now, just call default controller which returns all; client can filter.
  return getAllCategories(req, res, next);
});
router.get('/tree', getCategoryTree);
router.get('/parent/:parentId', getSubcategories); // parentId = 'root' for root categories
router.get('/:id', getCategory);

// Admin routes
// Management routes (admins full access; category managers scoped)
router.get('/assigned', adminOrCategoryManager, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return getAllCategories(req, res, next);
    // For managers, list only assigned categories
    const { default: Category } = await import('../models/Category.js');
    const ids = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds : [];
    const list = await Category.find({ _id: { $in: ids } }).sort({ order: 1, name: 1 }).lean();
    return res.json(list);
  } catch (e) { return next(e); }
});

router.post('/', adminOrCategoryManager,
  // Require parent for category managers when creating
  (req, res, next) => {
    if (req.user.role === 'categoryManager' && !req.body?.parent) {
      return res.status(400).json({ message: 'CategoryManager must create subcategories under assigned parents' });
    }
    next();
  },
  enforceCategoryScopeByBodyIds((req)=> req.body?.parent ? [req.body.parent] : []),
  createCategory
);
router.put('/reorder', adminOrCategoryManager, enforceCategoryScopeByBodyIds((req)=> Array.isArray(req.body?.categories) ? req.body.categories.map(x=>x.id) : []), reorderCategories);
router.put('/:id([0-9a-fA-F]{24})', adminOrCategoryManager, enforceCategoryScopeByParam('id'), updateCategory);
router.delete('/:id([0-9a-fA-F]{24})', adminOrCategoryManager, enforceCategoryScopeByParam('id'), deleteCategory);
// Backfill translations for categories: POST /api/categories/translate?to=ar
router.post('/translate', adminAuth, translateAllCategories);

export default router;