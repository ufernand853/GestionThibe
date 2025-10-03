const { Schema, model, Types } = require('mongoose');
const { coerceQuantity } = require('../utils/quantity');
const quantitySubSchema = require('./schemas/quantity');

const customerStockSchema = new Schema(
  {
    customer: { type: Types.ObjectId, ref: 'Customer', required: true },
    item: { type: Types.ObjectId, ref: 'Item', required: true },
    quantity: { type: quantitySubSchema, required: true, default: () => coerceQuantity() },
    status: { type: String, enum: ['reserved', 'delivered'], default: 'reserved' },
    boxLabel: { type: String, default: null, trim: true },
    dateCreated: { type: Date, default: Date.now },
    dateDelivered: { type: Date, default: null }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

customerStockSchema.index({ customer: 1, item: 1, status: 1, boxLabel: 1 });

customerStockSchema.pre('validate', function ensureQuantity(next) {
  this.quantity = coerceQuantity(this.quantity);
  next();
});

module.exports = model('CustomerStock', customerStockSchema);
