# FORGE — Progress Tracker

> **Rule:** this file records *implementation reality*. A row is COMPLETED only with evidence (a path, a command and its result). Documentation existing for a feature is not evidence.
> **Frontend location:** `/Users/aryansingh/Documents/QuantForge_IITB/client-end/` (inside this repository). It is **untouched** by design in this phase (owner instruction); see §A "Frontend".
> **Related:** [plan.md](plan.md) · [architecture.md](architecture.md) · [Ui-regitry.md](Ui-regitry.md) · [Agents.md](Agents.md) · [../README.md](../README.md)
> **Status labels:** NOT STARTED · IN PROGRESS · BLOCKED · IN REVIEW · COMPLETED

---

## A. Project Status

| Field | Value |
|---|---|
| Product | FORGE — editor-native coding agent for VS Code; agent loop on TrueForge |
| Current phase | Phases 0–6, 8, 9 implemented and verified **with a scripted model**; Phase 7 largely done; Phase 10 (UI polish) and Phase 11–12 (video, write-up, packaging, licence) outstanding |
| Overall completion | **≈ 60 %** (estimate: mean of milestone completion M0–M10 below; weighted equally) |
| Last updated | 2026-11-20 |
| Product code | `packages/{protocol,diff-engine,context-engine,editor-mcp,trueforge-client,extension}`, `agents/`, `scripts/`, `eval/`, `config/` |

### What "verified" means here — read this
All end-to-end results below use a **scripted, deterministic fake model** (`packages/trueforge-client/src/testing/fake-model.ts`) behind a **real TrueForge**, real MCP tools, the real Flask 3.1.3 repo and (for the VS Code suite) a real VS Code 1.146.0. They prove FORGE's plumbing, safety and resilience. **No real LLM has been run against Tasks A/B/C yet.** Real-model pass rates, models used and cost are therefore *unknown* and must be measured before the write-up (FORGE-073).

### Current blockers and critical risks

