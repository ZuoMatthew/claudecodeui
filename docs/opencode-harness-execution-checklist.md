# OpenCode Harness Execution Checklist

## Global Gates
- [ ] Layer 1 normalization fixtures green
- [ ] Layer 2 API contract tests green
- [ ] Layer 3 session-store merge tests green
- [ ] Layer 4 UI mapping/render tests green
- [ ] Layer 5 Playwright live parity green (3 consecutive)
- [ ] Layer 6 streaming response harness green
- [ ] No regressions for Claude/Codex/Cursor/Gemini smoke tests

## Agent A: Backend Harness + Adapter
### Files
- `server/providers/opencode/adapter.js`
- `server/providers/opencode/acp-adapter.js`

### Tasks
- [ ] Define fixture schema for OpenCode part timelines
- [ ] Add fixtures: reasoning-only, reasoning+tool, multi-turn refresh-mid-session
- [ ] Enforce deterministic ordering and stable IDs
- [ ] Implement mode-aware normalization (`native_opencode`, `compact`)

### Acceptance
- [ ] Fixture replay exactly matches expected transcript
- [ ] No random IDs for persisted parts

## Agent B: API Contract Harness
### Files
- `server/routes/messages.js`
- `server/providers/types.js`

### Tasks
- [ ] Validate response shape includes needed OpenCode metadata
- [ ] Add parity tests: adapter output == API output for fixtures
- [ ] Ensure non-OpenCode providers unchanged

### Acceptance
- [ ] Stable repeated fetch for same fixture
- [ ] No dropped reasoning/tool lifecycle entries in `native_opencode`

## Agent C: Session Store Merge Harness
### Files
- `src/stores/useSessionStore.ts`

### Tasks
- [ ] Tests for refresh during stream and after completion
- [ ] Tests for dedupe with stable IDs
- [ ] Tests to prevent “last response only” collapse

### Acceptance
- [ ] Before/after refresh transcript signature matches (except transient stream marker)
- [ ] No duplicate parts

## Agent D: UI + Playwright
### Files
- `src/components/chat/hooks/useChatMessages.ts`
- `src/components/chat/view/subcomponents/MessageComponent.tsx`
- Playwright scripts

### Tasks
- [ ] Native timeline mapping for reasoning/step/tool/text
- [ ] Collapsible reasoning blocks
- [ ] Compact fallback mode
- [ ] Canonical Playwright parity script
- [ ] Streaming behavior e2e script:
  - [ ] progressive chunk render observed before stream completion
  - [ ] `stream_end` converts transient stream message to stable assistant message
  - [ ] refresh during stream preserves already received content
  - [ ] interruption/retry path yields clear final state (response or error)
- [ ] Add stream timeout/no-chunk fallback test (no silent hang)

### Acceptance
- [ ] UI sequence tests pass
- [ ] Playwright parity passes 3x
- [ ] Session visible in left tree before/after refresh
- [ ] Streaming response tests pass 3x with deterministic assertions

## Integration Order
1. [ ] Merge Agent A
2. [ ] Merge Agent B
3. [ ] Merge Agent C
4. [ ] Merge Agent D
5. [ ] Run full test matrix + Playwright parity + streaming harness
6. [ ] Final QA in `test_oc`
