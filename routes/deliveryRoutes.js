import express from 'express';
import { auth, adminAuth, adminOrCategoryManager } from '../middleware/auth.js';
import {
  listCompanies,
  listActiveCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  updateFieldMappings,
  calculateDeliveryFee,
  sendOrder,
  sendOrderWithOrderPayload,
  getDeliveryStatus,
  validateFieldMappings,
  validateAllFieldMappings,
  listDeliveryOrders,
  testConnection,
  validateCompanyConfig,
  batchAssignOrders,
  batchSendOrders,
} from '../controllers/deliveryController.js';

const router = express.Router();

// Delivery stats (delivered orders count scoped by category manager categories)
router.get('/stats', adminOrCategoryManager, async (req, res) => {
  try {
    const OrderModel = (await import('../models/Order.js')).default;
    const Product = (await import('../models/Product.js')).default;
    const orders = await OrderModel.find({ status: { $in: ['delivered','shipped','processing','pending'] } }).select('status items.product').lean();
    if (req.user.role === 'admin' || !req.categoryScopeIds) {
      const delivered = orders.filter(o => o.status === 'delivered');
      return res.json({ delivered: delivered.length });
    }
    const scopeIds = req.categoryScopeIds.map(String);
    const productIds = Array.from(new Set(orders.flatMap(o => (o.items||[]).map(i => String(i.product)))));
    const prodDocs = await Product.find({ _id: { $in: productIds } }).select('category categories').lean();
    const prodMap = new Map(prodDocs.map(p => [String(p._id), p]));
    let deliveredCount = 0;
    for (const o of orders) {
      if (o.status !== 'delivered') continue;
      for (const it of (o.items || [])) {
        const p = prodMap.get(String(it.product));
        if (!p) continue;
        const cats = [p.category, ...(Array.isArray(p.categories)?p.categories:[])].filter(Boolean).map(c=>String(c));
        if (cats.some(c => scopeIds.includes(c))) { deliveredCount++; break; }
      }
    }
    return res.json({ delivered: deliveredCount });
  } catch (e) {
    console.error('[delivery/stats] error', e);
    res.status(500).json({ message: 'Failed to compute delivery stats' });
  }
});

// Conditional admin guard for development/testing without tokens
const deliveryAdminGuard = (req, res, next) => {
  const bypass = process.env.DELIVERY_ADMIN_BYPASS === 'true' || process.env.DEV_DELIVERY_NO_AUTH === 'true';
  if (bypass) return next();
  return adminAuth(req, res, next);
};

// Companies (admin)
router.get('/companies', deliveryAdminGuard, listCompanies);
router.post('/companies', deliveryAdminGuard, createCompany);
router.get('/companies/:id', deliveryAdminGuard, getCompany);
router.put('/companies/:id', deliveryAdminGuard, updateCompany);
router.delete('/companies/:id', deliveryAdminGuard, deleteCompany);
router.put('/companies/:id/field-mappings', deliveryAdminGuard, updateFieldMappings);
router.post('/companies/:id/test-connection', deliveryAdminGuard, testConnection);
// Validate config + show effective db sources
router.get('/companies/:id/validate-config', deliveryAdminGuard, validateCompanyConfig);
router.get('/companies/:id/validate-config', deliveryAdminGuard, validateCompanyConfig);

// Public companies listing for checkout
router.get('/companies/public/active', listActiveCompanies);

// Fee calculation for a company
router.post('/companies/:id/calculate-fee', calculateDeliveryFee);

// Send order to delivery company
router.post('/send', deliveryAdminGuard, sendOrder);
// Batch assign multiple orders to a delivery company
router.post('/assign/batch', deliveryAdminGuard, batchAssignOrders);
// Batch send multiple orders to provider (full integration flow)
router.post('/send/batch', deliveryAdminGuard, batchSendOrders);

// Legacy/alternate send path used by some components
router.post('/order', deliveryAdminGuard, sendOrderWithOrderPayload);

// Status
router.get('/status/:orderId/:companyId?', auth, getDeliveryStatus);

// Validate field mappings
router.post('/validate-field-mappings', deliveryAdminGuard, validateFieldMappings);
// Bulk validation across multiple companies
router.post('/validate-field-mappings/bulk', deliveryAdminGuard, validateAllFieldMappings);

// List delivery orders (for dashboards)
router.get('/orders', deliveryAdminGuard, listDeliveryOrders);

export default router;
