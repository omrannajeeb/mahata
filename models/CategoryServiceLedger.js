import mongoose from 'mongoose';

const categoryServiceLedgerSchema = new mongoose.Schema({
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  managerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
  quantity: { type: Number, required: true, min: 1 },
  feePerUnit: { type: Number, required: true, min: 0 },
  totalFee: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: () => process.env.STORE_CURRENCY || 'USD' }
}, { timestamps: true });

try { categoryServiceLedgerSchema.index({ category: 1, managerUser: 1, createdAt: -1 }); } catch {}
try { categoryServiceLedgerSchema.index({ service: 1, createdAt: -1 }); } catch {}

export default mongoose.model('CategoryServiceLedger', categoryServiceLedgerSchema);
