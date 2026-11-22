# QuantForge — Progress Tracker

> **Rule:** this file records *implementation reality*. A row is COMPLETED only with evidence (a path, a command and its result). Documentation existing for a feature is not evidence.
> **Frontend location:** `/Users/aryansingh/Documents/QuantForge_IITB/client-end/` (inside this repository). It is **untouched** by design in this phase (owner instruction); see §A "Frontend".
> **Related:** [plan.md](plan.md) · [architecture.md](architecture.md) · [Ui-regitry.md](Ui-regitry.md) · [Agents.md](Agents.md) · [../README.md](../README.md)
> **Status labels:** NOT STARTED · IN PROGRESS · BLOCKED · IN REVIEW · COMPLETED

---

## A. Project Status

| Field | Value |
|---|---|
| Product | QuantForge — editor-native coding agent for VS Code; agent loop on TrueForge |
| Current phase | Backend and extension feature-complete for the planned scope and verified with a scripted model **and, for Tasks A and C, a real local model**; remaining: a strong-model Task B pass, independent check of the React UI in VS Code, demo video |
| Overall completion | **≈ 80 %** of engineering scope (demo artefacts and real-model evidence are the rest) (estimate: mean of milestone completion M0–M10 below; weighted equally) |
| Last updated | 2026-11-22 |
| Product code | `packages/{protocol,diff-engine,context-engine,editor-mcp,trueforge-client,extension}`, `agents/`, `scripts/`, `eval/`, `config/` |

### What "verified" means here — read this
All end-to-end results below use a **scripted, deterministic fake model** (`packages/trueforge-client/src/testing/fake-model.ts`) behind a **real TrueForge**, real MCP tools, the real Flask 3.1.3 repo and (for the VS Code suite) a real VS Code 1.146.0. They prove QuantForge's plumbing, safety and resilience. **No real LLM has been run against Tasks A/B/C yet.** Real-model pass rates, models used and cost are therefore *unknown* and must be measured before the write-up (FORGE-073).

### Current blockers and critical risks

