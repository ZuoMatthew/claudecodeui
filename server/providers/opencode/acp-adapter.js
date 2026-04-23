/**
 * OpenCode ACP (Agent Client Protocol) Adapter
 *
 * Uses @opencode-ai/sdk to communicate with OpenCode ACP server
 * for proper session management.
 *
 * Flow:
 * 1. createOpencodeServer() starts 'opencode serve' process
 * 2. createOpencodeClient() connects to the server via HTTP
 * 3. Session operations via client.session.* methods
 *
 * Auth: CloudCLI always starts its own OpenCode server instance
 * with a known password, so auth is guaranteed to work.
 * We never reuse an existing server on the default port
 * because we can't know its credentials.
 */

import { createOpencode, createOpencodeServer, createOpencodeClient } from '@opencode-ai/sdk';
import net from 'net';
import { spawn } from 'cross-spawn';
import fs from 'fs';
import path from 'path';

// ─── State Management with Proper Locking ─────────────────────────────────────

let opencodeInstance = null;
let serverUrl = null;
let initPromise = null; // Prevents concurrent initialization

// Circuit breaker state
let lastError = null;
let lastErrorTime = 0;
const ERROR_COOLDOWN_MS = 30000; // Don't retry for 30 seconds after failure

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_OPENCODE_PASSWORD = 'cloudcli-opencode';
const DEFAULT_OPENCODE_USERNAME = 'opencode';
const CLOUDCLI_OPENCODE_PORT = 4097; // Use a different port from the default 4096

// ALWAYS force-override auth env vars for our own server instance.
// This is critical: other plugins (e.g. oh-my-openagent) may set
// OPENCODE_SERVER_PASSWORD to a random UUID in process.env before we load.
// Since CloudCLI always starts its OWN server (never reuses an existing one),
// we must ensure both the spawned server and our client use the same password.
process.env.OPENCODE_SERVER_PASSWORD = DEFAULT_OPENCODE_PASSWORD;
process.env.OPENCODE_SERVER_USERNAME = DEFAULT_OPENCODE_USERNAME;

// ─── Auth Helpers ──────────────────────────────────────────────────────────────

/**
 * Get Basic Auth header for OpenCode server
 * Uses env vars (with defaults already set above) so client always authenticates
 * @returns {Object} Headers object with Authorization header
 */
function getAuthHeaders() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  const username = process.env.OPENCODE_SERVER_USERNAME || DEFAULT_OPENCODE_USERNAME;
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  return { Authorization: auth };
}

// ─── Port Detection ────────────────────────────────────────────────────────────

/**
 * Check if a port is already in use by trying to connect
 * Handles authenticated servers that return 401
 * @param {number} port - Port to check
 * @returns {Promise<boolean>}
 */
async function isPortInUse(port) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'GET',
      signal: controller.signal,
    });
    // Any response (including 401 Unauthorized) means something is listening
    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    clearTimeout(timeoutId);
    // If aborted, it means timeout - port might be in use but not responding
    if (error.name === 'AbortError') {
      // Try a second check with a simple socket connection
      return await checkPortWithSocket(port);
    }
    // Connection refused means port is free
    return false;
  }
}

/**
 * Fallback port check using net socket
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function checkPortWithSocket(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 1000;
    
    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(true); // If it times out, something is listening
    });
    
    socket.on('error', () => {
      resolve(false); // Connection refused = port is free
    });
    
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Find an available port starting from the preferred one
 * @param {number} preferredPort - First port to try
 * @returns {Promise<number>} Available port
 */
async function findAvailablePort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 10; port++) {
    const inUse = await isPortInUse(port);
    if (!inUse) {
      return port;
    }
    console.log(`[OpenCode ACP] Port ${port} is in use, trying next...`);
  }
  throw new Error(`No available port found in range ${preferredPort}-${preferredPort + 9}`);
}

// ─── Initialization with Proper Locking ───────────────────────────────────────

/**
 * Initialize OpenCode ACP server and client
 * 
 * Uses proper async locking to prevent concurrent initialization.
 * Implements circuit breaker to prevent retry storms.
 * 
 * @returns {Promise<{client: OpencodeClient, server: {url: string, close: Function}}>}
 */
