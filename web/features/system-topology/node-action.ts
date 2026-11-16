import type { TopologyNodeView } from 'footprintjs-iac/system-topology';
/** History stays in the inspector; the card shows an active operation or the latest recorded one. */
export function currentTopologyAction(node:TopologyNodeView) {
  const actions=node.actions??[],running=actions.filter(action=>action.status==='running');
  const action=running.find(action=>action.scope==='component')??running.at(-1)??actions.at(-1);
  return {action,runningCount:running.length};
}
