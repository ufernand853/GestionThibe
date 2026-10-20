const test = require('node:test');
const assert = require('node:assert/strict');
const stockRouter = require('../src/routes/stock');

function middlewareNames(path) {
  const layer = stockRouter.stack.find(candidate => candidate.route?.path === path);
  assert.ok(layer, `No se encontró la ruta ${path}`);
  return layer.route.stack.map(middleware => middleware.name);
}

test('crear y reenviar solicitudes no exige permiso de modificación directa', () => {
  assert.deepEqual(middlewareNames('/request'), ['permissionMiddleware', 'wrapped']);
  assert.deepEqual(middlewareNames('/request/:id/resubmit'), ['permissionMiddleware', 'wrapped']);
});

test('aprobar solicitudes continúa exigiendo permiso para modificar cantidades', () => {
  assert.deepEqual(middlewareNames('/approve/:id'), [
    'permissionMiddleware',
    'requireQuantityModification',
    'wrapped'
  ]);
});
