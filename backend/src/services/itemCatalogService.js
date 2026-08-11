function buildPositiveStockFilters(locationIds, stockFields) {
  return locationIds.flatMap(locationId =>
    stockFields.map(stockField => ({ [`stock.${locationId}.${stockField}`]: { $gt: 0 } }))
  );
}

function buildNonLocalCatalogStockCondition({ nonLocalLocationIds, allWarehouseLocationIds }) {
  const positiveNonLocalStock = buildPositiveStockFilters(
    nonLocalLocationIds,
    ['boxes', 'units']
  );
  const positiveWarehouseStock = buildPositiveStockFilters(
    allWarehouseLocationIds,
    ['boxes', 'units']
  );

  // Un artículo agotado no tiene stock positivo que permita asociarlo a un
  // depósito. Debe seguir visible en el catálogo general para poder reponerlo.
  // Los artículos que sólo tienen existencias en locales permanecen fuera.
  return {
    $or: [
      ...positiveNonLocalStock,
      { $nor: positiveWarehouseStock }
    ]
  };
}

module.exports = {
  buildNonLocalCatalogStockCondition,
  buildPositiveStockFilters
};
