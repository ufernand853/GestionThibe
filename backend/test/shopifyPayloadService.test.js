const test = require('node:test');
const assert = require('node:assert/strict');
const { sumStock } = require('../src/services/shopifyPayloadService');

test('sumStock totals Shopify inventory from a Mongoose-style map', () => {
  const stock = new Map([
    ['local-1', { boxes: 2, units: 4 }],
    ['deposit-1', { boxes: 3, units: 6 }]
  ]);

  assert.deepEqual(sumStock(stock), { boxes: 5, units: 10 });
});

test('sumStock accepts plain stock objects and ignores invalid quantities', () => {
  const stock = {
    local: { boxes: '2', units: undefined },
    deposit: { boxes: null, units: '7' },
    malformed: null
  };

  assert.deepEqual(sumStock(stock), { boxes: 2, units: 7 });
  assert.deepEqual(sumStock(undefined), { boxes: 0, units: 0 });
});
