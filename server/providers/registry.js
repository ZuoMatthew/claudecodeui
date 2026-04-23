/**
 * Compatibility registry for legacy OpenCode CLI integration.
 *
 * The newer provider system now lives under `server/modules/providers/*`, but
 * `server/opencode-cli.js` still relies on this legacy registry for a status
 * check. Keep this shim small so the GUI can start without pulling back the
 * deleted adapter modules from the old architecture.
 */

import { opencodeAdapter } from './opencode/adapter.js';
import * as opencodeStatus from './opencode/status.js';

const providers = new Map([
  ['opencode', opencodeAdapter],
]);

const statusCheckers = new Map([
  ['opencode', opencodeStatus],
]);

export function getProvider(name) {
  return providers.get(name);
}

export function getStatusChecker(name) {
  return statusCheckers.get(name);
}

export function getAllProviders() {
  return Array.from(providers.keys());
}
