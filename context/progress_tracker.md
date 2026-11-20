# FORGE — Progress Tracker

> **Rule:** this file records *implementation reality*. A row may be marked COMPLETED only with evidence (a file path, a test run, a recorded session). Existence of documentation is never evidence of implementation.
> **Frontend location:** `/Users/aryansingh/Documents/QuantForge_IITB/client-end/` (inside this repository).
> **Related:** [plan.md](plan.md) · [architecture.md](architecture.md) · [Ui-regitry.md](Ui-regitry.md) · [Agents.md](Agents.md) · [README.md](README.md)
> **Status labels:** NOT STARTED · IN PROGRESS · BLOCKED · IN REVIEW · COMPLETED

---

## A. Project Status

| Field | Value |
|---|---|
| Product | FORGE — AI-powered autonomous software engineering agent for VS Code |
| Objective | Competition-grade, TrueForge-based coding agent: inline edit, autonomous multi-file agent, context assembly, safe diff review, streaming/cancellation, model resilience; passes fixed Flask 3.1.3 Tasks A/B/C |
| Current phase | Phase 0 — Repository audit and setup (documentation foundation done; setup not done) |
| Current milestone | M0 — Repository and project setup: **IN PROGRESS** |
| Overall completion | **≈ 2 %** (estimate = mean of milestone completion across M0–M10; only M0 has any, and only for the audit/docs part) |
| Last updated | 2026-11-20 |
| Product code written | **None.** No extension, no MCP server, no TrueForge client, no tests. |
| Documentation | Six engineering documents created 2026-11-20 (see §B "Documentation"). Not yet reviewed by the project owner. |

### Current blockers and critical risks

