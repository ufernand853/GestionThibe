const { Schema, model, Types } = require('mongoose');
const { coerceQuantity } = require('../utils/quantity');

const quantitySchema = new Schema(
  {
    boxes: { type: Number, default: 0, min: 0 },
    units: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const movementRequestSchema = new Schema(
  {
    item: { type: Types.ObjectId, ref: 'Item', required: true },
    type: { type: String, enum: ['in', 'out', 'transfer'], required: true },
    fromList: { type: String, default: null },
    toList: { type: String, default: null },
    quantity: { type: quantitySchema, required: true, default: () => coerceQuantity() },
    reason: { type: String, default: '' },
    requestedBy: { type: Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'executed'], default: 'pending' },
    approvedBy: { type: Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    executedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: null },
    customer: { type: Types.ObjectId, ref: 'Customer', default: null },
    boxLabel: { type: String, default: null, trim: true }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

movementRequestSchema.index({ status: 1, requestedAt: -1 });

movementRequestSchema.pre('validate', function ensureQuantity(next) {
  this.quantity = coerceQuantity(this.quantity);
  next();
});

module.exports = model('MovementRequest', movementRequestSchema);
