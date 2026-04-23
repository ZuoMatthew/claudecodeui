import type { IProviderMcp } from '@/shared/interfaces.js';
import type { LLMProvider, McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

export class OpencodeMcpProvider implements IProviderMcp {
  async listServers(): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(): Promise<ProviderMcpServer> {
    throw new AppError('OpenCode does not support MCP server management in this integration.', {
      code: 'MCP_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  async removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    return {
      removed: false,
      provider: 'opencode',
      name: input.name,
      scope: input.scope ?? 'project',
    };
  }
}