| # | Item | Impact | Action |
|---|---|---|---|
| B1 | **Round 1 deadline is 20 Nov 2026 23:59 IST** (competition PDF). Outstanding mandatory artefacts: demo video, write-up PDF, public repo with `LICENSE`. | Critical | Confirm date; record real-model runs; see [plan.md R14](plan.md#h-risk-register) |
| B2 | No `LICENSE` file (open-source licence is required). Choosing one is the owner's decision. | Eligibility | Owner picks; FORGE-066 |
| B3 | No real model has been exercised; behaviour with weaker/local models is unmeasured. | High | Configure ≥2 real models in TrueForge; run Tasks A–C; FORGE-073 |
| B4 | A React UI now exists in `client-end/` (built by the owner after the freeze) and is preferred by the extension; I have **not** verified it inside VS Code. The built-in vanilla page is the fallback. | Medium | Run the extension with `dist/webview` present and exercise it manually |
| B5 | Nothing is committed from this phase (working tree only). | Low | Owner commits when satisfied |
| ~~B6~~ | ~~Loopback MCP registration unverified~~ — **resolved** (needs `OUTBOUND_URL_ALLOWED_HOSTS`). | — | [architecture.md §K](architecture.md#k-implementation-notes-verified-findings) |
| ~~B7~~ | ~~Commit `22d92470` ↔ tag `3.1.3` unverified~~ — **verified** (`release version 3.1.3`). | — | `eval/setup-flask.sh` asserts it |

### Verification evidence (all run on 2026-11-20, macOS, Node v26.13.1, VS Code 1.146.0, TrueForge via `npx @truefoundry/trueforge@latest`)

| Command | Result |
|---|---|
| `npx tsc -b packages/*` (strict, 6 packages) | exit 0 |
| `npx vitest run` | **111 passed** (diff-engine 27, context-engine 26, editor-mcp 30 incl. checklist/gate and output limits, trueforge-client 15 incl. real-payload classifier, sidebar UI 8, eligibility guard 5) |
| `npm run test:live` (real TrueForge + real Flask + scripted model) | **14 passed**: Task A ×2, Task B ×2, **sub-agent + deferred tool**, **weak-model completeness gate**, **over-eager submit declined**, cancel-and-reap, Task C ×5, resume |
| `npm run test:vscode` (real VS Code 1.146.0, isolated profile) | **106 checks passed** across 5 scenarios: Task A inline, automatic fallback (401), unreachable endpoint, resume across a real quit/restart, **cancel (UI idle 22 ms after Stop, process tree killed)**; `@` picker, native diff opens automatically, `git status` empty after each. Note: responsiveness checks failed (346/778 ms stalls) while an 8 GB local model was resident and passed again after it was stopped — the stall metric is sensitive to machine load |
| Installed `.vsix` (`FORGE_VSIX=… npm run test:vscode`) | Task A flow passes from `…/ext/forge-dev.forge-0.1.0` in a clean profile |
| `eval/setup-flask.sh` asserts it |

### Verification evidence (all run on 2026-11-20, macOS, Node v26.13.1, VS Code 1.146.0, TrueForge via `npx @truefoundry/trueforge@latest`)

| Command | Result |
|---|---|
| `npx tsc -b packages/*` (strict, 6 packages) | exit 0 |
| `npx vitest run` | **59 passed** (diff-engine 21, context-engine 17, editor-mcp 21) |
| `npm run test:live` (real TrueForge + real Flask + scripted model) | **10 passed**: Task A (apply, denied review, undo), Task B (3 files, 56 passed in shadow, `flask --help` lists `config`, masking via real CLI, pending state has zero writes), cancel-and-reap, Task C ×5 |
| `npm run test:vscode` (real VS Code, isolated profile) | **42 checks passed** across 3 scenarios (Task A inline, automatic fallback on a 401, unreachable endpoint with banner); `git status --porcelain` empty after each; worst extension-host event-loop stall 106–131 ms |
| `eval/setup-flask.sh` | Flask 3.1.3 @ `22d92470`; baseline `pytest tests/test_cli.py -q` = 55 passed, 3 skipped |
| Mutation check | Injecting an off-by-one into the hunk applier made a diff-engine test fail (tests can fail) |
| Retrieval on Flask 3.1.3 | Task B: `cli.py` #1, `tests/test_cli.py` #3, `docs/cli.rst` #7 (24k-token budget, ~365 ms); Task A: `helpers.py` #1 citing `get_debug_flag (function, L28-33)` |

### Frontend
`client-end/` was **not modified**. A first commit by the owner (`274ea2b`) tracks the Next.js starter. The webview bridge contract (`packages/protocol`) is ready for a React UI; until then the extension's sidebar (`packages/extension/src/webviewHtml.ts`) provides Agent / Context / Plan / Review / Timeline tabs.

---

### Frontend status (`client-end/`, updated 2026-11-20) — see [frontend-plan.md](frontend-plan.md)

| Step | Status | Evidence |
|---|---|---|
| F0 tokens + Tailwind aliases, template removed | IN REVIEW | `client-end/styles/tokens.css`, `app/globals.css`; `npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run build` OK |
| F1 protocol mirror, reducer, host bridge | IN REVIEW | `lib/protocol/*`, `lib/store/reducer.ts`, `lib/host/*`. Mirror of `packages/protocol` (not yet created); message additions listed in frontend-plan §5 need agreement with the extension owner |
| F2–F6 primitives + product components (Agent, Composer, Diff Review, Context Inspector, Plan, Timeline, banners, Welcome, Model config, Settings) | IN REVIEW | `components/ui/*`, `components/forge/*`. Exercised in headless Chrome against the mock host: Task B flow (stream → terminal approval → review gate → per-hunk accept/reject → apply → undo), C-error (3 retries → error, "workspace unchanged"), C-fallback (banner → diff), cancel mid-run (no spinners left, 3/3 runs), 0 page errors |
| F7 harness (`/`) with scripted scenarios | IN REVIEW | `app/Harness.tsx`, `lib/host/mockHost.ts`. **Mock data only — not the product; the demo video must use the real extension + TrueForge** |
| F8 webview bundle | IN REVIEW | `npm run build:webview` emits `dist/webview/main.{js,css}` (~800 kB JS). **Not yet loaded in a real VS Code webview** — needs `WebviewViewProvider` + nonce CSP from the extension |
| F9 polish (themes, axe, Playwright suite, virtualised timeline, 280 px width pass) | NOT STARTED | No axe run, no automated UI tests committed, light/high-contrast themes unverified |

Not verified: behaviour inside VS Code; real TrueForge event shapes (spikes S1–S4); screen-reader behaviour; widths below 360 px.

## B. Overall Progress Dashboard

| Module | Status | Completion | Priority | Owner | Notes / evidence |
|---|---|---|---|---|---|
| VS Code extension foundation | COMPLETED | 100 % | P0 | Unassigned | Activates in real VS Code; commands, keybindings, settings, CSP webview (`test:vscode`) |
| React webview | BLOCKED | 10 % | P0 | Unassigned | `client-end/` untouched by instruction; vanilla sidebar ships instead |
| TrueForge integration | COMPLETED | 95 % | P0 | Unassigned | SDK client, event normaliser, approvals, probe, registration (live tests) |
| Agent session management | COMPLETED | 95 % | P1 | Unassigned | Persist + resume after real VS Code restart, detach-not-cancel on close; only the active session is kept (no history list) |
| MCP tool layer | COMPLETED | 100 % | P0 | Unassigned | 12 tools, loopback+bearer, 21 tests, verified through real TrueForge |
| Inline editing | IN REVIEW | 85 % | P0 | Unassigned | Verified end-to-end in VS Code via `runTask`; input-box command path and keybinding not exercised; real-model run pending |
| Autonomous agent mode | IN REVIEW | 70 % | P0 | Unassigned | Task B passes live with scripted model; real-model run pending |
| Context engine | COMPLETED | 98 % | P0 | Unassigned | Ranking, budget invariant, tiers, reasons, exclusions, `@` suggestions + sidebar picker |
| Symbol retrieval | COMPLETED | 100 % | P0 | Unassigned | Tree-sitter Python/TS/JS; `find_symbol` |
| Diff review | COMPLETED | 90 % | P0 | Unassigned | Hunks, review state, native diff, CodeLens, sidebar; added-line decorations absent |
| Hunk acceptance/rejection | COMPLETED | 100 % | P0 | Unassigned | Per-hunk accept/reject verified in tests and VS Code |
| Undo functionality | COMPLETED | 98 % | P0 | Unassigned | Identity property test, VS Code undo, crash recovery before/during/after write |
| Streaming | IN REVIEW | 85 % | P0 | Unassigned | Deltas coalesced ~16 ms; no list virtualisation |
| Cancellation | IN REVIEW | 85 % | P0 | Unassigned | Live: process reaped, tree clean; UI latency target (<200 ms) not measured |
| Model resilience | COMPLETED | 95 % | P0 | Unassigned | Classifier from real payloads, backoff, stall detection |
| Automatic fallback | COMPLETED | 95 % | P0 | Unassigned | Verified live and in VS Code; fallback session carries a progress handoff only |
| Repository intelligence | COMPLETED | 95 % | P1 | Unassigned | Import graph, test affinity, persistent SQLite FTS5 index with incremental updates |
| Testing | IN PROGRESS | 85 % | P0 | Unassigned | 79 + 11 + 86; CI workflow written (not yet run on GitHub); no Playwright UI tests |
| Documentation | IN REVIEW | 90 % | P0 | Unassigned | Updated to reality 2026-11-20 |
| Competition demo | NOT STARTED | 0 % | P0 | Unassigned | No video, no write-up PDF, no real-model runs |

---

## C. Mandatory Capability Tracker

### C.1 Inline Edit — rubric A1 (10)
| Field | Value |
|---|---|
| Implementation | IN REVIEW |
| Source | `packages/extension/src/{extension,controller,reviewUi}.ts`, `agents/forge-inline-edit.*` |
| Unit / integration tests | diff-engine 21; live `Task A` ×2; VS Code `taskA` 15 checks |
| Demonstration | Not recorded. Scripted-model run passes; real-model run not done |
| Remaining | Real-model Task A; exercise keybinding + input box; added-line decorations |
| Acceptance | Diff rendered in editor with per-hunk Accept/Reject (**met**: CodeLens Accept/Reject/Diff verified); `FLASK_DEBUG=off … get_debug_flag` → `False` (**met** for scripted edit, incl. `off OFF Off n N`) |

### C.2 Autonomous Agent Mode — rubric A2 (10), B4 (10)
| Field | Value |
|---|---|
| Implementation | IN REVIEW |
| Source | `agents/forge-agent.*`, `packages/editor-mcp/src/*`, `controller.ts` |
| Tests | live Task B ×2 (3 files, shadow `56 passed`, masking, zero writes while paused) |
| Demonstration | Not recorded; no real model |
| Remaining | Real-model Task B; show subagent/deferred-loading events in a real session; TrueForge session screenshots |
| Acceptance | ≥3 files, none named (**met** with scripted model); approval drives review (**met**: `submit_changes` gated); ≥1 context-engineering feature visible (**configured** — subagents, deferred loading, compaction in the spec; **not yet shown with a real model**) |

### C.3 Context Assembly — rubric B1 (15)
| Field | Value |
|---|---|
| Implementation | COMPLETED (engine) / IN PROGRESS (UI) |
| Source | `packages/context-engine/src/*`, `get_context` tool, sidebar Context tab |
| Tests | 17 unit incl. Flask golden (Task A/B top-k) and a hard budget invariant |
| Remaining | Context Inspector polish (React UI); recall measurement beyond the two fixed tasks |
| Acceptance | Budget never exceeded (**met**, tested at 500…24000); Task B target files in top-10 (**met**: ranks 1, 3, 7); reasons visible (**met** in sidebar) |

### C.4 Diff Review and Safety — rubric B2 (10)
| Field | Value |
|---|---|
| Implementation | COMPLETED (core) |
| Tests | 21 diff-engine (property tests, 147 random cases), concurrent edit, conflict never overwritten, undo refuses to clobber, failed batch leaves nothing |
| Remaining | Crash-recovery of journal; editor decorations for additions |
| Acceptance | Zero writes before approval (**met**, asserted via `git status` and file hashes while paused); per-hunk; undo identity (**met**) |

### C.5 Streaming and Cancellation — rubric A3 (10)
| Field | Value |
|---|---|
| Implementation | IN REVIEW |
| Tests | live cancel test (process killed ≤ seconds, no orphans, tree clean, queue empty); MCP-level cancel + host-level cancel + timeout |
| Remaining | UI cancel-latency measurement; list virtualisation |
| Acceptance | Workspace consistent after cancel (**met**); immediate UI (**unmeasured**) |

### C.6 Eligibility gate and resilience — rubric B3 (10)
| Item | Status | Evidence |
|---|---|---|
| Agent loop on TrueForge, no second loop | COMPLETED | No provider SDK in code; loop is TrueForge's (FORGE-015 CI guard **not yet written**) |
| Extension is a TrueForge SDK client | COMPLETED | `@truefoundry/trueforge-sdk` 0.185.0 |
| Editor capabilities as MCP tools | COMPLETED | 12 tools via loopback MCP |
| TrueForge local mode | COMPLETED | all runs use `npx @truefoundry/trueforge@latest` |
| Models via TrueForge only | COMPLETED | settings hold model *names* only |
| Agent definition in repo | COMPLETED | `agents/forge-agent.json`, `agents/forge-inline-edit.json` |
| Demo shows Task B session | NOT STARTED | video not recorded |
| Task C automatic fallback | IN REVIEW | live + VS Code (401 → fallback); unreachable → clear error, tree clean |

### C.7 Submission artefacts
| Artefact | Status | Notes |
|---|---|---|
| Public repo, README, example config, fork-point declaration | IN PROGRESS | README updated, `config/forge.example.json` ✓, "from scratch" declared; **`LICENSE` missing**; not pushed/public |
| Demo video ≤ 4 min | NOT STARTED | |
| Write-up PDF (8 headings) | NOT STARTED | |

---

## D. Milestone Tracker

| ID | Objective | Status | Completion | Remaining |
|---|---|---|---|---|
| M0 Setup | workspaces, spikes, fixture | COMPLETED* | 85 % | CI; `client-end` cleanup is out of scope by instruction (*all spikes S1–S4, S6 resolved; S5 optional) |
| M1 TrueForge foundation | sessions/turns from extension | COMPLETED | 100 % | — |
| M2 MCP editor integration | tools reachable by agent | COMPLETED | 100 % | — |
| M3 Inline editing | Task A | IN REVIEW | 75 % | real-model run; keybinding path test |
| M4 Diff review and safety | hunk review, undo | COMPLETED | 95 % | added-line editor decorations |
| M5 Autonomous multi-file agent | Task B | IN REVIEW | 70 % | real-model run; richer approval/plan UI |
| M6 Context intelligence | retrieval + inspector | COMPLETED | 92 % | richer inspector in the React UI |
| M7 Streaming and cancellation | | IN REVIEW | 85 % | latency measurement |
| M8 Resilience and fallback | Task C | COMPLETED | 90 % | real endpoint failure demo |
| M9 UI polish and integration testing | registry parity | IN PROGRESS | 15 % | React UI (blocked on `client-end`), Playwright, a11y |
| M10 Demonstration and submission | | NOT STARTED | 10 % | video, write-up, licence, public repo, real-model results |

---


### Real-model results (local qwen3-8b via Ollama, 16 GB laptop; raw JSON in `eval/results/`)
Run with `npm run eval:real -- --model ollama/qwen3-forge --task A|B|C --params '{"reasoning_effort":"none"}'`. The reviewer is simulated by accepting every hunk. **Failures are kept in the results.**

| Task | Result | Detail |
|---|---|---|
| **A** (inline edit) | **3/3 pass** after the completeness gate; **0/3** before it | Before: the model fixed the code and skipped the docstring every time. With `verify_changes` + the submit gate it proposes, is rejected for the missing docstring, adds it, passes the check and submits. All five checks pass: `FLASK_DEBUG=off` → `False`, `n/N/OFF` → `False`, old behaviour kept, docstring lists all five values, only `helpers.py` changed. ~150 s per run |
| **B** (agent, ≥3 files) | **Not achieved — and not measurable on this hardware** | Best earlier run: real sub-agent delegation and deferred-tool use, then no edits. Later runs: each model call took **2–4 minutes** at 10k-token prompts on a 16 GB laptop, so runs stalled or timed out before any edit. A stronger/faster model is needed to measure A2 honestly; **no real-model Task B pass exists** |
| **C** (resilience) | **Resilience works; model quality caps the rest** | Dead primary → one retry → automatic fallback to the real model → flow completed, workspace controlled. (Run was before the gate, so the docstring check failed for the same model-quality reason as Task A) |

Lessons that changed the product (all covered by tests): TrueForge's default 20 s model-response timeout misreports a slow local model as "unreachable"; Ollama's default 4096 context truncates silently; `get_context`/`read_file`/command output must be sized to the model's window; reasoning mode is too slow on this hardware; deferred-tool indirection **hurts** small models, so only diagnostics/git status stay deferred.

## E. Known Bugs and Technical Debt

| ID | Description | Severity | Files | Resolution | Status |
|---|---|---|---|---|---|
| BUG-01 *(fixed)* | Cancel did not kill the child process: stateless MCP transport routed `notifications/cancelled` to a different server instance | High | `editor-mcp/src/server.ts` | in-flight map by JSON-RPC id + `CancelRegistry` + socket-close abort; test asserts no orphans | COMPLETED |
| BUG-02 *(fixed)* | `rg` exit code 2 with `--no-messages` threw "invalid pattern" on harmless errors | Medium | `context-engine/src/rg.ts` | only treat parse errors as invalid | COMPLETED |
| BUG-03 *(fixed)* | Generic term "test" boosted every test file via path match; CHANGES.rst outranked docs | Medium | `context-engine/src/assemble.ts` | generic-term list, changelog penalty, relevance floor | COMPLETED |
| TD-01 | Session persistence/resume after reload | Medium | `controller.ts`, `turn.ts` | persisted state + `runTurn({resume})` + stable MCP endpoint | COMPLETED |
| TD-02 | Undo journal reconciliation after a crash mid-apply | Medium | `diff-engine/src/journal.ts` | intent/commit + `reconcile()` | COMPLETED |
| TD-03 | Shadow copy re-syncs the whole file list per command (fast on Flask, untested on 10k+ files) | Low | `editor-mcp/src/shadow.ts` | incremental watcher | NOT STARTED |
| TD-04 | Terminal policy cannot express `a && b`; agents must use `cwd` | Low | `policy.ts` | by design; documented in tool description | COMPLETED |
| TD-05 | CI and provider-import guard | Medium | `.github/workflows/ci.yml`, `guard.test.ts` | guard test fails on planted violation; workflow not yet run on GitHub | IN REVIEW |
| TD-06 | `client-end` still template (page, metadata, Arial/Geist mismatch, `next/font/google`) | Low | `client-end/` | owner decision | BLOCKED |
| TD-07 | Case-insensitive FS: `Readme.md` ≡ `README.md` | Low | root | `README.md` canonical | COMPLETED |
| BUG-08 *(fixed)* | TrueForge wraps MCP tool failures as `{"error":[{"type":"text",…}]}`; QuantForge showed every failed tool call as **successful** in the timeline | High | `trueforge-client/src/turn.ts` | unwrap envelope, readable message; live test asserts `ok:false` | COMPLETED |
| BUG-09 *(fixed)* | A slow-model timeout was reported as "TrueForge is not reachable" | Medium | `classify.ts` | timeout → STALLED with local-model hint; 15 classifier tests from real payloads | COMPLETED |
| BUG-10 *(fixed)* | Default `get_context` budget (24k) exceeded small models' windows → silent truncation / empty replies | High | `editor-mcp` | model-sized limits from TrueForge `context_length` | COMPLETED |
| BUG-11 *(fixed)* | The new submit gate declined a *resumed* approval because the verified flag was not persisted | High | `controller.ts` | persist on verify + one-shot bypass on resume; VS Code resume scenario | COMPLETED |
| BUG-12 *(fixed)* | `@` regex lost its backslashes inside a TS template literal — picker never opened | Medium | `webviewHtml.ts` | fixed; jsdom UI test | COMPLETED |
| BUG-04 *(fixed)* | `tree-sitter.js` copied beside a `"type":"module"` package was loaded as ESM → `__filename` undefined → **symbol analysis silently empty inside the extension** | High | `scripts/build.mjs`, `parser.ts` | ship as `.cjs`; startup self-check warns if parsing is degraded | COMPLETED |
| BUG-05 *(fixed)* | Closing the window cancelled the TrueForge turn (abort path called `sessions.cancel`) | High | `controller.ts`, `turn.ts` | separate `detach` signal | COMPLETED |
| BUG-06 *(fixed)* | MCP endpoint port/token changed on restart, so a surviving turn lost its tools | High | `controller.ts` | persisted port + token (0600) | COMPLETED |
| BUG-07 *(fixed)* | Half-built SQLite index answered `@symbol` searches | Medium | `suggest.ts`, `repo-index.ts` | answer only after complete warm-up (`warmDone`) | COMPLETED |
| TD-08 | `fileParallelism:false` live tests need network the first time (`npx`) | Low | `harness.ts` | document | COMPLETED |

---

## F. Decision Log

| ID | Date | Decision | Rationale |
|---|---|---|---|
| D-001…D-013 | 2026-11-20 | As recorded in [architecture.md §I](architecture.md#i-architectural-decision-records) (TrueForge-only loop, loopback MCP, Review Gate, shadow workspace, lexical+structural retrieval, QuantForge-side fallback, storage outside workspace, from-scratch fork point) | see ADRs |
| D-014 | 2026-11-20 | `@vscode/tree-sitter-wasm` replaces `web-tree-sitter`+`tree-sitter-wasms` | latter pair incompatible (tested) |
| D-015 | 2026-11-20 | `propose_edit` accepts exact-text `oldText` edits in addition to line ranges | more reliable for weaker/local models; judges may swap models |
| D-016 | 2026-11-20 | Preload 8 essential tools; defer 3 | keeps deferred-loading visible without forcing `call_tool` indirection on weak models |
| D-017 | 2026-11-20 | QuantForge aborts its own tool calls on Stop | TrueForge `sessions.cancel` waits for running MCP calls |
| D-018 | 2026-11-20 | Start TrueForge with `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]'` (not `NETWORK_POLICY_ENABLED=false`) | minimal loosening of TrueForge's SSRF guard |
| D-019 | 2026-11-20 | Scripted fake model is test infrastructure only; real-model results reported separately | honesty about what is proven |
| D-020 | 2026-11-20 | `client-end/` left untouched; extension ships a vanilla sidebar | owner instruction |

---

## G. Next Actions (prioritised)

1. **Run Task B with a capable model** (hosted, or a bigger/faster local one) through `npm run eval:real` and then through the extension; record pass/fail honestly. This is the largest remaining unknown (A2/B4).
2. Open the extension with the React UI bundle present and exercise review/approval/cancel by hand; fix what breaks (I verified only the built-in fallback page and the protocol).
3. Re-measure Task A/C with a second, stronger model to confirm the completeness gate generalises.
4. Record the ≤4-minute demo (`docs/DEMO.md`) and finish the write-up placeholders with real numbers.
5. Per-platform VSIX builds; run the CI workflow on GitHub once.
6. Playwright/axe coverage of the React UI inside the extension host.
