# AGENTS.md

Guidance for future agents working in this repo.

## Source Of Truth
1. `docs/opencode-harness-design-implementation-plan.md`
2. `docs/opencode-harness-execution-checklist.md`

## Mission
Implement and stabilize OpenCode native-like reasoning/timeline rendering with refresh parity.

## Mandatory Workflow
1. Normalization harness
2. API contract harness
3. Store merge harness
4. UI render harness
5. Live Playwright parity
6. Streaming response harness

Do not skip lower-layer harness checks.

## Ownership Split
- Agent A: `server/providers/opencode/*`
- Agent B: `server/routes/messages.js`, provider types
- Agent C: `src/stores/useSessionStore.ts`
- Agent D: UI mapping/render + Playwright

## Quality Gates
- Normalization fixtures pass
- API parity tests pass
- Store merge tests pass
- UI render tests pass
- Playwright parity passes 3 consecutive runs
- Streaming harness passes 3 consecutive runs
- No regressions for Claude/Codex/Cursor/Gemini

## Live Browser Validation
Required scenario:
1. Create OpenCode session
2. Send prompt producing reasoning/tool/final text
3. Capture visible structure
4. Refresh
5. Re-check structure parity and left-tree visibility

Required streaming scenario:
1. Send prompt that produces multiple stream chunks
2. Assert progressive render before completion
3. Assert `stream_end` finalizes transient stream into stable assistant message
4. Refresh during in-flight stream and verify received chunks are preserved
5. Validate interruption/retry and no-chunk-timeout fallback (no silent hang)

## Handoff Template
Include:
1. Files changed
2. Tests run/results
3. Risks remaining
4. Next agent task + acceptance criteria
