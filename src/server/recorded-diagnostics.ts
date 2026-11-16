import { createHash } from 'node:crypto';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { queryRecordedDependencies, type RecordedDependencyInput } from 'footprintjs-iac/diagnostics/recorded';
import { diagnosticCandidates } from '../core/diagnostic-candidates.ts';
import { DIAGNOSTIC_HISTORY_LIMIT, readRecordedDiagnostics, type DiagnosticRun, type RecordedDiagnostics } from '../core/recorded-diagnostics.ts';
import type { DashboardState } from '../core/types.ts';
import { registryHistoryBinding, legacyOnboardingHistoryBinding, currentDiagnosticVersion, legacyDiagnosticVersion, preserveLegacyDiagnostics } from './onboarding-history.ts';

function binding(state: DashboardState): string {
  const registry = registryHistoryBinding(state); if (registry) return registry;
  if (state.onboarding) return legacyOnboardingHistoryBinding(state.onboarding);
  return createHash('sha256').update(JSON.stringify({ graph: state.graph?.digest ?? null, target: state.resourceFlow?.target ?? state.target ?? null,
    workflow: state.resourceFlow?.definitionDigest ?? null })).digest('hex');
}
/** Bounded value-free reports are separate from native evidence. Failed runs remain after recovery. */
export class RecordedDiagnosticHistory {
  private state?: RecordedDiagnostics;
  private completion: Promise<void> = Promise.resolve();
  private readonly file: string;
  private readonly directory: string;
  private readonly onError: () => void;
  private readonly initialLimitations: string[] = [];
  private persistenceBlocked = false;
  constructor(directory: string, onError: () => void) { this.directory = directory; this.file = join(directory, 'recorded-diagnostics.json'); this.onError = onError; }
  async initialize(state: DashboardState): Promise<void> {
    const expected = binding(state); let adopted = false;
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw Error('Unsupported history file');
      const content = await readFile(this.file, 'utf8'), prior = readRecordedDiagnostics(JSON.parse(content));
      if (prior.binding === expected) this.state = prior;
      else {
        const version = legacyDiagnosticVersion(state, prior);
        if (version) { await preserveLegacyDiagnostics(this.directory, prior.binding, content); this.state = { ...prior, binding: expected, runs: prior.runs.map(run => ({ ...run, configurationVersion: run.configurationVersion ?? version })) }; adopted = true; }
        else { this.initialLimitations.push('Earlier viewer history belongs to another system or workflow and is not included. Its file is retained; new reports in this view are not saved to it.'); this.persistenceBlocked = true; }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.initialLimitations.push('Earlier diagnostic history could not be read. This view includes only newly observed runs. The unreadable file is retained and new reports are not saved to it; native recordings remain authoritative.');
        this.persistenceBlocked = true;
      }
    }
    this.update(state); if (adopted) this.persist(); await this.whenIdle();
  }
  snapshot(): RecordedDiagnostics | undefined { return this.state && structuredClone(this.state); }
  whenIdle(): Promise<void> { return this.completion; }
  update(input: DashboardState): void {
    const nextBinding = binding(input);
    if (this.state?.binding !== nextBinding) this.state = { version: 1, binding: nextBinding, runs: [], omitted: 0,
      ...(this.initialLimitations.length ? { limitations: [...this.initialLimitations] } : {}) };
    let changed = false;
    for (const candidate of diagnosticCandidates(input)) {
      const prior = this.state.runs.find(run => run.id === candidate.id);
      if (prior && prior.outcome !== candidate.outcome) continue; // A terminal run cannot be rewritten as its recovery.
      const recording = candidate.recording?.provenance?.runId && candidate.recording.provenance.runId !== candidate.runId ? undefined : candidate.recording;
      const limitations = [...candidate.limitations, ...(!recording ? ['The native recording is not available for dependency inspection.'] : [])];
      if (prior && prior.targets.every(target => !!target.trace) && prior.limitations.join() === limitations.join()) continue;
      if (prior && !recording && prior.limitations.join() === limitations.join()) continue;
      const raw = recording?.snapshot as Partial<RecordedDependencyInput['snapshot']> | undefined;
      const runtimeRunId = typeof raw?.runId === 'string' ? raw.runId : null;
      const targets = candidate.targets.map(target => ({ ...target, ...(raw && typeof raw === 'object' ? {
        trace: queryRecordedDependencies({ snapshot: raw as RecordedDependencyInput['snapshot'], ...(recording?.controlDeps ? { controlDeps: recording.controlDeps as RecordedDependencyInput['controlDeps'] } : {}) }, target.key),
      } : {}) }));
      const configurationVersion = prior?.configurationVersion ?? currentDiagnosticVersion(input);
      const next: DiagnosticRun = { id: candidate.id, runId: candidate.runId, runtimeRunId, kind: candidate.kind, label: candidate.label,
        outcome: candidate.outcome, sequence: prior?.sequence ?? Math.max(0,...this.state.runs.map(run => run.sequence)) + 1, targets,
        limitations, ...(configurationVersion ? { configurationVersion } : {}) };
      const runs = [...this.state.runs.filter(run => run.id !== next.id), next].sort((a,b) => a.sequence - b.sequence);
      const removed = Math.max(0, runs.length - DIAGNOSTIC_HISTORY_LIMIT);
      this.state = { ...this.state, runs: runs.slice(-DIAGNOSTIC_HISTORY_LIMIT), omitted: this.state.omitted + removed }; changed = true;
    }
    if (changed) {
      const admitted = readRecordedDiagnostics(this.state); this.state = admitted;
      this.persist();
    }
  }
  private persist(): void {
    if (this.persistenceBlocked || !this.state) return;
    const content = JSON.stringify(readRecordedDiagnostics(this.state), null, 2) + '\n';
    this.completion = this.completion.then(async () => {
        const temporary = this.file + '.next'; await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, this.file);
      }).catch(() => {
        this.state = { ...this.state!, persistenceError: 'Diagnostic history could not be saved. Earlier native recordings remain authoritative.' };
        this.onError();
      });
  }
}
