/**
 * OpenCode CLI integration
 *
 * Spawns OpenCode CLI process for real-time agent execution.
 *
 * @module opencode-cli
 */

import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import sessionManager from './sessionManager.js';
import { createNormalizedMessage } from './providers/types.js';
import { getStatusChecker } from './providers/registry.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

let activeOpencodeProcesses = new Map(); // Track active processes by session ID

/**
 * Spawn an OpenCode CLI process
 * @param {string} command - The prompt/command to send
 * @param {object} options - Options
 * @param {WebSocket} ws - WebSocket for real-time communication
 */
async function spawnOpencode(command, options = {}, ws) {
  const {
    sessionId,
    projectPath,
    cwd,
    model,
    sessionSummary,
  } = options;

  let capturedSessionId = sessionId;

  // Determine OpenCode path
  const opencodePath = process.env.OPENCODE_PATH || 'opencode';

  // Build OpenCode command arguments
  const args = [];

  // If resuming a session
  if (sessionId) {
    args.push('--session', sessionId);
  }

  // If we have a specific model to use
  if (model) {
    args.push('--model', model);
  }

  // Add the command/prompt
  if (command && command.trim()) {
    // opencode run expects positional args for the message
    args.push('--prompt', command);
  }

  // Use JSON format for machine-readable output
  args.push('--format', 'json');

  // Use the specified working directory
  const workingDir = cwd || projectPath || process.cwd();

  console.log('Spawning OpenCode CLI:', opencodePath, args.join(' '));
  console.log('Working directory:', workingDir);

  let spawnCmd = opencodePath;
  let spawnArgs = args;

  // On non-Windows platforms, wrap in shell
  if (os.platform() !== 'win32') {
    spawnCmd = 'sh';
    spawnArgs = ['-c', 'exec "$0" "$@"', opencodePath, ...args];
  }

  return new Promise((resolve, reject) => {
    const opencodeProcess = spawnFunction(spawnCmd, spawnArgs, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let sessionCreatedSent = false;
    let assistantContent = '';

    // Store process reference
    const processKey = capturedSessionId || Date.now().toString();
    activeOpencodeProcesses.set(processKey, opencodeProcess);
    opencodeProcess.sessionId = processKey;

    // Close stdin after starting
    opencodeProcess.stdin.end();

    // Handle stdout - OpenCode outputs JSON for session info
    opencodeProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();

      if (!output) return;

      // Try to parse as JSON (OpenCode may output JSON for session info)
      try {
        const parsed = JSON.parse(output);

        // Handle different message types from OpenCode
        if (parsed.type === 'session' || parsed.session) {
          // Session created/attached
          const newSessionId = parsed.session?.id || parsed.id || capturedSessionId;
          if (newSessionId && !sessionCreatedSent) {
            capturedSessionId = newSessionId;
            sessionCreatedSent = true;

            // Create session in manager if new
            if (!sessionId) {
              sessionManager.createSession(newSessionId, workingDir);
            }

            ws.setSessionId && typeof ws.setSessionId === 'function' && ws.setSessionId(newSessionId);
            ws.send(createNormalizedMessage({
              kind: 'session_created',
              newSessionId,
              sessionId: newSessionId,
              provider: 'opencode',
            }));
          }
        }

        // Handle tool calls
        if (parsed.type === 'tool' || parsed.tool) {
          ws.send(createNormalizedMessage({
            kind: 'tool_use',
            toolName: parsed.tool || parsed.toolName || 'unknown',
            toolInput: parsed.input || parsed.parameters || {},
            toolId: parsed.callId || parsed.id || generateMessageId('opencode_tool'),
            sessionId: capturedSessionId,
            provider: 'opencode',
          }));
        }

        // Handle text content
        if (parsed.type === 'content' || parsed.content) {
          const text = parsed.content.text || parsed.text || '';
          if (text) {
            assistantContent += text;
            ws.send(createNormalizedMessage({
              kind: 'stream_delta',
              content: text,
              sessionId: capturedSessionId,
              provider: 'opencode',
            }));
          }
        }

        // Handle error
        if (parsed.type === 'error' || parsed.error) {
          ws.send(createNormalizedMessage({
            kind: 'error',
            content: parsed.error || parsed.message || 'Unknown error',
            sessionId: capturedSessionId,
            provider: 'opencode',
          }));
        }

        // Handle completion
        if (parsed.type === 'done' || parsed.done || parsed.complete) {
          ws.send(createNormalizedMessage({
            kind: 'complete',
            sessionId: capturedSessionId,
            provider: 'opencode',
          }));
        }
      } catch {
        // Not JSON - treat as text output
        if (output) {
          assistantContent += output;
          ws.send(createNormalizedMessage({
            kind: 'stream_delta',
            content: output,
            sessionId: capturedSessionId,
            provider: 'opencode',
          }));
        }
      }
    });

    // Handle stderr
    opencodeProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString().trim();
      if (!errorMsg) return;

      // Filter common non-error messages
      if (errorMsg.includes('DeprecationWarning') || errorMsg.includes('[DEP')) {
        return;
      }

      ws.send(createNormalizedMessage({
        kind: 'error',
        content: errorMsg,
        sessionId: capturedSessionId,
        provider: 'opencode',
      }));
    });

    // Handle process completion
    opencodeProcess.on('close', async (code) => {
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeOpencodeProcesses.delete(finalSessionId);

      // Send stream end if we had content
      if (assistantContent) {
        ws.send(createNormalizedMessage({
          kind: 'stream_end',
          sessionId: finalSessionId,
          provider: 'opencode',
        }));
      }

      // Send completion
      ws.send(createNormalizedMessage({
        kind: 'complete',
        exitCode: code,
        isNewSession: !sessionId && !!command,
        sessionId: finalSessionId,
        provider: 'opencode',
      }));

      if (code === 0) {
        resolve();
      } else {
        // Check if OpenCode is installed
        const installed = getStatusChecker('opencode')?.checkInstalled() ?? true;
        if (!installed) {
          ws.send(createNormalizedMessage({
            kind: 'error',
            content: 'OpenCode CLI is not installed. Please install it first.',
            sessionId: finalSessionId,
            provider: 'opencode',
          }));
        }
        reject(new Error(`OpenCode CLI exited with code ${code}`));
      }
    });

    // Handle process errors
    opencodeProcess.on('error', (error) => {
      const finalSessionId = capturedSessionId || sessionId || processKey;
      activeOpencodeProcesses.delete(finalSessionId);

      const installed = getStatusChecker('opencode')?.checkInstalled() ?? true;
      const errorContent = !installed
        ? 'OpenCode CLI is not installed. Please install it first.'
        : error.message;

      ws.send(createNormalizedMessage({
        kind: 'error',
        content: errorContent,
        sessionId: finalSessionId,
        provider: 'opencode',
      }));

      reject(error);
    });
  });
}

