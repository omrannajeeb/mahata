import asyncHandler from 'express-async-handler';
import { StatusCodes } from 'http-status-codes';
import revenueAnalyticsService from '../services/revenueAnalyticsService.js';
import dataSeeder from '../services/dataSeeder.js';

// @desc Get revenue analytics
// @route GET /api/revenue/analytics
// @access Private
export const getRevenueAnalytics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Default to last 30 days if no dates provided
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  console.log('Revenue analytics request:', { start, end });

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ start, end });

  res.status(StatusCodes.OK).json({
    success: true,
    data: analytics,
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      days: Math.ceil((end - start) / (1000 * 60 * 60 * 24))
    }
  });
});

// @desc Get revenue forecast
// @route GET /api/revenue/forecast
// @access Private
export const getRevenueForecast = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const forecastDays = Math.min(parseInt(days), 90); // Limit to 90 days

  console.log('Revenue forecast request:', { days: forecastDays });

  const forecast = await revenueAnalyticsService.getRevenueForecast(forecastDays);

  res.status(StatusCodes.OK).json({
    success: true,
    data: forecast,
    parameters: {
      forecastDays,
      generatedAt: new Date().toISOString()
    }
  });
});

// @desc Get real-time revenue metrics
// @route GET /api/revenue/realtime
// @access Private
export const getRealTimeRevenue = asyncHandler(async (req, res) => {
  // Get today's metrics for real-time display
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ 
    start: today, 
    end: tomorrow 
  });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      todayRevenue: analytics.summary.todayRevenue,
      totalOrders: analytics.summary.totalOrders,
      averageOrderValue: analytics.summary.averageOrderValue,
      hourlyRevenue: analytics.hourlyRevenue,
      lastUpdated: new Date().toISOString()
    }
  });
});

// @desc Update revenue on new order (for real-time updates)
// @route POST /api/revenue/update-order
// @access Private
export const updateRevenueOnOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: 'Order ID is required'
    });
  }

  // This would typically be called internally when an order is created/updated
  // For now, we'll return the current real-time metrics
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ 
    start: today, 
    end: tomorrow 
  });

  res.status(StatusCodes.OK).json({
    success: true,
    data: analytics.summary,
    updatedAt: new Date().toISOString()
  });
});

// @desc Get revenue by category
// @route GET /api/revenue/categories
// @access Private
export const getRevenueByCategoryController = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ start, end });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      categories: analytics.categoryRevenue,
      totalRevenue: analytics.summary.totalRevenue,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    }
  });
});

// @desc Get top products by revenue
// @route GET /api/revenue/products
// @access Private
export const getTopProductsByRevenue = asyncHandler(async (req, res) => {
  const { startDate, endDate, limit = 10 } = req.query;

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ start, end });
  let products = analytics.topProducts;

  // Scope filtering for category managers when requested
  const debug = req.query.debug === '1' || req.query.debug === 'true';
  const fallback = req.query.fallback === '1' || req.query.fallback === 'true';
  let debugInfo = undefined;

  if (req.user && req.user.role === 'categoryManager' && (req.query.scope === 'manager' || req.query.scope === 'assigned')) {
    try {
      const Product = (await import('../models/Product.js')).default;
      const ids = products.map(p => p.productId).filter(Boolean);
      const prodDocs = await Product.find({ _id: { $in: ids } }).select('category categories').lean();
      const scopeIds = Array.isArray(req.user.assignedCategories) ? req.user.assignedCategories.map(c => String(c)) : [];
      const allowedSet = new Set(scopeIds);
      const docMap = new Map(prodDocs.map(d => [String(d._id), d]));
      let filtered = [];
      debugInfo = [];
      for (const p of products) {
        const d = docMap.get(String(p.productId));
        if (!d) {
          if (debug) debugInfo.push({ productId: p.productId, name: p.name, reason: 'docMissing' });
          continue;
        }
        const cats = [d.category, ...(Array.isArray(d.categories)?d.categories:[])]
          .filter(Boolean).map(c=>String(c));
        const inScope = cats.some(c => allowedSet.has(c));
        if (inScope) {
          filtered.push(p);
          if (debug) debugInfo.push({ productId: p.productId, name: p.name, matchedCategories: cats.filter(c=>allowedSet.has(c)), allCategories: cats });
        } else if (debug) {
          debugInfo.push({ productId: p.productId, name: p.name, reason: 'outOfScope', allCategories: cats });
        }
      }
      // Fallback to global products when none match and requested
      if (!filtered.length && fallback) {
        if (debug) debugInfo.push({ reason: 'fallbackToGlobal' });
        products = products; // unchanged global list
      } else {
        products = filtered;
      }
    } catch (scopeErr) {
      console.warn('[revenue/products] scope filter failed', scopeErr?.message || scopeErr);
      products = []; // fail closed to avoid leaking data out of scope
    }
  }

  const lim = parseInt(limit);
  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      products: products.slice(0, lim),
      totalProducts: products.length,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      },
      debug: debug ? debugInfo : undefined
    }
  });
});

// @desc Get revenue trends
// @route GET /api/revenue/trends
// @access Private
export const getRevenueTrends = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ start, end });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      dailyRevenue: analytics.dailyRevenue,
      trends: analytics.trends,
      summary: analytics.summary,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    }
  });
});

// @desc Seed revenue data for testing
// @route POST /api/revenue/seed
// @access Public
export const seedRevenueData = asyncHandler(async (req, res) => {
  await dataSeeder.seedRevenueData();
  await dataSeeder.seedTodaysOrders();
  
  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Revenue data seeded successfully'
  });
});
