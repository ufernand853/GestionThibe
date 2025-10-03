const { Schema, model, Types } = require('mongoose');

const { coerceQuantity } = require('../utils/quantity');
const quantitySubSchema = require('./schemas/quantity');

const stockSchema = new Schema(
  {
    general: { type: quantitySubSchema, default: () => coerceQuantity() },
    overstockGeneral: { type: quantitySubSchema, default: () => coerceQuantity() },
    overstockThibe: { type: quantitySubSchema, default: () => coerceQuantity() },
    overstockArenal: { type: quantitySubSchema, default: () => coerceQuantity() }
  },
  { _id: false }
);

['general', 'overstockGeneral', 'overstockThibe', 'overstockArenal'].forEach(path => {
  stockSchema.path(path).set(coerceQuantity);
});

const itemSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, unique: true },
    description: { type: String, required: true, trim: true },
    group: { type: Types.ObjectId, ref: 'Group', default: null },
    attributes: { type: Map, of: String, default: {} },
    stock: { type: stockSchema, default: () => ({}) }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

itemSchema.pre('validate', function ensureStockQuantities(next) {
  if (!this.stock || typeof this.stock !== 'object') {
    this.stock = {};
  }
  ['general', 'overstockGeneral', 'overstockThibe', 'overstockArenal'].forEach(key => {
    this.stock[key] = coerceQuantity(this.stock[key]);
  });
  next();
});

module.exports = model('Item', itemSchema);
