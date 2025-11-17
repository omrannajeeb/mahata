import mongoose from 'mongoose';

const categoryServiceAssignmentSchema = new mongoose.Schema({
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  // Optional override; if null/undefined, use Service.feePerUnit
  feePerUnit: { type: Number, required: false, min: 0 },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

try { categoryServiceAssignmentSchema.index({ category: 1, service: 1 }, { unique: true }); } catch {}

export default mongoose.model('CategoryServiceAssignment', categoryServiceAssignmentSchema);
