import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep, extname } from 'node:path';
import type { ServerResponse } from 'node:http';
import { RequestError } from './controller.ts';

const media: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export async function serveStatic(response: ServerResponse, directory: string, path: string): Promise<void> {
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { throw new RequestError(400, 'Invalid file path'); }
  if (decoded.includes('\0') || decoded.includes('\\')) throw new RequestError(400, 'Invalid file path');
  let root: string, file: string;
  try { root = await realpath(directory); file = await realpath(resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded))); }
  catch { throw new RequestError(404, 'Build the viewer first with npm run build'); }
  const inside = relative(root, file);
  if (inside === '..' || inside.startsWith('..' + sep) || !media[extname(file)] || !(await stat(file)).isFile()) {
    throw new RequestError(404, 'File not found');
  }
  response.writeHead(200, { 'Content-Type': media[extname(file)]!, 'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  response.end(await readFile(file));
}
