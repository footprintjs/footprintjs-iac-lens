import { Component, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';

interface Props { children: ReactNode; onRetry(): void; onInfrastructure(): void }
/** A failed optional chunk cannot take the infrastructure workspace with it. */
export class AgentFeatureBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="agents-opening" role="alert"><Icon name="graph" size={32}/><h1>Agents could not load</h1>
      <p>Retry this view, or continue with your infrastructure.</p><div>
        <button className="button button-secondary" type="button" onClick={this.props.onRetry}>Retry Agents</button>
        <button className="button button-secondary" type="button" onClick={this.props.onInfrastructure}>Back to infrastructure</button>
      </div></main>;
  }
}
