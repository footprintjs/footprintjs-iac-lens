import { infra, resource, type InfraGraph } from 'footprint-iac';

/** A labelled simulation of a small application, with real dependency scheduling. */
export function demoGraph(failure = false): InfraGraph {
  const network = resource('network', 'simulator', { family: 'network', kind: 'network-segment', purpose: 'private communication' });
  const sessions = resource('session-store', 'simulator', { family: 'storage', kind: 'session-store', purpose: 'session state' });
  const database = resource('persistent-store', 'simulator', { family: 'storage', kind: 'data-store', purpose: 'application data', revision: failure ? 2 : 1 });
  const api = resource('api', 'simulator', { family: 'compute', kind: 'service', purpose: 'request execution' });
  const worker = resource('worker', 'simulator', { family: 'compute', kind: 'service', purpose: 'background execution' });
  const web = resource('web', 'simulator', { family: 'compute', kind: 'service', purpose: 'user interface' });
  const gateway = resource('gateway', 'simulator', { family: 'network', kind: 'endpoint', purpose: 'HTTP communication' });
  return infra('iac-lens-simulation')
    .boundary({ id: 'local-review', kind: 'region', label: 'Local simulation' })
    .boundary({ id: 'application', kind: 'group', label: 'Application' })
    .boundary({ id: 'state', kind: 'group', label: 'State' })
    .start(network).parallel(sessions, database).next(api).parallel(worker, web).next(gateway)
    .within('local-review', network, sessions, database, api, worker, web, gateway)
    .within('application', api, worker, web, gateway).within('state', sessions, database).synth();
}
