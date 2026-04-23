import { createNormalizedMessage, readObjectRecord } from '@/shared/utils.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import type { IProviderSessions } from '@/shared/interfaces.js';

import { opencodeAdapter } from '@/providers/opencode/adapter.js';
import { getSessionMessages as getAcpSessionMessages } from '@/providers/opencode/acp-adapter.js';

const PROVIDER = 'opencode';

type LegacyOpenCodeHistoryResult = Awaited<ReturnType<typeof opencodeAdapter.fetchHistory>>;

function readStringField(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function getPartsContainer(message: Record<string, unknown>, raw: Record<string, unknown>): unknown[] {
  const messageParts = Array.isArray(message.parts) ? message.parts : null;
  if (messageParts) {
    return messageParts;
  }

  const rawParts = Array.isArray(raw.parts) ? raw.parts : null;
  if (rawParts) {
    return rawParts;
  }

  return [];
}

function normalizeAcpMessage(rawMessage: unknown, sessionId: string): NormalizedMessage[] {
  const raw = readObjectRecord(rawMessage);
  if (!raw) {
    return [];
  }

  const ts = typeof raw.timestamp === 'string'
    ? raw.timestamp
    : new Date().toISOString();

  const message = readObjectRecord(raw.message) ?? raw;
  const role = typeof message.role === 'string' ? message.role : undefined;
  const content = message.content;
  const parts = getPartsContainer(message, raw);

  if (typeof content === 'string' && content.trim()) {
    return [createNormalizedMessage({
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'text',
      role: role === 'user' ? 'user' : 'assistant',
      content,
    })];
  }

  if (Array.isArray(content) || parts.length > 0) {
    const messages: NormalizedMessage[] = [];
    const normalizedParts = Array.isArray(content) ? content : parts;
    for (const part of normalizedParts) {
      const normalizedPart = readObjectRecord(part);
      if (!normalizedPart) continue;

      const text = readStringField(normalizedPart.text) ?? readStringField(normalizedPart.content);
      if ((normalizedPart.type === 'text' || normalizedPart.type === 'input_text' || normalizedPart.type === 'output_text') && text) {
        messages.push(createNormalizedMessage({
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: role === 'user' ? 'user' : 'assistant',
          content: text,
        }));
        continue;
      }

      if (normalizedPart.type === 'tool_result') {
        messages.push(createNormalizedMessage({
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId: typeof normalizedPart.tool_use_id === 'string' ? normalizedPart.tool_use_id : undefined,
          content: typeof normalizedPart.content === 'string' ? normalizedPart.content : JSON.stringify(normalizedPart.content ?? ''),
          isError: Boolean(normalizedPart.is_error),
        }));
        continue;
      }

      if (normalizedPart.type === 'tool_use') {
        messages.push(createNormalizedMessage({
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'tool_use',
          toolId: typeof normalizedPart.id === 'string' ? normalizedPart.id : undefined,
          toolName: readStringField(normalizedPart.name) ?? 'tool_use',
          toolInput: normalizedPart.input ?? {},
        }));
      }
    }

    return messages;
  }

  if (typeof raw.type === 'string' && raw.type === 'error') {
    return [createNormalizedMessage({
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'error',
      content: typeof raw.message === 'string' ? raw.message : 'Unknown error',
    })];
  }

  return [];
}

function toResult(messages: NormalizedMessage[], options: FetchHistoryOptions): FetchHistoryResult {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? null;
  const pagedMessages = limit === null ? messages : messages.slice(offset, offset + limit);
  return {
    messages: pagedMessages,
    total: messages.length,
    hasMore: limit === null ? false : offset + limit < messages.length,
    offset,
    limit,
  };
}

export class OpencodeSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    if (!sessionId) {
      return [];
    }

    return normalizeAcpMessage(rawMessage, sessionId);
  }

  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const legacyResult = await opencodeAdapter.fetchHistory(sessionId, options);
    if (legacyResult.messages.length > 0) {
      return legacyResult;
    }

    try {
      const rawMessages = await getAcpSessionMessages(sessionId);
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
        return legacyResult;
      }

      const normalized: NormalizedMessage[] = [];
      for (const rawMessage of rawMessages) {
        normalized.push(...normalizeAcpMessage(rawMessage, sessionId));
      }

      if (normalized.length === 0) {
        return legacyResult;
      }

      return toResult(normalized, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[OpenCodeSessionsProvider] Failed to load session ${sessionId}:`, message);
      return legacyResult;
    }
  }
}
