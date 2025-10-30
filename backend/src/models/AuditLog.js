const { Schema, model } = require('mongoose');

const auditLogSchema = new Schema(
  {
    action: { type: String, required: true, trim: true },
    request: { type: String, required: true, trim: true },
    user: { type: String, required: true, trim: true },
    timestamp: { type: Date, default: Date.now }
  },
  {
    versionKey: false
  }
);

auditLogSchema.index({ timestamp: -1 });

module.exports = model('AuditLog', auditLogSchema);
