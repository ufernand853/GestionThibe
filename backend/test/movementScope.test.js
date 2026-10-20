const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMovementScopeFilter, canAccessMovementHistory } = require('../src/utils/movementScope');

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

test('reserva el historial y las solicitudes locales para administradores', () => {
  assert.equal(canAccessMovementHistory({ role: 'Administrador' }, { history: 'true' }), true);
  assert.equal(canAccessMovementHistory({ role: 'Administrador' }, { scope: 'local-sales' }), true);
  assert.equal(canAccessMovementHistory({ role: 'Operador' }, { history: 'true' }), false);
  assert.equal(canAccessMovementHistory({ role: 'Supervisor' }, { scope: 'local-sales' }), false);
  assert.equal(canAccessMovementHistory({ role: 'Operador' }, { scope: 'deposits' }), true);
});
