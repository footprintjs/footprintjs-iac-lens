import type { IncomingMessage } from 'node:http';
import { readHostActionInput, type HostActionInput } from '../core/host-actions.ts';
import { RequestError } from './controller.ts';
export async function readHostActionRequest(request: IncomingMessage): Promise<HostActionInput> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'Send application/json');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024) throw new RequestError(413, 'Configured action request is too large'); chunks.push(Buffer.from(chunk)); }
  try { return readHostActionInput(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new RequestError(400, 'Choose only a configured action ID'); }
}