| # | Item | Impact | Action |
|---|---|---|---|
| B1 | **Round 1 deadline is 20 Nov 2026 23:59 IST** (competition PDF). Outstanding mandatory artefacts: demo video, write-up PDF, public repo with `LICENSE`. | Critical | Confirm date; record real-model runs; see [plan.md R14](plan.md#h-risk-register) |
| B2 | No `LICENSE` file (open-source licence is required). Choosing one is the owner's decision. | Eligibility | Owner picks; FORGE-066 |
| B3 | No real model has been exercised; behaviour with weaker/local models is unmeasured. | High | Configure ≥2 real models in TrueForge; run Tasks A–C; FORGE-073 |
| B4 | Frontend (`client-end/`) is the unmodified Next.js starter by instruction; the registry's React UI is not built. The extension ships a compact vanilla-JS sidebar instead. | Medium (C1/UX) | Owner decision on when to build the React UI against `packages/protocol` |
| B5 | Nothing is committed from this phase (working tree only). | Low | Owner commits when satisfied |
| ~~B6~~ | ~~Loopback MCP registration unverified~~ — **resolved** (needs `OUTBOUND_URL_ALLOWED_HOSTS`). | — | [architecture.md §K](architecture.md#k-implementation-notes-verified-findings) |
| ~~B7~~ | ~~Commit `22d92470` ↔ tag `3.1.3` unverified~~ — **verified** (`release version 3.1.3`). | — | `eval/setup-flask.sh` asserts it |

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

## B. Overall Progress Dashboard

| Module | Status | Completion | Priority | Owner | Notes / evidence |
|---|---|---|---|---|---|
| VS Code extension foundation | COMPLETED | 100 % | P0 | Unassigned | Activates in real VS Code; commands, keybindings, settings, CSP webview (`test:vscode`) |
| React webview | BLOCKED | 10 % | P0 | Unassigned | `client-end/` untouched by instruction; vanilla sidebar ships instead |
| TrueForge integration | COMPLETED | 95 % | P0 | Unassigned | SDK client, event normaliser, approvals, probe, registration (live tests) |
| Agent session management | IN PROGRESS | 60 % | P1 | Unassigned | Sessions/turns/retry/fallback work; **no persistence/resume after reload** |
| MCP tool layer | COMPLETED | 100 % | P0 | Unassigned | 11 tools, loopback+bearer, 21 tests, verified through real TrueForge |
| Inline editing | IN REVIEW | 85 % | P0 | Unassigned | Verified end-to-end in VS Code via `runTask`; input-box command path and keybinding not exercised; real-model run pending |
| Autonomous agent mode | IN REVIEW | 80 % | P0 | Unassigned | Task B passes live with scripted model; real-model run pending |
| Context engine | COMPLETED | 90 % | P0 | Unassigned | Ranking, budget invariant, tiers, reasons, exclusions; composer `@` autocomplete missing |
| Symbol retrieval | COMPLETED | 100 % | P0 | Unassigned | Tree-sitter Python/TS/JS; `find_symbol` |
| Diff review | COMPLETED | 90 % | P0 | Unassigned | Hunks, review state, native diff, CodeLens, sidebar; added-line decorations absent |
| Hunk acceptance/rejection | COMPLETED | 100 % | P0 | Unassigned | Per-hunk accept/reject verified in tests and VS Code |
| Undo functionality | IN REVIEW | 90 % | P0 | Unassigned | Identity property test + VS Code undo; **crash-recovery reconciliation not implemented** |
| Streaming | IN REVIEW | 75 % | P0 | Unassigned | Deltas forwarded to UI; no frame batching/virtualisation |
| Cancellation | IN REVIEW | 85 % | P0 | Unassigned | Live: process reaped, tree clean; UI latency target (<200 ms) not measured |
| Model resilience | COMPLETED | 95 % | P0 | Unassigned | Classifier from real payloads, backoff, stall detection |
| Automatic fallback | COMPLETED | 95 % | P0 | Unassigned | Verified live and in VS Code; fallback session carries a progress handoff only |
| Repository intelligence | IN PROGRESS | 70 % | P1 | Unassigned | Import graph + test affinity done; SQLite FTS5 tier not started |
| Testing | IN PROGRESS | 70 % | P0 | Unassigned | 59 + 10 + 42; **no CI**, no Playwright UI tests |
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
| Remaining | `@` autocomplete in the composer; Context Inspector polish; recall measurement beyond two tasks |
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
| Remaining | UI latency measurement; frame batching; resume after reload |
| Acceptance | Workspace consistent after cancel (**met**); immediate UI (**unmeasured**) |

### C.6 Eligibility gate and resilience — rubric B3 (10)
| Item | Status | Evidence |
|---|---|---|
| Agent loop on TrueForge, no second loop | COMPLETED | No provider SDK in code; loop is TrueForge's (FORGE-015 CI guard **not yet written**) |
| Extension is a TrueForge SDK client | COMPLETED | `@truefoundry/trueforge-sdk` 0.185.0 |
| Editor capabilities as MCP tools | COMPLETED | 11 tools via loopback MCP |
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
| M1 TrueForge foundation | sessions/turns from extension | COMPLETED | 90 % | session persistence/resume |
| M2 MCP editor integration | tools reachable by agent | COMPLETED | 100 % | — |
| M3 Inline editing | Task A | IN REVIEW | 75 % | real-model run; keybinding path test |
| M4 Diff review and safety | hunk review, undo | COMPLETED | 85 % | crash recovery; added-line decorations |
| M5 Autonomous multi-file agent | Task B | IN REVIEW | 70 % | real-model run; richer approval/plan UI |
| M6 Context intelligence | retrieval + inspector | IN REVIEW | 80 % | `@` autocomplete; SQLite tier |
| M7 Streaming and cancellation | | IN REVIEW | 70 % | latency measurement; batching |
| M8 Resilience and fallback | Task C | COMPLETED | 90 % | real endpoint failure demo |
| M9 UI polish and integration testing | registry parity | IN PROGRESS | 15 % | React UI (blocked on `client-end`), Playwright, a11y |
| M10 Demonstration and submission | | NOT STARTED | 10 % | video, write-up, licence, public repo, real-model results |

---

## E. Known Bugs and Technical Debt

| ID | Description | Severity | Files | Resolution | Status |
|---|---|---|---|---|---|
| BUG-01 *(fixed)* | Cancel did not kill the child process: stateless MCP transport routed `notifications/cancelled` to a different server instance | High | `editor-mcp/src/server.ts` | in-flight map by JSON-RPC id + `CancelRegistry` + socket-close abort; test asserts no orphans | COMPLETED |
| BUG-02 *(fixed)* | `rg` exit code 2 with `--no-messages` threw "invalid pattern" on harmless errors | Medium | `context-engine/src/rg.ts` | only treat parse errors as invalid | COMPLETED |
| BUG-03 *(fixed)* | Generic term "test" boosted every test file via path match; CHANGES.rst outranked docs | Medium | `context-engine/src/assemble.ts` | generic-term list, changelog penalty, relevance floor | COMPLETED |
| TD-01 | No session persistence/resume after reload | Medium | `controller.ts` | SessionManager (FORGE-019) | NOT STARTED |
| TD-02 | Undo journal persists but is not reconciled after a crash mid-apply | Medium | `diff-engine/src/review.ts` | startup reconciliation | NOT STARTED |
| TD-03 | Shadow copy re-syncs the whole file list per command (fast on Flask, untested on 10k+ files) | Low | `editor-mcp/src/shadow.ts` | incremental watcher | NOT STARTED |
| TD-04 | Terminal policy cannot express `a && b`; agents must use `cwd` | Low | `policy.ts` | by design; documented in tool description | COMPLETED |
| TD-05 | No CI; no guard against provider SDK imports (FORGE-015) | Medium | repo | GitHub Actions + lint rule | NOT STARTED |
| TD-06 | `client-end` still template (page, metadata, Arial/Geist mismatch, `next/font/google`) | Low | `client-end/` | owner decision | BLOCKED |
| TD-07 | Case-insensitive FS: `Readme.md` ≡ `README.md` | Low | root | `README.md` canonical | COMPLETED |
| TD-08 | `fileParallelism:false` live tests need network the first time (`npx`) | Low | `harness.ts` | document | COMPLETED |

---

## F. Decision Log

| ID | Date | Decision | Rationale |
|---|---|---|---|
| D-001…D-013 | 2026-11-20 | As recorded in [architecture.md §I](architecture.md#i-architectural-decision-records) (TrueForge-only loop, loopback MCP, Review Gate, shadow workspace, lexical+structural retrieval, FORGE-side fallback, storage outside workspace, from-scratch fork point) | see ADRs |
| D-014 | 2026-11-20 | `@vscode/tree-sitter-wasm` replaces `web-tree-sitter`+`tree-sitter-wasms` | latter pair incompatible (tested) |
| D-015 | 2026-11-20 | `propose_edit` accepts exact-text `oldText` edits in addition to line ranges | more reliable for weaker/local models; judges may swap models |
| D-016 | 2026-11-20 | Preload 8 essential tools; defer 3 | keeps deferred-loading visible without forcing `call_tool` indirection on weak models |
| D-017 | 2026-11-20 | FORGE aborts its own tool calls on Stop | TrueForge `sessions.cancel` waits for running MCP calls |
| D-018 | 2026-11-20 | Start TrueForge with `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]'` (not `NETWORK_POLICY_ENABLED=false`) | minimal loosening of TrueForge's SSRF guard |
| D-019 | 2026-11-20 | Scripted fake model is test infrastructure only; real-model results reported separately | honesty about what is proven |
| D-020 | 2026-11-20 | `client-end/` left untouched; extension ships a vanilla sidebar | owner instruction |

---

## G. Next Actions (prioritised)

1. **Run Tasks A/B/C with real models** (≥2 distinct, one OpenAI-compatible/local if possible) through the extension; record pass/fail honestly, model names, where they ran, cost (FORGE-073). Tune `agents/*.instructions.md` only from observed failures.
2. **Add a `LICENSE`** (owner's choice) and push the repo public (FORGE-066/075).
3. **Record the ≤4-minute demo** (Tasks A → B → C, TrueForge session visible during B) (FORGE-074).
4. **Write the 8-heading write-up PDF** with an accurate scorecard and limitations (FORGE-070).
5. Add CI (typecheck, unit tests, provider-import guard) (FORGE-008/015).
6. Session persistence and resume after reload (FORGE-019).
7. Composer `@` autocomplete + richer Context Inspector (FORGE-042/047).
8. Build the React UI from `Ui-regitry.md` in `client-end/` once the owner lifts the freeze (FORGE-013/014/037/039/055/057/058/059/061).
9. Journal crash-recovery; added-line decorations (TD-02).
10. VSIX packaging per platform (ripgrep binary), clean-machine README verification (FORGE-065/067).
