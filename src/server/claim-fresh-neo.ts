import { open } from 'node:fs/promises';
import type { Plan } from 'footprintjs-iac';

/** One fresh take per prepared target, including across separate dashboard processes. */
export async function claimFreshNeo(path: string, plan: () => Promise<Plan>): Promise<void> {
  const claim = await open(path, 'wx', 0o600).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('This fresh target already started a deployment. Use its original dashboard to reapply, or prepare another fresh target.');
    }
    throw error;
  });
  try {
    await claim.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    await claim.sync();
  } finally { await claim.close(); }
  // A failed admission keeps the claim: it must never silently turn a later take into a no-op.
  const observed = await plan();
  if (!observed.operations.length || observed.operations.some(operation => operation.action !== 'create' || operation.observed.exists)) {
    throw new Error('Fresh Neo requires every resource to be absent and planned for creation. Prepare another fresh target.');
  }
}
