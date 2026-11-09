import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist/web');
await mkdir(output, { recursive: true });
await build({ absWorkingDir: root, entryPoints: { app: 'web/main.tsx' }, outdir: resolve(output, 'assets'), bundle: true,
  format: 'esm', splitting: true, platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true,
  entryNames: '[name]', chunkNames: 'chunk-[hash]', assetNames: 'asset-[hash]', sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
await writeFile(resolve(output, 'index.html'), await readFile(resolve(root, 'web/index.html')));
