const { Schema, model } = require('mongoose');

const variantSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, required: true },
  sourceItemId: Schema.Types.ObjectId,
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
  principalItemId: { type: Schema.Types.ObjectId, unique: true, sparse: true },
  claimedItemIds: { type: [Schema.Types.ObjectId], default: undefined },
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
  draftShopifyLocationId: String,
  adoptedProductId: { type: String, unique: true, sparse: true },
  syncedRevision: Number,
  syncedAt: Date,
  syncError: String
}, { timestamps: true, versionKey: false });

catalogSchema.index({ 'variants.itemId': 1 }, { unique: true });
catalogSchema.index({ claimedItemIds: 1 }, { unique: true, sparse: true });

module.exports = model('ShopifyCatalogModel', catalogSchema);
