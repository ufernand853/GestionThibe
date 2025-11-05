import { build, mergeConfig } from 'vite';
import baseConfig from '../vite.config.js';
import { ensureOutDir } from './out-dir.mjs';

async function run() {
  try {
    const { dirName, isFallback } = ensureOutDir();
    const finalConfig = mergeConfig(baseConfig, {
      build: {
        ...(baseConfig.build ?? {}),
        outDir: dirName
      }
    });

    if (isFallback) {
      console.warn(
        `[build] La carpeta "dist" no tiene permisos de escritura. Se utilizará la alternativa "${dirName}".`
      );
    } else {
      console.log(`[build] Carpeta de salida: ${dirName}`);
    }

    await build(finalConfig);
  } catch (error) {
    console.error('[build] Error al compilar el frontend:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

run();
