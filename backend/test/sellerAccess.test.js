const test = require('node:test');
const assert = require('node:assert/strict');
const { restrictSellerAccess } = require('../src/middlewares/auth');

function run(path, role) {
  let continued = false;
  restrictSellerAccess({ path, user: role ? { role } : null }, {}, () => { continued = true; });
  return continued;
}

test('el Vendedor solamente puede usar autenticación y Venta desde Local', () => {
  assert.equal(run('/api/auth/refresh', 'Vendedor'), true);
  assert.equal(run('/api/local-sales/items', 'Vendedor'), true);
  assert.throws(() => run('/api/items', 'Vendedor'), /solo puede acceder a Venta desde Local/);
});

test('los demás perfiles conservan el acceso definido por sus permisos', () => {
  assert.equal(run('/api/items', 'Administrador'), true);
  assert.equal(run('/api/items', null), true);
});
