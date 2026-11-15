import type { IncomingMessage } from 'node:http';
import { readDeliveryAction, type DeliveryAction } from '../core/delivery.ts';
import { RequestError } from './controller.ts';
export async function readDeliveryRequest(request: IncomingMessage): Promise<DeliveryAction> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415,'Send application/json');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024) throw new RequestError(413,'Delivery request is too large'); chunks.push(Buffer.from(chunk)); }
  try { return readDeliveryAction(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new RequestError(400,'Choose only the configured delivery ID'); }
}
