const { Schema, model } = require('mongoose');

const roleSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    permissions: { type: [String], default: [] }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

module.exports = model('Role', roleSchema);
