const { Schema, model, Types } = require('mongoose');

const { coerceQuantity } = require('../utils/quantity');

const quantitySchema = new Schema(
  {
    boxes: { type: Number, default: 0, min: 0 },
    units: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const stockSchema = new Schema(
  {
    general: { type: quantitySchema, default: () => coerceQuantity() },
    overstockGeneral: { type: quantitySchema, default: () => coerceQuantity() },
    overstockThibe: { type: quantitySchema, default: () => coerceQuantity() },
    overstockArenal: { type: quantitySchema, default: () => coerceQuantity() }
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
