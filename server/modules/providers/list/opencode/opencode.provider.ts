import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { OpencodeProviderAuth } from '@/modules/providers/list/opencode/opencode-auth.provider.js';
import { OpencodeMcpProvider } from '@/modules/providers/list/opencode/opencode-mcp.provider.js';
import { OpencodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import type { IProviderAuth, IProviderSessions } from '@/shared/interfaces.js';

export class OpencodeProvider extends AbstractProvider {
  readonly mcp = new OpencodeMcpProvider();
  readonly auth: IProviderAuth = new OpencodeProviderAuth();
  readonly sessions: IProviderSessions = new OpencodeSessionsProvider();

  constructor() {
    super('opencode');
  }
}
