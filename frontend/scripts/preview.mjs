import { mergeConfig, preview } from 'vite';
import baseConfig from '../vite.config.js';
import { loadOutDir } from './out-dir.mjs';

async function run() {
  try {
    const { dirName } = loadOutDir();
    const finalConfig = mergeConfig(baseConfig, {
      build: {
        ...(baseConfig.build ?? {}),
        outDir: dirName
      }
    });

    const server = await preview(finalConfig);
    server.printUrls();

    const close = async () => {
      await server.close();
      process.exit(0);
    };

    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  } catch (error) {
    console.error('[preview] Error al iniciar el servidor de previsualización:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

run();
