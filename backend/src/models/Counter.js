const { Schema, model } = require('mongoose');

const counterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: Number, required: true, default: 0, min: 0 }
  },
  {
    versionKey: false,
    timestamps: true
  }
);

module.exports = model('Counter', counterSchema);
