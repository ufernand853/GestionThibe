const { Schema, model, Types } = require('mongoose');

const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    parent: { type: Types.ObjectId, ref: 'Group', default: null }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

groupSchema.index({ name: 1 }, { unique: true });

module.exports = model('Group', groupSchema);
