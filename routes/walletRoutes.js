import express from 'express';
import { adminAuth, adminOrCategoryManager } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Service from '../models/Service.js';
import WalletRequest from '../models/WalletRequest.js';

const router = express.Router();

// Helper to compute scoped sales for a manager based on assigned categories
async function computeScopedSalesAndFees(userId, scopeCategoryIds) {
  const orders = await Order.find().lean();
  if (!orders.length) return { totalSales: 0, totalFees: 0, recentSales: [], recentFees: [] };

  // Build product map for category lookup
  const productIds = Array.from(new Set(orders.flatMap(o => (o.items || []).map(it => String(it.product)).filter(Boolean))));
  const products = await Product.find({ _id: { $in: productIds } }).select('category categories').lean();
  const prodMap = new Map(products.map(p => [String(p._id), p]));

  let totalSales = 0;
  const recentSales = [];

  for (const o of orders) {
    let orderSales = 0;
    for (const it of (o.items || [])) {
      const p = prodMap.get(String(it.product));
      if (!p) continue;
      const cats = [p.category, ...(Array.isArray(p.categories)? p.categories: [])].filter(Boolean).map(c => String(c));
      const inScope = cats.some(c => scopeCategoryIds.includes(c));
      if (!inScope) continue;
      const line = (Number(it.price) || 0) * (Number(it.quantity) || 0);
      orderSales += line;
    }
    if (orderSales > 0) {
      totalSales += orderSales;
      recentSales.push({ orderId: String(o._id), amount: orderSales, date: o.createdAt });
    }
  }

  // Service fees (categoryServiceCharges) linked to this manager and in scope categories
  let totalFees = 0;
  const recentFees = [];
  const feeByService = new Map(); // serviceId -> { totalFee, serviceId }
  for (const o of orders) {
    const charges = Array.isArray(o.categoryServiceCharges) ? o.categoryServiceCharges : [];
    for (const sc of charges) {
      if (String(sc.managerUser) !== String(userId)) continue;
      if (sc.category && !scopeCategoryIds.includes(String(sc.category))) continue;
      const fee = Number(sc.totalFee) || 0;
      if (fee > 0) {
        totalFees += fee;
        recentFees.push({ orderId: String(o._id), amount: fee, service: String(sc.service), category: String(sc.category || ''), date: o.createdAt });
        const sid = String(sc.service);
        const prev = feeByService.get(sid) || { totalFee: 0, serviceId: sid };
        prev.totalFee += fee;
        feeByService.set(sid, prev);
      }
    }
  }

  // Keep only recent last 20 entries
  recentSales.sort((a,b)=> new Date(b.date) - new Date(a.date));
  recentFees.sort((a,b)=> new Date(b.date) - new Date(a.date));

  // Resolve service titles for breakdown
  const breakdownArr = Array.from(feeByService.values());
  if (breakdownArr.length) {
    try {
      const svcDocs = await Service.find({ _id: { $in: breakdownArr.map(b => b.serviceId) } }).select('title slug').lean();
      const titleMap = new Map(svcDocs.map(s => [String(s._id), s.title || s.slug || 'Service']));
      breakdownArr.forEach(b => { b.title = titleMap.get(b.serviceId) || 'Service'; });
    } catch (e) {
      // swallow errors (leave titles undefined)
    }
  }
  return { totalSales, totalFees, recentSales: recentSales.slice(0,20), recentFees: recentFees.slice(0,20), serviceBreakdown: breakdownArr };
}

