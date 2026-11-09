const test = require('node:test');
const assert = require('node:assert/strict');
const { syncProductImages } = require('../src/services/shopifyMediaService');

test('adds a new photo to an existing gallery and reuses it on later sends', async () => {
  const productId = 'gid://shopify/Product/1';
  const file = { id: 'gid://shopify/MediaImage/2', fileStatus: 'READY' };
  const existing = [{ id: 'gid://shopify/MediaImage/1', image: { url: 'https://example.com/existing.jpg' } }];
  let created;
  const graphql = async (query, variables) => {
    if (query.includes('query ThibeProductImages')) {
      return { product: { media: { nodes: existing, pageInfo: { hasNextPage: false } } } };
    }
    if (query.includes('query FindThibeImage')) {
      if (created) assert.equal(variables.query, `filename:"${created.filename}"`);
      return { files: { nodes: created ? [file] : [] } };
    }
    if (query.includes('mutation CreateThibeImage')) {
      assert.equal(created, undefined);
      [created] = variables.files;
      assert.equal(created.duplicateResolutionMode, 'RAISE_ERROR');
      return { fileCreate: { files: [file] } };
    }
    if (query.includes('mutation AttachThibeImage')) {
      assert.deepEqual(variables.files, [{ id: file.id, referencesToAdd: [productId] }]);
      existing.push(file);
      return { fileUpdate: { files: [file] } };
    }
    assert.fail(query);
  };
  const media = [
    { originalSource: 'https://example.com/existing.jpg' },
    { originalSource: 'https://example.com/new.jpg', alt: 'Foto del artículo' }
  ];
  assert.deepEqual(await syncProductImages(graphql, productId, media), { attached: 1, pending: 0, errors: [] });
  assert.deepEqual(await syncProductImages(graphql, productId, media), { attached: 0, pending: 0, errors: [] });
  assert.equal(existing.length, 2);
});
