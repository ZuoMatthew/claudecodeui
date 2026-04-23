import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { checkInstalled, checkStatus } from '@/providers/opencode/status.js';

export class OpencodeProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'opencode',
        authenticated: false,
        email: null,
        method: null,
        error: 'OpenCode CLI is not installed',
      };
    }

    const status = await checkStatus();
    return {
      installed,
      provider: 'opencode',
      authenticated: status.authenticated,
      email: status.email ?? null,
      method: status.method ?? null,
      error: status.error || undefined,
    };
  }
}
