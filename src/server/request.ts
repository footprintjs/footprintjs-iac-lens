import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestError } from './controller.ts';

export function admitRequest(request: IncomingMessage, port: number): void {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(request.headers.host ?? '')) throw new RequestError(403, 'Use this viewer through its local loopback address');
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) throw new RequestError(403, 'Cross-origin requests are refused');
}
export async function readRunRequest(request: IncomingMessage): Promise<{ scenario: string; reviewId?: string }> {
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
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.scenario !== 'string'
    || Object.keys(body).some(key => key !== 'scenario' && key !== 'reviewId')) {
    throw new RequestError(400, 'Specify only the named scenario');
  }
  if (body.scenario === 'revision-apply') {
    if (typeof body.reviewId !== 'string' || !/^[a-f0-9]{64}$/.test(body.reviewId)) throw new RequestError(400, 'Specify the exact completed revision review');
  } else if (body.reviewId !== undefined) throw new RequestError(400, 'A review ID belongs only to revision-apply');
  return { scenario: body.scenario, ...(body.reviewId !== undefined ? { reviewId: body.reviewId } : {}) };
}
export function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
