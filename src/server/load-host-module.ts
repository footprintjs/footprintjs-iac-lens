import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Operator-supplied executable module; this helper is never reachable from a browser request. */
export async function loadTrustedHostModule(modulePath: string, directory: string): Promise<Record<string, unknown>> {
  if (typeof modulePath !== 'string' || !modulePath.trim() || /[\x00-\x1f\x7f]/.test(modulePath)
    || /^[a-z][a-z0-9+.-]*:/i.test(modulePath) || !isAbsolute(directory)) throw Error('Invalid host registration');
  const path = await realpath(resolve(modulePath));
  if (!['.mjs', '.js', '.ts'].includes(extname(path)) || !(await stat(path)).isFile()) throw Error('Invalid host module');
  return import(pathToFileURL(path).href) as Promise<Record<string, unknown>>;
}
