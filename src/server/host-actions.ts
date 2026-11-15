import { randomUUID } from 'node:crypto';
import { readHostActionInput, readHostActionMetadata, readHostActionReceipt, readHostActionsView,
  type HostActionControl, type HostActionInput, type HostActionRun, type HostActionsView } from '../core/host-actions.ts';

export type { HostActionControl, HostActionReceipt, HostActionsView } from '../core/host-actions.ts';
export class HostActionRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Executes only parameterless actions supplied by the trusted local host. */
export class HostActionReview {
  private readonly controls: readonly HostActionControl[];
  private readonly publish: (view: HostActionsView) => void;
  private readonly history: HostActionRun[] = [];
  private pending = false;
  private completion: Promise<void> = Promise.resolve();
  constructor(controls: readonly HostActionControl[], publish: (view: HostActionsView) => void) {
    if (!Array.isArray(controls) || controls.length > 32) throw Error('Configure a bounded action catalog');
    this.controls = controls.map(control => {
      if (!control || typeof control.execute !== 'function') throw Error('A configured action needs an executor');
      const metadata = readHostActionMetadata({ id: control.id, label: control.label,
        ...(control.description !== undefined ? { description: control.description } : {}) });
      return Object.freeze({ ...metadata, execute: control.execute.bind(control) });
    });
    if (new Set(this.controls.map(control => control.id)).size !== this.controls.length) throw Error('Configured action IDs must be unique');
    this.publish = publish;
  }
  get isBusy(): boolean { return this.pending; }
  snapshot(): HostActionsView {
    return readHostActionsView({ controls: this.controls.map(({ id, label, description }) => ({ id, label, ...(description ? { description } : {}) })),
      busy: this.pending, history: structuredClone(this.history) });
  }
  whenIdle(): Promise<void> { return this.completion; }
  action(input: HostActionInput): void {
    let selected: HostActionInput;
    try { selected = readHostActionInput(input); }
    catch { throw new HostActionRequestError(400, 'Choose a configured action'); }
    const control = this.controls.find(control => control.id === selected.actionId);
    if (!control) throw new HostActionRequestError(400, 'Choose a configured action');
    if (this.pending) throw new HostActionRequestError(409, 'A configured action is already running');
    if (this.history.length >= 256) throw new HostActionRequestError(409, 'This review has reached its action history limit');
    const run: HostActionRun = { invocationId: randomUUID(), actionId: control.id, label: control.label,
      status: 'running', startedAt: Date.now() };
    this.pending = true; this.history.push(run); this.notify();
    this.completion = this.perform(control, run);
  }
  private async perform(control: HostActionControl, run: HostActionRun): Promise<void> {
    try {
      run.receipt = readHostActionReceipt(await control.execute());
      run.status = run.receipt.ok ? 'passed' : 'failed';
      if (!run.receipt.ok) run.error = 'The configured action did not confirm its intended result. Inspect its retained recording.';
    } catch {
      run.status = 'failed'; run.error = 'The configured action could not confirm its result. Inspect retained evidence before repeating it.';
    } finally {
      run.finishedAt = Date.now(); this.pending = false; this.notify();
    }
  }
  private notify(): void { try { this.publish(this.snapshot()); } catch { /* A viewer cannot alter a host action. */ } }
}
