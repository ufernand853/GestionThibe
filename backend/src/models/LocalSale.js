const { Schema, model, Types } = require('mongoose');

const saleLineSchema = new Schema(
  {
    item: { type: Types.ObjectId, ref: 'Item', required: true },
    code: { type: String, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    movementRequest: { type: Types.ObjectId, ref: 'MovementRequest', required: true },
    shopifyStatus: { type: String, enum: ['synced', 'not_linked', 'location_not_mapped', 'pending'], required: true },
    shopifyError: { type: String, default: null }
  },
  { _id: false }
);

const localSaleSchema = new Schema(
  {
    location: { type: Types.ObjectId, ref: 'Location', required: true },
    authorizedBy: { type: Types.ObjectId, ref: 'User', required: true },
    operatedBy: { type: Types.ObjectId, ref: 'User', required: true },
    lines: { type: [saleLineSchema], required: true }
  },
  { timestamps: true, versionKey: false }
);

localSaleSchema.index({ location: 1, createdAt: -1 });

module.exports = model('LocalSale', localSaleSchema);
