const mongoose = require('mongoose');
const { connectDatabase } = require('../src/db');
const Counter = require('../src/models/Counter');
const Item = require('../src/models/Item');

async function main() {
  try {
    await connectDatabase();

    const counter = await Counter.findOne({ key: 'item_sku' }).lean();
    const [maxSkuEntry] = await Item.aggregate([
      { $match: { sku: { $type: 'string', $regex: /^\d{6}$/ } } },
      { $addFields: { skuNumber: { $toInt: '$sku' } } },
      { $sort: { skuNumber: -1 } },
      { $limit: 1 },
      { $project: { sku: 1, skuNumber: 1 } }
    ]);
    const missingSkuCount = await Item.countDocuments({
      $or: [{ sku: { $exists: false } }, { sku: null }, { sku: '' }]
    });

    console.log('Estado SKU');
    console.log('----------');
    console.log(`Counter item_sku: ${counter?.value ?? 0}`);
    console.log(`Máximo SKU en items: ${maxSkuEntry?.sku || 'N/A'} (${maxSkuEntry?.skuNumber || 0})`);
    console.log(`Items sin SKU: ${missingSkuCount}`);
  } catch (error) {
    console.error('No se pudo obtener el estado de SKU.', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

main();
