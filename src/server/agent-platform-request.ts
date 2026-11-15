import type { IncomingMessage } from 'node:http';
import { readAgentPlatformAction } from '../core/agent-platform-read.ts';
import type { AgentPlatformAction } from '../core/agent-platform.ts';
import { RequestError } from './controller.ts';

export async function readAgentPlatformRequest(request: IncomingMessage): Promise<AgentPlatformAction> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'Send application/json');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 1024) throw new RequestError(413, 'Agent request is too large'); chunks.push(Buffer.from(chunk)); }
  try { return readAgentPlatformAction(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new RequestError(400, 'Choose a registered agent action'); }
}
