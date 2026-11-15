import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
await rm(resolve(root, 'dist/react'), { recursive: true, force: true });
await build({ absWorkingDir: root, entryPoints: { index: 'src/react/index.ts', agents: 'src/react/agents.ts' }, outdir: resolve(root, 'dist/react'),
  bundle: true, format: 'esm', splitting: true, platform: 'browser', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@xyflow/react', 'footprint-explainable-ui', 'footprint-explainable-ui/*'],
  minify: true, sourcemap: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
