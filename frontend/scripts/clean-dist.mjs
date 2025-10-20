import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(currentDir, '..', 'dist');

if (!existsSync(distPath)) {
  console.log('No se encontró la carpeta dist, nada para limpiar.');
  process.exit(0);
}

rmSync(distPath, { recursive: true, force: true });
console.log(`Carpeta limpia: ${distPath}`);
