const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPositiveStockFilters } = require('../src/services/itemCatalogService');

test('crea filtros positivos para los campos de stock indicados', () => {
  assert.deepEqual(buildPositiveStockFilters(['deposito'], ['boxes', 'units']), [
    { 'stock.deposito.boxes': { $gt: 0 } },
    { 'stock.deposito.units': { $gt: 0 } }
  ]);
});
