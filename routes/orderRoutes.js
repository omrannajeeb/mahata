import express from 'express';
import { auth, adminAuth, adminOrCategoryManager } from '../middleware/auth.js';
import {
  createOrder,
  getUserOrders,
  getAllOrders,
  getOrderPublic,
  updateOrderStatus,
  recalculateShipping
} from '../controllers/orderController.js';

const router = express.Router();

// Public routes (guest checkout)
router.post('/', (req, res, next) => {
  console.log('POST /orders route hit');
  next();
}, createOrder);

// Protected routes
router.get('/my-orders', auth, getUserOrders);

// Admin routes (must be before catch-all '/:id')
// Full admin list (legacy). Category managers use /manage for scoped access.
router.get('/all', adminAuth, getAllOrders);

// Scoped management list for category managers (and admins for parity)
router.get('/manage', adminOrCategoryManager, async (req, res) => {
  try {
    // Admin delegates to existing controller for consistency
    if (req.user.role === 'admin') return getAllOrders(req, res);
    const scopeIds = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds.map(id=>String(id)).filter(id=>/^[0-9a-fA-F]{24}$/.test(id)) : [];
    if (!scopeIds.length) return res.json([]);
    // Fetch all orders (could be optimized with aggregation; kept simple)
    const orders = await (await import('../models/Order.js')).default.find().lean();
    // Collect unique product ids from order items
    const productIds = Array.from(new Set(orders.flatMap(o => (o.items||[]).map(it => String(it.product)).filter(Boolean))));
    if (!productIds.length) return res.json([]);
    const Product = (await import('../models/Product.js')).default;
    const prodDocs = await Product.find({ _id: { $in: productIds } }).select('category categories').lean();
    const prodMap = new Map(prodDocs.map(p => [String(p._id), p]));
    const allowedOrderIds = new Set();
    for (const o of orders) {
      for (const it of (o.items||[])) {
        const p = prodMap.get(String(it.product));
        if (!p) continue;
        // Primary category + extra categories
        const cats = [p.category, ...(Array.isArray(p.categories) ? p.categories : [])].filter(Boolean).map(c=>String(c));
        if (cats.some(c => scopeIds.includes(c))) { allowedOrderIds.add(String(o._id)); break; }
      }
    }
    const filtered = orders.filter(o => allowedOrderIds.has(String(o._id)));
    return res.json(filtered);
  } catch (e) {
    console.error('[orders/manage] error', e);
    return res.status(500).json({ message: 'Failed to load scoped orders' });
  }
});

// Public order details (guest checkout flow)
router.get('/:id', getOrderPublic);
// Full admin update (customer info, shipping address, status, fee)
import { updateOrder } from '../controllers/orderController.js';
router.put('/:id', adminAuth, updateOrder);
router.put('/:id/status', adminAuth, updateOrderStatus);
router.post('/:id/recalculate-shipping', adminAuth, recalculateShipping);

export default router;