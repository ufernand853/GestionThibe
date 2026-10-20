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

module.exports = { buildMovementScopeFilter, LOCAL_SALE_REASON };
