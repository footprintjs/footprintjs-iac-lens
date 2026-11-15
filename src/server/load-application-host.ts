import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applicationId, applicationText, readApplicationStrategies } from '../core/application.ts';
import type { ApplicationHost, ApplicationHostContext } from './application-host.ts';

/** Only the local operator supplies this executable module path. Never use browser input. */
export async function loadApplicationHost(modulePath: string, context: ApplicationHostContext): Promise<ApplicationHost> {
  try {
    if (typeof modulePath !== 'string' || !modulePath.trim() || /[\x00-\x1f\x7f]/.test(modulePath)
      || /^[a-z][a-z0-9+.-]*:/i.test(modulePath) || !isAbsolute(context.directory)) throw Error('Invalid host registration');
    const path = await realpath(resolve(modulePath));
    if (!['.mjs', '.js', '.ts'].includes(extname(path)) || !(await stat(path)).isFile()) throw Error('Invalid host module');
    const module = await import(pathToFileURL(path).href);
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
