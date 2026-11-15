import type { IncomingMessage } from 'node:http';
import { readConnectionProfileAction, type ConnectionProfileAction } from '../core/connection-profiles.ts';
import { RequestError } from './controller.ts';

/** This larger limit belongs only to declared connection form fields, never execution inputs. */
export async function readConnectionProfileRequest(request: IncomingMessage): Promise<ConnectionProfileAction> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'Send application/json');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 32 * 1024) throw new RequestError(413, 'Connection request is too large');
    chunks.push(Buffer.from(chunk));
  }
  try { return readConnectionProfileAction(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new RequestError(400, 'Supply only the declared connection fields or a saved profile ID'); }
}
