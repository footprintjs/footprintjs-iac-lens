import type { IncomingMessage } from 'node:http';
import { readApplicationAction, type ApplicationAction } from '../core/application.ts';
import { RequestError } from './controller.ts';

/** Public execution input selects registered IDs only. Connection values use the separate bounded profile endpoint. */
export async function readApplicationRequest(request: IncomingMessage): Promise<ApplicationAction> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'Send application/json');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 2048) throw new RequestError(413, 'Application request is too large');
    chunks.push(Buffer.from(chunk));
  }
  try { return readApplicationAction(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new RequestError(400, 'Choose registered application IDs and the current review'); }
}
