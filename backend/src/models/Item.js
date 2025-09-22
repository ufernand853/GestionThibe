const { Schema, model, Types } = require('mongoose');

const stockSchema = new Schema(
  {
    general: { type: Number, default: 0, min: 0 },
    overstockGeneral: { type: Number, default: 0, min: 0 },
    overstockThibe: { type: Number, default: 0, min: 0 },
    overstockArenal: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

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

module.exports = model('Item', itemSchema);
