/** Presentation compatibility only. The native recording, commits and provenance are never rewritten. */
export interface EvidenceSnapshotView {
  snapshot: Record<string, unknown>;
  convertedChains: number;
  causalLimitations: readonly ('temporal-read-window' | 'built-on-view' | 'partial-write')[];
}
const MAX_NODES = 20_000, MAX_BRANCHES = 128, MAX_SUBFLOWS = 2_048, MAX_COMMITS = 50_000, MAX_WORK = 500_000;
const malformed = 'This recorded execution uses an unsupported or incomplete structure.';
const oversized = 'This recorded execution exceeds the embedded viewer’s inspection limits.';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(malformed);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string') || Object.values(descriptors).some(field => !('value' in field) || !field.enumerable)) throw Error(malformed);
  if (Object.keys(descriptors).length > 256) throw Error(oversized);
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value)) throw Error(malformed);
  if (value.length > limit) throw Error(oversized);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string')
    || Object.keys(descriptors).some(key => key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) throw Error(malformed);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const field = descriptors[String(index)];
    if (!field || !('value' in field) || !field.enumerable) throw Error(malformed);
    result.push(field.value);
  }
  return result;
}

/** Admit both linked executions and chain/branch executions without guessing unfamiliar topology. */
export function prepareEvidenceSnapshot(input: unknown): EvidenceSnapshotView {
  const snapshot = record(input), result = { ...snapshot };
  const tasks: (() => void)[] = [], seen = new WeakSet<object>();
  const limitations = new Set<'temporal-read-window' | 'built-on-view' | 'partial-write'>();
  let nodes = 0, subflows = 0, work = 0, convertedChains = 0;
  function spend(amount = 1) { work += amount; if (work > MAX_WORK) throw Error(oversized); }
  function unique(value: object) { if (seen.has(value)) throw Error(malformed); seen.add(value); }
  function commits(input: unknown) {
    if (input === undefined) return;
    for (const value of array(input, MAX_COMMITS)) {
      spend(); const commit = record(value);
      // Native stamps mean reads/views precede intervening commits. Legacy key tracing cannot date them.
      if (['beganAt', 'sawUntil', 'viewAt'].some(key => Object.hasOwn(commit, key))) limitations.add('temporal-read-window');
      if (commit.updates !== undefined && Object.keys(record(commit.updates)).length) limitations.add('partial-write');
      if (commit.trace !== undefined) for (const value of array(commit.trace, MAX_WORK)) {
        spend(); const row = record(value);
        // DELIM-joined record paths and additive verbs are the formats understood by the embedded viewer.
        if (row.verb === 'merge' || row.verb === 'append' || typeof row.path === 'string' && row.path.includes('\u001f')) limitations.add('partial-write');
        if (Object.hasOwn(row, 'builtOnView')) {
          if (row.builtOnView !== true) throw Error(malformed);
          limitations.add('built-on-view');
        }
      }
    }
  }
  type Assign = (value: Record<string, unknown> | undefined) => void;
  function stage(value: unknown, kind: 'linked' | 'chain'): Record<string, unknown> {
    spend(); if (++nodes > MAX_NODES) throw Error(oversized);
    const row = record(value); unique(value as object);
    if (typeof row.id !== 'string' || !row.id || row.id.length > 4096
      || (row.runtimeStageId !== undefined && (typeof row.runtimeStageId !== 'string' || row.runtimeStageId.length > 4096))) throw Error(malformed);
    for (const field of ['stageReads', 'stageWrites']) if (row[field] !== undefined) record(row[field]);
    if (kind === 'chain' ? row.next !== undefined || row.children !== undefined : row.branches !== undefined) throw Error(malformed);
    return row;
  }
  function tree(value: unknown, assign: Assign) {
    tasks.push(() => {
      spend();
      if (value === undefined || value === null) { assign(undefined); return; }
      if (Array.isArray(value)) {
        unique(value); convertedChains++;
        const entries = array(value, MAX_NODES), projected = entries.map(entry => stage(entry, 'chain'));
        assign(projected[0]);
        for (let index = 0; index < projected.length; index++) {
          const node = projected[index]!;
          if (projected[index + 1]) node.next = projected[index + 1];
          if (node.branches !== undefined) {
            const branches = array(node.branches, MAX_BRANCHES), children: (Record<string, unknown> | undefined)[] = new Array(branches.length);
            delete node.branches;
            tasks.push(() => { node.children = children.filter(child => child !== undefined); });
            branches.forEach((branch, index) => {
              if (!Array.isArray(branch)) throw Error(malformed);
              tree(branch, child => { children[index] = child; });
            });
          }
        }
      } else {
        const node = stage(value, 'linked'); assign(node);
        if (node.next !== undefined && node.next !== null) tree(node.next, child => { node.next = child; });
        if (node.children !== undefined) {
          const entries = array(node.children, MAX_BRANCHES), children: (Record<string, unknown> | undefined)[] = new Array(entries.length);
          node.children = children;
          entries.forEach((child, index) => {
            if (Array.isArray(child) || child === null || child === undefined) throw Error(malformed);
            tree(child, projected => { children[index] = projected; });
          });
        }
      }
    });
  }
  function results(input: unknown, assign: (value: Record<string, unknown>) => void) {
    tasks.push(() => {
    const entries = record(input), projected: Record<string, unknown> = {}; unique(input as object); assign(projected);
    for (const [key, value] of Object.entries(entries)) {
      spend(); if (++subflows > MAX_SUBFLOWS) throw Error(oversized);
      const row = record(value); unique(value as object); projected[key] = row;
      if (row.treeContext !== undefined) {
        const context = record(row.treeContext); unique(row.treeContext as object); row.treeContext = context;
        tree(context.stageContexts, value => { context.stageContexts = value; }); commits(context.history);
        if (context.subflowResults !== undefined) results(context.subflowResults, value => { context.subflowResults = value; });
      }
      if (row.subflowResults !== undefined) results(row.subflowResults, value => { row.subflowResults = value; });
    }
    });
  }
  tree(snapshot.executionTree, value => { result.executionTree = value; }); commits(snapshot.commitLog);
  if (snapshot.subflowResults !== undefined) results(snapshot.subflowResults, value => { result.subflowResults = value; });
  while (tasks.length) tasks.pop()!();
  return { snapshot: result, convertedChains, causalLimitations: [...limitations] };
}
