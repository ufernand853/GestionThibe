const { Schema, model } = require('mongoose');

const destinationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    contactInfo: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

module.exports = model('Destination', destinationSchema);
