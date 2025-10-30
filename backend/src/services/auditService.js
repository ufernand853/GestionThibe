const AuditLog = require('../models/AuditLog');

function sanitizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  return Object.entries(metadata).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }
    if (typeof value === 'object') {
      try {
        acc[key] = JSON.stringify(value);
      } catch (error) {
        acc[key] = '[unserializable]';
      }
    } else {
      acc[key] = String(value);
    }
    return acc;
  }, {});
}

async function recordAuditEvent({
  action,
  entityType,
  entityId = null,
  actorUserId = null,
  metadata = {},
  ip = '',
  userAgent = ''
}) {
  if (!action || !entityType) {
    return;
  }

  const normalizedMetadata = sanitizeMetadata(metadata);

  await AuditLog.create({
    action,
    entityType,
    entityId: entityId ? String(entityId) : null,
    actor: actorUserId || null,
    metadata: normalizedMetadata,
    ip: ip || '',
    userAgent: userAgent || ''
  });
}

module.exports = {
  recordAuditEvent
};
