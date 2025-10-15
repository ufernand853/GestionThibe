#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Types;

const args = process.argv.slice(2);

const optionValue = (flag) => {
  const index = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) {
    return null;
  }

  const current = args[index];
  if (current.includes('=')) {
    return current.split('=').slice(1).join('=');
  }

  const next = args[index + 1];
  if (!next || next.startsWith('--')) {
    return null;
  }

  return next;
};

const hasFlag = (flag) => args.some((arg) => arg === flag);

const printHelp = () => {
  console.log(`Importa el dataset de ejemplo en una instancia de MongoDB.

Uso:
  node scripts/import-sample-dataset.js [opciones]

Opciones:
  --uri <cadena>        Cadena de conexión a MongoDB (con o sin base de datos). Por defecto mongodb://localhost:27017
  --db <nombre>         Nombre de la base de datos destino. Por defecto gestionthibe
  --file <ruta>         Ruta al archivo JSON a importar. Por defecto backend/docs/sample-dataset.json
  --drop-existing       Elimina el contenido previo de cada colección antes de insertar los datos
  --help                Muestra este mensaje y termina

Ejemplo:
  npm run seed:sample -- --uri mongodb://localhost:27017 --db gestionthibe --drop-existing
`);
};

if (hasFlag('--help')) {
  printHelp();
  process.exit(0);
}

const defaultDatasetPath = path.join(__dirname, '..', 'docs', 'sample-dataset.json');
const datasetPathOption = optionValue('--file');
const datasetPath = datasetPathOption
  ? path.isAbsolute(datasetPathOption)
    ? datasetPathOption
    : path.resolve(process.cwd(), datasetPathOption)
  : defaultDatasetPath;

if (!fs.existsSync(datasetPath)) {
  console.error(`No se encontró el archivo de datos en: ${datasetPath}`);
  process.exit(1);
}

const uri = optionValue('--uri') || 'mongodb://localhost:27017';
const dbName = optionValue('--db') || 'gestionthibe';
const dropExisting = hasFlag('--drop-existing');

const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const datasetRaw = fs.readFileSync(datasetPath, 'utf8');
const dataset = JSON.parse(datasetRaw, (key, value) => {
  if (typeof value === 'string' && iso8601Pattern.test(value)) {
    return new Date(value);
  }
  return value;
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idMaps = {};

const resolveObjectId = (datasetKey, raw) => {
  if (raw == null) {
    return raw;
  }

  if (raw instanceof ObjectId) {
    return raw;
  }

  if (typeof raw === 'object' && raw.$oid && typeof raw.$oid === 'string') {
    return new ObjectId(raw.$oid);
  }

  if (typeof raw === 'string') {
    if (ObjectId.isValid(raw) && raw.length === 24) {
      return new ObjectId(raw);
    }

    if (uuidPattern.test(raw)) {
      if (!idMaps[datasetKey]) {
        idMaps[datasetKey] = new Map();
      }
      const map = idMaps[datasetKey];
      if (!map.has(raw)) {
        map.set(raw, new ObjectId());
      }
      return map.get(raw);
    }
  }

  return raw;
};

const converters = {
  groups: (doc) => ({
    ...doc,
    _id: resolveObjectId('groups', doc._id),
    parent: resolveObjectId('groups', doc.parent)
  }),
  roles: (doc) => ({
    ...doc,
    _id: resolveObjectId('roles', doc._id)
  }),
  users: (doc) => ({
    ...doc,
    _id: resolveObjectId('users', doc._id),
    role: resolveObjectId('roles', doc.role)
  }),
  items: (doc) => ({
    ...doc,
    _id: resolveObjectId('items', doc._id),
    group: resolveObjectId('groups', doc.group)
  }),
  destinations: (doc) => ({
    ...doc,
    _id: resolveObjectId('destinations', doc._id)
  }),
  deposits: (doc) => ({
    ...doc,
    _id: resolveObjectId('deposits', doc._id)
  }),
  movementRequests: (doc) => {
    const fromDeposit = doc.fromDeposit ? resolveObjectId('deposits', doc.fromDeposit) : null;
    const toDeposit = doc.toDeposit ? resolveObjectId('deposits', doc.toDeposit) : null;
    if (!fromDeposit || !toDeposit) {
      return null;
    }
    return {
      ...doc,
      _id: resolveObjectId('movementRequests', doc._id),
      item: resolveObjectId('items', doc.item),
      requestedBy: resolveObjectId('users', doc.requestedBy),
      approvedBy: resolveObjectId('users', doc.approvedBy),
      fromDeposit,
      toDeposit
    };
  },
  movementLogs: (doc) => ({
    ...doc,
    _id: resolveObjectId('movementLogs', doc._id),
    movementRequest: resolveObjectId('movementRequests', doc.movementRequest),
    actor: resolveObjectId('users', doc.actor)
  })
};

const collectionMap = {
  groups: 'groups',
  roles: 'roles',
  users: 'users',
  items: 'items',
  destinations: 'destinations',
  deposits: 'deposits',
  movementRequests: 'movementrequests',
  movementLogs: 'movementlogs'
};

const run = async () => {
  console.log(`Importando datos desde ${datasetPath}`);
  console.log(`Conectando a ${uri} (base de datos: ${dbName})...`);

  try {
    await mongoose.connect(uri, { dbName });
    const db = mongoose.connection.db;

    const summary = [];

    for (const [datasetKey, collectionName] of Object.entries(collectionMap)) {
      const documents = dataset[datasetKey];
      if (!Array.isArray(documents) || documents.length === 0) {
        continue;
      }

      const collection = db.collection(collectionName);
      let deletedCount = 0;

      if (dropExisting) {
        const deleteResult = await collection.deleteMany({});
        deletedCount = deleteResult.deletedCount || 0;
      }

      const transformer = converters[datasetKey];
      const documentsToInsert = transformer
        ? documents.map((doc) => transformer(doc)).filter(Boolean)
        : documents;

      if (documentsToInsert.length === 0) {
        continue;
      }

      try {
        const insertResult = await collection.insertMany(documentsToInsert, { ordered: true });
        const insertedCount = insertResult.insertedCount ?? documentsToInsert.length;
        summary.push({ datasetKey, collectionName, insertedCount, deletedCount });
      } catch (error) {
        if (error.code === 11000) {
          console.error(`\n[${collectionName}] Se detectaron claves duplicadas. Ejecutá el script con --drop-existing para reemplazar los datos.`);
        }
        throw error;
      }
    }

    if (summary.length === 0) {
      console.warn('No se encontraron colecciones para importar en el archivo proporcionado.');
    } else {
      console.log('\nResumen de importación:');
      summary.forEach(({ datasetKey, collectionName, insertedCount, deletedCount }) => {
        console.log(` - ${datasetKey} -> ${collectionName}: ${insertedCount} insertados${dropExisting ? `, ${deletedCount} eliminados previamente` : ''}`);
      });
    }

    console.log('\nImportación finalizada.');
  } catch (error) {
    console.error('\nLa importación falló:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

run();
