import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const itemsPagePath = resolve('src/pages/items/ItemsPage.jsx');
const source = await readFile(itemsPagePath, 'utf8');
const locationFilterLabels = source.match(/<label htmlFor="filterLocation">/g) ?? [];

if (locationFilterLabels.length !== 1) {
  console.error(
    `[check-items-location-filter] Se esperaba un único filtro de ubicación, pero se encontraron ${locationFilterLabels.length}.`
  );
  process.exit(1);
}

if (source.includes('Ubicación de stock')) {
  console.error('[check-items-location-filter] Todavía existe el filtro duplicado "Ubicación de stock".');
  process.exit(1);
}

console.log('[check-items-location-filter] OK: existe un único filtro "Ubicación".');
