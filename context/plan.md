# FORGE — Product Plan and Implementation Roadmap

> **Frontend location:** the frontend lives in this repository at `/Users/aryansingh/Documents/QuantForge_IITB/` in the `client-end/` workspace (see [architecture.md ADR-009](architecture.md#i-architectural-decision-records)).
> **Role of this file:** defines the *sequence* of implementation. The system design is in [architecture.md](architecture.md); implementation reality is in [progress_tracker.md](progress_tracker.md); UI rules in [Ui-regitry.md](Ui-regitry.md); AI-contributor rules in [Agents.md](Agents.md).
> **Competition source of truth:** `TrueFoundry_Forge-a-thon_compressed_UvvRJ9C (2).pdf` (repository root). Round 1 submission deadline: **20 November 2026, 23:59 IST** — the same date as this audit. Round 2 (finals at Techfest IIT Bombay): 16–18 December 2026.
> **Baseline (audited 2026-11-20):** the repository contains only a `create-next-app` scaffold in `client-end/` and placeholder README. No extension, no TrueForge integration, no tests. Everything below is PLANNED.

---

## A. Product Objectives

**Vision.** FORGE is an editor-native autonomous engineering agent for VS Code that understands a whole repository, plans, edits many files, verifies, and hands every change to the developer for review — "Think. Understand. Engineer. Verify."

**Target users.** (1) Professional developers working in repositories too large to paste into a prompt; (2) maintainers doing cross-cutting changes (CLI command + tests + docs); (3) teams that want model choice and local control (models and keys live in TrueForge).

**Main use cases.**
1. *Inline edit:* select a function, describe a change, review a diff in place.
2. *Autonomous task:* describe an outcome ("add a `config` CLI command, tested and documented") without naming files; review multi-file diff.
3. *Context-aware Q&A and exploration:* see why files were selected.
4. *Resilient operation:* a failing model/endpoint degrades gracefully without touching the workspace.

**Value proposition.** Repository-aware context with visible reasoning, agent autonomy with human-owned writes, model independence via TrueForge, local-first.

**Competition objectives (TrueFoundry Forge-a-thon, Techfest IIT Bombay 2026–27).** Deliver the five mandatory capabilities, satisfy every TrueForge eligibility rule, and pass the three fixed Flask 3.1.3 tasks (§G) with a recorded demonstration showing TrueForge sessions, turns, and tool calls.

**Scoring map (100 points, from the problem statement).** Judges award the *anchor that matches what the demo shows*; between anchors the lower applies.

| Criterion | Pts | Top anchor (what must be on screen) | Delivered by | Phase |
|---|---|---|---|---|
| A1 Inline edit | 10 | Diff rendered with per-hunk accept and reject | `forge.inlineEdit`, CodeLens + decorations | 4, 5 |
| A2 Agent mode | 10 | Discovers and edits ≥3 files unprompted (Task B) | `forge-agent`, MCP tools, Shadow Workspace | 6 |
| A3 Streaming + cancellation | 10 | Cancellation immediate, workspace consistent | Streaming pipeline, `sessions.cancel`, atomic Review Gate | 8 |
| B1 Context assembly | 15 | Retrieval with a size budget, strategy stated, and *visibly at work in Task B* (which files and why) | Context Engine, `get_context`, Context Inspector | 7 |
| B2 Diff safety | 10 | Per-hunk review and a working undo shown on screen | Diff Engine, undo journal | 5 |
| B3 Resilience (Task C) | 10 | Automatic fallback to a second configured model, no user action, workspace unchanged | Resilience Manager (needs ≥2 models configured) | 9 |
| B4 TrueForge depth | 10 | MCP tools + TrueForge tool approval driving diff review + ≥1 context-engineering feature explained and visible in the session | `submit_changes` Review Gate (ADR-014); subagents/deferred loading/compaction (ADR-015) | 3, 6, 7 |
| C1 Video (≤ 4 min) | 10 | Tasks A, B, C in order, each verified on screen; TrueForge session shown during B; no cuts between instruction and diff | `eval/` + `docs/demo.md` | 11 |
| C2 Write-up (1–3 page PDF, 8 fixed headings) | 15 | Architecture, context strategy, model setup, trade-offs, accurate scorecard with timestamps, honest limitations | `docs/writeup/` (FORGE-070) | 11–12 |

**Mandatory submission artefacts (all public before the deadline; non-public links are not scored):** demo video; write-up PDF with the eight headings in the statement's order (Team · Starting point · Architecture on TrueForge · How context is selected · Model setup · Scorecard · Tools used · Known limitations); public GitHub repository whose README has setup that works from a clean clone, how to start TrueForge locally and load the agent definition, the declared fork point, and an example model configuration file. **Eligibility gate (pass/fail):** agent loop on TrueForge; extension is a TrueForge client; editor capabilities exposed as MCP tools; TrueForge local mode; models configured in TrueForge (no direct provider calls); demo shows the Task B session (turns and tool calls); agent definition in the repo. A visible **open-source licence** is required (rule 7). **Judge call:** shortlisted teams repeat Task A live with an organiser-chosen model — FORGE must work with any TrueForge-configured model (no model-specific prompts or code paths).

**Long-term goals.** More languages, change-impact preview, project memory, multiple agent roles, team-grade review workflows — all without a mandatory hosted backend.

---

## B. Functional Requirements

Priority key: **P0** competition-critical · **P1** essential product · **P2** differentiators · **P3** future.

| ID | Requirement | Pri | Notes / owner doc |
|---|---|---|---|
| FR-01 | Inline edit: selection + keybinding + natural-language instruction → in-editor diff with accept/reject | P0 | [architecture §C.1](architecture.md#c1-inline-editing) |
| FR-02 | Agent mode: task panel; agent reads, searches, runs commands, edits ≥3 files without user naming files | P0 | §C.2 |
| FR-03 | Context assembly: @file, @symbol, auto retrieval, symbol-level retrieval, ranking, token budget, compression, exclusions, visible reasons | P0 | [§B.5](architecture.md#b5-context-engine) |
| FR-04 | Diff review: file + hunk diffs, per-hunk accept/reject, accept/reject all, undo, summaries, no silent writes | P0 | [§B.6](architecture.md#b6-diff-engine) |
| FR-05 | Streaming of TrueForge events; UI responsive | P0 | |
| FR-06 | Cancellation mid-generation with no partial application | P0 | [§C.6](architecture.md#c6-cancellation) |
| FR-07 | MCP tool layer: 8 required tools + `get_context`, `update_plan` | P0 | [§B.4](architecture.md#b4-mcp-tool-layer) |
| FR-08 | TrueForge sessions/turns via SDK, local mode, in-repo agent definitions | P0 | [§B.3](architecture.md#b3-trueforge-integration) |
| FR-09 | Model resilience: classified errors, retry/backoff, fallback model, clear error, workspace untouched | P0 | [§B.7](architecture.md#b7-model-resilience) |
| FR-10 | Terminal approval policy + shadow verification | P0 | [§F.3](architecture.md#f3-terminal-execution-policy) |
| FR-11 | Context Inspector UI (selected, excluded, reasons, budget meter) | P1 | [Ui-regitry §D.3](Ui-regitry.md) |
| FR-12 | Execution timeline (tools, searches, commands, model events) | P1 | Ui-regitry §D.6 |
| FR-13 | Plan viewer fed by `update_plan` | P1 | |
| FR-14 | Session history and resume after window reload | P1 | |
| FR-15 | Settings UI (keys, budget, excludes, fallbacks, behaviour) | P1 | |
| FR-16 | Persistent symbol index (SQLite FTS5), incremental updates | P2 | Optional; spike S5 |
| FR-17 | Dependency analysis beyond depth 2, test-impact hints | P2 | |
| FR-18 | Impact preview before apply (files/tests likely affected) | P2 | |
| FR-19 | Project memory (TrueForge `memory` and/or notes file) | P2 | |
| FR-20 | Embeddings-based semantic retrieval | P3 | Must route through TrueForge or run locally |
| FR-21 | Additional languages (Go, Rust, Java) | P3 | |
| FR-22 | Multiple agent roles (reviewer, test writer) | P3 | |
| FR-23 | Hosted TrueForge support via tunnel/relay | P3 | |
| FR-24 | Review Gate: approval-gated `submit_changes` drives diff review through TrueForge (ADR-014) | P0 | rubric B4 |
| FR-25 | Use ≥1 TrueForge context-engineering feature (subagents for discovery, deferred tool loading, compaction), visible in the session (ADR-015) | P0 | rubric B1/B4 |
| FR-26 | Submission artefacts: example model config, fork-point declaration, licence, write-up PDF, demo video | P0 | statement |
| FR-27 | Model-agnostic behaviour: works with any TrueForge-configured model, incl. local OpenAI-compatible endpoints | P0 | fairness rule |

---

## C. Non-functional Requirements

All numbers are **targets**, not guarantees; each gets a validation task in Phase 11.

| Area | Requirement (target) |
|---|---|
| Performance | Extension activation < 300 ms; no host task > 50 ms blocking; first streamed token visible < 100 ms after event; `search_workspace` p95 < 1.5 s on 10k files; cancel reflected in UI < 200 ms |
| Reliability | 0 workspace writes without accept (tested); a failed/cancelled run leaves `git status` clean; undo restores byte-identical pre-state; host crash mid-apply recoverable via journal |
| Security | Loopback-only MCP with bearer token; path traversal and symlink escape blocked; terminal default-deny; untrusted-content envelope; Workspace Trust honored; no secrets in repo/logs |
| Privacy | No FORGE telemetry in v1; code leaves machine only via the user's TrueForge model config; documented in README |
| Maintainability | TypeScript `strict`; modules with single responsibility; `context-engine`/`diff-engine` free of `vscode` imports; ≥ 80% line coverage on those two packages (target) |
| Extensibility | Language = grammar + query file; new tool = schema + handler + test; new agent = JSON in `agents/` |
| Accessibility | WCAG 2.1 AA targets in webview: keyboard-complete, visible focus, ARIA live regions for streaming/status, contrast ≥ 4.5:1, reduced-motion respected |
| Testability | Every package unit-testable without VS Code; mock-host harness for UI; fixed-task eval script |
| Resource usage | Extension host overhead < 300 MB on 10k-file repo; no background CPU when idle; no persistent index unless enabled |

---

## D. Development Phases

Dependency order is strict: do not start a phase before its prerequisites meet their acceptance criteria. Status of each phase lives in [progress_tracker.md §D](progress_tracker.md#d-milestone-tracker); milestone ↔ phase mapping: M0=P0–P1 setup, M1=P2, M2=P3, M3=P4, M4=P5, M5=P6, M6=P7, M7=P8, M8=P9, M9=P10–P11 (integration), M10=P11–P12.

### Phase 0 — Repository audit and setup
1. **Objective:** Turn the scaffold into a workspace ready for the extension; resolve every integration unknown before code depends on it.
2. **Technical tasks:** Root npm workspaces; strict `tsconfig.base.json`; ESLint/Prettier; CI skeleton; clean the `client-end` template; run spikes S1–S6; check out Flask 3.1.3 fixture and capture baseline test result.
3. **Files/modules:** `package.json`, `tsconfig.base.json`, `.gitignore`, `.github/workflows/ci.yml`, `docs/spikes.md`, `eval/` skeleton.
4. **Dependencies:** none.
5. **Expected output:** repo builds; spike report with decisions (S1 MCP localhost registration; S2 health endpoint & down-server behavior; S3 inline spec referencing a registered MCP server; S4 error `turn.done` payloads for bad key/unreachable; S5 SQLite binding; S6 shadow workspace on Flask).
6. **Testing:** `npm ci`, `npm run build`, `npm run typecheck` pass in CI; Flask baseline `pytest tests/test_cli.py -q` result recorded.
7. **Acceptance:** all six spikes have a written outcome and a go/no-go; ADR-002 and ADR-004 confirmed or amended.
8. **Risks:** S1 fails (TrueForge rejects loopback MCP URL) → fallback bridge process; S6 fails → post-accept verification.

### Phase 1 — Extension foundation
1. **Objective:** Activatable extension with sidebar webview and a validated message bridge.
2. **Tasks:** `packages/protocol` zod schemas; `packages/extension` activation, commands, `WebviewViewProvider`, CSP; `client-end/webview` esbuild entry with host bridge; design tokens; Welcome screen shell; provider-call lint guard.
3. **Files:** `packages/protocol/src/*`, `packages/extension/src/{extension,webview,commands}.ts`, `client-end/webview/{main.tsx,bridge.ts}`, `client-end/styles/tokens.css`, `client-end/components/ui/*`.
4. **Deps:** Phase 0.
5. **Output:** F5 launches Extension Development Host showing FORGE sidebar with Welcome screen; ping/pong message round-trip.
6. **Testing:** Vitest for schemas; `@vscode/test-electron` smoke (activates, view registered); Playwright against the Next harness for Welcome.
7. **Acceptance:** invalid messages are rejected and logged; no network requests from webview; CSP verified.
8. **Risks:** Next.js config (`cacheComponents`) leaks into shared components; webview asset path issues.

### Phase 2 — TrueForge integration
1. **Objective:** Create sessions and stream turns from the extension via the SDK against local TrueForge.
2. **Tasks:** `trueforge-client` wrapper; `EventNormalizer`; `SessionManager` persistence/resume; agent definition loader; `forge.startTrueForge`; model status; settings for `baseUrl`, `model.primary`, `model.fallbacks`.
3. **Files:** `packages/trueforge-client/src/*`, `agents/forge-agent.json`, `agents/forge-inline-edit.json`, `agents/*.instructions.md`.
4. **Deps:** Phase 1, spikes S2–S4.
5. **Output:** typing a prompt streams a reply; TrueForge Sessions UI shows the session and turn.
6. **Testing:** unit (event normalization with recorded fixtures); integration against real local TrueForge (CI optional, manual required).
7. **Acceptance:** session id persisted and resumed after window reload; no provider hostnames/keys in code.
8. **Risks:** SDK API drift (pin exact version); ESM/CJS bundling.

### Phase 3 — MCP tool implementation
1. **Objective:** Editor MCP Server with all tools reachable by the TrueForge agent.
2. **Tasks:** MCP server (Streamable HTTP, loopback, bearer); `resolveWorkspacePath`; implement `read_file`, `search_workspace`, `get_file_structure`, `find_symbol` (first LSP/regex-based), `get_diagnostics`, `get_git_status`, `propose_edit` (queue stub), `run_terminal` + policy, `update_plan`; register server with TrueForge; abort handling.
3. **Files:** `packages/editor-mcp/src/{server,tools/*,safety/*}.ts`.
4. **Deps:** Phase 2, spike S1.
5. **Output:** the agent, asked "what does `get_debug_flag` do?", calls tools on its own and answers; visible in TrueForge session tool calls.
6. **Testing:** per-tool unit tests (schema, errors, traversal, symlink); MCP protocol tests with the SDK client; end-to-end smoke with TrueForge.
7. **Acceptance:** traversal/symlink/oversize/binary/secret-file cases return structured errors; `run_terminal` denied without approval; no tool writes to disk.
8. **Risks:** TrueForge approval semantics for unlabeled tools (mitigated: list `run_terminal` by name).

### Phase 4 — Inline editing
1. **Objective:** Mandatory capability 2.1 end-to-end; pass Task A.
2. **Tasks:** `forge.inlineEdit` command + keybinding; instruction input; short-lived session with `forge-inline-edit` agent; selection/file context packaging as data block; decorations + CodeLens accept/reject (temporary adapter over the Diff Engine stub).
3. **Files:** `packages/extension/src/inline/*`.
4. **Deps:** Phase 3.
5. **Output:** Task A diff appears in editor; accept applies.
6. **Testing:** extension integration test with a scripted/recorded TrueForge stream; manual Task A on Flask.
7. **Acceptance:** §G Task A passes; no manual copy/paste; selection-aware (edits outside selection only if agent justifies in rationale and user accepts).
8. **Risks:** inline diff surface limitations (ADR-007).

### Phase 5 — Diff review and safe application
1. **Objective:** Mandatory capability 2.4.
2. **Tasks:** `diff-engine` (structured patch, stable hunk ids, review state machine); `submit_changes` Review Gate wired to the approval flow (FORGE-071); 3-way apply via `WorkspaceEdit`; undo journal in extension storage; stale detection; `forge-proposed:` content provider; Diff Review UI; accept all/reject all.
3. **Files:** `packages/diff-engine/src/*`, `packages/extension/src/review/*`, `client-end/components/forge/DiffReview*`.
4. **Deps:** Phase 3 (`propose_edit`), Phase 1 UI base.
5. **Output:** file + hunk review in webview and editor; undo.
6. **Testing:** unit — hunk splitting, 3-way merge, conflict, journal; property tests (apply∘undo = identity); integration — concurrent edit while proposal pending; crash-recovery test.
7. **Acceptance:** zero writes before accept (asserted by filesystem watcher test); undo byte-identical; conflicting hunks never overwrite.
8. **Risks:** merge edge cases (CRLF, trailing newline, encoding).

### Phase 6 — Autonomous multi-file agent
1. **Objective:** Mandatory capability 2.2; pass Task B.
2. **Tasks:** Agent workspace UI (task input, stream, tool activity); approval prompts (terminal and Review Gate) wired to `user.tool_approval`; `submit_changes` tool; agent spec with subagents/deferred loading/compaction; Shadow Workspace; shadow-aware `read_file`; Plan Viewer via `update_plan`; agent instructions tuned for discover→plan→edit→verify.
3. **Files:** `packages/extension/src/{agent,shadow}/*`, `agents/forge-agent.instructions.md`, `client-end/components/forge/{Composer,Timeline,PlanViewer,ApprovalCard}.tsx`.
4. **Deps:** Phases 3, 5; spike S6.
5. **Output:** Task B yields ≥3 modified files, tests pass in shadow, review queue populated.
6. **Testing:** integration with recorded + live runs; shadow tests on Flask.
7. **Acceptance:** §G Task B passes without filenames in the prompt.
8. **Risks:** agent drift; shadow env mismatch; long runs (iteration limit).

### Phase 7 — Context intelligence
1. **Objective:** Mandatory capability 2.3.
2. **Tasks:** mention parser + composer autocomplete; ripgrep wrapper; `web-tree-sitter` Python + TS/JS symbols/imports; import graph; scorer; token budgeter with tier ladder; `get_context` tool; Context Inspector UI; exclusion settings; optional SQLite index (P2); eval harness measuring recall on fixed tasks.
3. **Files:** `packages/context-engine/src/{mentions,search,symbols,graph,score,budget,assemble}.ts`, `client-end/components/forge/ContextInspector*`.
4. **Deps:** Phase 3; can overlap Phase 6 only after `find_symbol` interfaces are stable.
5. **Output:** reasons and budget visible for every retrieved item.
6. **Testing:** golden tests (repo fixture → expected ranked files); budget invariant tests; large-fixture perf test.
7. **Acceptance:** on Flask, Task B retrieval surfaces `src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst` within top-10 for the task text (**target**); assembled tokens ≤ budget in 100% of runs.
8. **Risks:** weights need tuning; WASM grammar packaging. Instructions should make the agent delegate wide discovery to a subagent (ADR-015) and surface chosen files and reasons in the Context Inspector.

### Phase 8 — Streaming and cancellation
1. **Objective:** Mandatory capability 2.5.
2. **Tasks:** delta batching; virtualized timeline; cancel button + Esc; `sessions.cancel` + AbortSignal propagation; late-event guard; reload resume via `subscribeToTurn`.
3. **Files:** `packages/trueforge-client/src/stream.ts`, `packages/extension/src/cancel.ts`, `editor-mcp` abort plumbing.
4. **Deps:** Phases 2, 3, 6.
5. **Output:** cancel mid-run leaves queue intact, nothing written, process killed.
6. **Testing:** cancellation at each state (model streaming, tool executing, awaiting approval, applying); no orphan processes; UI remains responsive under 10k deltas.
7. **Acceptance:** UI cancel < 200 ms; process group dead < 2 s; zero partial applies.
8. **Risks:** TrueForge waits for in-flight MCP calls on cancel (documented) → handlers must abort promptly.

### Phase 9 — Resilience and model fallback
1. **Objective:** Pass Task C; deliver ADR-006.
2. **Tasks:** error classifier (from spike S4 payloads); retry/backoff with jitter; fallback session with handoff; UI banners and Model Configuration screen; unreachable-server UX; stall detection.
3. **Files:** `packages/trueforge-client/src/resilience/*`, `client-end/components/forge/{ModelStatus,ErrorBanner}.tsx`.
4. **Deps:** Phase 2, 8.
5. **Output:** invalid key → visible error or automatic fallback; workspace unchanged.
6. **Testing:** fault-injection (refused port, 401, 429, 500, stall, mid-stream drop); fake TrueForge server for deterministic tests; manual Task C.
7. **Acceptance:** §G Task C passes; `git status` clean.
8. **Risks:** error payloads vary by provider; classification heuristics.

### Phase 10 — Product UI polish
1. **Objective:** Match [Ui-regitry.md](Ui-regitry.md) completely.
2. **Tasks:** all eight screens; settings; keyboard map; themes (dark, light, high contrast); responsive widths; empty/loading/error states; a11y audit; notifications.
3. **Files:** `client-end/components/**`, `client-end/styles/*`.
4. **Deps:** Phases 5–9 data contracts stable.
5. **Output:** gallery page showing every component state; Playwright visual snapshots.
6. **Testing:** Playwright (keyboard-only flows, axe checks), snapshot per theme.
7. **Acceptance:** axe: 0 serious/critical violations on all screens; every registry component implemented or explicitly deferred.
8. **Risks:** scope creep — registry is the contract.

### Phase 11 — Testing and competition validation
1. **Objective:** Prove the five capabilities and Tasks A–C repeatably.
2. **Tasks:** `eval/run-fixed-tasks.sh`; extension integration suite; Playwright suite; performance checks; rehearse and record demo; fix defects.
3. **Files:** `eval/*`, `docs/demo.md`, `packages/*/test/*`.
4. **Deps:** Phases 1–10.
5. **Output:** evidence bundle (logs, screenshots, TrueForge session ids/exports).
6. **Testing:** all suites green; three consecutive passes of Tasks A–C on a clean clone.
7. **Acceptance:** [progress_tracker.md §C](progress_tracker.md#c-mandatory-capability-tracker) every row has evidence links.
8. **Risks:** model nondeterminism → record multiple runs; document pass rate honestly.

### Phase 12 — Release preparation
1. **Objective:** Installable, documented, licensed.
2. **Tasks:** `vsce package` VSIX (Marketplace publishing is explicitly out of scope); open-source licence and attribution; write-up PDF (8 headings); example config; public repository check; README verification on a clean machine; CHANGELOG; submission checklist; security review.
3. **Files:** `LICENSE`, `CHANGELOG.md`, `.vscodeignore`, `docs/submission.md`, `docs/writeup/`, `config/forge.example.json`.
4. **Deps:** Phase 11.
5. **Output:** `forge-<version>.vsix`, tagged release.
6. **Testing:** install VSIX in a clean VS Code profile; follow README verbatim.
7. **Acceptance:** README steps succeed without undocumented actions; no secrets in history.
8. **Risks:** native/WASM asset packaging; licence compatibility.

---

## E. Engineering Backlog

Status values: NOT STARTED · IN PROGRESS · BLOCKED · IN REVIEW · COMPLETED. As of 2026-11-20 nothing is COMPLETED. Live status is mirrored in [progress_tracker.md](progress_tracker.md).

| ID | Task | Priority | Dependencies | Acceptance Criteria | Status |
|---|---|---|---|---|---|
| FORGE-001 | Root npm workspaces, `tsconfig.base.json` (strict), ESLint, Prettier | P0 | — | `npm ci && npm run typecheck` passes from clean clone | NOT STARTED |
| FORGE-002 | Spike S1: register loopback MCP server with local TrueForge; call a trivial tool | P0 | — | Written outcome in `docs/spikes.md`; agent session shows the tool call | NOT STARTED |
| FORGE-003 | Spike S2: reachability endpoint + SDK behavior when TrueForge is down | P0 | — | Probe function spec + captured error shape | NOT STARTED |
| FORGE-004 | Spike S3/S4: inline spec referencing registered MCP server; capture `turn.done` error payloads (bad key, unreachable endpoint) | P0 | FORGE-002 | Fixtures saved under `packages/trueforge-client/test/fixtures` | NOT STARTED |
| FORGE-005 | Spike S5: SQLite binding for FTS5 in extension host | P2 | FORGE-001 | Decision recorded; optional | NOT STARTED |
| FORGE-006 | Spike S6: shadow workspace on Flask 3.1.3 (`pytest tests/test_cli.py -q` runs against shadow edits) | P0 | FORGE-009 | Proposed change visible to pytest in shadow; real tree untouched | NOT STARTED |
| FORGE-007 | Clean `client-end` template (page, metadata, fonts) and confirm ADR-009 layout | P1 | FORGE-001 | No template content remains; harness page builds | NOT STARTED |
| FORGE-008 | CI workflow (typecheck, lint, unit tests, build) | P1 | FORGE-001 | Green on PR | NOT STARTED |
| FORGE-009 | Flask fixture: clone pallets/flask at tag 3.1.3 (commit `22d92470`), create venv, record baseline `pytest tests/test_cli.py -q` | P0 | — | Baseline result and commit hash recorded in `eval/README` | NOT STARTED |
| FORGE-010 | `packages/protocol` zod schemas (webview messages, tool IO, `TimelineEvent`) | P0 | FORGE-001 | Round-trip tests; unknown types rejected | NOT STARTED |
| FORGE-011 | Extension scaffold: activation, commands, keybindings, settings contribution | P0 | FORGE-010 | Dev Host activates; commands listed | NOT STARTED |
| FORGE-012 | Webview provider + CSP + bridge | P0 | FORGE-010, FORGE-011 | Ping/pong; no remote requests | NOT STARTED |
| FORGE-013 | `client-end/webview` esbuild entry + `tokens.css` + primitives | P0 | FORGE-007, FORGE-012 | Webview renders in Dev Host with VS Code theme vars | NOT STARTED |
| FORGE-014 | Welcome screen (Ui-regitry §D.1) | P1 | FORGE-013 | Matches registry states: connected / unreachable / no model | NOT STARTED |
| FORGE-015 | Guardrail: lint/CI check forbidding model-provider SDKs and hostnames in `packages/extension` and `packages/editor-mcp` | P0 | FORGE-001 | CI fails on `openai`, `@anthropic-ai/sdk`, `@google/genai` imports or provider URLs | NOT STARTED |
| FORGE-016 | `trueforge-client` wrapper (connect, sessions, turns, cancel, resume) | P0 | FORGE-003, FORGE-010 | Streams a reply from local TrueForge | NOT STARTED |
| FORGE-017 | `EventNormalizer` → `TimelineEvent` | P0 | FORGE-016 | Fixture-driven tests for all documented event types | NOT STARTED |
| FORGE-018 | Agent definitions + instructions in `agents/`; loader | P0 | FORGE-004 | Files exist, validated against spec fields; session created from them | NOT STARTED |
| FORGE-019 | `SessionManager` persistence/resume across reload | P1 | FORGE-016 | Reload mid-turn resumes via `subscribeToTurn` | NOT STARTED |
| FORGE-020 | `forge.startTrueForge` + probe + model status | P1 | FORGE-003 | Status reflects Connected/Unreachable | NOT STARTED |
| FORGE-021 | MCP server skeleton (Streamable HTTP, loopback, bearer, Origin check) | P0 | FORGE-002 | Rejects missing/invalid token and browser origins | NOT STARTED |
| FORGE-022 | `resolveWorkspacePath` + deny lists + Workspace Trust gate | P0 | FORGE-021 | Traversal/symlink/NUL tests pass | NOT STARTED |
| FORGE-023 | Tools: `read_file`, `get_file_structure` | P0 | FORGE-022 | Schema + error tests; size caps | NOT STARTED |
| FORGE-024 | Tool: `search_workspace` (ripgrep) | P0 | FORGE-022 | Honors ignores; timeout; cap | NOT STARTED |
| FORGE-025 | Tool: `find_symbol` (LSP-first, upgraded in FORGE-043) | P0 | FORGE-022 | Finds `get_debug_flag` in Flask | NOT STARTED |
| FORGE-026 | Tools: `get_diagnostics`, `get_git_status` | P1 | FORGE-022 | Structured outputs; read-only | NOT STARTED |
| FORGE-027 | Tool: `propose_edit` (queue API; hash checks) | P0 | FORGE-022, FORGE-030 | Never writes; stale base rejected | NOT STARTED |
| FORGE-028 | Tool: `run_terminal` + policy + env scrub + abort | P0 | FORGE-022 | Denied cmds blocked; approval required; kill on abort | NOT STARTED |
| FORGE-029 | Tool: `update_plan` | P1 | FORGE-021 | UI-only effect; limits enforced | NOT STARTED |
| FORGE-030 | `diff-engine`: structured patch, hunk ids, review state machine | P0 | FORGE-010 | Unit tests incl. CRLF/EOF newline | NOT STARTED |
| FORGE-031 | Inline edit command, keybinding, instruction input | P0 | FORGE-018, FORGE-023 | Selection captured with file/version | NOT STARTED |
| FORGE-032 | Inline diff UI: decorations, CodeLens, `forge-proposed:` provider | P0 | FORGE-030 | Per-hunk accept/reject in editor | NOT STARTED |
| FORGE-033 | **Task A pass** on Flask 3.1.3 | P0 | FORGE-027, FORGE-031, FORGE-032 | `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` prints `False` after accept | NOT STARTED |
| FORGE-034 | Apply engine: 3-way merge + `WorkspaceEdit` batch | P0 | FORGE-030 | Conflicts never overwrite | NOT STARTED |
| FORGE-035 | Undo journal in extension storage + crash recovery | P0 | FORGE-034 | apply∘undo identity (property test) | NOT STARTED |
| FORGE-036 | Stale/concurrent modification detection | P0 | FORGE-034 | Edit during pending review → `stale` | NOT STARTED |
| FORGE-037 | Diff Review UI (file list, hunks, accept/reject/all, undo, summaries) | P0 | FORGE-034, FORGE-013 | Registry parity; keyboard operable | NOT STARTED |
| FORGE-038 | Shadow Workspace + shadow-aware `read_file` | P0 | FORGE-006, FORGE-027 | Tests run on proposed code; real tree untouched | NOT STARTED |
| FORGE-039 | Agent workspace UI: composer, stream, timeline, approval card, cancel | P0 | FORGE-017, FORGE-013 | Registry parity | NOT STARTED |
| FORGE-040 | Plan Viewer | P1 | FORGE-029, FORGE-039 | Steps reflect `update_plan` | NOT STARTED |
| FORGE-041 | **Task B pass** on Flask 3.1.3 | P0 | FORGE-038, FORGE-039, FORGE-037 | ≥3 files changed; `pytest tests/test_cli.py -q` passes; demo app masks secrets | NOT STARTED |
| FORGE-042 | Context core: mention parser, ripgrep wrapper, composer autocomplete | P0 | FORGE-024 | `@file`/`@symbol` resolve; errors visible | NOT STARTED |
| FORGE-043 | `web-tree-sitter` Python + TS/JS symbols and imports | P0 | FORGE-042 | Symbols for Flask modules extracted | NOT STARTED |
| FORGE-044 | Import graph + test-affinity | P1 | FORGE-043 | Neighbors computed to depth 2 | NOT STARTED |
| FORGE-045 | Scorer + token budgeter + tier ladder + compression | P0 | FORGE-043 | Budget never exceeded (property test) | NOT STARTED |
| FORGE-046 | `get_context` tool | P0 | FORGE-045 | Returns items, reasons, exclusions | NOT STARTED |
| FORGE-047 | Context Inspector UI | P1 | FORGE-046, FORGE-013 | Shows selected/excluded/reasons/budget | NOT STARTED |
| FORGE-048 | Context eval harness (recall@10 on Tasks A/B) | P1 | FORGE-046, FORGE-009 | Report generated | NOT STARTED |
| FORGE-049 | Optional SQLite FTS5 index | P2 | FORGE-005, FORGE-043 | Incremental update < 500 ms | NOT STARTED |
| FORGE-050 | Streaming pipeline: delta batching, virtualized timeline | P0 | FORGE-039 | Smooth under 10k deltas | NOT STARTED |
| FORGE-051 | Cancellation end-to-end (UI, `sessions.cancel`, AbortSignals, late-event guard) | P0 | FORGE-028, FORGE-039 | Matrix of cancel points tested | NOT STARTED |
| FORGE-052 | Error classifier from real payloads | P0 | FORGE-004 | Table-driven tests | NOT STARTED |
| FORGE-053 | Retry/backoff with jitter; stall detector | P0 | FORGE-052 | Deterministic fake-timer tests | NOT STARTED |
| FORGE-054 | Fallback session + handoff builder | P0 | FORGE-053, FORGE-018 | Continues task on fallback model | NOT STARTED |
| FORGE-055 | Model Configuration screen + error banners | P1 | FORGE-054 | Registry parity | NOT STARTED |
| FORGE-056 | **Task C pass** | P0 | FORGE-054, FORGE-055 | VS Code responsive; error/fallback visible; `git status --porcelain` empty | NOT STARTED |
| FORGE-057 | Settings screen + contributed settings | P1 | FORGE-013 | All registry settings present | NOT STARTED |
| FORGE-058 | Theme + responsive pass (dark/light/HC; 280–900 px) | P1 | FORGE-037, FORGE-039 | Playwright snapshots | NOT STARTED |
| FORGE-059 | Accessibility audit and fixes | P1 | FORGE-058 | axe: 0 serious/critical | NOT STARTED |
| FORGE-060 | Extension integration tests (`@vscode/test-electron`) | P0 | FORGE-033 | Suite runs in CI | NOT STARTED |
| FORGE-061 | Playwright UI suite on mock-host harness | P1 | FORGE-007 | Suite runs in CI | NOT STARTED |
| FORGE-062 | `eval/run-fixed-tasks.sh` (Tasks A–C, repeatable) | P0 | FORGE-033, FORGE-041, FORGE-056 | Outputs pass/fail + session ids | NOT STARTED |
| FORGE-063 | Performance validation vs. NFR targets | P1 | FORGE-050 | Report | NOT STARTED |
| FORGE-064 | Demo script, recording, evidence bundle | P0 | FORGE-062 | `docs/demo.md` | NOT STARTED |
| FORGE-065 | VSIX packaging + `.vscodeignore` | P1 | FORGE-060 | Installs in clean profile | NOT STARTED |
| FORGE-066 | Choose and add an open-source `LICENSE` (rule 7); attribution for upstream deps; CHANGELOG | **P0** | — | `LICENSE` present at root; README §17 matches | NOT STARTED |
| FORGE-067 | README clean-machine verification | P0 | FORGE-065 | Steps run verbatim | NOT STARTED |
| FORGE-068 | `config/forge.example.json` (+ documented TrueForge model setup, no secrets) | P0 | FORGE-016 | Example works when keys are filled via TrueForge; secret scan clean | NOT STARTED |
| FORGE-069 | Fork-point declaration ("from scratch", scaffold note) and any reused-code attribution | P0 | FORGE-007 | README §17 states upstream URL + commit or "from scratch" | NOT STARTED |
| FORGE-070 | Write-up PDF (8 mandated headings, accurate scorecard with video timestamps, honest limitations) | P0 | FORGE-064 | 1–3 pages; headings in order | NOT STARTED |
| FORGE-071 | `submit_changes` Review Gate tool + approval-driven review flow + local-review safety net | P0 | FORGE-027, FORGE-034 | Allow applies accepted hunks only; Deny applies none; agent receives applied/rejected lists | NOT STARTED |
| FORGE-072 | Agent spec tuning: subagent delegation for discovery, deferred tool loading, compaction; show in session | P0 | FORGE-018, FORGE-046 | Subagent `thread.created` events and deferred loading visible in a Task B session | NOT STARTED |
| FORGE-073 | Model-agnostic validation: run Tasks A–C on ≥2 distinct models incl. one local/OpenAI-compatible; no model-specific code | P0 | FORGE-062 | Results table in write-up | NOT STARTED |
| FORGE-074 | Demo video (≤ 4 min, Tasks A→B→C, on-screen verification, TrueForge session during B) | P0 | FORGE-062 | Public link | NOT STARTED |
| FORGE-075 | Submission checklist: public repo, public video link, PDF link, no secrets, LICENSE | P0 | FORGE-066–070, FORGE-074 | All links open logged-out | NOT STARTED |

---

## F. Testing Strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `protocol`, `context-engine`, `diff-engine`, `trueforge-client` (fake timers), tool handlers with a fake `WorkspaceFacade` |
| Integration (extension) | `@vscode/test-electron` + Mocha | activation, commands, WorkspaceEdit apply/undo, decorations/CodeLens registration, MCP server auth, webview bridge |
| MCP tool testing | MCP SDK client against the server; real TrueForge smoke | schema validation, traversal/symlink/size/secret cases, abort behavior |
| Context retrieval | golden fixtures (small synthetic repos + Flask 3.1.3) | expected ranking top-k, budget invariant, exclusion reasons, determinism |
| Diff safety | property tests (fast-check) + fixtures | apply∘undo = id; no write before accept (fs watcher); stale/conflict; CRLF/EOF; multi-file atomicity |
| Cancellation | integration with fake TrueForge | cancel at: model streaming, tool running, awaiting approval, applying; assert no orphan processes, no writes |
| Model failure | fake TrueForge server + fault injection | refused port, 401, 429, 5xx, mid-stream drop, stall; asserts classification, backoff schedule, fallback, banner, clean `git status` |
| UI | Playwright on the `client-end` mock-host harness + axe | keyboard-only flows, themes, widths, snapshots |
| Regression | CI on every PR | all of the above except live-model runs |
| Fixed-task evaluation | `eval/run-fixed-tasks.sh` | Tasks A, B, C on Flask 3.1.3 with a real TrueForge + configured model; run ≥ 3 times; report pass rate honestly |

Rules: tests that need a live model are labelled `live` and excluded from default CI; recorded event fixtures keep unit tests deterministic.

---

## G. Competition Validation

Fixture: `pallets/flask`, release tag **3.1.3**, commit **`22d92470`** (as provided by the competition; tag existence was verified on GitHub 2026-11-20, the commit-to-tag mapping is **to be confirmed in FORGE-009** via `git rev-parse 3.1.3`). Run with a clean tree: `git status --porcelain` must be empty before each task.

### Task A — Inline edit
(Statement: *Open `src/flask/helpers.py`, select the function `get_debug_flag`, and instruct …; review and accept the diff.* Verify with the command below and show `False` on screen. Exact wording will not change.)

- File `src/flask/helpers.py`, function `get_debug_flag`.
- Instruction (verbatim): *"Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."*
- Steps: select the function body → `Cmd/Ctrl+Alt+K` → paste instruction → review diff → accept.
- Verify: `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` → `False`. Also check `n`, `N`, `OFF`, `Off` → `False`, and `1`/`true` → `True`, unset → value of `app.debug` default per existing behavior.
- Evidence: diff screenshot, TrueForge session/turn/tool-call export (expect `read_file`/`get_file_structure` + `propose_edit`).

### Task B — Autonomous multi-file agent
- Instruction (verbatim): *"Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as \"***\". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands."*
- No filenames in the prompt. The agent must discover the CLI module, existing tests, and docs on its own. Expected (not prescribed) touched files: `src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst` (≥ 3 required).
- Verify: `pytest tests/test_cli.py -q` passes. `flask --help` lists `config`.
- Demo app check:
  ```bash
  mkdir -p /tmp/forge-demo && cat > /tmp/forge-demo/app.py <<'EOF'
  from flask import Flask
  app = Flask(__name__)
  app.config.update(SECRET_KEY="s3cr3t", DB_PASSWORD="pw", API_TOKEN="tok", STRIPE_KEY="k", GREETING="visible")
  EOF
  cd /tmp/forge-demo && flask --app app config | python -c "import json,sys; c=json.load(sys.stdin); assert all(c[k]=='***' for k in ['SECRET_KEY','DB_PASSWORD','API_TOKEN','STRIPE_KEY']); assert c['GREETING']=='visible'; print('masking OK')"
  ```
  Also confirm JSON output does not crash on non-JSON-native config values (e.g. `timedelta` for `PERMANENT_SESSION_LIFETIME`) — a likely agent oversight worth checking.
- Evidence: TrueForge session with ≥ 2 turns possible, tool-call list (search/read/structure/propose/terminal), Context Inspector screenshot showing why files were selected, review-queue screenshot, pytest output from shadow and after accept.

### Task C — Resilience
- Configure TrueForge with an unreachable custom endpoint (e.g. a `custom` provider whose base URL is `http://127.0.0.1:9`) or an invalid API key; set it as `forge.model.primary`.
- Repeat Task A exactly.
- Verify: (1) VS Code stays responsive (type in editor, open palette during the failure); (2) a clear error or fallback banner appears (test both: no fallback configured → error; fallback configured to a working model → banner + completed diff); (3) `git status --porcelain` is empty (for the no-fallback run) or contains only the intentionally accepted change (for the fallback run).
- Evidence: screen recording, banner screenshot, `git status` output.

### Completion gate
Each task passes three times consecutively on a clean clone and fresh VS Code profile before the milestone M10 is marked COMPLETED.

---

## H. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | TrueForge cannot attach a loopback MCP server (S1) | Med | Critical | Spike first (FORGE-002); fallback bridge process per ADR-002 |
| R2 | Shadow Workspace can't reproduce the Python env (editable installs) (S6) | Med | High | PYTHONPATH + env symlinks; degrade to post-accept verification |
| R3 | No native model fallback in TrueForge; failure payloads inconsistent (S4) | High | High | Own orchestration (ADR-006); fixtures from real failures; heuristics table-driven |
| R4 | Model nondeterminism fails fixed tasks on demo day | Med | High | Strong agent instructions; context quality; multiple rehearsals; fallback models; record evidence early |
| R5 | Prompt injection via repo content | Med | High | Data envelopes; no disk write without accept; terminal approval + allowlist; no network tool |
| R6 | Inline diff UX weaker due to API limits | High | Med | ADR-007; invest in CodeLens + side-by-side polish |
| R7 | WASM/native packaging problems in VSIX | Med | Med | WASM Tree-sitter; bundle with esbuild; test VSIX in clean profile early |
| R8 | `client-end` Next.js 16 canary-style config (`cacheComponents`, `partialPrefetching`, `agentFeedback`) conflicts with webview needs | Med | Med | Keep shared components framework-agnostic; webview built with esbuild, not Next |
| R9 | Scope creep before P0 done | High | High | Phase gating (§J); P2/P3 frozen until Phase 11 acceptance |
| R10 | TrueForge SDK/API changes (young project) | Med | Med | Pin versions; thin wrapper; fixtures |
| R11 | Large repo performance | Med | Med | Tier 0 on-demand design; caps; worker threads |
| R12 | Cancellation leaves child processes | Med | High | Process-group kill; test for orphans |
| R13 | Licence ambiguity (no LICENSE yet) | Low | Med | Decide in FORGE-066 before release |
| R14 | Time: Round 1 deadline is 2026-11-20 23:59 IST (same day this plan was written); the full roadmap below cannot be finished by then | **Certain** if the date is firm | Critical | Confirm the date on the portal immediately. If firm, execute only the *minimum credible submission*: FORGE-001/002/010–013, 016–018, 021–028, 071, 031–033, 034–037, 038–041, 051, 052–056, 068–070, 074–075 in that order, and state limitations honestly in the write-up. Never claim unbuilt features. Otherwise follow the full critical path 0→3→4→5→6 |
| R15 | Judges run Task A live with an organiser-chosen (possibly weak) model | Med | High | No model-specific logic; compact instructions; validate on ≥2 models (FORGE-073) |
| R16 | Missing open-source licence or committed key → eligibility failure | Low | Critical | FORGE-066, FORGE-068, secret scan in CI |

---

## I. Definition of Done

A task (or phase) is **done** only when all hold:
1. Implementation exists in source (not only docs).
2. Relevant tests pass — actually executed; output recorded in the PR/report.
3. Error handling exists for failure paths (structured errors, user-visible messages, no silent failure).
4. Documentation is updated (this plan if scope changed; architecture/ADRs if design changed; registry if UI changed; README if commands changed).
5. Acceptance criteria in §E / §D are satisfied and evidence is linked in [progress_tracker.md](progress_tracker.md).
6. `npm run typecheck`, lint, and affected tests are green; no `any` without justification.
Documentation existing for a feature never marks it COMPLETED.

---

## J. Execution Instructions for Claude Code

1. Read [Agents.md](Agents.md) first, then README → architecture → plan → Ui-regitry → progress_tracker.
2. Execute in dependency order: **Phase 0 → 1 → 2 → 3 → 4 → 5 → 6**, then 7/8/9 (7 and 9 may overlap once Phase 3 interfaces are stable), then 10 → 11 → 12. Do not skip prerequisites; do not build modules in parallel "to save time".
3. Within a phase, take backlog items in ID order unless dependencies say otherwise; one item per change set.
4. Never start a P2/P3 item while any P0 item is unfinished.
5. When a spike contradicts architecture.md, **stop**, update the ADR and this plan, then proceed.
6. After each meaningful milestone update [progress_tracker.md](progress_tracker.md) (status labels, evidence, decision log, blockers).
7. Before editing anything in `client-end/`, read `client-end/AGENTS.md` and the relevant guide in `client-end/node_modules/next/dist/docs/` — the installed Next.js version differs from common training data.
8. First recommended work item: **FORGE-001 → FORGE-002** (workspace setup + the MCP/TrueForge spike), because S1 gates the rest of the architecture.
