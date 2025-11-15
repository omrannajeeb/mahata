import Coupon from '../models/Coupon.js';
import Product from '../models/Product.js';
import mongoose from 'mongoose';
import { StatusCodes } from 'http-status-codes';

export const createCoupon = async (req, res) => {
  try {
    const coupon = new Coupon(req.body);
    await coupon.save();
    res.status(StatusCodes.CREATED).json(coupon);
  } catch (error) {
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
  }
};

export const getAllCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate('categories', 'name')
      .populate('products', 'name')
      .sort('-createdAt');
    res.json(coupons);
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

export const getCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id)
      .populate('categories', 'name')
      .populate('products', 'name');
    
    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Coupon not found' });
    }
    
    res.json(coupon);
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

export const updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Coupon not found' });
    }
    
    res.json(coupon);
  } catch (error) {
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
  }
};

export const deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    
    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Coupon not found' });
    }
    
    res.json({ message: 'Coupon deleted successfully' });
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

export const validateCoupon = async (req, res) => {
  try {
    // Support both POST body and optional GET query fallback
    const codeRaw = (req.body?.code || req.query?.code || req.params?.code || '').toString();
    const totalAmountRaw = req.body?.totalAmount ?? req.query?.totalAmount ?? 0;
    const totalAmount = Number(totalAmountRaw) || 0;
    const itemsRaw = req.body?.items;

    if (!codeRaw) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Coupon code is required' });
    }

    const code = codeRaw.toUpperCase();
    const now = new Date();
    const coupon = await Coupon.findOne({
      code,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    }).populate('categories', 'name').populate('products','name');

    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Invalid or expired coupon code' });
    }
    
    // Determine base amount for discount calculation.
    // If coupon is restricted to certain products/categories, compute eligible subtotal from provided items.
    let baseAmount = totalAmount;
    const hasProductRestrictions = Array.isArray(coupon.products) && coupon.products.length > 0;
    const hasCategoryRestrictions = Array.isArray(coupon.categories) && coupon.categories.length > 0;

    if (hasProductRestrictions || hasCategoryRestrictions) {
      const items = Array.isArray(itemsRaw) ? itemsRaw : [];
      const readableCategoryNames = hasCategoryRestrictions && Array.isArray(coupon.categories)
        ? coupon.categories.map(c => c?.name).filter(Boolean)
        : [];
      if (items.length === 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: readableCategoryNames.length
            ? `Coupon is restricted. Valid only for categories: ${readableCategoryNames.join(', ')}`
            : 'Coupon applies only to specific items. Please add eligible products to your cart.'
        });
      }

      // Normalize and pick product ids from client cart payload
      const rawIds = [...new Set(items.map(it => String(it?.productId || '').trim()).filter(Boolean))];
      const productIds = rawIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));

      const products = await Product.find({ _id: { $in: productIds } }).select('_id category categories price');
      const eligibleProductIdSet = new Set();
      const priceById = new Map(products.map(p => [String(p._id), Number(p.price) || 0]));

      // When populated, coupon.products / coupon.categories contain full docs; fall back to raw id if not populated
      const couponProductIds = Array.isArray(coupon.products) ? coupon.products.map(p => String(p?._id || p)) : [];
      const couponCategoryIds = Array.isArray(coupon.categories) ? coupon.categories.map(c => String(c?._id || c)) : [];

      for (const p of products) {
        const idStr = String(p._id);
        let eligible = false;
        if (hasProductRestrictions && couponProductIds.includes(idStr)) {
          eligible = true;
        }
        if (!eligible && hasCategoryRestrictions) {
          const primary = p.category ? String(p.category) : null;
          const extra = Array.isArray(p.categories) ? p.categories.map(c => String(c)) : [];
          const prodCats = new Set([...(primary ? [primary] : []), ...extra]);
          for (const cId of couponCategoryIds) {
            if (prodCats.has(cId)) { eligible = true; break; }
          }
        }
        if (eligible) eligibleProductIdSet.add(idStr);
      }

      let eligibleSubtotal = 0;
      for (const it of items) {
        const pid = String(it?.productId || '').trim();
        const qty = Number(it?.quantity) || 0;
        const price = priceById.get(pid) ?? (Number(it?.price) || 0);
        if (eligibleProductIdSet.has(pid)) {
          eligibleSubtotal += qty * price;
        }
      }

      if (eligibleSubtotal <= 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: readableCategoryNames.length
            ? `Coupon not applicable. It is valid only for categories: ${readableCategoryNames.join(', ')}`
            : 'Coupon is not applicable to the items in your cart'
        });
      }

      baseAmount = eligibleSubtotal;
    }

    if (baseAmount < coupon.minPurchase) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: `Minimum purchase amount of $${coupon.minPurchase} required` });
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Coupon usage limit reached' });
    }

    let discount = 0;
    if (coupon.type === 'percentage') {
      discount = (baseAmount * coupon.value) / 100;
      if (coupon.maxDiscount) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      discount = coupon.value;
    }

    res.json({ 
      coupon, 
      discount: Number(discount.toFixed(2)),
      baseAmount,
      appliedScope: (hasProductRestrictions || hasCategoryRestrictions) ? 'restricted' : 'cart'
    });
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

export const applyCoupon = async (req, res) => {
  try {
    const { code } = req.params;
    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    
    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Coupon not found' });
    }

    // Increment usage count
    coupon.usedCount += 1;
    await coupon.save();

    res.json({ message: 'Coupon applied successfully' });
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};