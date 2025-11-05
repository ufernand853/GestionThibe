import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_OUT_DIR = 'dist';
export const FALLBACK_OUT_DIR = 'build';
const META_FILE_NAME = '.frontend-build-meta.json';

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(currentDir, '..');
const metaFilePath = resolve(rootDir, META_FILE_NAME);

function ensureDirectoryWritable(dirPath) {
  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true, mode: 0o775 });
    }

    accessSync(dirPath, constants.W_OK | constants.X_OK);

    const probeFile = resolve(dirPath, '.permission-check');
    writeFileSync(probeFile, '');
    rmSync(probeFile, { force: true });

    return true;
  } catch (error) {
    return false;
  }
}

export function ensureOutDir() {
  const defaultPath = resolve(rootDir, DEFAULT_OUT_DIR);
  if (ensureDirectoryWritable(defaultPath)) {
    storeMeta(DEFAULT_OUT_DIR);
    return { dirName: DEFAULT_OUT_DIR, path: defaultPath, isFallback: false };
  }

  const fallbackPath = resolve(rootDir, FALLBACK_OUT_DIR);
  if (ensureDirectoryWritable(fallbackPath)) {
    storeMeta(FALLBACK_OUT_DIR);
    return { dirName: FALLBACK_OUT_DIR, path: fallbackPath, isFallback: true };
  }

  throw new Error(
    `No se pudo preparar una carpeta de salida con permisos de escritura. Intentado: ${DEFAULT_OUT_DIR}, ${FALLBACK_OUT_DIR}.`
  );
}

function storeMeta(dirName) {
  const payload = { outDir: dirName, savedAt: new Date().toISOString() };
  writeFileSync(metaFilePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function loadOutDir() {
  try {
    if (!existsSync(metaFilePath)) {
      const defaultPath = resolve(rootDir, DEFAULT_OUT_DIR);
      return { dirName: DEFAULT_OUT_DIR, path: defaultPath, isFallback: false };
    }

    const raw = readFileSync(metaFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    const dirName = typeof parsed.outDir === 'string' ? parsed.outDir : DEFAULT_OUT_DIR;
    const targetPath = resolve(rootDir, dirName);
    const isFallback = dirName !== DEFAULT_OUT_DIR;

    return { dirName, path: targetPath, isFallback };
  } catch (error) {
    const defaultPath = resolve(rootDir, DEFAULT_OUT_DIR);
    return { dirName: DEFAULT_OUT_DIR, path: defaultPath, isFallback: false };
  }
}

export function getMetaFilePath() {
  return metaFilePath;
}

export function getRootDir() {
  return rootDir;
}
