import { STATUS_LABELS } from '../../src/core/model.ts';
import type { ResourceStatus } from '../../src/core/types.ts';

export function StatusBadge({ status, action }: { status: ResourceStatus; action?: string }) {
  return <span className={`status-badge status-${status}`}><span className="status-dot"/>{action === 'find' && status === 'ready' ? 'Found' : STATUS_LABELS[status]}{action === 'noop' && status === 'ready' ? ' · no change' : ''}</span>;
}
