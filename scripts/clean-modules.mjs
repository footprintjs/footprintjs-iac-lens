import { lstat, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
try {
  const directory = await lstat(dist);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error('Refusing to clean modules through a non-directory or linked dist path');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
// The target is fixed: never accept a command-line path or remove sibling assets.
await rm(resolve(dist, 'modules'), { recursive: true, force: true });
