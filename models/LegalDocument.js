import mongoose from 'mongoose';

const legalDocumentSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true }, // e.g. privacy-policy, terms-of-service
  title: { type: String, required: true },
  content: { type: String, required: true }, // markdown or html
  format: { type: String, enum: ['markdown', 'html'], default: 'markdown' },
  version: { type: Number, default: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Increment version when content changes
legalDocumentSchema.pre('save', function(next) {
  if (this.isModified('content') && !this.isNew) {
    this.version = (this.version || 1) + 1;
  }
  this.updatedAt = new Date();
  next();
});

legalDocumentSchema.index({ slug: 1 });
legalDocumentSchema.index({ updatedAt: -1 });

export default mongoose.model('LegalDocument', legalDocumentSchema);
