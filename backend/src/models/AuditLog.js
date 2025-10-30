const { Schema, model, Types } = require('mongoose');

const auditLogSchema = new Schema(
  {
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    actor: { type: Types.ObjectId, ref: 'User', default: null },
    metadata: { type: Map, of: String, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
  },
  {
    versionKey: false
  }
);

auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });

module.exports = model('AuditLog', auditLogSchema);
