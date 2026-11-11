export const workspaceViews = [
  { id: 'deployment', name: 'Deployment flow', icon: 'graph' },
  { id: 'system', name: 'Running system', icon: 'network' },
  { id: 'evidence', name: 'Execution evidence', icon: 'evidence' },
  { id: 'artifacts', name: 'Output artifacts', icon: 'file' },
] as const;

export type View = typeof workspaceViews[number]['id'];
export type InfrastructureView = Extract<View, 'deployment' | 'system'>;
