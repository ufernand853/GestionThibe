const { Schema, model, Types } = require('mongoose');
const { coerceQuantity } = require('../utils/quantity');
const quantitySubSchema = require('./schemas/quantity');

const movementRequestSchema = new Schema(
  {
    item: { type: Types.ObjectId, ref: 'Item', required: true },
    type: { type: String, enum: ['transfer'], default: 'transfer' },
    fromDeposit: { type: Types.ObjectId, ref: 'Deposit', required: true },
    toDeposit: { type: Types.ObjectId, ref: 'Deposit', required: true },
    quantity: { type: quantitySubSchema, required: true, default: () => coerceQuantity() },
    reason: { type: String, default: '' },
    requestedBy: { type: Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'executed'], default: 'pending' },
    approvedBy: { type: Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    executedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: null }
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
