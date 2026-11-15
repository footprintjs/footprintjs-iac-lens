import type { ConnectionProfileCatalog } from 'footprintjs-iac/connection-profiles';
import { readConnectionProfileAction, readConnectionProfileSummary, readConnectionProfilesView, readConnectionProfileTestResult,
  CONNECTION_PROFILE_CAPACITY, type ConnectionProfileActionResult, type ConnectionProfilesView } from '../core/connection-profiles.ts';

export type { ConnectionProfileCatalog };
/** A fixed host owns registration and endpoint admission. No secret values are retained by the viewer. */
export class ConnectionProfilesReview {
  private state?: ConnectionProfilesView;
  private readonly catalog: ConnectionProfileCatalog;
  private readonly requiredAtStart: boolean;
  private readonly publish: (state: ConnectionProfilesView) => void;
  constructor(catalog: ConnectionProfileCatalog, requiredAtStart: boolean, publish: (state: ConnectionProfilesView) => void) {
    this.catalog = catalog; this.requiredAtStart = requiredAtStart; this.publish = publish;
  }
  async initialize(): Promise<void> { await this.refresh(false); }
  isBusy(): boolean { return this.state?.busy === true; }
  has(id: string): boolean { return this.state?.profiles.some(profile => profile.id === id) === true; }
  private async refresh(busy: boolean): Promise<void> {
    const state = readConnectionProfilesView({ schemas: this.catalog.schemas(), profiles: await this.catalog.list(), busy,
      requiredAtStart: this.requiredAtStart, ...(this.state?.lastTest ? { lastTest: this.state.lastTest } : {}) });
    this.state = state; this.publish(structuredClone(state));
  }
  async action(input: unknown): Promise<ConnectionProfileActionResult> {
    const action = readConnectionProfileAction(input);
    if (!this.state || this.state.busy) throw Error('Connection setup is unavailable');
    if (action.action === 'register' && this.state.profiles.length >= CONNECTION_PROFILE_CAPACITY) throw Error('Connection capacity reached');
    this.state = { ...this.state, busy: true }; this.publish(structuredClone(this.state));
    try {
      if (action.action === 'register') {
        const saved = await this.catalog.register(action.registration);
        const profile = readConnectionProfileSummary(saved, this.state.schemas);
        await this.refresh(true); return { action: 'register', profile };
      }
      if (!this.has(action.profileId)) throw Error('Unknown connection profile');
      const result = readConnectionProfileTestResult(await this.catalog.test(action.profileId));
      if (result.profileId !== action.profileId) throw Error('The connection test returned another profile');
      this.state = { ...this.state, lastTest: result }; return { action: 'test', result };
    } finally {
      this.state = { ...this.state, busy: false }; this.publish(structuredClone(this.state));
    }
  }
}
