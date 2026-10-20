import test from 'node:test';
import assert from 'node:assert/strict';
import { canRequestStockMovement } from '../src/utils/stockPermissions.js';

test('permite solicitar movimientos aunque la edición directa de cantidades esté deshabilitada', () => {
  assert.equal(
    canRequestStockMovement({ permissions: ['stock.request'], canModifyQuantities: false }),
    true
  );
});

test('exige el permiso de solicitud de stock', () => {
  assert.equal(canRequestStockMovement({ permissions: [], canModifyQuantities: true }), false);
  assert.equal(canRequestStockMovement(null), false);
});
