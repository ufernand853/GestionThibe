const mongoose = require('mongoose');
const { connectDatabase } = require('../src/db');
const { ensureItemSkus } = require('../src/services/skuService');

async function main() {
  try {
    await connectDatabase();
    await ensureItemSkus();
    console.log('Sincronización de SKU completada.');
  } catch (error) {
    console.error('No se pudo sincronizar SKU de artículos.', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

main();
