const AuditLog = require('../models/AuditLog');

function normalizeText(value, { fallback = '' } = {}) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
}

function normalizeDetails(value) {
  if (value === undefined || value === null || typeof value !== 'object') {
    return {};
  }
  return value;
}

async function recordAuditEvent({ action, request, user, details }) {
  const actionValue = normalizeText(action);
  const requestValue = normalizeText(request);
  const userValue = normalizeText(user, { fallback: 'Desconocido' });

  if (!actionValue || !requestValue || !userValue) {
    return;
  }

  await AuditLog.create({
    action: actionValue,
    request: requestValue,
    user: userValue,
    details: normalizeDetails(details)
  });
}

module.exports = {
  recordAuditEvent
};
