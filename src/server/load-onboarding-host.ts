import { loadTrustedHostModule } from './load-host-module.ts';
import type { OnboardingHost, OnboardingHostContext } from './onboarding-host.ts';

/** Only the operator selects this private composition. Construction may not discover or deploy resources. */
export async function loadOnboardingHost(modulePath: string, context: OnboardingHostContext): Promise<OnboardingHost> {
  try {
    const module = await loadTrustedHostModule(modulePath, context.directory);
    const factory = Object.getOwnPropertyDescriptor(module, 'createOnboardingHost');
    if (!factory || !('value' in factory) || typeof factory.value !== 'function') throw Error('Missing onboarding factory');
    const host = await factory.value(Object.freeze({ directory: context.directory }));
    if (!host || host.version !== 1 || !host.workflow || ['snapshot', 'dispatch', 'subscribe'].some(key => typeof host.workflow[key] !== 'function')) throw Error('Invalid onboarding host');
    return host as OnboardingHost;
  } catch {
    throw Error('Onboarding host could not be loaded. Check the trusted module and its private configuration.');
  }
}
