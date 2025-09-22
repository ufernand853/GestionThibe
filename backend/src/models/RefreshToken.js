const { Schema, model, Types } = require('mongoose');

const refreshTokenSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    user: { type: Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
  },
  {
    versionKey: false
  }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('RefreshToken', refreshTokenSchema);
