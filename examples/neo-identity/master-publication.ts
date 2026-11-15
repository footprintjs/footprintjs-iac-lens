import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IdentityTarget } from 'footprintjs-iac/integration/identity';
import type { MasterState, SystemRevision } from 'footprintjs-iac/master';
import { writeMasterJson } from './master-files.ts';

/** The applied pointer is the authority: a staged or failed release cannot publish canonical bindings. */
export async function publishNeoMasterTarget(options: {
  current: IdentityTarget; candidate: IdentityTarget; revision: SystemRevision; state: MasterState;
  canonicalBytes: string; directory: string;
}): Promise<void> {
  const { current, candidate, revision, state, directory } = options;
  const attempt = state.attempts.at(-1);
  if (state.appliedDigest !== revision.digest || attempt?.status !== 'applied' || attempt.revisionDigest !== revision.digest) {
    throw Error('Only a proven applied master revision can publish Neo bindings');
  }
  const path = join(current.directory, 'target.json'), before = await readFile(path, 'utf8');
  if (before !== options.canonicalBytes && JSON.stringify(JSON.parse(before)) !== JSON.stringify(candidate)) {
    throw Error('The canonical Neo target changed; retained revision evidence needs inspection');
  }
  await writeMasterJson(join(directory, 'publications', revision.digest + '.json'), {
    revisionDigest: revision.digest, runId: attempt.runId, target: candidate, previousTarget: current,
    status: 'publishing', at: new Date().toISOString(),
  });
  await writeMasterJson(path, candidate);
  const latest = join(current.directory, '../latest.json');
  try {
    if ((JSON.parse(await readFile(latest, 'utf8')) as { id?: string }).id === candidate.id) await writeMasterJson(latest, candidate);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeMasterJson(join(directory, 'publications', revision.digest + '.json'), {
    revisionDigest: revision.digest, runId: attempt.runId, target: candidate, previousTarget: current,
    status: 'published', at: new Date().toISOString(),
  });
}
