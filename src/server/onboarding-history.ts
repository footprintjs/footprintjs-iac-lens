import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OnboardingSnapshot } from '../core/onboarding.ts';
import type { DiagnosticConfigurationVersion, RecordedDiagnostics } from '../core/recorded-diagnostics.ts';
import type { DashboardState } from '../core/types.ts';

export function legacyOnboardingHistoryBinding(view: Pick<OnboardingSnapshot, 'id' | 'strategyId' | 'targetId' | 'profileId' | 'configurationDigest'>): string {
  return createHash('sha256').update(JSON.stringify({ onboarding: view.id, strategy: view.strategyId, target: view.targetId, profile: view.profileId ?? null, configuration: view.configurationDigest })).digest('hex');
}
export function registryHistoryBinding(state: DashboardState): string | undefined {
  const registry = state.onboardingRegistry;
  if (!registry) return undefined;
  const owner = registry.owner;
  return createHash('sha256').update(JSON.stringify([registry.id, owner.id, owner.strategyId, owner.targetId, owner.physicalTargetDigest, owner.controllerId, owner.controllerDigest])).digest('hex');
}
export function currentDiagnosticVersion(state: DashboardState): DiagnosticConfigurationVersion | undefined {
  const registry = state.onboardingRegistry;
  if (!registry) return undefined;
  const version = registry.versions.find(version => version.id === registry.activeVersionId)!;
  return { registryId: registry.id, versionId: version.id, head: registry.head, configurationDigest: version.definition.configurationDigest, releaseDigest: version.releaseDigest, association: 'admitted-registry-head' };
}
/** Exact legacy binding plus retained native registry membership, never a guessed app/target match. */
export function legacyDiagnosticVersion(state: DashboardState, prior: RecordedDiagnostics): DiagnosticConfigurationVersion | undefined {
  const registry = state.onboardingRegistry;
  if (!registry) return undefined;
  const entry = registry.history.find(entry => legacyOnboardingHistoryBinding(entry.workflow) === prior.binding);
  if (!entry) return undefined;
  const version = registry.versions.find(version => version.id === entry.versionId)!;
  if (legacyOnboardingHistoryBinding(version.definition) !== prior.binding) return undefined;
  return { registryId: registry.id, versionId: entry.versionId, head: entry.head, configurationDigest: version.definition.configurationDigest, releaseDigest: version.releaseDigest, association: 'matched-legacy-binding' };
}
/** Preserve the original viewer file before changing its derived owner binding or adding version annotations. */
export async function preserveLegacyDiagnostics(directory: string, binding: string, content: string): Promise<void> {
  const path = join(directory, 'recorded-diagnostics-legacy-' + binding + '.json');
  try { await writeFile(path, content, { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024 || await readFile(path, 'utf8') !== content) throw Error('Retain the unmatched legacy viewer archive');
  }
}