/**
 * Abort an OpenCode session
 * @param {string} sessionId
 */
function abortOpencodeSession(sessionId) {
  let opencodeProc = activeOpencodeProcesses.get(sessionId);

  if (!opencodeProc) {
    for (const [key, proc] of activeOpencodeProcesses.entries()) {
      if (proc.sessionId === sessionId) {
        opencodeProc = proc;
        break;
      }
    }
  }

  if (opencodeProc) {
    try {
      opencodeProc.kill('SIGTERM');
      setTimeout(() => {
        if (activeOpencodeProcesses.has(sessionId)) {
          try {
            opencodeProc.kill('SIGKILL');
          } catch (e) { }
        }
      }, 2000);
      return true;
    } catch (error) {
      return false;
    }
  }
  return false;
}

/**
 * Check if an OpenCode session is active
 * @param {string} sessionId
 */
function isOpencodeSessionActive(sessionId) {
  return activeOpencodeProcesses.has(sessionId);
}

/**
 * Get all active OpenCode sessions
 */
function getActiveOpencodeSessions() {
  return Array.from(activeOpencodeProcesses.keys());
}

function generateMessageId(prefix = 'msg') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export {
  spawnOpencode,
  abortOpencodeSession,
  isOpencodeSessionActive,
  getActiveOpencodeSessions,
};