export async function initOpenCode() {
  // Return existing instance if already initialized
  if (opencodeInstance) {
    return opencodeInstance;
  }
  
  // Circuit breaker: if we failed recently, don't retry
  if (lastError && Date.now() - lastErrorTime < ERROR_COOLDOWN_MS) {
    throw new Error(`OpenCode ACP initialization failed recently. Waiting ${Math.ceil((ERROR_COOLDOWN_MS - (Date.now() - lastErrorTime)) / 1000)}s before retry. Last error: ${lastError.message}`);
  }
  
  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise;
  }
  
  // Start initialization and store promise
  initPromise = doInit();
  
  try {
    const result = await initPromise;
    resetAcpFailureCount(); // Success, reset failure count
    return result;
  } catch (error) {
    // Record error for circuit breaker
    lastError = error;
    lastErrorTime = Date.now();
    recordAcpFailure(); // Track ACP failures for graceful degradation
    throw error;
  } finally {
    // Clear promise so future calls can retry
    initPromise = null;
  }
}

/**
 * Internal initialization logic
 * @returns {Promise<{client: OpencodeClient, server: {url: string, close: Function}}>}
 */
async function doInit() {
  // Find an available port (4097 by default, avoiding conflict with user's 4096)
  const port = await findAvailablePort(CLOUDCLI_OPENCODE_PORT);
  console.log(`[OpenCode ACP] Starting CloudCLI's own server on port ${port}`);
  console.log(`[OpenCode ACP] Auth password: ${process.env.OPENCODE_SERVER_PASSWORD}`);

  let server;
  try {
    // Create server with proper config structure
    // The SDK may expect different parameter formats, so we try multiple approaches
    server = await createOpencodeServer({
      hostname: '127.0.0.1',
      port,
      timeout: 15000,
    });
  } catch (error) {
    console.error('[OpenCode ACP] Failed to create server with SDK:', error.message);
    
    // Try alternative approach: spawn opencode serve directly
    server = await spawnServerManually(port);
  }

  serverUrl = server.url;
  console.log(`[OpenCode ACP] Server started at: ${server.url}`);

  // Create client connected to OUR server with known auth
  const client = createOpencodeClient({
    baseUrl: server.url,
    headers: getAuthHeaders(),
  });

  opencodeInstance = { client, server, url: server.url };
  
  // Clear error state on success
  lastError = null;
  lastErrorTime = 0;

  return opencodeInstance;
}

/**
 * Fallback: spawn opencode serve manually if SDK fails
 * Handles Windows where opencode is a .ps1 script
 * @param {number} port
 * @returns {Promise<{url: string, close: Function}>}
 */
async function spawnServerManually(port) {
  return new Promise((resolve, reject) => {
    // On Windows, opencode is installed as a .ps1 script
    // We need to find and run the actual JS file
    let cmd, args;
    
    if (process.platform === 'win32') {
      // Try to find opencode in npm global or user's AppData
      const opencodePath = findOpencodeBinary();
      if (opencodePath) {
        cmd = process.execPath; // Use current node executable
        args = [opencodePath, 'serve', '--hostname', '127.0.0.1', '--port', String(port)];
      } else {
        // Fallback to npx
        cmd = 'npx';
        args = ['opencode-ai', 'serve', '--hostname', '127.0.0.1', '--port', String(port)];
      }
    } else {
      cmd = 'opencode';
      args = ['serve', '--hostname', '127.0.0.1', '--port', String(port)];
    }
    
    console.log(`[OpenCode ACP] Spawning: ${cmd} ${args.join(' ')}`);
    
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENCODE_SERVER_PASSWORD: DEFAULT_OPENCODE_PASSWORD,
        OPENCODE_SERVER_USERNAME: DEFAULT_OPENCODE_USERNAME,
      },
    });
    
    let output = '';
    let resolved = false;
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      // SDK looks for "opencode server listening on <url>"
      const match = output.match(/opencode server listening on (https?:\/\/[^\s\n]+)/);
      if (!resolved && match) {
        resolved = true;
        resolve({
          url: match[1],
          close: () => proc.kill(),
        });
      }
      // Also check for simpler patterns
      if (!resolved && (output.includes('Server running') || output.includes(`listening on`) || output.includes(`:${port}`))) {
        resolved = true;
        resolve({
          url: `http://127.0.0.1:${port}`,
          close: () => proc.kill(),
        });
      }
    });
    
    proc.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('error', (err) => {
      console.error(`[OpenCode ACP] Spawn error:`, err.message);
      if (!resolved) {
        reject(new Error(`Failed to spawn OpenCode server: ${err.message}`));
      }
    });
    
    proc.on('exit', (code) => {
      if (!resolved) {
        reject(new Error(`OpenCode server exited with code ${code}. Output: ${output.slice(0, 500)}`));
      }
    });
    
    // Timeout after 15 seconds
    setTimeout(() => {
      if (!resolved) {
        proc.kill();
        reject(new Error('OpenCode server startup timeout'));
      }
    }, 15000);
  });
}

