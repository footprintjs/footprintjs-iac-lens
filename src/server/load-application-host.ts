import { loadTrustedHostModule } from './load-host-module.ts';
import { applicationId, applicationText, readApplicationStrategies } from '../core/application.ts';
import type { ApplicationHost, ApplicationHostContext } from './application-host.ts';

/** Only the local operator supplies this executable module path. Never use browser input. */
export async function loadApplicationHost(modulePath: string, context: ApplicationHostContext): Promise<ApplicationHost> {
  try {
    const module = await loadTrustedHostModule(modulePath, context.directory);
    const factory = Object.getOwnPropertyDescriptor(module, 'createApplicationHost');
    if (!factory || !('value' in factory) || typeof factory.value !== 'function') throw Error('Missing application host factory');
    const host = await factory.value(Object.freeze({ directory: context.directory }));
    if (!host || typeof host !== 'object' || Array.isArray(host) || host.version !== 1) throw Error('Invalid application host');
    applicationId(host.id); applicationText(host.label, 160); readApplicationStrategies(host.strategies);
    for (const method of ['inspect', 'plan', 'apply', 'snapshot']) if (typeof host[method] !== 'function') throw Error('Incomplete application host');
    return host as ApplicationHost;
  } catch {
    // A trusted module can resolve private configuration. Its error must not print that configuration.
    throw Error('Application host could not be loaded. Check the trusted local module and its private configuration.');
  }
}
