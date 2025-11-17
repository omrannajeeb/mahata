import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  listPages,
  getPageById,
  getPageBySlug,
  createPage,
  updatePage,
  deletePage
} from '../controllers/pageController.js';

// Allow unauthenticated listing ONLY when requesting published pages explicitly.
// All other listing (drafts, mixed status, CRUD) still requires admin.
function maybePublicPublished(req, res, next) {
  try {
    const status = String(req.query.status || '').toLowerCase();
    if (status === 'published') {
      // Directly serve via existing controller without admin auth.
      return listPages(req, res);
    }
  } catch {}
  return next();
}

const router = express.Router();

// Public read by slug (published only)
router.get('/slug/:slug', getPageBySlug);

// Admin list + CRUD (with conditional public published access)
router.get('/', maybePublicPublished, adminAuth, listPages);
router.get('/:id', adminAuth, getPageById);
router.post('/', adminAuth, createPage);
router.put('/:id', adminAuth, updatePage);
router.delete('/:id', adminAuth, deletePage);

export default router;
