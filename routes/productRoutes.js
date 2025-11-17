import express from 'express';
import { auth, adminAuth, adminOrCategoryManager, enforceProductScopeById, constrainQueryToAssignedCategories, enforceProductScopeByBody } from '../middleware/auth.js';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  updateRelatedProducts,
  updateAddOns,
  searchProducts,
  reorderFeaturedProducts,
  bulkCreateProducts,
  getProductStock,
  uploadProductVideo,
  uploadTempProductVideo,
  getProductFilters,
  getProductLite,
  getProductStats
} from '../controllers/productController.js';
import { videoUpload } from '../middleware/videoUpload.js';
import {
  getAllReviews,
  addReview,
  updateReview,
  markReviewHelpful,
  reportReview,
  verifyReview,
  deleteReview
} from '../controllers/reviewController.js';
import { updateProductImages, generateProductVariants, updateVariant, bulkUpdateVariants, getAttributeValueImages, setAttributeValueImages, deleteVariant, translateProductFields, batchTranslateProducts, syncQuantityFromRivhit, getProductI18n, setProductI18n } from '../controllers/productController.js';

const router = express.Router();

// Public routes
// Alias: allow GET /api/products?q=term (maps to search controller when q present)
router.get('/', (req, res, next) => {
  if (req.query && typeof req.query.q === 'string' && req.query.q.trim()) {
    return searchProducts(req, res, next);
  }
  return getProducts(req, res, next);
});
router.get('/filters', getProductFilters); // must be before :id
// Admin stats (total/active counts)
router.get('/stats', adminOrCategoryManager, constrainQueryToAssignedCategories, getProductStats);
router.get('/search', searchProducts);
router.get('/lite/:id', getProductLite);
// Place static paths before dynamic ':id' to avoid conflicts
router.get('/:id([0-9a-fA-F]{24})/stock', getProductStock); // New endpoint for stock levels
// Constrain :id to a 24-hex ObjectId so paths like /manage don't collide
router.get('/:id([0-9a-fA-F]{24})', getProduct);

// Protected routes (admin only)
router.post('/', adminOrCategoryManager, enforceProductScopeByBody, createProduct);
router.post('/bulk', adminOrCategoryManager, enforceProductScopeByBody, createProduct);
// Translation endpoints
router.post('/translate/batch', adminOrCategoryManager, constrainQueryToAssignedCategories, batchTranslateProducts);
router.post('/:id/translate', adminOrCategoryManager, enforceProductScopeById, translateProductFields);
// Manual i18n (admin)
router.get('/:id/i18n', adminOrCategoryManager, enforceProductScopeById, getProductI18n);
router.put('/:id/i18n', adminOrCategoryManager, enforceProductScopeById, setProductI18n);
// Put static route before dynamic ones
router.put('/featured/reorder', adminOrCategoryManager, constrainQueryToAssignedCategories, reorderFeaturedProducts);
router.put('/:id', adminOrCategoryManager, enforceProductScopeById, enforceProductScopeByBody, updateProduct);
// Sync quantity from Rivhit for product or variant (variantId via query param)
router.post('/:id/sync-rivhit-qty', adminOrCategoryManager, enforceProductScopeById, syncQuantityFromRivhit);
router.put('/:id/related', adminOrCategoryManager, enforceProductScopeById, updateRelatedProducts);
router.put('/:id/addons', adminOrCategoryManager, enforceProductScopeById, updateAddOns);
// Variant management
router.post('/:id/variants/generate', adminOrCategoryManager, enforceProductScopeById, generateProductVariants);
router.put('/:id/variants/:variantId', adminOrCategoryManager, enforceProductScopeById, updateVariant);
router.put('/:id/variants-bulk', adminOrCategoryManager, enforceProductScopeById, bulkUpdateVariants);
router.delete('/:id/variants/:variantId', adminOrCategoryManager, enforceProductScopeById, deleteVariant);
// Attribute value images on a product
router.get('/:id/attribute-images', adminOrCategoryManager, enforceProductScopeById, getAttributeValueImages);
router.put('/:id/attribute-images', adminOrCategoryManager, enforceProductScopeById, setAttributeValueImages);
// Partial image-only update
router.patch('/:id/images', adminOrCategoryManager, enforceProductScopeById, updateProductImages);
router.post('/:id/videos', adminOrCategoryManager, enforceProductScopeById, videoUpload.single('video'), uploadProductVideo);
// Pre-create standalone video upload (returns URL only). Must precede dynamic :id catch for GETs but after other static POSTs.
router.post('/videos/temp', adminOrCategoryManager, videoUpload.single('video'), uploadTempProductVideo);
router.delete('/:id', adminOrCategoryManager, enforceProductScopeById, deleteProduct);

// Management-friendly list for admins and category managers (scoped for managers)
// Management-friendly list for admins and category managers (scoped for managers)
// Place before any unconstrained dynamic :id routes (now constrained, but keep for clarity)
router.get('/manage', adminOrCategoryManager, constrainQueryToAssignedCategories, getProducts);

// Review routes
router.get('/reviews/all', adminAuth, getAllReviews);
router.post('/:id/reviews', auth, addReview);
router.patch('/:id/reviews/:reviewId', auth, updateReview);
router.post('/:id/reviews/:reviewId/helpful', auth, markReviewHelpful);
router.post('/:id/reviews/:reviewId/report', auth, reportReview);
router.put('/:id/reviews/:reviewId/verify', adminAuth, verifyReview);
router.delete('/:id/reviews/:reviewId', auth, deleteReview);

export default router;