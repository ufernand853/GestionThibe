function buildPositiveStockFilters(locationIds, stockFields) {
  return locationIds.flatMap(locationId =>
    stockFields.map(stockField => ({ [`stock.${locationId}.${stockField}`]: { $gt: 0 } }))
  );
}

module.exports = {
  buildPositiveStockFilters
};
