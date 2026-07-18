const { Schema, model, Types } = require('mongoose');

const { coerceQuantity } = require('../utils/quantity');
const quantitySubSchema = require('./schemas/quantity');

const priceTierSchema = new Schema(
  {
    minQuantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const itemSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, unique: true },
    sku: { type: String, trim: true, unique: true, sparse: true, immutable: true },
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
    needsRecount: { type: Boolean, default: false },
    pDecimal: { type: Number, default: null },
    priceTiers: { type: [priceTierSchema], default: [] },
    lastCountedAt: { type: Date, default: null },
    lastCountedBy: { type: String, default: null, trim: true },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: String, default: null, trim: true },
    scheduledDeletionAt: { type: Date, default: null, index: true },
    shopify: {
      productId: { type: String, default: null, trim: true },
      variantId: { type: String, default: null, trim: true },
      handle: { type: String, default: null, trim: true },
      status: { type: String, enum: ['draft', 'active', 'archived', 'deleted'], default: 'draft' },
      lastSyncedAt: { type: Date, default: null },
      lastAction: { type: String, default: null, trim: true },
      lastError: { type: String, default: null, trim: true }
    }
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
