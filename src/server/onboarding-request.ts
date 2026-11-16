import type { IncomingMessage } from 'node:http';
import { readOnboardingAction, type OnboardingAction } from '../core/onboarding.ts';
import { RequestError } from './controller.ts';

/** Public actions contain no private configuration, arbitrary target or executable input. */
export async function readOnboardingRequest(request: IncomingMessage): Promise<OnboardingAction> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'Send application/json');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 2048) throw new RequestError(413, 'Onboarding request is too large');
    chunks.push(Buffer.from(chunk));
  }
  try { return readOnboardingAction(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new RequestError(400, 'Choose an onboarding action and the current review'); }
}
