import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compileGraph } from 'footprintjs-iac/graph';
import { createOnboardingPreset, type OnboardingSnapshot } from 'footprintjs-iac/onboarding';
import { OnboardingVersionRegistry, type OnboardingVersionRegistryOptions } from 'footprintjs-iac/onboarding/versions/node';
import type { OnboardingHost, OnboardingVersionPublication } from '../../src/server/onboarding-host.ts';

export function versionComposition(directory: string) {
  const calls = { guard: 0, check: 0, plan: 0, apply: 0, reconcile: 0 }, modes = { host: 'closed', native: 'closed', connection: true, access: true, uncertainApply: false, captureLoss: false, withholdPublication: false } as {
    host: 'closed' | 'pending' | 'unknown'; native: 'closed' | 'pending' | 'unknown'; connection: boolean; access: boolean; uncertainApply: boolean; captureLoss: boolean; withholdPublication: boolean;
  };
  const registryDirectory = join(directory, 'registry');
  const owner = { id: 'registered-owner', strategyId: 'systemd', targetId: 'registered-server', physicalTargetDigest: 'a'.repeat(64), controllerId: 'registered-controller', controllerDigest: 'b'.repeat(64) };
  const options: OnboardingVersionRegistryOptions = { id: 'setup-versions', label: 'Registered application setup', directory: registryDirectory, owner, initialVersionId: 'v1',
    versions: (['v1', 'v2'] as const).map((id, index) => ({ id, label: index ? 'Stricter readiness' : 'Original readiness', releaseDigest: 'c'.repeat(64), checksDigest: index ? 'd'.repeat(64) : 'e'.repeat(64), profileDigest: index ? 'f'.repeat(64) : '1'.repeat(64),
      createPreset(context) {
        const check = (stage: string) => ({ id: stage, configurationDigest: index ? '2'.repeat(64) : '3'.repeat(64), requiredCheckIds: [stage], async run() { calls.check++; return [{ id: stage, label: 'Registered ' + stage, status: stage === 'verify' && !modes.connection ? 'failed' as const : 'passed' as const }]; } });
        return createOnboardingPreset({ definition: { version: 1, id: 'registered-app', label: 'Registered application', strategyId: owner.strategyId, targetId: owner.targetId, configurationDigest: index ? '4'.repeat(64) : '5'.repeat(64), profileId: 'profile-' + id },
          deployment: { id: 'systemd', kind: 'systemd', async snapshot() { return {}; }, async plan() { return context.withActiveVersion(async () => { calls.plan++; return { ok: true, reviewId: 'resource-review-' + calls.plan }; }); },
            async apply() { return context.withActiveVersion(async () => { calls.apply++; if (modes.uncertainApply) { modes.native = 'unknown'; throw Error('PRIVATE_ADAPTER_EXCEPTION'); } return { ok: modes.access, promoted: modes.access, status: modes.access ? 'promoted' : 'verification-failed', checks: ['health', 'login', 'allowed', 'denied'].map(id => ({ id, label: id, status: id === 'login' && !modes.access ? 'failed' as const : 'passed' as const })) }; }); },
            async reconcile(reviewId) { return context.withActiveVersion(async () => { calls.reconcile++; modes.native = 'closed'; return { ok: false, promoted: false, status: 'reconciled-failed', reviewId }; }); } },
          adapters: { discover: check('discover'), configure: check('configure'), verify: check('verify') }, projectReview: () => [{ resourceId: 'program', label: 'Program', action: 'noop' }], projectDeployment: result => (result as { checks: OnboardingSnapshot['checks'] }).checks });
      } })),
    guard: { id: 'registered-owner-guard', configurationDigest: '6'.repeat(64), withLock: work => work(), async inspect({ versionIds }) {
      calls.guard++;
      if (modes.captureLoss) for (const name of (await readdir(registryDirectory)).filter(name => name.endsWith('.jsonl'))) {
        const path = join(registryDirectory, name.slice(0, -6) + '.json');
        try { await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') await mkdir(path); }
      }
      return { owner, hosts: versionIds.map(versionId => ({ versionId, ownerId: 'host-' + versionId, status: modes.host, digest: '7'.repeat(64), runId: 'host-observation-' + versionId })), native: { ownerId: owner.controllerId, status: modes.native, digest: createHash('sha256').update(JSON.stringify({ plan: calls.plan, apply: calls.apply, reconcile: calls.reconcile })).digest('hex'), runId: 'native-observation' } };
    } },
  };
  const registry = new OnboardingVersionRegistry(options), listeners = new Set<(value: OnboardingVersionPublication) => void>();
  const graph = compileGraph({ name: 'registered-program', boundaries: [], memberships: [], relations: [], resources: [{ id: 'program', provider: 'registered', spec: { kind: 'SystemdServiceGroup' } }] });
  const host: OnboardingHost = { version: 1, workflow: registry.activeWorkflow, registry, registryPublication: {
    async snapshot() { const state = await registry.snapshot(); return { head: state.head, versionId: state.activeVersionId, ...(modes.withholdPublication ? {} : { publication: {
      graph, target: { id: owner.targetId }, artifacts: [{ id: 'public-' + state.activeVersionId, path: 'declared-source.txt', content: state.activeVersionId }],
      ...(state.active.status === 'ready' ? { appAccess: { status: 'ready' as const }, neoUrl: 'http://127.0.0.1:55330' } : {}) } }) }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  } };
  return { options, registry, host, calls, modes, emit(value: OnboardingVersionPublication) { for (const listener of listeners) listener(value); } };
}
