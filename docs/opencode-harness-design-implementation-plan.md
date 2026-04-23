# OpenCode Native Reasoning UI

## Design And Implementation Plan (Harness-First)

### Goal
Render OpenCode conversations in the main chat pane with native-like structure (reasoning timeline + tools + final answer), and keep the same structure after refresh. Avoid regressions where only the last response is represented.

### Scope
- Provider: `opencode`
- Surfaces: session history API, session store merge, chat rendering, sidebar session persistence/visibility
- Non-goals: redesign Claude/Codex message UX

## Guiding Principles
1. Harness-first: define contracts and tests before broad feature expansion.
2. Deterministic replay: refresh output must match live-stream structure.
3. Stable identity: each normalized part must carry stable IDs for dedupe.
4. Provider isolation: OpenCode-specific behavior must not regress Claude/Codex.

## Harness Engineering Plan

### Layer 1: Normalization Contract Harness (Backend)
- Define canonical OpenCode part ordering:
  - `step-start` -> `reasoning` -> `tool`/`tool_result` -> `step-finish` -> `text`
- Add fixture-driven tests for `server/providers/opencode/adapter.js`:
  - role correctness
  - stable part IDs
  - deterministic order
  - mode behavior (`native_opencode` vs `compact`)

### Layer 2: Unified API Contract Harness
- Add tests for `server/routes/messages.js`:
  - ordering and count
  - mode policy behavior
  - parity with adapter fixtures

### Layer 3: Session Store Merge Harness
- Add tests for `src/stores/useSessionStore.ts`:
  - refresh during stream
  - refresh after complete
  - no duplicate parts
  - no stale-only-last-response collapse

### Layer 4: UI Mapping + Rendering Harness
- Tests for `src/components/chat/hooks/useChatMessages.ts`
- Tests for `src/components/chat/view/subcomponents/MessageComponent.tsx`
- Validate native ordering and collapsible reasoning behavior

### Layer 5: Live Browser Parity Harness (Playwright)
- Canonical e2e:
  1. create OpenCode session
  2. send prompt producing reasoning/tool/final text
  3. capture structure signature
  4. refresh
  5. compare signatures and check left-tree visibility

### Layer 6: Streaming Response Harness
- Validate active-stream behavior end-to-end:
  - progressive chunk rendering while response is in-flight
  - `stream_delta` ordering and append semantics
  - `stream_end` finalization into stable assistant message
- Validate resilience behaviors:
  - stream interruption + resume/retry
  - no-chunk timeout fallback (user still gets clear completion/error state)
  - refresh during in-flight stream does not lose already received chunks
- Validate provider isolation:
  - OpenCode streaming changes do not regress Claude/Codex streaming paths

## Implementation Workstreams
- Workstream A: Adapter + mode policy
- Workstream B: API shape + metadata
- Workstream C: Store merge semantics
- Workstream D: Chat rendering
- Workstream E: Sidebar/session visibility hardening

## Definition Of Done
- All harness layers pass.
- OpenCode reasoning timeline renders in native mode.
- Refresh preserves structure and layout parity.
- Session appears in left tree before and after refresh.
- Streaming responses render progressively and finalize correctly.
- No regressions in Claude/Codex behavior.
