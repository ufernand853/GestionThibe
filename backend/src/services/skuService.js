const Counter = require('../models/Counter');
const Item = require('../models/Item');

const SKU_LENGTH = 6;

function formatSku(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error('SKU inválido');
  }
  return String(normalized).padStart(SKU_LENGTH, '0');
}

async function reserveNextSkuValue({ session } = {}) {
  const counter = await Counter.findOneAndUpdate(
    { key: 'item_sku' },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return counter.value;
}

async function assignSkuToNewItemData(itemData, { session } = {}) {
  if (itemData.sku) {
    return itemData;
  }
  const nextValue = await reserveNextSkuValue({ session });
  return { ...itemData, sku: formatSku(nextValue) };
}

async function syncSkuCounterWithExistingItems() {
  const [maxSkuEntry] = await Item.aggregate([
    { $match: { sku: { $type: 'string', $regex: /^\d{6}$/ } } },
    { $addFields: { skuNumber: { $toInt: '$sku' } } },
    { $sort: { skuNumber: -1 } },
    { $limit: 1 },
    { $project: { skuNumber: 1 } }
  ]);

  const maxSku = Number(maxSkuEntry?.skuNumber) || 0;

  await Counter.findOneAndUpdate(
    { key: 'item_sku' },
    { $max: { value: maxSku } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function backfillMissingSkus() {
  const missingItems = await Item.find({
    $or: [{ sku: { $exists: false } }, { sku: null }, { sku: '' }]
  })
    .sort({ createdAt: 1, _id: 1 })
    .select({ _id: 1 });

  for (const item of missingItems) {
    const nextValue = await reserveNextSkuValue();
    await Item.updateOne(
      {
        _id: item._id,
        $or: [{ sku: { $exists: false } }, { sku: null }, { sku: '' }]
      },
      { $set: { sku: formatSku(nextValue) } }
    );
  }
}

async function ensureItemSkus() {
  await syncSkuCounterWithExistingItems();
  await backfillMissingSkus();
}

module.exports = {
  ensureItemSkus,
  assignSkuToNewItemData,
  formatSku
};
