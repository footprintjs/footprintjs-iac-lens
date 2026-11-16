import { readOnboardingVersionAction, readOnboardingVersionSnapshot, type OnboardingVersionSnapshot, type OnboardingVersionDescriptor } from '../core/onboarding-versions.ts';
import type { OnboardingSnapshot } from '../core/onboarding.ts';
import type { OnboardingVersionPublication } from './onboarding-host.ts';
import { readApplicationPublication } from './application-publication.ts';

type OnboardingIdentity = Pick<OnboardingSnapshot, 'id' | 'strategyId' | 'targetId' | 'configurationDigest' | 'profileId'>;
export function sameOnboardingDefinition(left: OnboardingIdentity, right: OnboardingIdentity): boolean {
  return (['id', 'strategyId', 'targetId', 'configurationDigest', 'profileId'] as const).every(key => left[key] === right[key]);
}
function ownerKey(view: OnboardingVersionSnapshot): string {
  const value = view.owner;
  return JSON.stringify([value.id, value.strategyId, value.targetId, value.physicalTargetDigest, value.controllerId, value.controllerDigest]);
}
function versionKey(value: OnboardingVersionDescriptor): string {
  const definition = value.definition;
  return JSON.stringify([value.id, value.label, value.bindingDigest, value.releaseDigest, value.checksDigest, value.profileDigest,
    definition.id, definition.label, definition.strategyId, definition.targetId, definition.configurationDigest, definition.profileId]);
}
/** Shape admission complements the native registry's sealed review and ownership verification. */
export function admitOnboardingVersion(input: unknown, current?: OnboardingVersionSnapshot): OnboardingVersionSnapshot | undefined {
  const next = readOnboardingVersionSnapshot(input);
  if (!current) return next;
  if (next.id !== current.id || ownerKey(next) !== ownerKey(current)) throw Error('Registered configuration ownership changed');
  if (next.head < current.head) return undefined;
  for (const before of current.versions) {
    const after = next.versions.find(version => version.id === before.id);
    if (!after || versionKey(after) !== versionKey(before)) throw Error('A retained configuration version was overwritten');
  }
  if (next.head === current.head && (next.activeVersionId !== current.activeVersionId || !sameOnboardingDefinition(next.active, current.active))) throw Error('Active configuration changed without an admitted head');
  if (next.head > current.head) {
    const prior = next.history.find(entry => entry.head === current.head);
    const active = next.history.find(entry => entry.head === next.head);
    if (!prior || prior.versionId !== current.activeVersionId || !active || active.versionId !== next.activeVersionId || !active.recording) throw Error('Configuration transition lacks retained native history');
  }
  return next;
}
/** A scoped publication cannot choose another version, a provider argument or an executable. */
export function readOnboardingVersionPublication(input: unknown): OnboardingVersionPublication {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length
    || Object.entries(Object.getOwnPropertyDescriptors(input)).some(([key, descriptor]) => !['head', 'versionId', 'publication'].includes(key) || !descriptor.enumerable || !('value' in descriptor))) throw Error('Invalid configuration publication');
  const row = input as OnboardingVersionPublication;
  if (!Number.isSafeInteger(row.head) || row.head < 0) throw Error('Invalid configuration publication head');
  readOnboardingVersionAction({ action: 'review-version', versionId: row.versionId });
  return { head: row.head, versionId: row.versionId, ...(row.publication !== undefined ? { publication: readApplicationPublication(row.publication) } : {}) };
}
