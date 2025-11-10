const { Schema, model, Types } = require('mongoose');

const { coerceQuantity } = require('../utils/quantity');
const quantitySubSchema = require('./schemas/quantity');

const itemSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, unique: true },
    description: { type: String, required: true, trim: true },
    group: { type: Types.ObjectId, ref: 'Group', default: null },
    attributes: { type: Map, of: String, default: {} },
    unitsPerBox: {
      type: Number,
      min: 0,
      default: null,
      set: value => (value === null || value === undefined ? value : Math.trunc(value))
    },
    stock: { type: Map, of: quantitySubSchema, default: () => ({}) },
    images: { type: [String], default: [] },
    needsRecount: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

function toQuantity(value) {
  const coerced = coerceQuantity(value);
  return { boxes: coerced.boxes, units: coerced.units };
}

itemSchema.pre('validate', function ensureStockQuantities(next) {
  if (!this.stock || typeof this.stock !== 'object') {
    this.stock = {};
  }
  if (this.stock instanceof Map) {
    for (const [key, value] of this.stock.entries()) {
      this.stock.set(key, toQuantity(value));
    }
  } else {
    Object.keys(this.stock).forEach(key => {
      this.stock[key] = toQuantity(this.stock[key]);
    });
  }
  next();
});

module.exports = model('Item', itemSchema);