// GET /api/wallet/me - summary for current category manager
router.get('/me', adminOrCategoryManager, async (req, res) => {
  try {
    let targetUserId = req.user._id;
    const role = req.user.role;

    // Determine scope categories for category manager; admin can pass userId and categories optionally
    let scopeIds = [];
    if (role === 'categoryManager') {
      scopeIds = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds.map(String) : [];
      if (!scopeIds.length) return res.json({ balance: 0, totalSales: 0, totalDeductions: 0, netAfterDeductions: 0, requests: { pending: 0, approved: 0, rejected: 0 }, recent: { sales: [], fees: [], requests: [] } });
    } else {
      // Admin view for specific manager via query ?userId=...
      const qUser = String(req.query.userId || '') || String(targetUserId);
      if (!qUser) return res.status(400).json({ message: 'userId required for admin view' });
      // For simplicity, admin scope = all categories; optionally filter by ?categories=
      const rawCats = String(req.query.categories || '').split(',').map(s=>s.trim()).filter(Boolean);
      scopeIds = rawCats.length ? rawCats : [];
      // Override userId
      targetUserId = qUser;
    }

    const { totalSales, totalFees, recentSales, recentFees, serviceBreakdown } = await computeScopedSalesAndFees(targetUserId, scopeIds.length ? scopeIds : (Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds.map(String) : []));

    // Wallet Requests impact (approved only)
    const approved = await WalletRequest.find({ user: targetUserId, status: 'approved' }).lean();
    const approvedTopups = approved.filter(r => r.type === 'topup').reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const approvedWithdrawals = approved.filter(r => r.type === 'withdrawal').reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const pendingCount = await WalletRequest.countDocuments({ user: targetUserId, status: 'pending' });
    const approvedCount = approved.length;
    const rejectedCount = await WalletRequest.countDocuments({ user: targetUserId, status: 'rejected' });

    const balance = totalSales + approvedTopups - approvedWithdrawals;
    return res.json({
      balance,
      totalSales,
      totalDeductions: totalFees,
      netAfterDeductions: totalSales - totalFees,
      requests: { pending: pendingCount, approved: approvedCount, rejected: rejectedCount },
      recent: { sales: recentSales, fees: recentFees, requests: (await WalletRequest.find({ user: targetUserId }).sort({ createdAt: -1 }).limit(20).lean()).map(r=>({ id: String(r._id), type: r.type, status: r.status, amount: r.amount, date: r.createdAt })) },
      serviceBreakdown
    });
  } catch (e) {
    console.error('[wallet/me] error', e);
    return res.status(500).json({ message: 'Failed to compute wallet summary' });
  }
});

// POST /api/wallet/requests - create a wallet request (manager)
router.post('/requests', adminOrCategoryManager, async (req, res) => {
  try {
    if (req.user.role !== 'categoryManager' && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { type, amount, note } = req.body || {};
    if (!['withdrawal', 'topup'].includes(String(type))) return res.status(400).json({ message: 'Invalid type' });
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) return res.status(400).json({ message: 'Amount must be positive' });
    // If withdrawal, ensure it does not exceed current net value (sales - service fees)
    if (type === 'withdrawal' && req.user.role === 'categoryManager') {
      const scopeIds = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds.map(String) : [];
      const { totalSales, totalFees } = await computeScopedSalesAndFees(req.user._id, scopeIds);
      const net = Math.max(0, totalSales - totalFees);
      if (amt > net) {
        return res.status(400).json({ message: 'Withdrawal amount exceeds available net value' });
      }
    }
    const doc = await WalletRequest.create({ user: req.user._id, type, amount: amt, note: note || '' });
    return res.status(201).json({ ok: true, request: doc });
  } catch (e) {
    console.error('[wallet/requests:create] error', e);
    return res.status(500).json({ message: 'Failed to create wallet request' });
  }
});

// GET /api/wallet/requests - admin list (optionally by status)
router.get('/requests', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const q = {};
    if (status && ['pending','approved','rejected'].includes(String(status))) q.status = status;
    const list = await WalletRequest.find(q).sort({ createdAt: -1 }).limit(200).lean();
    return res.json(list);
  } catch (e) {
    console.error('[wallet/requests:list] error', e);
    return res.status(500).json({ message: 'Failed to load wallet requests' });
  }
});

// PUT /api/wallet/requests/:id/approve
router.put('/requests/:id/approve', adminAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const doc = await WalletRequest.findById(id);
    if (!doc) return res.status(404).json({ message: 'Request not found' });
    if (doc.status !== 'pending') return res.status(400).json({ message: 'Request already processed' });
    doc.status = 'approved';
    doc.adminNote = req.body?.adminNote || '';
    doc.processedAt = new Date();
    await doc.save();
    return res.json({ ok: true, request: doc });
  } catch (e) {
    console.error('[wallet/requests:approve] error', e);
    return res.status(500).json({ message: 'Failed to approve request' });
  }
});

// PUT /api/wallet/requests/:id/reject
router.put('/requests/:id/reject', adminAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const doc = await WalletRequest.findById(id);
    if (!doc) return res.status(404).json({ message: 'Request not found' });
    if (doc.status !== 'pending') return res.status(400).json({ message: 'Request already processed' });
    doc.status = 'rejected';
    doc.adminNote = req.body?.adminNote || '';
    doc.processedAt = new Date();
    await doc.save();
    return res.json({ ok: true, request: doc });
  } catch (e) {
    console.error('[wallet/requests:reject] error', e);
    return res.status(500).json({ message: 'Failed to reject request' });
  }
});

export default router;