| # | Blocker / risk | Impact | Action |
|---|---|---|---|
| B1 | **Round 1 submission deadline is 20 Nov 2026, 23:59 IST** (per `TrueFoundry_Forge-a-thon_compressed_UvvRJ9C (2).pdf`), the same day as this audit. The full roadmap cannot be completed by then. | Critical | Confirm the deadline on the Techfest portal now. If firm, follow the minimum-credible-submission order in [plan.md R14](plan.md#h-risk-register) and be explicit in the write-up about what is built and what is not. |
| B2 | Spike S1 unverified: can TrueForge local mode attach a loopback MCP server, and can that be configured by API rather than only the Settings → Connectors UI? | Gates all agent tooling | FORGE-002 |
| B3 | No model provider/key is configured in a local TrueForge yet (none verified) | Gates live testing | Configure in TrueForge Settings → Models; never in the repo |
| B4 | No `LICENSE` file; the rules require a public open-source repository | Eligibility | FORGE-066 |
| B5 | Not yet confirmed that the competition-supplied commit `22d92470` corresponds to Flask tag `3.1.3` (tag exists on GitHub; commit mapping not verified) | Low | FORGE-009 |

### Repository audit evidence (2026-11-20)

| Item | Finding |
|---|---|
| Git | 1 commit (`21f6143 Initial commit`), branch `main`. Untracked: `client-end/`, six docs, the competition PDF. |
| Root files | `README.md` (single line `# QuantForge_IITB`, since replaced by the full README), the competition PDF. No `package.json`, no workspace config, no `LICENSE`, no CI. |
| `client-end/` | Unmodified `create-next-app` output: `next 16.4.6`, `react 19.3.0`, `react-dom 19.3.0`, `tailwindcss 4.3.3`, `@tailwindcss/turbopack 4.3.3`, `typescript ^5`, `eslint ^9`, `eslint-config-next 16.4.6`. `app/page.tsx` is the default template; `app/layout.tsx` metadata title is "Create Next App"; Geist fonts via `next/font/google`. `next.config.ts` enables `experimental.agentFeedback`, `cacheComponents`, `partialPrefetching` and a Tailwind turbopack rule. `node_modules/` installed. `client-end/AGENTS.md` (auto-generated) warns that this Next.js version has breaking changes and docs are in `node_modules/next/dist/docs/`. |
| Scripts available | `npm run dev`, `build`, `start`, `lint` (in `client-end/`). |
| Verified runs | `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0 (both on the unmodified scaffold). `npm run build` and `npm run dev` **not run** (UNKNOWN; build needs Google Fonts network access). |
| Environment | Node `v26.13.1`, npm `11.20.0` on the audit machine. TrueForge documents Node ≥ 22.14. The Node range required by Next 16.4.6 was **not verified**. |
| TrueForge | Official repo read via GitHub on 2026-11-20 (MIT; SDK `@truefoundry/trueforge-sdk`; local mode `npx @truefoundry/trueforge@latest` at `http://localhost:8790`). TrueForge was **not installed or run** here. |
| Competition statement | Found: `TrueFoundry_Forge-a-thon_compressed_UvvRJ9C (2).pdf` (appeared in the root during the audit). Scoring rubric and deadline captured in [plan.md §A](plan.md#a-product-objectives). |
| Case-insensitivity | The filesystem is case-insensitive (macOS). The requested `Readme.md` and the existing `README.md` are the same file; **`README.md` is the canonical name**. The requested `Ui-regitry.md` spelling is preserved intentionally. |

### Reality assessment (feature classification)

| Feature | Class | Evidence |
|---|---|---|
| VS Code extension | PLANNED | no `package.json` with `engines.vscode`, no `src/extension.ts` |
| React webview | PLANNED | `client-end/` has React 19 + Tailwind 4 dependencies but only the template page |
| Next.js frontend scaffold | PARTIALLY IMPLEMENTED | `client-end/` builds types/lint clean; no FORGE UI |
| TrueForge integration, sessions, MCP tools | PLANNED | no SDK dependency present |
| Context engine, diff engine, resilience | PLANNED | — |
| Agent definition in repo | PLANNED | no `agents/` directory |
| Tests | PLANNED | no test runner configured anywhere |
| TrueForge availability | UNKNOWN | not installed/run in this audit |
| MCP loopback registration | UNKNOWN | spike S1 not run |

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

Owner is **Unassigned** until the team confirms assignments (git user on this machine: Aryan Singh).

| Module | Status | Completion | Priority | Owner | Notes |
|---|---|---|---|---|---|
| VS Code extension foundation | NOT STARTED | 0 % | P0 | Unassigned | Phase 1; FORGE-010–012 |
| React webview | NOT STARTED | 0 % | P0 | Unassigned | `client-end/` scaffold exists (template only); ADR-009 pending owner confirmation; FORGE-007, 013 |
| TrueForge integration | NOT STARTED | 0 % | P0 | Unassigned | Phase 2; FORGE-016–018; docs read, nothing run |
| Agent session management | NOT STARTED | 0 % | P0 | Unassigned | FORGE-019 |
| MCP tool layer | NOT STARTED | 0 % | P0 | Unassigned | Phase 3; gated by spike S1 (FORGE-002) |
| Inline editing | NOT STARTED | 0 % | P0 | Unassigned | Phase 4; FORGE-031–033 |
| Autonomous agent mode | NOT STARTED | 0 % | P0 | Unassigned | Phase 6; FORGE-038–041 |
| Context engine | NOT STARTED | 0 % | P0 | Unassigned | Phase 7; FORGE-042–046 |
| Symbol retrieval | NOT STARTED | 0 % | P0 | Unassigned | `find_symbol`, Tree-sitter; FORGE-025, 043 |
| Diff review | NOT STARTED | 0 % | P0 | Unassigned | Phase 5; FORGE-030, 034, 037 |
| Hunk acceptance/rejection | NOT STARTED | 0 % | P0 | Unassigned | Includes Review Gate FORGE-071 |
| Undo functionality | NOT STARTED | 0 % | P0 | Unassigned | FORGE-035 |
| Streaming | NOT STARTED | 0 % | P0 | Unassigned | FORGE-017, 050 |
| Cancellation | NOT STARTED | 0 % | P0 | Unassigned | FORGE-051 |
| Model resilience | NOT STARTED | 0 % | P0 | Unassigned | FORGE-052–053 |
| Automatic fallback | NOT STARTED | 0 % | P0 | Unassigned | FORGE-054; needs ≥2 configured models (rubric B3 = 10) |
| Repository intelligence | NOT STARTED | 0 % | P1 | Unassigned | Import graph, index; FORGE-044, 049 |
| Testing | NOT STARTED | 0 % | P0 | Unassigned | No test runner configured; FORGE-008, 060–063 |
| Documentation | IN REVIEW | 85 % | P0 | Unassigned | Six docs written 2026-11-20; cross-check run the same day: 34 anchor links resolve, all 16 Mermaid diagrams parse with the real `mermaid` parser, tool names consistent; README commands for unbuilt parts are marked PLANNED; needs owner review |
| Competition demo | NOT STARTED | 0 % | P0 | Unassigned | FORGE-062, 064, 070, 074 |

---

## C. Mandatory Capability Tracker

Evidence columns hold *paths or run logs*; "—" means none exists.

### C.1 Inline Edit — rubric A1 (10 pts)
| Field | Value |
|---|---|
| Requirements | Selection + keybinding + plain-language instruction → in-editor diff, per-hunk accept/reject; no copy-paste |
| Implementation status | NOT STARTED |
| Relevant source files | Planned: `packages/extension/src/inline/*`, `agents/forge-inline-edit.json`, `packages/diff-engine` |
| Unit tests | — |
| Integration tests | — |
| Demonstration | NOT STARTED (Task A) |
| Remaining work | FORGE-018, 027, 030–033, 071 |
| Acceptance criteria | Task A diff rendered in editor; per-hunk accept; `FLASK_DEBUG=off … get_debug_flag` prints `False` |

### C.2 Autonomous Agent Mode — rubric A2 (10), B4 (10)
| Field | Value |
|---|---|
| Requirements | Single request drives TrueForge tool loop (read, search, write, run); ≥3 files, none named by user; TrueForge approval drives review; ≥1 context-engineering feature |
| Implementation status | NOT STARTED |
| Relevant source files | Planned: `agents/forge-agent.json`, `packages/editor-mcp`, `packages/extension/src/{agent,shadow}` |
| Unit tests | — |
| Integration tests | — |
| Demonstration | NOT STARTED (Task B) |
| Remaining work | FORGE-021–029, 038–041, 071, 072 |
| Acceptance criteria | Task B: ≥3 files changed, `pytest tests/test_cli.py -q` passes, masked JSON shown, TrueForge session with turns/tool calls shown |

### C.3 Context Assembly — rubric B1 (15 pts)
| Field | Value |
|---|---|
| Requirements | `@file`, `@symbol`, automatic retrieval, symbol-level retrieval, dependency awareness, ranking, token budget, compression, exclusions, visible reasons |
| Implementation status | NOT STARTED |
| Relevant source files | Planned: `packages/context-engine/*`, `client-end/components/forge/ContextInspector*` |
| Unit tests | — |
| Integration tests | — |
| Demonstration | NOT STARTED |
| Remaining work | FORGE-042–048 |
| Acceptance criteria | Budget never exceeded (property test); Task B retrieval surfaces `src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst` in top-10 (target); Context Inspector shows reasons live |

### C.4 Diff Review and Safety — rubric B2 (10 pts)
| Field | Value |
|---|---|
| Requirements | File- and hunk-level diffs, per-hunk accept/reject, accept/reject all, undo, summaries, no silent writes, workspace consistency |
| Implementation status | NOT STARTED |
| Relevant source files | Planned: `packages/diff-engine/*`, `packages/extension/src/review/*` |
| Unit tests | — |
| Integration tests | — |
| Demonstration | NOT STARTED |
| Remaining work | FORGE-027, 030, 034–037, 071 |
| Acceptance criteria | Zero writes before accept (fs-watcher test); apply∘undo = identity; conflicts never overwritten; undo shown on screen |

### C.5 Streaming and Cancellation — rubric A3 (10 pts)
| Field | Value |
|---|---|
| Requirements | Stream TrueForge events; UI responsive; cancel mid-generation; consistent workspace; no partial application |
| Implementation status | NOT STARTED |
| Relevant source files | Planned: `packages/trueforge-client/src/stream.ts`, `packages/extension/src/cancel.ts` |
| Unit tests | — |
| Integration tests | — |
| Demonstration | NOT STARTED |
| Remaining work | FORGE-017, 050, 051 |
| Acceptance criteria | UI reflects cancel < 200 ms (target); process group dead < 2 s; workspace byte-identical after cancel |

### C.6 TrueForge eligibility gate (pass/fail) and resilience
| Item | Status | Evidence |
|---|---|---|
| Agent loop on TrueForge; no second loop | NOT STARTED (design only) | [architecture.md ADR-001](architecture.md#i-architectural-decision-records) |
| Extension is an SDK/HTTP client | NOT STARTED | — |
| Editor capabilities as MCP tools | NOT STARTED | — |
| TrueForge local mode | NOT STARTED | TrueForge not yet run |
| Models configured in TrueForge only | NOT STARTED | guardrail FORGE-015 |
| Agent definition in repo | NOT STARTED | `agents/` absent |
| Demo shows Task B session | NOT STARTED | — |
| Resilience (Task C, rubric B3) | NOT STARTED | FORGE-052–056 |

### C.7 Submission artefacts (mandatory)
| Artefact | Status | Notes |
|---|---|---|
| Public GitHub repo with working README, fork-point declaration, example config, LICENSE, no secrets | NOT STARTED | README written (setup for unbuilt parts marked PLANNED); LICENSE, `config/forge.example.json` absent; FORGE-066/068/069 |
| Demo video ≤ 4 min (Tasks A→B→C) | NOT STARTED | FORGE-074 |
| Write-up PDF, 8 mandated headings | NOT STARTED | FORGE-070 |

---

## D. Milestone Tracker

| ID | Objective | Deliverables | Dependencies | Completion criteria | Status |
|---|---|---|---|---|---|
| **M0** — Repository and project setup | Workspace, tooling, CI, spikes, Flask fixture | root `package.json` workspaces, strict TS, lint, CI, spike report, Flask baseline | — | FORGE-001–009 done; `npm ci && npm run typecheck` green in CI; spikes S1–S6 resolved | **IN PROGRESS** (audit + docs done; no setup code) |
| **M1** — TrueForge foundation | Sessions/turns from the extension | Extension scaffold, protocol schemas, webview shell, `trueforge-client`, agent definitions | M0 | A prompt streams a reply from local TrueForge; session visible in TrueForge | NOT STARTED |
| **M2** — MCP editor integration | Agent can use editor tools | MCP server, safety layer, 8 required tools + `get_context`, `update_plan` registered; `submit_changes` registered as a stub (full Review Gate behavior lands in M4) | M1, S1 | Agent calls tools unprompted; tool calls visible in TrueForge session | NOT STARTED |
| **M3** — Inline editing | Mandatory capability 1 | Command, keybinding, inline diff UI, inline agent | M2 | Task A passes | NOT STARTED |
| **M4** — Diff review and safety | Mandatory capability 4 | Diff engine, hunk review, apply, undo, stale detection, review UI, Review Gate | M2 | Zero pre-accept writes; undo identity; per-hunk review on screen | NOT STARTED |
| **M5** — Autonomous multi-file agent | Mandatory capability 2 | Agent workspace UI, approvals, Shadow Workspace, plan viewer | M3, M4, S6 | Task B passes (≥3 files, none named) | NOT STARTED |
| **M6** — Repository context intelligence | Mandatory capability 3 | Context engine, `get_context`, Inspector, subagent delegation | M2 (parallel with M5 after interfaces stabilize) | Budget invariant; Task B retrieval top-10 target met | NOT STARTED |
| **M7** — Streaming and cancellation | Mandatory capability 5 | Streaming pipeline, cancel end-to-end, resume | M1, M2, M5 | Cancel matrix green; workspace unchanged | NOT STARTED |
| **M8** — Model resilience and fallback | Task C | Classifier, backoff, fallback session, banners | M1, M7 | Task C passes with error path and fallback path | NOT STARTED |
| **M9** — UI polish and integration testing | Registry parity, a11y, themes | All eight screens, Playwright, extension integration suite | M3–M8 | axe 0 serious/critical; suites green in CI | NOT STARTED |
| **M10** — Competition demonstration and submission | Deliverables | Eval script, demo video, write-up PDF, licence, example config, public repo | M9 | Tasks A–C pass three times; all links public before deadline | NOT STARTED |

---

## E. Known Bugs and Technical Debt

No product bugs (no product code). Items below are defects/debt in the current repository state.

| ID | Description | Severity | Reproduction | Relevant files | Proposed resolution | Status |
|---|---|---|---|---|---|---|
| TD-01 | `client-end` still renders the `create-next-app` demo page and metadata title "Create Next App" | Low | `cd client-end && npm run dev` → open `/` | `client-end/app/page.tsx`, `app/layout.tsx` | Replace with FORGE harness (FORGE-007) | NOT STARTED |
| TD-02 | `globals.css` sets `font-family: Arial` on `body`, overriding the Geist variables defined in `layout.tsx` | Low | Inspect computed font | `client-end/app/globals.css` | Move to token-based font stack (Ui-regitry §B.3) | NOT STARTED |
| TD-03 | `next/font/google` (Geist) needs network at build and cannot be used inside a VS Code webview (CSP, offline) | Medium | `next build` offline | `client-end/app/layout.tsx` | Harness-only; webview uses VS Code font variables (ADR-009) | NOT STARTED |
| TD-04 | `next.config.ts` enables `experimental.agentFeedback`, `cacheComponents`, `partialPrefetching` and a custom turbopack Tailwind rule; compatibility with the planned component sharing is unverified | Medium | — | `client-end/next.config.ts` | Verify against `node_modules/next/dist/docs` before relying on it (UNKNOWN) | NOT STARTED |
| TD-05 | No root `package.json`; no workspace, CI, license, or `.gitignore` at root | High | `ls` | repo root | FORGE-001, 008, 066 | NOT STARTED |
| TD-06 | `client-end/AGENTS.md` is auto-generated by `next dev` and may be rewritten; root `Agents.md` is the FORGE contributor guide | Low | `npm run dev` | `client-end/AGENTS.md` | Keep both; root file links to it (Agents.md §B) | NOT STARTED |
| TD-07 | Case-insensitive filesystem: `Readme.md` ≡ `README.md` | Low | `ls` | root | `README.md` canonical (D-010) | COMPLETED (decision recorded; evidence: single file `README.md`) |
| TD-08 | Untracked `client-end/` and docs: nothing from this audit is committed | Medium | `git status` | repo | Commit when the owner approves (not done by the audit) | NOT STARTED |
| TD-09 | `.next/` build artefacts exist under `client-end/` (git-ignored by `client-end/.gitignore`) | Low | `ls client-end/.next` | `client-end/.gitignore` | None needed | COMPLETED |

---

## F. Decision Log

| ID | Date | Decision | Rationale | Source |
|---|---|---|---|---|
| D-001 | 2026-11-20 | TrueForge owns the agent loop; extension is SDK client + MCP host | Eligibility gate | ADR-001 |
| D-002 | 2026-11-20 | Editor tools served by a loopback Streamable-HTTP MCP server inside the extension host | TrueForge attaches MCP servers by URL (docs); editor APIs live in the extension host | ADR-002; verify via spike S1 |
| D-003 | 2026-11-20 | `propose_edit` queues; `submit_changes` (approval-gated) is the only write path | No silent writes + rubric B4 (TrueForge approval drives review) | ADR-003/014 |
| D-004 | 2026-11-20 | Shadow Workspace for agent verification; fallback to post-accept verification | Keep real tree untouched during runs | ADR-004; spike S6 |
| D-005 | 2026-11-20 | Lexical + structural retrieval first; embeddings optional | Deterministic, explainable, no infra | ADR-005 |
| D-006 | 2026-11-20 | FORGE orchestrates retry/fallback by creating new TrueForge sessions; TrueForge docs list automatic model selection as roadmap | Needed for rubric B3 = 10 | ADR-006 |
| D-007 | 2026-11-20 | Inline diff via decorations + CodeLens + `vscode.diff` | Stable public API only | ADR-007 |
| D-008 | 2026-11-20 | `web-tree-sitter` (WASM) | No native rebuild per Electron | ADR-008 |
| D-009 | 2026-11-20 | **Frontend lives in `client-end/`** (existing Next.js app = component gallery/mock-host harness; `client-end/webview/` = esbuild bundle for the extension) and docs state this location. **Pending owner confirmation.** | The user instructed that docs state the frontend lives in this repository; avoids discarding existing work | ADR-009 |
| D-010 | 2026-11-20 | `README.md` canonical; `Ui-regitry.md` spelling kept as specified | Case-insensitive FS; explicit user filename | TD-07 |
| D-011 | 2026-11-20 | FORGE state lives in extension storage, never in the user's workspace | Task C `git status` must be clean | ADR-013 |
| D-012 | 2026-11-20 | Docs written after reading the competition PDF; design amended for rubric (Review Gate, subagents/deferred loading/compaction, licence/example config/write-up as P0 tasks) | Scoring is anchor-based on demonstrated behaviour | plan §A |
| D-013 | 2026-11-20 | From-scratch build (no declared upstream fork); evaluate reuse of OSS diff/webview patterns with attribution | Smaller surface for the judge call; rules allow reuse if declared | ADR-016 |

---

## G. Next Actions (prioritized)

1. **Confirm the Round 1 deadline** (20 Nov 2026 23:59 IST per the PDF) on the Techfest portal and decide between the full path and the minimum-credible submission ([plan.md R14](plan.md#h-risk-register)).
2. **FORGE-001** — root npm workspaces, strict `tsconfig.base.json`, lint, `.gitignore` (add `.env*`, `dist/`, `*.vsix`).
3. **FORGE-066 / FORGE-068** — add an open-source `LICENSE` and `config/forge.example.json` (cheap eligibility items).
4. **FORGE-002 (spike S1)** — run `npx @truefoundry/trueforge@latest`, configure one model, attach a trivial loopback MCP server, record the outcome.
5. **FORGE-003/004 (spikes S2–S4)** — probe/health behaviour and capture real error payloads for bad key and unreachable endpoint.
6. **FORGE-009** — clone Flask 3.1.3 fixture, confirm commit `22d92470`, record baseline `pytest tests/test_cli.py -q`.
7. **FORGE-010 → 013** — protocol schemas, extension scaffold, webview provider, `client-end/webview` shell (clean the template first: FORGE-007).
8. **FORGE-016 → 018** — TrueForge client wrapper, event normalizer, agent definitions.
9. **FORGE-021 → 028, 071** — MCP server, safety layer, tools, Review Gate.
10. **FORGE-031 → 033** — inline edit end-to-end, then Task A.

*Update this file after each meaningful milestone; do not mark anything COMPLETED without evidence.*
