const { Schema, model, Types } = require('mongoose');

const customerStockSchema = new Schema(
  {
    customer: { type: Types.ObjectId, ref: 'Customer', required: true },
    item: { type: Types.ObjectId, ref: 'Item', required: true },
    quantity: { type: Number, required: true, min: 0 },
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

module.exports = model('CustomerStock', customerStockSchema);
