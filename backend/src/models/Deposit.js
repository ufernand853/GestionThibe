const { Schema, model } = require('mongoose');

const depositSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

module.exports = model('Deposit', depositSchema);
