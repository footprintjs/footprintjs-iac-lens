import { applicationId, applicationText, readApplicationSelection, type ApplicationSelection } from './application.ts';

export interface ApplicationSourceView {
  version: 1; id: string; label: string; providerId: string;
  binding: ApplicationSelection;
  definitionDigest: string; recipeDigest: string; configurationDigest: string;
  /** Identity of exact source, packages and native preparation; distinct from configured mutable refs. */
  receiptDigest?: string;
  repository: string; ref: string;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'incomplete';
  commit?: string; tree?: string;
  stages: { id: 'resolve' | 'fetch' | 'build' | 'publish'; label: string; status: 'pending' | 'running' | 'passed' | 'failed' }[];
  recording?: { id: string; kind: 'source-preparation'; runId: string; complete: true; source: 'native' };
}
function row(input: unknown, keys: readonly string[]): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length || Object.entries(Object.getOwnPropertyDescriptors(input)).some(([key, descriptor]) => !keys.includes(key) || !descriptor.enumerable || !('value' in descriptor))) throw Error('Invalid application source');
  return input as Record<string, any>;
}
function hex(input: unknown, git = false): string {
  const value = applicationText(input, 64);
  if (!(git ? /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/ : /^[a-f0-9]{64}$/).test(value)) throw Error('Invalid source identity');
  return value;
}
/** A bounded source receipt projection, without checkout paths, commands, credentials or adapter metadata. */
export function readApplicationSourceView(input: unknown): ApplicationSourceView {
  const value = row(input, ['version', 'id', 'label', 'providerId', 'binding', 'definitionDigest', 'recipeDigest', 'configurationDigest', 'receiptDigest', 'repository', 'ref', 'status', 'commit', 'tree', 'stages', 'recording']);
  if (value.version !== 1 || !['pending', 'running', 'ready', 'failed', 'incomplete'].includes(value.status)) throw Error('Invalid source status');
  const repository = applicationText(value.repository, 2048);
  if (repository !== 'Configured repository') {
    const url = new URL(repository);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid source repository');
  }
  const ids = ['resolve', 'fetch', 'build', 'publish'];
  if (!Array.isArray(value.stages) || Object.getPrototypeOf(value.stages) !== Array.prototype || value.stages.length !== ids.length
    || Object.getOwnPropertySymbols(value.stages).length || Object.entries(Object.getOwnPropertyDescriptors(value.stages)).some(([key, descriptor]) => key !== 'length' && (!ids.some((_id, index) => String(index) === key) || !descriptor.enumerable || !('value' in descriptor)))
    || ids.some((_id, index) => !Object.hasOwn(value.stages, index))) throw Error('Invalid source stages');
  const stages = value.stages.map((input: unknown, index: number) => {
    const stage = row(input, ['id', 'label', 'status']);
    if (stage.id !== ids[index] || !['pending', 'running', 'passed', 'failed'].includes(stage.status)) throw Error('Invalid source stage');
    return { id: stage.id, label: applicationText(stage.label, 160), status: stage.status };
  });
  const commit = value.commit === undefined ? undefined : hex(value.commit, true);
  const tree = value.tree === undefined ? undefined : hex(value.tree, true);
  const receiptDigest = value.receiptDigest === undefined ? undefined : hex(value.receiptDigest);
  if ((commit === undefined) !== (tree === undefined)) throw Error('Incomplete source version');
  let recording: ApplicationSourceView['recording'];
  if (value.recording !== undefined) {
    const proof = row(value.recording, ['id', 'kind', 'runId', 'complete', 'source']);
    if (proof.kind !== 'source-preparation' || proof.source !== 'native' || proof.complete !== true) throw Error('Invalid source proof');
    recording = { id: applicationText(proof.id, 256), kind: 'source-preparation', runId: applicationText(proof.runId, 512), complete: true, source: 'native' };
  }
  if (value.status === 'ready' && (!commit || !tree || !recording || !receiptDigest || stages.some((stage: ApplicationSourceView['stages'][number]) => stage.status !== 'passed'))
    || value.status === 'pending' && stages.some((stage: ApplicationSourceView['stages'][number]) => stage.status !== 'pending')) throw Error('Unconfirmed source readiness');
  return { version: 1, id: applicationId(value.id), label: applicationText(value.label, 160), providerId: applicationId(value.providerId),
    binding: readApplicationSelection(value.binding), definitionDigest: hex(value.definitionDigest), recipeDigest: hex(value.recipeDigest), configurationDigest: hex(value.configurationDigest),
    repository, ref: applicationText(value.ref, 256), status: value.status, stages, ...(commit ? { commit, tree } : {}), ...(recording ? { recording } : {}), ...(receiptDigest ? { receiptDigest } : {}) };
}
export function applicationSourceMatches(source: ApplicationSourceView, selection: ApplicationSelection | undefined): boolean {
  return !!selection && source.binding.strategyId === selection.strategyId && source.binding.targetId === selection.targetId && source.binding.profileId === selection.profileId;
}
/** Identity sealed into the application review; changing any admitted input requires another review. */
export function applicationSourceIdentity(source: ApplicationSourceView | undefined): string {
  return source ? JSON.stringify([source.id, source.binding, source.definitionDigest, source.recipeDigest, source.configurationDigest, source.repository, source.ref, source.commit, source.tree, source.recording?.runId, source.receiptDigest]) : '';
}
