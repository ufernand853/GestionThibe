const test = require('node:test');
const assert = require('node:assert/strict');
const { requireQuantityModification } = require('../src/middlewares/auth');

function run(user) {
  let continued = false;
  requireQuantityModification({ user }, {}, () => { continued = true; });
  return continued;
}

test('bloquea la modificación de cantidades cuando el administrador la deshabilitó', () => {
  assert.throws(
    () => run({ canModifyQuantities: false }),
    /no tiene permiso para modificar cantidades de stock/
  );
});

test('mantiene habilitados los usuarios existentes y exige autenticación', () => {
  assert.equal(run({}), true);
  assert.equal(run({ canModifyQuantities: true }), true);
  assert.throws(() => run(null), /No autorizado/);
});
