const { Schema, model } = require('mongoose');

const LOCATION_TYPES = Object.freeze(['warehouse', 'external', 'externalOrigin']);

const locationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: LOCATION_TYPES, default: 'warehouse' },
    description: { type: String, default: '' },
    contactInfo: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

locationSchema.index({ name: 1, type: 1 }, { unique: false });

module.exports = model('Location', locationSchema);
module.exports.LOCATION_TYPES = LOCATION_TYPES;
