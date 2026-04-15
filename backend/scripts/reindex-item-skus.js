const mongoose = require('mongoose');
const { connectDatabase } = require('../src/db');
const Counter = require('../src/models/Counter');
const Item = require('../src/models/Item');
const { formatSku } = require('../src/services/skuService');

async function main() {
  try {
    await connectDatabase();

    const items = await Item.find({})
      .sort({ createdAt: 1, _id: 1 })
      .select({ _id: 1 })
      .lean();

    if (items.length === 0) {
      await Counter.findOneAndUpdate(
        { key: 'item_sku' },
        { $set: { value: 0 } },
        { upsert: true, setDefaultsOnInsert: true }
      );
      console.log('No hay artículos. Contador SKU reiniciado en 0.');
      return;
    }

    const operations = items.map((item, index) => ({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { sku: formatSku(index + 1) } }
      }
    }));

    await Item.collection.bulkWrite(operations, { ordered: true });
    await Counter.findOneAndUpdate(
      { key: 'item_sku' },
      { $set: { value: items.length } },
      { upsert: true, setDefaultsOnInsert: true }
    );

    console.log(`Reindexación SKU completada. Total de artículos: ${items.length}.`);
    console.log(`Rango asignado: 000001 a ${formatSku(items.length)}.`);
  } catch (error) {
    console.error('No se pudo reindexar SKU de artículos.', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

main();
