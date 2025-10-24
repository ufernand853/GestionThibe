const { Schema, model, Types } = require('mongoose');

const dashboardPreferencesSchema = new Schema(
  {
    manualAttentionIds: { type: [String], default: [] }
  },
  { _id: false }
);

const preferencesSchema = new Schema(
  {
    dashboard: { type: dashboardPreferencesSchema, default: () => ({}) }
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    username: { type: String, required: true, trim: true, unique: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: Types.ObjectId, ref: 'Role', required: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    lastLoginAt: { type: Date, default: null },
    preferences: { type: preferencesSchema, default: () => ({}) }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

module.exports = model('User', userSchema);
