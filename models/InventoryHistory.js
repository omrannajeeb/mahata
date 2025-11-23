import mongoose from 'mongoose';

const inventoryHistorySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  // Optional reference to variant for more granular per-variant history
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    index: true
  },
  // Legacy size/color when variantId is not used
  size: { type: String },
  color: { type: String },
  type: {
    type: String,
    enum: ['increase', 'decrease', 'update'],
    required: true
  },
  // Quantity supplied by existing code (kept for backward compatibility)
  quantity: {
    type: Number,
    required: true
  },
  // Additional granular fields
  beforeQuantity: { type: Number },
  afterQuantity: { type: Number },
  delta: { type: Number },
  reason: {
    type: String,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Performance indexes for analytics queries filtered/sorted by time and product
try { inventoryHistorySchema.index({ timestamp: -1 }); } catch {}
try { inventoryHistorySchema.index({ product: 1, timestamp: -1 }); } catch {}
try { inventoryHistorySchema.index({ product: 1, variantId: 1, timestamp: -1 }); } catch {}
try { inventoryHistorySchema.index({ user: 1, timestamp: -1 }); } catch {}

export default mongoose.model('InventoryHistory', inventoryHistorySchema);