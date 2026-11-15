import { randomUUID } from 'node:crypto';
import { readAgentPlatformAction, readAgentPlatformView } from '../core/agent-platform-read.ts';
import { agentContextKey, projectAgentPlatformView } from '../core/agent-platform-project.ts';
import type { AgentPlatformAction, AgentPlatformView, AgentView } from '../core/agent-platform.ts';
import type { AgentPlatformContext, AgentPlatformHost, AgentPlatformHostProvider } from './agent-platform-host.ts';

export class AgentPlatformRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function scope(agent: AgentView): string {
  return JSON.stringify([agent.binding?.graphDigest, agent.binding?.targetId, agent.revisionId, agent.id]);
}
function settled(agent: AgentView | undefined): boolean {
  const layer = agent?.layers.find(layer => layer.id === 'agent');
  return !!layer && ['ready', 'failed'].includes(layer.status)
    && layer.recording?.kind === 'readiness' && layer.recording.complete;
}
/** An optional viewer bridge. Native workflows and the registered host own every effect and durable intent. */
export class AgentPlatformReview {
  private host?: AgentPlatformHost;
  private view?: AgentPlatformView;
  private pending: Promise<void> = Promise.resolve();
  private refreshing?: Promise<void>;
  private unsubscribe?: () => void;
  private checking?: string;
  private contextKey = '';
  private uncertain = new Set<string>();
  private publication = 0;
  private disposed = false;
  private readonly provider: AgentPlatformHostProvider;
  private readonly context: () => AgentPlatformContext;
  private readonly changed: (view: AgentPlatformView) => void;
  constructor(provider: AgentPlatformHostProvider, context: () => AgentPlatformContext, changed: (view: AgentPlatformView) => void) {
    this.provider = provider; this.context = context; this.changed = changed;
  }
  get isBusy(): boolean { return !!this.checking; }
  whenIdle(): Promise<void> { return Promise.all([this.pending, this.refreshing]).then(() => {}); }
  dispose(): void { this.disposed = true; this.unsubscribe?.(); }
  private accept(input: AgentPlatformView): void {
    const view = readAgentPlatformView(input);
    if (view.id !== this.host?.id) throw Error('Agent host identity changed');
    ++this.publication;
    this.view = { ...view, busy: this.isBusy || view.busy, agents: view.agents.map(agent => this.uncertain.has(scope(agent))
      ? { ...agent, status: 'incomplete', canCheck: false, layers: agent.layers.map(layer => layer.id === 'agent' ? { ...layer, status: 'incomplete' } : layer) } : agent) };
    if (!this.disposed) this.changed(structuredClone(this.view));
  }
  private message(text: string): void { if (this.view) this.accept({ ...this.view, error: text }); }
  async initialize(): Promise<void> {
    try {
      this.host = typeof this.provider === 'function' ? await this.provider() : this.provider;
      if (!this.host || this.host.version !== 1 || typeof this.host.snapshot !== 'function' || typeof this.host.id !== 'string'
        || typeof this.host.label !== 'string') throw Error('Agent host unavailable');
      if (this.host.subscribe) this.unsubscribe = this.host.subscribe(view => {
        try { this.accept(view); } catch { this.message('Some agent observations could not be displayed. Inspect the retained native records.'); }
      });
      await this.refresh();
    } catch { this.unsubscribe?.(); this.unsubscribe = undefined; throw new AgentPlatformRequestError(500, 'Agent view could not be loaded. Check its trusted host configuration.'); }
  }
  async action(input: AgentPlatformAction): Promise<void> {
    input = readAgentPlatformAction(input);
    if (this.disposed) throw new AgentPlatformRequestError(409, 'Agent view is closed');
    if (input.action === 'open') return;
    if (this.isBusy) throw new AgentPlatformRequestError(409, 'Wait for the current agent check');
    if (input.action === 'refresh') {
      try { await this.refresh(); } catch { throw new AgentPlatformRequestError(500, 'Agent records could not be read. Check its trusted host configuration.'); }
      return;
    }
    const context = structuredClone(this.context()), view = this.view && projectAgentPlatformView(this.view, context);
    const agent = view?.agents.find(agent => agent.id === input.agentId);
    if (!agent?.canCheck || !agent.revisionId || this.uncertain.has(scope(agent)) || !this.host?.check) throw new AgentPlatformRequestError(409, 'Agent check is unavailable for this deployment');
    const checkedScope = scope(agent);
    this.checking = input.agentId;
    this.accept({ ...this.view!, busy: true, error: undefined });
    const key = agentContextKey(context);
    this.pending = (async () => {
      let accepting = true;
      try {
        const result = await this.host!.check!(input.agentId, { ...structuredClone(context), operationId: randomUUID() }, value => {
          if (!accepting || this.disposed || key !== agentContextKey(this.context())) return;
          try {
            const observation = readAgentPlatformView(value), selected = observation.agents.find(agent => agent.id === input.agentId);
            if (!selected || scope(selected) !== checkedScope) throw Error('Agent check observation changed scope');
            this.accept(observation);
          } catch { this.message('Some agent observations could not be displayed. Inspect the retained native records.'); }
        });
        accepting = false;
        const final = readAgentPlatformView(result);
        const checked = final.agents.find(agent => agent.id === input.agentId);
        if (final.busy || !checked || scope(checked) !== checkedScope || !settled(checked)) throw Error('Agent check did not settle');
        if (key === agentContextKey(this.context())) this.accept(final);
        else this.message('The selected deployment changed. Refresh its agent records.');
      } catch {
        this.uncertain.add(checkedScope);
        this.message('Agent check was not confirmed. Inspect its retained native records before retrying.');
      } finally {
        accepting = false;
        this.checking = undefined;
        if (this.view) this.accept({ ...this.view, busy: false });
        this.contextChanged();
      }
    })();
  }
  private async refresh(): Promise<void> {
    if (!this.host) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.readSnapshot().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async readSnapshot(): Promise<void> {
    while (!this.disposed) {
      const context = structuredClone(this.context()), key = agentContextKey(context), publication = this.publication;
      const view = await this.host!.snapshot(context);
      if (key !== agentContextKey(this.context())) continue;
      this.contextKey = key;
      if (!this.disposed && publication === this.publication) this.accept(view);
      return;
    }
  }
  contextChanged(): void {
    if (!this.host || this.disposed || this.isBusy || this.contextKey === agentContextKey(this.context())) return;
    void this.refresh().catch(() => this.message('Agent records could not be read. Check the retained native evidence.'));
  }
}
