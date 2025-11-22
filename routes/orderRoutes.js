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

// Manager/Admin store stats (orders + delivered counts)
router.get('/stats', adminOrCategoryManager, async (req, res) => {
  try {
    const OrderModel = (await import('../models/Order.js')).default;
    const Product = (await import('../models/Product.js')).default;
    // Fetch minimal fields to reduce memory
    const orders = await OrderModel.find({}, 'status items.product').lean();
    if (req.user.role === 'admin' || !req.categoryScopeIds) {
      // Global counts (any order with items >0)
      const allWithItems = orders.filter(o => Array.isArray(o.items) && o.items.length);
      const delivered = allWithItems.filter(o => o.status === 'delivered');
      return res.json({ orders: allWithItems.length, delivered: delivered.length });
    }
    const scopeIds = req.categoryScopeIds.map(String);
    // Collect product ids
    const productIds = Array.from(new Set(orders.flatMap(o => (o.items||[]).map(i => String(i.product)))));
    const prodDocs = await Product.find({ _id: { $in: productIds } }).select('category categories').lean();
    const prodMap = new Map(prodDocs.map(p => [String(p._id), p]));
    let ordersCount = 0;
    let deliveredCount = 0;
    for (const o of orders) {
      let inScope = false;
      for (const it of (o.items || [])) {
        const p = prodMap.get(String(it.product));
        if (!p) continue;
        const cats = [p.category, ...(Array.isArray(p.categories)?p.categories:[])].filter(Boolean).map(c=>String(c));
        if (cats.some(c => scopeIds.includes(c))) { inScope = true; break; }
      }
      if (inScope) {
        ordersCount++;
        if (o.status === 'delivered') deliveredCount++;
      }
    }
    return res.json({ orders: ordersCount, delivered: deliveredCount });
  } catch (e) {
    console.error('[orders/stats] error', e);
    res.status(500).json({ message: 'Failed to compute order stats' });
  }
});

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
    const scopeIds = Array.isArray(req.categoryScopeIds)
      ? req.categoryScopeIds.map(id => String(id)).filter(id => /^[0-9a-fA-F]{24}$/.test(id))
      : [];
    if (!scopeIds.length) return res.json([]);

    // Fetch all orders (could be optimized with aggregation; kept simple)
    const OrderModel = (await import('../models/Order.js')).default;
    const orders = await OrderModel.find().lean();

    // Collect unique product ids from order items
    const productIds = Array.from(
      new Set(
        orders.flatMap(o => (o.items || []).map(it => String(it.product)).filter(Boolean))
      )
    );
    if (!productIds.length) return res.json([]);

    const Product = (await import('../models/Product.js')).default;
    const prodDocs = await Product.find({ _id: { $in: productIds } })
      .select('category categories')
      .lean();
    const prodMap = new Map(prodDocs.map(p => [String(p._id), p]));

    // Build scoped view per order: keep only items in assigned categories and recompute total
    const scopedOrders = [];
    for (const o of orders) {
      const scopedItems = [];
      for (const it of (o.items || [])) {
        const p = prodMap.get(String(it.product));
        if (!p) continue;
        const cats = [p.category, ...(Array.isArray(p.categories) ? p.categories : [])]
          .filter(Boolean)
          .map(c => String(c));
        const inScope = cats.some(c => scopeIds.includes(c));
        if (inScope) {
          // Choose a representative category for this item (prefer one within scope)
          const matchedCat = cats.find(c => scopeIds.includes(c)) || cats[0] || null;
          // Attach helper fields for UI analytics without altering stored schema
          scopedItems.push({
            ...it,
            productCategory: matchedCat || null,
            productId: String(it.product || '')
          });
        }
      }
      if (!scopedItems.length) continue; // No in-scope items for this order
      const scopedTotal = scopedItems.reduce(
        (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0),
        0
      );
      scopedOrders.push({
        ...o,
        items: scopedItems,
        totalAmount: scopedTotal,
        scoped: {
          categories: scopeIds,
          originalTotal: Number(o.totalAmount) || 0,
          scopedTotal,
          excludedTotal: Math.max(0, (Number(o.totalAmount) || 0) - scopedTotal)
        }
      });
    }

    return res.json(scopedOrders);
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