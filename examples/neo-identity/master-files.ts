import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Private local state is replaced as one JSON document; readers never see half a write. */
export async function writeMasterJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function readMasterJson(path: string): Promise<unknown> {
  const bytes = await readFile(path, 'utf8');
  if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) throw Error('The selected local evidence is too large');
  return JSON.parse(bytes) as unknown;
}
