/**
 * OpenCode Provider Status
 *
 * Checks whether OpenCode CLI is installed and whether the user
 * has valid authentication credentials.
 *
 * @module providers/opencode/status
 */

import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Check if OpenCode CLI is installed.
 * Uses OPENCODE_PATH env var if set, otherwise looks for 'opencode' in PATH.
 * @returns {boolean}
 */
export function checkInstalled() {
  const cliPath = process.env.OPENCODE_PATH || 'opencode';
  try {
    execFileSync(cliPath, ['--version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Full status check: installation + authentication.
 * @returns {Promise<import('../types.js').ProviderStatus>}
 */
export async function checkStatus() {
  const installed = checkInstalled();

  if (!installed) {
    return {
      installed,
      authenticated: false,
      email: null,
      error: 'OpenCode CLI is not installed',
    };
  }

  const result = await checkCredentials();

  return {
    installed,
    authenticated: result.authenticated,
    email: result.email || null,
    error: result.error || null,
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────────

async function checkCredentials() {
  // OpenCode stores credentials in ~/.local/share/opencode/auth.json
  const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');

  try {
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);

    // Check if there's any valid provider credentials
    if (auth && typeof auth === 'object') {
      const providers = Object.keys(auth);
      if (providers.length > 0) {
        // Get first provider with credentials as email placeholder
        const firstProvider = providers[0];
        return {
          authenticated: true,
          email: `OpenCode (${firstProvider})`,
        };
      }
    }

    return { authenticated: false, email: null, error: 'No credentials found in auth.json' };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { authenticated: false, email: null, error: 'OpenCode not configured - run opencode providers login' };
    }
    return { authenticated: false, email: null, error: `Failed to read auth.json: ${err.message}` };
  }
}
