/**
 * OpenCode Sessions API Routes
 *
 * Provides REST API endpoints for OpenCode session management.
 * These routes use the ACP adapter which communicates with the OpenCode ACP server.
 */

import express from 'express';
import {
  listSessions,
  createSession,
  deleteSession,
  getSession,
  getSessionMessages,
  initOpenCode,
  isInitialized,
  getStatus,
  closeOpenCode,
  getMode,
  shouldUseCliFallback,
  forceCliMode,
  resetToAcpMode,
} from '../providers/opencode/acp-adapter.js';

const router = express.Router();

/**
 * GET /api/opencode/status
 * Check if OpenCode ACP server is running
 * Returns detailed status for debugging
 */
router.get('/status', async (req, res) => {
  try {
    const status = getStatus();
    
    // If not initialized, try to initialize
    if (!status.initialized) {
      await initOpenCode();
    }
    
    res.json({
      status: 'running',
      ...getStatus(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      ...getStatus(),
    });
  }
});

/**
 * GET /api/opencode/health
 * Quick health check without triggering initialization
 */
router.get('/health', (req, res) => {
  const status = getStatus();
  res.json({
    initialized: status.initialized,
    serverUrl: status.serverUrl,
    initInProgress: status.initInProgress,
    hasError: status.hasLastError,
  });
});

/**
 * POST /api/opencode/restart
 * Force restart the OpenCode server
 */
router.post('/restart', async (req, res) => {
  try {
    await closeOpenCode();
    await initOpenCode();
    res.json({ status: 'restarted', ...getStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message, ...getStatus() });
  }
});

/**
 * POST /api/opencode/mode/cli
 * Force switch to CLI fallback mode
 */
router.post('/mode/cli', (req, res) => {
  forceCliMode();
  res.json({ status: 'ok', mode: 'cli', ...getStatus() });
});

/**
 * POST /api/opencode/mode/acp
 * Reset to ACP mode (try ACP again)
 */
router.post('/mode/acp', async (req, res) => {
  try {
    resetToAcpMode();
    await closeOpenCode();
    await initOpenCode();
    res.json({ status: 'ok', mode: 'acp', ...getStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message, ...getStatus() });
  }
});

/**
 * GET /api/opencode/mode
 * Get current operation mode
 */
router.get('/mode', (req, res) => {
  res.json({
    mode: getMode(),
    usingCliFallback: shouldUseCliFallback(),
    ...getStatus(),
  });
});

/**
 * GET /api/opencode/sessions
 * List all OpenCode sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await listSessions();
    res.json(sessions);
  } catch (error) {
    console.error('Error listing OpenCode sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/opencode/sessions
 * Create a new OpenCode session
 */
router.post('/sessions', async (req, res) => {
  try {
    const { title } = req.body;
    const session = await createSession(title || 'CloudCLI Session');
    res.json(session);
  } catch (error) {
    console.error('Error creating OpenCode session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/opencode/sessions/:id
 * Get a specific session
 */
router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    res.json(session);
  } catch (error) {
    console.error('Error getting OpenCode session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/opencode/sessions/:id
 * Delete a session
 */
router.delete('/sessions/:id', async (req, res) => {
  try {
    await deleteSession(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting OpenCode session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/opencode/sessions/:id/messages
 * Get messages for a session
 */
router.get('/sessions/:id/messages', async (req, res) => {
  try {
    const messages = await getSessionMessages(req.params.id);
    res.json(messages);
  } catch (error) {
    console.error('Error getting OpenCode session messages:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
