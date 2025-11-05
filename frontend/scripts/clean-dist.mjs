import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_OUT_DIR, FALLBACK_OUT_DIR, getMetaFilePath, getRootDir, loadOutDir } from './out-dir.mjs';

const rootDir = getRootDir();
const metaPath = getMetaFilePath();
const trackedOutDir = loadOutDir();
const candidates = new Set([DEFAULT_OUT_DIR, FALLBACK_OUT_DIR, trackedOutDir.dirName]);

for (const candidate of candidates) {
  const candidatePath = resolve(rootDir, candidate);
  if (!existsSync(candidatePath)) {
    continue;
  }

  try {
    rmSync(candidatePath, { recursive: true, force: true });
    console.log(`Carpeta limpia: ${candidatePath}`);
  } catch (error) {
    console.warn(`No se pudo eliminar ${candidatePath}: ${error.message}`);
  }
}

if (existsSync(metaPath)) {
  try {
    rmSync(metaPath, { force: true });
    console.log(`Archivo meta eliminado: ${metaPath}`);
  } catch (error) {
    console.warn(`No se pudo eliminar el archivo meta ${metaPath}: ${error.message}`);
  }
}
