const assert = require('node:assert/strict');
const { test } = require('node:test');
const config = require('../src/config');
const { getCatalogAvailability, normalizeCatalogInput, getExistingBoxStock, resolveCatalogPhotoUrl } = require('../src/services/shopifyCatalogService');
const { syncCatalogDraft } = require('../src/services/shopifyCatalogDraftService');

const mediumId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const largeId = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function modelInput() {
  return {
    code: ' fy01 ',
    title: 'Jean recto',
    variants: [
      { itemId: mediumId, color: 'Negro', size: 'M' },
      { itemId: largeId, color: 'negro', size: 'L' }
    ],
    galleries: [{ color: 'NEGRO', images: ['/uploads/items/negro.jpg'] }],
    boxes: [
      { label: 'Caja A', opened: false, quantities: [{ itemId: mediumId, units: 2 }] },
      { label: 'Caja B', opened: true, quantities: [{ itemId: mediumId, units: 1 }] }
    ]
  };
}

test('calcula cada variante con cajas y reservas sin crear combinaciones ni usar stock de locales', () => {
  const model = normalizeCatalogInput(modelInput());
  assert.equal(model.code, 'FY01');
  assert.equal(model.variants[1].color, 'Negro');
  assert.deepEqual(model.galleries, [{ color: 'Negro', images: ['uploads/items/negro.jpg'] }]);
  const order = { itemId: mediumId, units: 3, status: 'reserved' };
  assert.deepEqual([...getCatalogAvailability({ ...model, testOrders: [order] })], [[mediumId, 0], [largeId, 0]]);
  order.status = 'cancelled';
  assert.equal(getCatalogAvailability({ ...model, testOrders: [order] }).get(mediumId), 3);
});

test('rechaza combinaciones, cajas y conteos duplicados', () => {
  const input = modelInput();
  input.variants[1].size = 'm';
  assert.throws(() => normalizeCatalogInput(input), /combinación/);
  input.variants[1].size = 'L';
  input.boxes[1].label = 'caja a';
  assert.throws(() => normalizeCatalogInput(input), /caja .* repetida/i);
  input.boxes[1].label = 'Caja B';
  input.boxes[1].quantities.push({ itemId: mediumId, units: 1 });
  assert.throws(() => normalizeCatalogInput(input), /variantes de la caja/);
});

test('sincroniza un borrador con SKU intactos, cero explícito y fotos compartidas por color', async t => {
  const previousLocation = config.shopify.defaultLocationId;
  const previousBackend = config.shopify.publicBackendUrl;
  config.shopify.defaultLocationId = '1234';
  config.shopify.publicBackendUrl = 'https://example.com';
  t.after(() => {
    config.shopify.defaultLocationId = previousLocation;
    config.shopify.publicBackendUrl = previousBackend;
  });
  const model = { ...normalizeCatalogInput(modelInput()), _id: 'catalogo' };
  const items = new Map([
    [mediumId, { sku: '00042', pDecimal: 12 }],
    [largeId, { sku: '00043', pDecimal: 12 }]
  ]);
  const variants = [{ id: 'v1', sku: '00042' }, { id: 'v2', sku: '00043' }];
  const mediaId = 'gid://shopify/MediaImage/1';
  const productId = 'gid://shopify/Product/1';
  const graphql = t.mock.fn(async (query, vars) => {
    if (query.includes('productByIdentifier')) {
      assert.deepEqual(vars.identifier, { handle: 'gestionthibe-modelo-catalogo' });
      return { productByIdentifier: { id: productId, status: 'DRAFT', variants: { nodes: variants, pageInfo: { hasNextPage: false } } } };
    }
    if (query.includes('FindThibeImage')) return { files: { nodes: [{ id: mediaId, fileStatus: 'READY' }] } };
    if (query.includes('productSet')) {
      assert.deepEqual(vars.identifier, { id: productId });
      assert.equal(vars.input.status, 'DRAFT');
      assert.deepEqual(vars.input.files, [{ id: mediaId }]);
      assert.deepEqual(vars.input.variants.map(variant => ({
        id: variant.id,
        sku: variant.sku,
        quantity: variant.inventoryQuantities[0].quantity,
        photo: variant.file.id,
        policy: variant.inventoryPolicy
      })), [
        { id: 'v1', sku: '00042', quantity: 3, photo: mediaId, policy: 'DENY' },
        { id: 'v2', sku: '00043', quantity: 0, photo: mediaId, policy: 'DENY' }
      ]);
      return { productSet: { product: { id: productId, variants: { nodes: variants } }, userErrors: [] } };
    }
    if (query.includes('nodes(ids:')) {
      return { nodes: variants.map(variant => ({ ...variant, media: { nodes: [{ id: mediaId }] } })) };
    }
    assert.fail('La consulta a Shopify no era esperada');
  });
  assert.equal(await syncCatalogDraft(model, items, graphql), productId);
  assert.equal(graphql.mock.callCount(), 4);

  const active = t.mock.fn(async () => ({ productByIdentifier: { id: productId, status: 'ACTIVE' } }));
  await assert.rejects(syncCatalogDraft(model, items, active), /solo sincroniza borradores/);
  assert.equal(active.mock.callCount(), 1);
});


test('trae las cajas por ubicación con sus unidades por caja e ignora las unidades sueltas', () => {
  const locationId = 'cccccccccccccccccccccccc';
  const item = { unitsPerBox: 12, stock: { [locationId]: { boxes: 3, units: 4 }, [mediumId]: 10 } };
  assert.deepEqual(getExistingBoxStock(item, new Map([[locationId, 'Depósito']])), [
    { locationId, locationName: 'Depósito', boxes: 3, unitsPerBox: 12 }
  ]);
  item.unitsPerBox = null;
  assert.equal(getExistingBoxStock(item)[0].unitsPerBox, null);
});

test('identifica las cajas importadas aunque su saldo llegue a cero y rechaza importar dos veces el mismo origen', () => {
  const input = modelInput();
  const box = {
    label: '00042 · Depósito',
    sourceKey: mediumId + ':cccccccccccccccccccccccc',
    sourceBoxes: 3,
    quantities: [{ itemId: mediumId, units: 0 }]
  };
  input.boxes = [box];
  assert.deepEqual(normalizeCatalogInput(input).boxes, [{ ...box, opened: false, quantities: [] }]);
  input.boxes.push({ ...box, label: 'Mismo stock de origen' });
  assert.throws(() => normalizeCatalogInput(input), /cajas importadas/);
});

test('permite guardar una foto local y requiere el dominio público al enviarla a Shopify', () => {
  const input = modelInput();
  input.galleries[0].images = ['uploads/shopify-catalog/abc123.webp'];
  const [photo] = normalizeCatalogInput(input).galleries[0].images;
  assert.throws(() => resolveCatalogPhotoUrl(photo, ''), /URL pública/);
  assert.equal(resolveCatalogPhotoUrl(photo, 'https://example.com'), 'https://example.com/' + photo);
});
