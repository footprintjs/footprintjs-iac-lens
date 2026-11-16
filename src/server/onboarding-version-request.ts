import type { IncomingMessage } from 'node:http';
import { readOnboardingVersionAction, type OnboardingVersionAction } from '../core/onboarding-versions.ts';
import { RequestError } from './controller.ts';

export async function readOnboardingVersionRequest(request: IncomingMessage): Promise<OnboardingVersionAction> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'Send application/json');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 2048) throw new RequestError(413, 'Configuration request is too large'); chunks.push(Buffer.from(chunk)); }
  try { return readOnboardingVersionAction(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new RequestError(400, 'Choose a registered setup version and the exact reviewed change'); }
}
