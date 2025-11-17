import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: false, trim: true },
    // Fee applied per product unit under the linked category (not charged to customer)
    feePerUnit: { type: Number, required: true, default: 0, min: 0 },
    // Optional legacy link to a single category; preferred way is assignments collection
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: false, index: true },
    // Whether service is active and should be applied
    isActive: { type: Boolean, default: true, index: true },
    // Optional image/icon
    imageUrl: { type: String, required: false },
    // Optional SEO slug
    slug: { type: String, required: false, trim: true, lowercase: true, index: true, unique: true, sparse: true },
    // Simple ordering for listings
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

try { serviceSchema.index({ category: 1, isActive: 1 }); } catch {}
try { serviceSchema.index({ category: 1, order: 1 }); } catch {}

export default mongoose.model('Service', serviceSchema);