/**
 * Find the opencode binary path on Windows
 * @returns {string|null}
 */
function findOpencodeBinary() {
  // Check common locations
  const locations = [
    // npm global
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode'),
    // User's node_modules
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode', 'bin', 'opencode'),
  ];
  
  for (const loc of locations) {
    try {
      if (fs.existsSync(loc)) {
        return loc;
      }
    } catch (e) {
      // Ignore
    }
  }
  
  return null;
}

// ─── Client Access ─────────────────────────────────────────────────────────────

/**
 * Get the initialized client
 * @returns {Promise<OpencodeClient>}
 */
export async function getClient() {
  if (!opencodeInstance) {
    await initOpenCode();
  }
  return opencodeInstance.client;
}

// ─── Session Operations ────────────────────────────────────────────────────────

/**
 * List OpenCode sessions, optionally filtered by directory/project
 * Uses client.session.list() which filters by directory
 * @param {string} directory - Optional project directory to filter sessions
 * @returns {Promise<Array>} List of sessions
 */
export async function listSessions(directory) {
  try {
    const client = await getClient();
    const params = {};
    if (directory) {
      params.directory = directory;
    }
    const response = await client.session.list(params);
    return response.data || [];
  } catch (error) {
    console.error('[OpenCode ACP] Error listing sessions:', error.message);
    throw error;
  }
}

/**
 * Resolve OpenCode model override.
 * Returns undefined to let OpenCode use provider defaults.
 * @param {string|undefined} model
 * @returns {{providerID: string, modelID: string}|undefined}
 */
function resolveModelOverride(model) {
  if (!model || typeof model !== 'string') {
    return undefined;
  }

  const normalized = model.trim().toLowerCase();
  // UI-level aliases map to provider defaults; do not send invalid model IDs.
  if (!normalized || normalized === 'auto' || normalized === 'claude' || normalized === 'gpt' || normalized === 'gemini') {
    return undefined;
  }

  return {
    providerID: 'anthropic',
    modelID: model,
  };
}

/**
 * Create a new OpenCode session
 * @param {string} title - Session title
 * @returns {Promise<Object>} Created session
 */
export async function createSession(title, options = {}) {
  try {
    const client = await getClient();
    const response = await client.session.create({
      body: { title: title || 'CloudCLI Session' },
      query: {
        directory: options.directory,
      },
    });
    return response.data;
  } catch (error) {
    console.error('[OpenCode ACP] Error creating session:', error.message);
    throw error;
  }
}

/**
 * Get a session by ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Session object
 */
export async function getSession(sessionId) {
  try {
    const client = await getClient();
    const response = await client.session.get({
      path: { id: sessionId },
    });
    return response.data;
  } catch (error) {
    console.error('[OpenCode ACP] Error getting session:', error.message);
    throw error;
  }
}

/**
 * Delete a session
 * @param {string} sessionId - Session ID
 * @returns {Promise<void>}
 */
export async function deleteSession(sessionId) {
  try {
    const client = await getClient();
    await client.session.delete({
      path: { id: sessionId },
    });
  } catch (error) {
    console.error('[OpenCode ACP] Error deleting session:', error.message);
    throw error;
  }
}

/**
 * Send a prompt/message to a session
 * @param {string} sessionId - Session ID
 * @param {string} prompt - The prompt/message to send
 * @param {Object} options - Additional options (model, provider, directory)
 * @returns {Promise<Object>} Response
 */
export async function sendPrompt(sessionId, prompt, options = {}) {
  try {
    const client = await getClient();
    const modelOverride = resolveModelOverride(options.model);
    const body = {
      parts: [{ type: 'text', text: prompt }],
    };
    if (modelOverride) {
      body.model = modelOverride;
    }

    const response = await client.session.prompt({
      path: { id: sessionId },
      body,
      query: {
        directory: options.directory,
      },
    });

    return response.data;
  } catch (error) {
    console.error('[OpenCode ACP] Error sending prompt:', error.message);
    throw error;
  }
}

/**
 * Get messages for a session
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} List of messages
 */
