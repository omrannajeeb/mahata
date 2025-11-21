import mongoose from 'mongoose';

const walletRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['withdrawal', 'topup'], required: true },
  amount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  note: { type: String },
  adminNote: { type: String },
  processedAt: { type: Date }
}, { timestamps: true });

walletRequestSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('WalletRequest', walletRequestSchema);
