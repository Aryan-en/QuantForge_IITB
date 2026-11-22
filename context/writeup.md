QuantForge
Think. Understand. Engineer. Verify.
An editor-native coding agent for VS Code whose agent loop runs on TrueForge  ·  TrueFoundry Forge-a-thon, Techfest IIT Bombay 2026-27  ·  Round 1 write-up
11 editor tools exposed over MCP   ·   0 disk writes before you approve   ·   per-hunk review + byte-exact undo   ·   auto model fallback   ·   24k-token hard context budget
1. Team
Kanavpreet Singh
GitHub @Kanavpreet-Singh
React sidebar UI, extension integration, UI tests
Punjab Engineering College, Chandigarh
Aryan Singh
GitHub @Aryan-en
TrueForge client, MCP tools, context and diff engines, VS Code extension
Punjab Engineering College, Chandigarh
Ananay Dubey
GitHub @FTS18
Research, documentation and write-up
Punjab Engineering College, Chandigarh

 
2. Starting point
From scratch. No upstream editor project (Cline, Continue, Roo Code, opencode) was forked or copied, so there is no upstream licence to preserve and no fork commit to declare. The only starter code is the unmodified create-next-app scaffold under client-end/. QuantForge is MIT-licensed; dependency licences are listed in THIRD_PARTY_NOTICES.md.
3. Architecture on TrueForge
TrueForge owns the agent loop; QuantForge is its client and tool host. The extension never calls a model provider. A guard test fails the build if any provider SDK or API host appears in shipped code, including the UI.

