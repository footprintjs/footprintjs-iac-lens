import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestError } from './controller.ts';

export function admitRequest(request: IncomingMessage, port: number): void {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(request.headers.host ?? '')) throw new RequestError(403, 'Use this viewer through its local loopback address');
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) throw new RequestError(403, 'Cross-origin requests are refused');
}
export async function readRunRequest(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'Send application/json');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024) throw new RequestError(413, 'Run request is too large');
    chunks.push(Buffer.from(chunk));
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'Run request must be JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.scenario !== 'string') {
    throw new RequestError(400, 'Specify only the named scenario');
  }
  return body.scenario;
}
export function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
