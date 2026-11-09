import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function projectRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    try { if (JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')).name === 'footprint-iac-lens') return directory; }
    catch { /* Continue through source and compiled module directories. */ }
    directory = dirname(directory);
  }
  throw new Error('Cannot locate the IaC Lens package root');
}
