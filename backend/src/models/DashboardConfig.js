const { Schema, model } = require('mongoose');

const dashboardConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    manualAttentionIds: [{ type: Schema.Types.ObjectId, ref: 'Item' }],
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  {
    timestamps: true
  }
);

dashboardConfigSchema.statics.getSingleton = async function getSingleton() {
  const existing = await this.findOne({ key: 'global' });
  if (existing) {
    return existing;
  }
  return this.create({ key: 'global', manualAttentionIds: [] });
};

module.exports = model('DashboardConfig', dashboardConfigSchema);
