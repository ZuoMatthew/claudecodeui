/**
 * OpenCode provider adapter.
 *
 * Normalizes OpenCode CLI session history into NormalizedMessage format.
 * @module providers/opencode
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { createNormalizedMessage, generateMessageId } from '../types.js';

const PROVIDER = 'opencode';

/**
 * Get the path to OpenCode's database
 */
function getOpencodeDbPath() {
  // Linux/macOS: ~/.local/share/opencode/opencode.db
  // Windows: %USERPROFILE%\.local\share\opencode\opencode.db
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');
  }
  return path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * Open OpenCode database connection
 */
function openOpencodeDb() {
  const dbPath = getOpencodeDbPath();
  return new Database(dbPath, { readonly: true });
}

/**
 * Parse a JSON part data into a NormalizedMessage or array of messages.
 * @param {object} partData - Parsed part data
 * @param {string} messageId
 * @param {string} sessionId
 * @param {string} timestamp
 * @returns {import('../types.js').NormalizedMessage[]}
 */
function normalizePart(partData, messageId, sessionId, timestamp, role = 'assistant') {
  // Prefer stable DB part/message IDs so server/realtime dedupe works across refreshes.
  const partId = partData.id || messageId || generateMessageId('opencode_part');
  const type = partData.type;

  switch (type) {
    case 'text':
      return [createNormalizedMessage({
        id: partId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'text',
        role,
        content: partData.text || '',
      })];

    case 'reasoning':
      // Internal reasoning should not be rendered as normal chat content.
      return [];

    case 'step-start':
      // Step lifecycle marker only; ignore in chat history rendering.
      return [];

    case 'tool':
      return [createNormalizedMessage({
        id: partId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: partData.tool || 'Unknown',
        toolInput: partData.state?.input || {},
        toolId: partData.callID || partId,
      })];

    case 'step-finish':
      // Completion marker only; keep chat history clean.
      return [];

    case 'patch':
      // File changes summary
      return [createNormalizedMessage({
        id: partId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: 'FilePatch',
        toolInput: { files: partData.files || [], hash: partData.hash },
        toolId: partId,
      })];

    case 'error':
      return [createNormalizedMessage({
        id: partId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'error',
        content: partData.message || 'Unknown error',
      })];

    default:
      // Unknown OpenCode parts are ignored to avoid rendering internal metadata
      // as user-visible chat content after refresh.
      return [];
  }
}

/**
 * Normalize a raw OpenCode event (for realtime streaming, if applicable).
 * @param {object} raw - A raw event from OpenCode
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
export function normalizeMessage(raw, sessionId) {
  const ts = raw.timestamp || new Date().toISOString();
  const baseId = raw.id || generateMessageId('opencode');

  // Handle different OpenCode event types
  if (raw.type === 'message' || raw.message) {
    // Message wrapper
    const msgData = raw.data || raw;
    const role = msgData.role;
    const parts = msgData.parts || [];

    const messages = [];

    // User message
    if (role === 'user') {
      for (const part of parts) {
        messages.push(...normalizePart(part, baseId, sessionId, ts, 'user'));
      }
    }

    // Assistant message
    if (role === 'assistant') {
      for (const part of parts) {
        messages.push(...normalizePart(part, baseId, sessionId, ts, 'assistant'));
      }
    }

    return messages;
  }

  // Tool events
  if (raw.type === 'tool') {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: raw.tool || 'Unknown',
      toolInput: raw.state?.input || {},
      toolId: raw.callID || baseId,
    })];
  }

  // Tool result
  if (raw.type === 'tool_result' || raw.result) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_result',
      toolId: raw.callID || '',
      content: raw.output || '',
      isError: raw.error || false,
    })];
  }

  // Error
  if (raw.type === 'error') {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'error',
      content: raw.message || 'Unknown error',
    })];
  }

  // Stream end
  if (raw.type === 'done' || raw.done) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'complete',
    })];
  }

  return [];
}

/**
 * @type {import('../types.js').ProviderAdapter}
 */
export const opencodeAdapter = {
  normalizeMessage,

  /**
   * Fetch session history from OpenCode SQLite database.
   */
  async fetchHistory(sessionId, opts = {}) {
    const { limit = null, offset = 0 } = opts;

    try {
      // Query messages for this session
      const msgQuery = limit
        ? `SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created LIMIT ${limit} OFFSET ${offset}`
        : `SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created`;

      const msgResult = await runDbQuery(msgQuery, [sessionId]);
      const messages = Array.isArray(msgResult) ? msgResult : [];

      // Query parts for these messages
      const msgIds = messages.map((m) => m.id);
      let parts = [];
      if (msgIds.length > 0) {
        const placeholders = msgIds.map(() => '?').join(',');
        const partsQuery = `SELECT id, message_id, data, time_created FROM part WHERE message_id IN (${placeholders}) ORDER BY time_created`;
        const partsResult = await runDbQuery(partsQuery, msgIds);
        parts = Array.isArray(partsResult) ? partsResult : [];
      }

      // Group parts by message_id
      const partsByMsg = new Map();
      for (const part of parts) {
        if (!partsByMsg.has(part.message_id)) {
          partsByMsg.set(part.message_id, []);
        }
        partsByMsg.get(part.message_id).push(part);
      }

      // Normalize messages and parts
      const normalized = [];
      for (const msg of messages) {
        const msgData = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
        const timestamp = msg.time_created
          ? new Date(msg.time_created).toISOString()
          : new Date().toISOString();
        const msgId = msg.id || generateMessageId('opencode_msg');

        const role = msgData.role;
        const msgParts = partsByMsg.get(msg.id) || [];

        if (role === 'user') {
          // User message - normalize parts
          for (const part of msgParts) {
            const partData = typeof part.data === 'string' ? JSON.parse(part.data) : part.data;
            normalized.push(...normalizePart(partData, part.id, sessionId, timestamp, 'user'));
          }
        } else if (role === 'assistant') {
          // Assistant message - normalize parts
          for (const part of msgParts) {
            const partData = typeof part.data === 'string' ? JSON.parse(part.data) : part.data;
            const normalizedParts = normalizePart(partData, part.id, sessionId, timestamp, 'assistant');
            normalized.push(...normalizedParts);
          }
        }
      }

      // Attach tool results to tool_use messages by matching callID
      const toolResultMap = new Map();
      for (const msg of normalized) {
        if (msg.kind === 'tool_result' && msg.toolId) {
          toolResultMap.set(msg.toolId, msg);
        }
      }
      for (const msg of normalized) {
        if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
          const tr = toolResultMap.get(msg.toolId);
          msg.toolResult = { content: tr.content, isError: tr.isError };
        }
      }

      return {
        messages: normalized,
        total: normalized.length,
        hasMore: false,
        offset,
        limit,
        tokenUsage: null,
      };
    } catch (error) {
      console.warn(`[OpenCodeAdapter] Failed to load session ${sessionId}:`, error.message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  },
};

/**
 * Run a query against the OpenCode database.
 * @param {string} query
 * @param {any[]} params
 * @returns {Promise<any>}
 */
function runDbQuery(query, params = []) {
  try {
    const db = openOpencodeDb();
    const stmt = db.prepare(query);
    const result = params.length > 0 ? stmt.all(...params) : stmt.all();
    db.close();
    return result;
  } catch (error) {
    console.error('[OpenCodeAdapter] Database query error:', error.message);
    throw error;
  }
}
