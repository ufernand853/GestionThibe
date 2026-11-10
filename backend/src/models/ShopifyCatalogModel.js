const { Schema, model } = require('mongoose');

const variantSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  color: { type: String, required: true },
  size: { type: String, required: true }
}, { _id: false });

const boxSchema = new Schema({
  label: { type: String, required: true },
  opened: { type: Boolean, default: false },
  sourceKey: String,
  sourceBoxes: Number,
  quantities: [{ _id: false, itemId: Schema.Types.ObjectId, units: Number }]
}, { _id: false });

const catalogSchema = new Schema({
  code: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  variants: { type: [variantSchema], required: true },
  galleries: [{ _id: false, color: String, images: [String] }],
  boxes: [boxSchema],
  testOrders: [{
    key: String,
    itemId: Schema.Types.ObjectId,
    sku: String,
    color: String,
    size: String,
    units: Number,
    status: { type: String, enum: ['reserved', 'prepared', 'cancelled'] },
    source: String,
    createdAt: Date
  }],
  revision: { type: Number, default: 0 },
  updatedBy: String,
  productId: String,
  syncedRevision: Number,
  syncedAt: Date,
  syncError: String
}, { timestamps: true, versionKey: false });

catalogSchema.index({ 'variants.itemId': 1 }, { unique: true });

module.exports = model('ShopifyCatalogModel', catalogSchema);
