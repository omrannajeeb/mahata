import express from 'express';
import { adminAuth, adminOrCategoryManager } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Service from '../models/Service.js';
import WalletRequest from '../models/WalletRequest.js';

const router = express.Router();

// Helper to compute scoped sales & fees for a manager based on assigned categories.
// Aligned with /orders/manage logic so wallet figures match dashboard cards.
async function computeScopedSalesAndFees(_userId, scopeCategoryIds) {
  const orders = await Order.find().lean();
  if (!orders.length || !scopeCategoryIds.length) return { totalSales: 0, totalFees: 0, recentSales: [], recentFees: [], serviceBreakdown: [] };

  // Build product map for category lookup
  const productIds = Array.from(new Set(orders.flatMap(o => (o.items || []).map(it => String(it.product)).filter(Boolean))));
  const products = await Product.find({ _id: { $in: productIds } }).select('category categories').lean();
  const prodMap = new Map(products.map(p => [String(p._id), p]));

  let totalSales = 0;
  const recentSales = [];
  let totalFees = 0;
  const recentFees = [];
  const feeByService = new Map(); // serviceId -> { totalFee, serviceId }

  for (const o of orders) {
    // Determine scoped items (same approach as /orders/manage) and compute scoped total
    let scopedTotal = 0;
    let inScopeOrder = false;
    for (const it of (o.items || [])) {
      const p = prodMap.get(String(it.product));
      if (!p) continue;
      const cats = [p.category, ...(Array.isArray(p.categories) ? p.categories : [])].filter(Boolean).map(c => String(c));
      const matched = cats.some(c => scopeCategoryIds.includes(c));
      if (!matched) continue;
      inScopeOrder = true;
      scopedTotal += (Number(it.price) || 0) * (Number(it.quantity) || 0);
    }
    if (inScopeOrder && scopedTotal > 0) {
      totalSales += scopedTotal;
      recentSales.push({ orderId: String(o._id), amount: scopedTotal, date: o.createdAt });
      // Collect fees from order charges whose category is in scope (do NOT filter by managerUser to match dashboard logic)
      const charges = Array.isArray(o.categoryServiceCharges) ? o.categoryServiceCharges : [];
      for (const sc of charges) {
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
  }

  // Sort & trim recent arrays
  recentSales.sort((a,b)=> new Date(b.date) - new Date(a.date));
  recentFees.sort((a,b)=> new Date(b.date) - new Date(a.date));

  // Resolve service titles for breakdown
  const breakdownArr = Array.from(feeByService.values());
  if (breakdownArr.length) {
    try {
      const svcDocs = await Service.find({ _id: { $in: breakdownArr.map(b => b.serviceId) } }).select('title slug').lean();
      const titleMap = new Map(svcDocs.map(s => [String(s._id), s.title || s.slug || 'Service']));
      breakdownArr.forEach(b => { b.title = titleMap.get(b.serviceId) || 'Service'; });
    } catch {/* ignore */}
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

    const { totalSales, totalFees, recentSales, recentFees, serviceBreakdown } = await computeScopedSalesAndFees(
      targetUserId,
      scopeIds.length ? scopeIds : (Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds.map(String) : [])
    );

    // Wallet Requests impact (approved only)
    const approved = await WalletRequest.find({ user: targetUserId, status: 'approved' }).lean();
    const approvedWithdrawals = approved.filter(r => r.type === 'withdrawal').reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const pendingCount = await WalletRequest.countDocuments({ user: targetUserId, status: 'pending' });
    const approvedCount = approved.length;
    const rejectedCount = await WalletRequest.countDocuments({ user: targetUserId, status: 'rejected' });

    // Balance should reflect net after service deductions minus any approved withdrawals
    const netAfterDeductions = totalSales - totalFees;
    const balance = Math.max(0, netAfterDeductions - approvedWithdrawals);
    const pendingWithdrawals = await WalletRequest.find({ user: targetUserId, status: 'pending', type: 'withdrawal' }).select('amount').lean();
    const pendingWithdrawalsSum = pendingWithdrawals.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const approvedUnreceived = await WalletRequest.find({ user: targetUserId, status: 'approved', type: 'withdrawal', receivedAt: { $exists: false } }).select('amount').lean();
    const approvedUnreceivedSum = approvedUnreceived.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const approvedTotalWithdrawals = approved.filter(r => r.type === 'withdrawal').reduce((s,r)=> s + (Number(r.amount)||0), 0);
    // netAfterDeductions already computed above
    // Funds already fully withdrawn (approved) reduce availability; pending & unreceived additionally lock remainder
    const lockedAmount = pendingWithdrawalsSum + approvedUnreceivedSum;
    const availableNetForWithdrawal = Math.max(0, netAfterDeductions - approvedTotalWithdrawals - pendingWithdrawalsSum);
    return res.json({
      balance,
      totalSales,
      totalDeductions: totalFees,
      netAfterDeductions,
      availableNetForWithdrawal,
      lockedAmount, // pending + approved not yet received
      requests: { pending: pendingCount, approved: approvedCount, rejected: rejectedCount },
      recent: { sales: recentSales, fees: recentFees, requests: (await WalletRequest.find({ user: targetUserId, type: 'withdrawal' }).sort({ createdAt: -1 }).limit(20).lean()).map(r=>({ id: String(r._id), type: r.type, status: r.status, amount: r.amount, date: r.createdAt, receivedAt: r.receivedAt || null })) },
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
    if (String(type) !== 'withdrawal') return res.status(400).json({ message: 'Invalid type' });
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) return res.status(400).json({ message: 'Amount must be positive' });
    // Prevent new withdrawal if there is a pending or an approved not yet received
    const unfinalized = await WalletRequest.exists({ user: req.user._id, type: 'withdrawal', $or: [ { status: 'pending' }, { status: 'approved', receivedAt: { $exists: false } } ] });
    if (unfinalized) return res.status(400).json({ message: 'You already have an unfinalized withdrawal (pending or not yet received)' });
    // If withdrawal, ensure it does not exceed current net value (sales - service fees)
    if (type === 'withdrawal' && req.user.role === 'categoryManager') {
      const scopeIds = Array.isArray(req.categoryScopeIds) ? req.categoryScopeIds.map(String) : [];
      // When creating a new withdrawal request, use post-reset figures (after last approved withdrawal)
      let sinceDate = null;
      try {
        const lastApproved = await WalletRequest.findOne({ user: req.user._id, status: 'approved' }).sort({ processedAt: -1 }).select('processedAt').lean();
        if (lastApproved?.processedAt) sinceDate = lastApproved.processedAt;
      } catch {/* ignore */}
      const { totalSales, totalFees } = await computeScopedSalesAndFees(req.user._id, scopeIds, sinceDate);
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

// PUT /api/wallet/requests/:id/received - manager confirms they received the funds
router.put('/requests/:id/received', adminOrCategoryManager, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const doc = await WalletRequest.findById(id);
    if (!doc) return res.status(404).json({ message: 'Request not found' });
    // Only allow the requester (category manager) to mark their own approved requests as received
    if (String(doc.user) !== String(req.user._id)) return res.status(403).json({ message: 'Forbidden' });
    if (doc.status !== 'approved') return res.status(400).json({ message: 'Only approved requests can be marked received' });
    if (doc.receivedAt) return res.status(400).json({ message: 'Already marked as received' });
    const signature = String(req.body?.signature || '').trim();
    if (!signature) return res.status(400).json({ message: 'Signature required' });
    doc.receivedAt = new Date();
    doc.receivedSignature = signature.slice(0,200);
    await doc.save();
    return res.json({ ok: true, request: doc });
  } catch (e) {
    console.error('[wallet/requests:received] error', e);
    return res.status(500).json({ message: 'Failed to mark request as received' });
  }
});

export default router;
