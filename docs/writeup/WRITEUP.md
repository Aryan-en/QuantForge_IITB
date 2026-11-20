---
title: "FORGE — Editor-native coding agent on TrueForge"
---

## 1. Team
⟦FILL: member names · college/employer · GitHub handles (up to 5)⟧

## 2. Starting point
**From scratch.** No upstream editor project (Cline, Continue, Roo Code, opencode) was forked or copied; no upstream licence to preserve. The only starter code is the unmodified `create-next-app` scaffold in `client-end/`. Open-source dependencies (MIT/BSD-3/ISC) are listed in `THIRD_PARTY_NOTICES.md`; FORGE itself is MIT.

## 3. Architecture on TrueForge
FORGE is a **client and tool host**; **TrueForge owns the agent loop**. The extension never calls a model provider (a CI guard test fails on any provider SDK/host in shipped code).

* **Talking to TrueForge.** `@truefoundry/trueforge-sdk` over HTTP/SSE in **local mode**: `sessions.create` with an inline agent spec (`agents/forge-agent.json`, `agents/forge-inline-edit.json`), `createTurnStream`, `createTurnEvents` (approvals), `subscribeToTurn`/`listTurnEvents` (resume), `sessions.cancel`. Models are TrueForge `provider/model` names only.
* **Editor capabilities as MCP tools.** A loopback Streamable-HTTP MCP server (bearer token, Origin/Host checks) registered through TrueForge's settings API. 11 tools: `read_file`, `search_workspace`, `find_symbol`, `get_file_structure`, `get_context`, `propose_edit`, `submit_changes`, `run_terminal`, `get_diagnostics`, `get_git_status`, `update_plan`. The **agent** chooses which to call and which files to read.
* **Review is driven by TrueForge's tool approval.** `propose_edit` only queues a proposal. `submit_changes` and `run_terminal` are approval-gated: the turn **pauses**, FORGE shows the diff (native diff editor, per-hunk CodeLens, sidebar), and *Allow* applies exactly the hunks the developer accepted via one `WorkspaceEdit`, with an undo journal. Nothing is written without that decision.
* **Harness features used and why.** *Sub-agents* (discovery delegated to a read-only sub-agent so the main context stays small), *deferred tool loading* (`preload_tools` keeps 8 essential tools direct; outlines go through `call_tool`), *compaction* and *large-tool-response offloading* (enabled in the spec), *tool approval* (review gate), *event log* (turn resume after a window reload). Cancellation: TrueForge's `sessions.cancel` waits for running MCP calls, so FORGE also aborts its own tool processes (process group kill).
* **Safety/consistency.** Verification commands run in a disposable shadow copy that already contains the proposed edits, so the real tree is untouched until approval. FORGE state lives outside the workspace, so a failed run leaves `git status` clean.

## 4. How context is selected
No repository is ever concatenated. `get_context` (agent-called) and `@file`/`@symbol` mentions (user-explicit) feed one pipeline: query terms → **ripgrep** per term, **IDF-weighted** (ubiquitous terms ignored) → **Tree-sitter** symbols (Python, TS/JS) matching the query's identifiers → import-graph neighbours and test affinity → score = 1.0·mention + 0.45·text + 0.35·symbol + 0.25·graph + 0.10·test + 0.10·recency, minus penalties (changelogs, lockfiles, generated) → a relevance floor.
**Budget:** default 24 000 tokens (configurable, hard cap, property-tested at 500–24 000). Each file is rendered at the richest tier that fits: *full → symbol excerpts + outline → signatures-only skeleton → path*. Every item carries *reasons*; exclusions carry reasons; the Context tab shows both. Secrets are never returned.
**Measured on Flask 3.1.3 (83 files, ≈17 k lines):** for Task B's wording, `src/flask/cli.py` ranks #1, `tests/test_cli.py` #3, `docs/cli.rst` #7 in ≈0.4 s; for Task A, `helpers.py` #1 citing `get_debug_flag (L28-33)`. Optional SQLite-FTS5 symbol index: cold 195 ms → warm 13 ms.

## 5. Model setup
⟦FILL: every model used, where it ran (provider / local), approximate cost, for the Task A/B/C demo runs⟧
Models are configured **only in TrueForge** (Settings → Models: catalog provider or any OpenAI-compatible endpoint, including local). A user switches with `forge.model.primary` and ordered `forge.model.fallbacks`; with ≥2 models FORGE retries with jittered exponential backoff and then falls back **automatically** (new TrueForge session with a progress handoff). No model-specific code or prompts exist. *CI only:* a scripted fake model stands in for an LLM to test plumbing; it is not used in the demo and says nothing about model quality.

## 6. Scorecard
| Criterion | Claim | Video timestamp | Evidence |
|---|---|---|---|
| A1 Inline edit | Selection → diff opens in editor, per-hunk Accept/Reject, apply, undo | ⟦FILL⟧ | 86-check real-VS-Code suite |
| A2 Agent mode | ≥3 files found without names (cli.py, test_cli.py, cli.rst) | ⟦FILL⟧ | live Task B test; ⟦FILL real-model result⟧ |
| A3 Streaming + cancel | Deltas stream; Stop → UI idle in 22 ms, process tree killed, tree clean | ⟦FILL⟧ | measured in real VS Code |
| B1 Context assembly | Budgeted retrieval, reasons visible, top-7 hits on Task B | ⟦FILL⟧ | 26 context tests incl. Flask golden |
| B2 Diff safety | Per-hunk review; undo restores byte-identical; zero writes pre-approval | ⟦FILL⟧ | property tests, `git status` checks |
| B3 Resilience | 401/unreachable → auto-fallback or clear error; `git status` clean | ⟦FILL⟧ | live + VS Code scenarios; ⟦FILL real run⟧ |
| B4 TrueForge depth | MCP tools; approval drives review; sub-agent + deferred tool + compaction | ⟦FILL⟧ | live sub-agent test; TrueForge Sessions page |
| C1/C2 | This document + demo video | — | — |

## 7. Tools used
Claude Code (Anthropic) wrote most of the code, tests and documentation under the team's direction; ⟦FILL: any other assistants⟧. Runtime: TrueForge, VS Code API, MCP SDK, Tree-sitter, ripgrep, jsdiff, zod, esbuild, Vitest, `@vscode/test-electron`.

## 8. Known limitations and next month
No React UI yet (the registry-designed UI is not built; a compact sidebar ships instead). Real-LLM pass rates for Tasks A/B/C: ⟦FILL: honest results, including failures⟧. Language support is Python and TS/JS. TrueForge must be started with `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]'` (its SSRF guard blocks loopback). The fallback session cannot inherit TrueForge-internal state. VSIX is per-platform and unsigned. With another month: the React UI, more languages, change-impact preview, project memory via TrueForge `memory`, hosted-TrueForge support through a relay, and a published benchmark across models.
