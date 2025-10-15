const { Schema, model } = require('mongoose');

const locationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['warehouse', 'external'], default: 'warehouse' },
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
