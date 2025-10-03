const { Schema } = require('mongoose');

const quantitySchema = new Schema(
  {
    boxes: { type: Number, default: 0, min: 0 },
    units: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

module.exports = quantitySchema;
