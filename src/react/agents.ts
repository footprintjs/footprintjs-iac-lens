import { createElement } from 'react';
import '../../web/styles.css';
import '../../web/components/fit-window.css';
import '../../web/features/agents/agent-platform.css';
import AgentWorkspace, { type AgentWorkspaceProps } from '../../web/features/agents/AgentWorkspace.tsx';

export interface IacLensAgentsProps extends AgentWorkspaceProps { fitWindow?: boolean }
/** Independent optional React adapter; supply admitted state and action callbacks. */
export function IacLensAgents({ fitWindow = true, ...props }: IacLensAgentsProps) {
  return createElement('div', { className: `iac-lens${fitWindow ? ' lens-fit' : ''}` }, createElement(AgentWorkspace, props));
}
export { AgentWorkspace, type AgentWorkspaceProps };
export default IacLensAgents;
