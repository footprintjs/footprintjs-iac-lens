import { readDeploymentChart, type DeploymentChart, type DeploymentResourceStages } from 'footprintjs-iac/progress';

export interface DeploymentScheduleReasons {
  readonly dependencies: readonly { readonly resourceId: string; readonly attributes: readonly string[] }[];
  readonly capacity?: { readonly fromBatch: number; readonly throughBatch: number; readonly limit: number };
  readonly batchBarrier?: number;
}
export interface LensDeploymentResource extends DeploymentResourceStages { readonly schedule?: DeploymentScheduleReasons }
export interface LensDeploymentChart extends DeploymentChart { readonly resources: readonly LensDeploymentResource[] }

const stableId = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
function require(valid: unknown): asserts valid { if (!valid) throw Error('Invalid recorded deployment schedule'); }
function fields(input: unknown, allowed?: string[]): Record<string, unknown> {
  require(input && typeof input === 'object' && [null, Object.prototype].includes(Object.getPrototypeOf(input)));
  const keys = Reflect.ownKeys(input);
  require(keys.length <= 32);
  return Object.fromEntries(keys.map(key => {
    const property = Object.getOwnPropertyDescriptor(input, key)!;
    require(typeof key === 'string' && property.enumerable && 'value' in property && (!allowed || allowed.includes(key)));
    return [key, property.value];
  }));
}
function list<T>(input: unknown, read: (value: unknown) => T): T[] {
  require(Array.isArray(input) && input.length <= 4096 && Reflect.ownKeys(input).length === input.length + 1);
  return Array.from({ length: input.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(input, index);
    require(property?.enumerable && 'value' in property);
    return read(property.value);
  });
}
function id(input: unknown) {
  require(typeof input === 'string' && stableId.test(input) && !['__proto__', 'constructor', 'prototype'].includes(input));
  return input;
}
function reasons(input: unknown, batch: number, count: () => void): DeploymentScheduleReasons {
  const row = fields(input, ['dependencies', 'capacity', 'batchBarrier']);
  const dependencies = list(row.dependencies, input => {
    count();
    const dep = fields(input, ['resourceId', 'attributes']);
    return Object.freeze({ resourceId: id(dep.resourceId), attributes: Object.freeze(list(dep.attributes, value => { count(); return id(value); })) });
  });
  let capacity: DeploymentScheduleReasons['capacity'];
  if (row.capacity !== undefined) {
    const { fromBatch, throughBatch, limit } = fields(row.capacity, ['fromBatch', 'throughBatch', 'limit']);
    require(typeof fromBatch === 'number' && Number.isSafeInteger(fromBatch) && fromBatch >= 0 && fromBatch < batch
      && throughBatch === batch - 1 && typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 1 && limit <= 128);
    capacity = Object.freeze({ fromBatch, throughBatch, limit });
  }
  const barrier = row.batchBarrier;
  require(barrier === undefined || (batch > 0 && barrier === batch - 1));
  return Object.freeze({ dependencies: Object.freeze(dependencies), ...(capacity && { capacity }), ...(barrier !== undefined && { batchBarrier: barrier }) });
}

/** The bundled core validates the native chart. Admit the optional schedule fields from newer hosts independently. */
export function readLensDeploymentChart(input: unknown): LensDeploymentChart {
  const source = fields(input);
  const extension: unknown[] = [];
  const resources = list(source.resources, item => {
    const { schedule, ...binding } = fields(item);
    extension.push(schedule);
    return binding;
  });
  const chart = readDeploymentChart({ ...source, resources });
  if (extension.every(item => item === undefined)) return chart;
  let remaining = 100_000;
  const count = () => require(--remaining >= 0);
  return Object.freeze({ ...chart, resources: Object.freeze(chart.resources.map((binding, index) => {
    const input = extension[index];
    return input === undefined ? binding : Object.freeze({ ...binding, schedule: reasons(input, binding.batchIndex, count) });
  })) });
}
