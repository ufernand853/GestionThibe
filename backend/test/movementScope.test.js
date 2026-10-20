const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMovementScopeFilter } = require('../src/utils/movementScope');

test('separa las ventas locales de las solicitudes de depósitos', () => {
  assert.deepEqual(buildMovementScopeFilter('local-sales'), {
    $or: [{ source: 'localSale' }, { reason: 'Venta desde Local' }]
  });
  assert.deepEqual(buildMovementScopeFilter('deposits'), {
    $nor: [{ source: 'localSale' }, { reason: 'Venta desde Local' }]
  });
});

test('no altera las consultas generales existentes', () => {
  assert.deepEqual(buildMovementScopeFilter(), {});
});