export async function getSessionMessages(sessionId) {
  try {
    const client = await getClient();
    const response = await client.session.messages({
      path: { id: sessionId },
    });
    return response.data || [];
  } catch (error) {
    console.error('[OpenCode ACP] Error getting session messages:', error.message);
    throw error;
  }
}

/**
 * Fetch session history for the adapter interface
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} Normalized messages
 */
export async function fetchHistory(sessionId) {
  const messages = await getSessionMessages(sessionId);
  return messages.map(normalizeMessage);
}

/**
 * Normalize OpenCode message to CloudCLI format
 * @param {Object} msg - OpenCode message
 * @returns {Object} Normalized message
 */
export function normalizeMessage(msg) {
  return {
    kind: 'text',
    content: msg.content || msg.parts?.[0]?.text || '',
    role: msg.role || 'assistant',
    sessionId: msg.sessionId,
    provider: 'opencode',
  };
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Close the OpenCode server connection
 */
export async function closeOpenCode() {
  if (opencodeInstance) {
    if (opencodeInstance.server) {
      try {
        opencodeInstance.server.close();
      } catch (error) {
        console.error('[OpenCode ACP] Error closing server:', error.message);
      }
    }
    opencodeInstance = null;
    serverUrl = null;
    initPromise = null;
  }
}

/**
 * Get the server URL
 * @returns {string|null}
 */
export function getServerUrl() {
  return serverUrl;
}

/**
 * Check if OpenCode is initialized
 * @returns {boolean}
 */
export function isInitialized() {
  return opencodeInstance !== null;
}

/**
 * Get initialization status for debugging
 * @returns {Object}
 */
export function getStatus() {
  return {
    initialized: opencodeInstance !== null,
    serverUrl,
    hasLastError: lastError !== null,
    lastErrorTime: lastErrorTime > 0 ? new Date(lastErrorTime).toISOString() : null,
    lastErrorMessage: lastError?.message || null,
    initInProgress: initPromise !== null,
    mode: getMode(),
  };
}

// ─── Graceful Degradation to CLI Mode ─────────────────────────────────────────

let fallbackToCli = false;
const MAX_ACP_FAILURES = 3;
let acpFailureCount = 0;

/**
 * Get the current operation mode
 * @returns {'acp'|'cli'}
 */
export function getMode() {
  return fallbackToCli ? 'cli' : 'acp';
}

/**
 * Check if we should use CLI fallback
 * @returns {boolean}
 */
export function shouldUseCliFallback() {
  return fallbackToCli;
}

/**
 * Record an ACP failure and potentially switch to CLI mode
 */
function recordAcpFailure() {
  acpFailureCount++;
  console.log(`[OpenCode ACP] Failure count: ${acpFailureCount}/${MAX_ACP_FAILURES}`);
  
  if (acpFailureCount >= MAX_ACP_FAILURES && !fallbackToCli) {
    fallbackToCli = true;
    console.warn('[OpenCode ACP] Switching to CLI fallback mode after repeated failures');
  }
}

/**
 * Reset ACP failure count (call on successful ACP operation)
 */
function resetAcpFailureCount() {
  acpFailureCount = 0;
}

/**
 * Force switch to CLI mode
 */
export function forceCliMode() {
  fallbackToCli = true;
  console.log('[OpenCode ACP] Forced switch to CLI mode');
}

/**
 * Reset to ACP mode (try ACP again)
 */
export function resetToAcpMode() {
  fallbackToCli = false;
  acpFailureCount = 0;
  lastError = null;
  lastErrorTime = 0;
  console.log('[OpenCode ACP] Reset to ACP mode');
}

/**
 * Try to perform an operation with ACP, falling back to CLI on failure
 * @param {Function} acpOperation - The ACP operation to try
 * @param {Function} cliOperation - The CLI fallback operation
 * @returns {Promise<any>}
 */
export async function withFallback(acpOperation, cliOperation) {
  // If already in CLI mode, use CLI directly
  if (fallbackToCli) {
    console.log('[OpenCode ACP] Using CLI fallback mode');
    return cliOperation();
  }
  
  try {
    const result = await acpOperation();
    resetAcpFailureCount(); // Success, reset failure count
    return result;
  } catch (error) {
    console.error('[OpenCode ACP] Operation failed:', error.message);
    recordAcpFailure();
    
    // If we switched to CLI mode, try CLI operation
    if (fallbackToCli) {
      console.log('[OpenCode ACP] Falling back to CLI for this operation');
      return cliOperation();
    }
    
    throw error;
  }
}
