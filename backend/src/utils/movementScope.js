const LOCAL_SALE_REASON = 'Venta desde Local';

function buildMovementScopeFilter(scope) {
  if (scope === 'local-sales') {
    return { $or: [{ source: 'localSale' }, { reason: LOCAL_SALE_REASON }] };
  }
  if (scope === 'deposits') {
    return { $nor: [{ source: 'localSale' }, { reason: LOCAL_SALE_REASON }] };
  }
  return {};
}

function canAccessMovementHistory(user, { history, scope } = {}) {
  const isRestrictedHistory = history === 'true' || scope === 'local-sales';
  return !isRestrictedHistory || user?.role === 'Administrador';
}

module.exports = { buildMovementScopeFilter, canAccessMovementHistory, LOCAL_SALE_REASON };
