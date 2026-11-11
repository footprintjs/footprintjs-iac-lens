import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createIdentityGraph, type IdentityTarget } from 'footprint-iac/integration/identity';
import { defineSystemRevision, type MasterTarget, type SystemRevision } from 'footprint-iac/master';

interface SourceReceipt { baseCommit: string; sourceTree: string; imageId: string; image: string;
  pythonImageId: string; pythonImage: string; canonicalTargetSha256: string }
export interface NeoMasterCandidate { target: IdentityTarget; receipt: SourceReceipt; path: string }
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const stable = (value: unknown): string => JSON.stringify(value, (_, field: unknown) => field && typeof field === 'object' && !Array.isArray(field)
  ? Object.fromEntries(Object.entries(field).sort(([left], [right]) => left.localeCompare(right))) : field);
export const sameNeoMasterTarget = (left: unknown, right: unknown): boolean => stable(left) === stable(right);

/** The binding excludes release images, while retaining every prepared ownership and endpoint field. */
export function neoMasterBinding(target: IdentityTarget): MasterTarget {
  const { images, sourceCommit: _commit, sourceDirectory: _source, ...binding } = target;
  return { id: target.id, scope: digest(stable({ ...binding,
    images: { ldapImage: images.ldapImage, providerImage: images.providerImage } })) };
}

/** A staged release may change application images and source metadata only, never its owned target. */
export async function readNeoMasterCandidate(path: string, current: IdentityTarget): Promise<NeoMasterCandidate> {
  path = resolve(path);
  const directory = dirname(path), tree = directory.split('/').at(-1)!;
  if (!/^[a-f0-9]{40}$/.test(tree) || directory !== join(current.directory, 'candidates', tree)
    || path !== join(directory, 'target.json')) throw Error('Select a staged candidate in this prepared Neo target');
  for (const location of [join(current.directory, 'candidates'), directory, path, join(directory, 'source-review.json')]) {
    if (await realpath(location) !== location || (await lstat(location)).isSymbolicLink()) throw Error('Staged release files cannot be symbolic links');
  }
  const candidate = JSON.parse(await readFile(path, 'utf8')) as IdentityTarget;
  const receipt = JSON.parse(await readFile(join(directory, 'source-review.json'), 'utf8')) as SourceReceipt;
  if (!candidate || typeof candidate !== 'object' || !candidate.images || typeof candidate.images !== 'object'
    || Object.keys(candidate).some(key => !Object.hasOwn(current, key) && !['sourceCommit', 'sourceDirectory'].includes(key))
    || Object.keys(candidate.images).sort().join(',') !== 'ldapImage,nodeImage,providerImage,pythonImage'
    || Object.entries(current).some(([key, value]) => !['images', 'sourceCommit', 'sourceDirectory'].includes(key)
      && stable((candidate as unknown as Record<string, unknown>)[key]) !== stable(value))
    || candidate.images.ldapImage !== current.images.ldapImage || candidate.images.providerImage !== current.images.providerImage
    || (candidate.sourceDirectory !== undefined && (typeof candidate.sourceDirectory !== 'string' || !candidate.sourceDirectory.startsWith('/')
      || /[\x00-\x1f\x7f]/.test(candidate.sourceDirectory)))
    || !/^[a-f0-9]{40}$/.test(candidate.sourceCommit ?? '') || !receipt || receipt.sourceTree !== tree
    || receipt.baseCommit !== candidate.sourceCommit || !/^[a-f0-9]{64}$/.test(receipt.canonicalTargetSha256)
    || !/^sha256:[a-f0-9]{64}$/.test(receipt.imageId) || !/^sha256:[a-f0-9]{64}$/.test(receipt.pythonImageId)
    || receipt.image !== candidate.images.nodeImage || receipt.pythonImage !== candidate.images.pythonImage
    || receipt.image !== 'footprint-iac/neo-node:identity-' + receipt.imageId.slice(7)
    || receipt.pythonImage !== 'footprint-iac/neo-python:identity-' + receipt.pythonImageId.slice(7)) {
    throw Error('Staged Neo release does not match its source receipt and existing ownership');
  }
  const canonical = await readFile(join(current.directory, 'target.json'), 'utf8');
  if (digest(canonical) !== receipt.canonicalTargetSha256 && stable(candidate) !== stable(current)) {
    throw Error('The applied target changed after the release was staged; build and review a new candidate');
  }
  return { target: candidate, receipt, path };
}

function artifacts(target: IdentityTarget) {
  return (['node', 'python'] as const).map(role => {
    const reference = target.images[role === 'node' ? 'nodeImage' : 'pythonImage'];
    const match = reference.match(/(?:sha256:|(?:review|identity)-)([a-f0-9]{64})$/);
    if (!match) throw Error('Neo releases require content-addressed application images');
    return { id: role, reference, digest: match[1]! };
  });
}
export function neoBaselineRevision(target: IdentityTarget, graph = createIdentityGraph(target, { includeNeo: true })): SystemRevision {
  return defineSystemRevision({ revisionId: 'neo-initial-' + graph.digest.slice(0, 12), parentDigest: null,
    target: neoMasterBinding(target), graph, artifacts: artifacts(target),
    ...(target.sourceCommit ? { source: { commit: target.sourceCommit } } : {}) });
}
export function neoCandidateRevision(candidate: NeoMasterCandidate, parentDigest: string): SystemRevision {
  return defineSystemRevision({ revisionId: 'neo-' + candidate.receipt.sourceTree.slice(0, 12), parentDigest,
    target: neoMasterBinding(candidate.target), graph: createIdentityGraph(candidate.target, { includeNeo: true }),
    source: { commit: candidate.receipt.baseCommit, tree: candidate.receipt.sourceTree }, artifacts: artifacts(candidate.target) });
}