Figure 1. The UI sends only ids and decisions, never file contents to write. Every message is schema-validated on both sides.
•     Editor capabilities as MCP tools. read_file, search_workspace, find_symbol, get_file_structure, get_context, propose_edit, submit_changes, run_terminal, get_diagnostics, get_git_status, update_plan. The agent decides which to call and which files to read; the extension never pre-selects files beyond your explicit @mentions.
•     TrueForge approval drives the review. propose_edit only queues a proposal. submit_changes and run_terminal are approval-gated, so the turn pauses. QuantForge shows the diff (native editor, CodeLens per hunk, sidebar). Allow applies exactly the hunks you accepted as one undoable batch.
•     Harness features used, and why. Sub-agents do wide discovery so the main context stays small; deferred tool loading keeps 8 tools preloaded and fetches the rest on demand; compaction and large-result offloading are enabled in the spec; tool approval is the review gate; the event log lets a turn resume after a window reload. All are visible in the TrueForge session and in QuantForge's Timeline.
•     Cancellation and consistency. TrueForge's sessions.cancel waits for running MCP calls, so QuantForge also aborts its own tool processes (whole process group). Verification runs in a disposable shadow copy that already contains the proposed edits, so a failed or cancelled run leaves git status clean.
4. How context is selected
A repository is never concatenated into the prompt. The agent-called get_context and your explicit @file / @symbol mentions feed one pipeline that ranks, then packs to a hard token budget: query terms → ripgrep per term, IDF-weighted (ubiquitous terms ignored) → Tree-sitter symbols matching identifiers (Python, TS/JS) → import-graph neighbours and test affinity → score (mention 1.0, text .45, symbol .35, graph .25, test .10, recency .10) → pack each file at the richest tier that fits.
•     Budget. Default 24,000 tokens, configurable, a hard cap that is property-tested from 500 to 24,000. Tiers: Full → symbol excerpts + outline → signatures-only skeleton → path only. Penalties push down changelogs, lockfiles and generated files; a relevance floor drops weak matches; secret files are never returned.
•     The reasoning is visible. Every selected item shows why it was chosen and every exclusion shows why it was left out. The Context tab renders tier badges, relevance bars and a stacked budget meter, which is what judges see during Task B.
•     Measured on Flask 3.1.3 (83 files, about 17k lines): for Task B's wording, src/flask/cli.py ranks #1, tests/test_cli.py #3 and docs/cli.rst #7 in about 0.4 s. For Task A, helpers.py ranks #1, citing get_debug_flag (L28-33). An optional SQLite FTS5 symbol index takes lookups from 195 ms cold to 13 ms warm.
5. Model setup
Models are configured only inside TrueForge (Settings → Models): a catalog provider or any OpenAI-compatible endpoint, including a local one. QuantForge stores model names, never keys, and ships only an example config (config/forge.example.json).
Model
Where it ran
Approx. cost
Used for
model name exactly as shown in TrueForge
Groq hosted API, free tier, through a TrueForge OpenAI-compatible provider
₹0 (free tier)
Tasks A, B and C demo runs
Scripted fake model
Local test server, in CI only
₹0
Plumbing and fault-injection tests; not used in the demo and says nothing about model quality

 
Switching models. Set forge.model.primary and an ordered forge.model.fallbacks list in VS Code settings. With two or more models, QuantForge retries with jittered exponential backoff, then falls back automatically to the next model in a new TrueForge session with a progress handoff. There is no model-specific code or prompt, so the same build runs on whatever model an organiser chooses.
6. Scorecard
Criterion
One-line claim
Evidence
A1 Inline edit (10)
Select code, Ctrl+Alt+K, diff opens in the editor with per-hunk Accept / Reject, apply, undo
86 checks in a real VS Code
A2 Agent mode (10)
One request finds and edits 3+ files with none named: cli.py, test_cli.py, cli.rst
Live Task B test against real TrueForge (scripted model)
A3 Stream + cancel (10)
Tokens stream live; Stop returns the UI to idle in 22 ms, kills the process tree, tree stays clean
Measured in real VS Code
B1 Context (15)
Budgeted retrieval with strategy stated, reasons and a budget meter visible during Task B
26 context tests incl. Flask golden
B2 Diff safety (10)
Per-hunk review; undo restores byte-identical files; zero writes before approval
Property tests; git status checks
B3 Resilience (10)
Bad key or unreachable endpoint: automatic fallback or a clear error; workspace unchanged
Live and VS Code scenarios with injected 401 and unreachable-endpoint failures
B4 TrueForge depth (10)
MCP tools; approval drives review; sub-agent, deferred loading and compaction in the session
Live sub-agent test; Sessions page
C1 Video / C2 Write-up
Tasks A, B, C in order, each verified on screen; this document
Public links submitted

 
7. Tools used
•     AI coding assistants: Claude Code (Anthropic) wrote most of the code, tests and documentation under the team's direction.
•     Runtime and libraries: TrueForge and its TypeScript SDK, VS Code Extension API, Model Context Protocol SDK, Tree-sitter (WASM), ripgrep, jsdiff, zod, React 19, Next.js 16, Tailwind CSS 4, Lucide icons, esbuild.
•     Testing: Vitest, @vscode/test-electron, Playwright and axe-core.
8. Known limitations and what we would do with another month
Limitations, stated plainly
•     No real-LLM pass rate yet. When this was written, Tasks A, B and C had not been run end to end with a real model; the demo video shows those runs. The backend was verified with a scripted model, which tests the plumbing, not model quality.
•     The React UI is new in the extension. It is built, passes browser and accessibility tests against the extension's real message format, and is loaded by the extension, with the older built-in sidebar as a fallback. It has had less time in a real VS Code than the backend (86 checks).
•     Python and TS/JS only for symbol-aware retrieval.
•     TrueForge setup: start it with OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]', because its SSRF guard blocks loopback tool servers.
•     A fallback model gets a new session with a progress summary; TrueForge-internal state does not carry over. The VSIX is per-platform and unsigned.
•     Windows: part of the backend test suite was written for macOS or Linux and does not pass on Windows yet.
With another month
•     Change-impact preview: show the files and tests likely affected before you apply.
•     More languages (Go, Rust, Java) as a grammar plus a query file each.
•     Project memory through TrueForge's memory feature, plus a team-owned notes file.
•     Embedding retrieval routed through TrueForge-configured models, alongside the lexical and structural ranker.
•     Hosted TrueForge through a relay, so teams can share one agent runtime.
•     A published benchmark of the same tasks across several models, with honest pass rates; review workflows with a reviewer agent and a test-writer agent.
