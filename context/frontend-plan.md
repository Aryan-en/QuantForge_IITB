# QuantForge — Frontend Plan

> **Scope:** everything under `client-end/` — the React UI that runs inside the VS Code webview, plus the Next.js harness used to build, test and rehearse it.
> **Governing docs:** [Ui-regitry.md](Ui-regitry.md) (design system and component contract — binding), [architecture.md §B.2 / §E](architecture.md) (message contract and state machines), [plan.md](plan.md) (phases, backlog IDs), [Agents.md](Agents.md) (rules). If this file conflicts with the registry, the registry wins and this file gets fixed.
> **Written:** 2026-11-20. Round 1 deadline is today (23:59 IST), so the plan is ordered so that every step leaves something demonstrable.

---

## 1. What the frontend is (and is not)

The frontend is a **pure renderer**. It receives `HostToWebview` messages, keeps a render-state store, and emits `WebviewToHost` intents (ids and decisions only). It never talks to TrueForge, the filesystem, or the network — that's the extension host's job (eligibility gate: the agent loop runs on TrueForge; the UI only renders its streamed events).

It ships in **two entry points that share one component source** (ADR-009):

| Entry | Path | Purpose | Talks to |
|---|---|---|---|
| **Webview bundle** | `client-end/webview/main.tsx` → esbuild → `client-end/dist/webview/{main.js,main.css}` | The real UI inside VS Code (sidebar + editor-area panel) | `acquireVsCodeApi().postMessage` via `lib/host/vscodeHost.ts` |
| **Next.js harness** | `client-end/app/` | Dev surface: (a) `/` — a VS Code–like frame running the UI against a **mock host** that replays scripted scenarios for Tasks A, B, C; (b) `/gallery` — every component in every state | `lib/host/mockHost.ts` (scripted, in-browser) |

**Honesty rule for the demo:** the competition video must be recorded in **real VS Code with the real extension and real TrueForge**. The mock-host harness exists so the UI can be built, styled and tested before the backend lands, and so the demo flow can be rehearsed. It must never be presented as the product running. Scripted scenarios are labelled "Mock host" in the harness chrome.

---

## 2. What judges see, and which UI delivers it

Points are awarded for what is on screen. The UI is planned backwards from that.

| Rubric | What must be visible | Frontend deliverable |
|---|---|---|
| A1 Inline edit (10) | Diff in the editor, per-hunk accept/reject | Native: CodeLens + decorations (extension side). Webview: inline-edit status + the same `HunkCard` in Review for the inline batch. Harness: `InlineDiffPreview` simulating the editor overlay for rehearsal |
| A2 Agent mode (10) | One request → tool loop → ≥3 files found unprompted | `AgentWorkspace`: `MessageList`, `ToolActivityCard`s (`search_workspace`, `read_file`, `get_context`…), `SubagentCard`, `PlanViewer` |
| A3 Streaming + cancel (10) | Tokens arrive live; Stop is immediate; workspace consistent | `AssistantMessage` with live caret, rAF-batched deltas, `StatusStrip`, Stop/Esc → *Cancelling* < 200 ms → "Cancelled — nothing was written" |
| B1 Context (15) | "Which files it chose and why", with a size budget | `ContextInspector`: tier badges, score bars, reason chips, `BudgetMeter` (used/budget, per-tier stack), excluded list with reasons |
| B2 Diff safety (10) | Per-hunk review + working undo on screen | `DiffReview`: file list, `HunkCard` (Accept/Reject, state chips), Apply accepted, **Undo last batch** with toast |
| B3 Resilience (10) | Clear message or automatic fallback; workspace unchanged | `ErrorBanner` (classified code, plain language), `FallbackBanner` ("Primary failed: MODEL_AUTH → switched to fallback"), `ModelStatusChip` state changes, retry countdown |
| B4 TrueForge depth (10) | Approval drives diff review; context-engineering feature visible | `ApprovalCard` for `submit_changes` (Review Gate) and `run_terminal`; `SubagentCard` for subagent threads; timeline rows for deferred tool loads and compaction; "Open session in TrueForge" link |
| C1 Video (10) | Legible outcomes | High-contrast, legible type at 1080p; state changes are text, not only colour |

---

## 3. Information architecture

Follows Ui-regitry §C.2. Sidebar (narrow, ≥ 280 px):

```
┌ Header: QuantForge · [Session ▾] · [● model] · [+] ┐
├ Tabs: Agent | Context | Plan | Review (n) | Timeline ┤
│  ErrorBanner / FallbackBanner (when present)          │
│  Active tab body (scrolls)                            │
├ StatusStrip (phase · elapsed · tokens)               ┤
└ Composer (@mentions · Send ▶ / ■ Stop)               ┘
```

Wide panel (≥ 700 px, editor-area webview — what we use for the recorded demo): two panes — conversation left, Context/Review/Plan/Timeline right.

Pushed views: **Welcome** (no connection/model), **Model Configuration**, **Settings** (back button + Esc).

---

## 4. Directory layout (created in `client-end/`)

```
client-end/
├─ app/                         # Next.js only (harness) — may import next/*
│  ├─ layout.tsx                # QuantForge metadata, tokens, no Google fonts in shared code
│  ├─ page.tsx                  # VS Code–like frame + scenario controller (mock host)
│  └─ gallery/page.tsx          # every component × state
├─ webview/
│  ├─ main.tsx                  # mounts <ForgeApp host={vscodeHost}/>
│  └─ build.mjs                 # esbuild bundle + Tailwind CLI → dist/webview
├─ components/
│  ├─ ui/                       # primitives (registry E.1) — no next/* imports
│  └─ forge/                    # product components (registry E.2) — no next/* imports
├─ lib/
│  ├─ protocol/                 # TEMP mirror of packages/protocol (types + zod). Replaced by
│  │                            #   `@forge/protocol` once FORGE-010 lands; same names, same shapes
│  ├─ host/                     # Host interface, vscodeHost, mockHost, HostProvider/useHost
│  ├─ store/                    # reducer: HostToWebview → AppViewState (render state only)
│  ├─ scenarios/                # scripted event sequences for Tasks A/B/C + cancel + fallback
│  ├─ cn.ts  format.ts  a11y.ts
└─ styles/tokens.css            # registry §B.1, imported by app/globals.css and webview css
```

Rules (from the registry/Agents.md): components are presentational (props in, callbacks out); only `lib/host` touches `postMessage`; no raw hex in TSX; Lucide icons only, using the registry's fixed mapping; nothing in `components/` or `lib/` imports `next/*`.

---

## 5. Data contract the UI codes against

Mirrors [architecture.md §B.2](architecture.md#b2-webview-ui). Every envelope is `{ v: 1, id, type, payload }`.

- **Host → Webview:** `state.snapshot` · `timeline.event` · `stream.delta` · `review.updated` · `error.notify`, plus UI-scoped events we need and will add to the protocol package: `context.updated` (get_context bundle), `plan.updated` (update_plan), `approval.requested`, `turn.status`, `model.status`.
- **Webview → Host:** `ready` · `task.submit` · `turn.cancel` · `approval.decide` · `review.hunk` · `review.bulk` (`acceptAll | rejectAll | apply | undo`) · `settings.update` · `file.open` · `diff.open` · `mention.query`.

Any additions are recorded here **and** proposed to `architecture.md §B.2` so the extension implements the same shapes. Until `packages/protocol` exists, `lib/protocol` is the single definition; the switch is an import-path change.

`TimelineEvent` kinds rendered: `session.start`, `user.message`, `model.call`, `tool.call` (requested/running/succeeded/failed/denied/aborted), `approval.requested`, `approval.decided`, `subagent.start/done`, `tool.deferred_load`, `context.compaction`, `test.run`, `model.retry`, `model.fallback`, `turn.done` (done/cancelled/error).

---

## 6. State inside the webview

One reducer, `lib/store/reducer.ts`, folds host messages into `AppViewState`:
`connection`, `model {primary, fallbacks, active, status}`, `session {id, title, trueforgeUrl}`, `turn {id, status: idle|running|paused|cancelling|cancelled|done|error, phase, startedAt, tokens}`, `messages[]`, `toolCalls{}`, `subagents{}`, `context {items, excluded, searches, usedTokens, budgetTokens}`, `plan[]`, `review {files, hunks, batch, lastApplied}`, `approval?`, `timeline[]`, `errors[]`, `ui {tab, …}`.

Turn and hunk transitions follow architecture §E.2 / §E.4 exactly; the reducer refuses transitions those diagrams don't allow (prevents a late event resurrecting a cancelled turn — the "late-event guard" on the UI side).

**Optimistic UI only where safe:** Stop flips to *Cancelling* immediately (spec: < 200 ms); hunk Accept/Reject marks locally and the host confirms. **Apply never shows "Applied" until the host says so** — the human owns the write and the UI never implies a write that didn't happen.

Streaming: deltas are appended to a buffer and flushed once per animation frame, so 10k deltas don't cause 10k renders.

---

## 7. Visual direction — "quiet surfaces, ember signal"

The registry fixes the tokens (dark `#0b0d10` base, single **ember** accent `#f5792a`, semantic state colours, 13 px body, mono for code/paths/tool names, 4 px spacing, radius 2/4/6/8). Within those rules, "striking" comes from:

1. **One accent, used sparingly** — ember marks only the live thing: the running turn, the caret, the primary action, the active tab rail. Everything else is neutral, so the eye goes where the action is in the video.
2. **Live run signal** — a 2 px ember progress rail under the header while a turn runs (indeterminate, disabled under reduced motion), and the `StatusStrip` phase text ("Reading `src/flask/cli.py`…").
3. **Context Inspector as the hero visual** — dense table with tier badges, horizontal score bars and a stacked per-tier budget meter. It's the part that's worth the most points (B1 = 15), so it gets the most care.
4. **Diffs that read at 1080p** — mono 13 px, `+`/`−` glyph gutter, tinted add/delete backgrounds, line numbers, per-hunk rationale in muted text above the code.
5. **Motion within registry limits** — 80/140/220 ms, `cubic-bezier(0.2,0,0,1)`; no typewriter easing; nothing animates under `prefers-reduced-motion`.
6. **Inherits VS Code theme in the webview** — tokens fall back to `--vscode-*` vars, so it looks native in the judge's theme; the harness uses the standalone dark values.

The harness frame (title bar, activity bar, file tree, editor with Flask's `helpers.py`, status bar) is drawn with the same tokens so rehearsal screenshots look like the real thing; it is clearly marked "QuantForge UI harness · mock host".

---

## 8. Build order (frontend phases)

Each step maps to plan.md backlog IDs and leaves something runnable.

| Step | Deliverable | Backlog | Done when |
|---|---|---|---|
| **F0** | Clean template; `styles/tokens.css`; Tailwind `@theme inline` aliases; `cn`, format helpers; deps: `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `zod` | FORGE-007, 013 | `/` renders QuantForge shell; no template content; typecheck + lint green |
| **F1** | `lib/protocol` (types + zod), `lib/store` reducer, `lib/host` (interface, `HostProvider`, `useHost`, mock host) | FORGE-010 (UI mirror) | Reducer handles every message type; invalid messages dropped and logged |
| **F2** | Primitives: Button, IconButton, Input/Textarea, Tabs (WAI-ARIA), Chip, Badge, Tooltip, Dialog, Skeleton, Spinner, ProgressBar, Toast, ScrollArea (stick-to-bottom), CodeBlock | registry E.1 | Gallery shows each with states |
| **F3** | Agent workspace: AppShell, header (SessionSwitcher, ModelStatusChip), TabBar, MessageList, UserMessage, AssistantMessage (safe mini-markdown, live caret), ToolActivityCard, SubagentCard, ApprovalCard, StatusStrip, Composer (+ MentionPicker), cancel flow | FORGE-039, 050, 051 (UI) | Scenario B streams end-to-end in the harness; Stop works at any point |
| **F4** | DiffReview, FileDiffList/Row, HunkCard (per-hunk accept/reject, state chips, stale/conflict), Apply/Undo + toast; `InlineDiffPreview` for harness Task A | FORGE-037, 032 (UI) | Accept 2 / reject 1 → Apply → Undo works in the mock |
| **F5** | ContextInspector, ContextItemRow, BudgetMeter, search list, excluded list; PlanViewer/PlanStep; ExecutionTimeline/TimelineRow with filters | FORGE-047, 040, FORGE-012 timeline | Task B scenario fills all three with real-looking Flask data |
| **F6** | Resilience: ErrorBanner, FallbackBanner, ModelConfigPanel, Welcome (ConnectionCard), SettingsPanel | FORGE-055, 014, 057 | Scenario C shows retry → fallback banner → diff; and no-fallback → clear error, "No files changed" |
| **F7** | Harness: VS Code–like frame, scenario controller (A / B / C-error / C-fallback / cancel-mid-run), speed control | FORGE-061 base | All five scenarios play from a clean reload |
| **F8** | Webview entry + esbuild/Tailwind build → `dist/webview`; CSP-safe (no inline scripts, no remote fonts); `vscodeHost` bridge | FORGE-012, 013 | `npm run build:webview` emits bundle; extension team loads it in `WebviewViewProvider` |
| **F9** | Polish: themes (dark/light/HC via body classes), widths 280–900 px, keyboard map (A/R, Ctrl+Enter, Esc, `?`), aria-live, axe pass, Playwright snapshots | FORGE-058, 059, 061 | axe 0 serious/critical; keyboard-only flows pass |

**Today's cut (deadline 23:59 IST):** F0 → F7 in the harness, F8 scaffolded. F9 and the Playwright suite follow. Nothing here is marked COMPLETED in `progress_tracker.md` until it's verified (typecheck, lint, manual run recorded).

---

## 9. Scripted scenarios (mock host) — mirror the fixed tasks

Data is realistic Flask 3.1.3 content so rehearsal matches the live demo.

- **A — Inline edit:** selection `get_debug_flag` in `src/flask/helpers.py` → instruction → stream short rationale → one proposal, 2 hunks (logic + docstring) → per-hunk accept → apply → undo available.
- **B — Agent mode:** task text verbatim → `get_context` (bundle: `src/flask/cli.py` Full, `tests/test_cli.py` Symbols, `docs/cli.rst` Skeleton, … with reasons and a 24k budget) → subagent "discover CLI command registration" → `search_workspace "routes_command"` → `read_file` ×3 → `update_plan` (4 steps) → `propose_edit` ×3 → `run_terminal pytest tests/test_cli.py -q` (approval card → allow → passes in shadow) → `submit_changes` (Review Gate approval) → review 3 files / 5 hunks.
- **C-error:** primary endpoint unreachable → retry 1/3, 2/3, 3/3 with backoff countdown → `ErrorBanner TRUEFORGE_UNREACHABLE/MODEL_UNREACHABLE` "No files were changed" → editor stays interactive.
- **C-fallback:** primary `MODEL_AUTH` → `FallbackBanner` → same Task A completes on fallback model.
- **Cancel:** start B → Stop mid-stream → *Cancelling* → "Cancelled — nothing was written"; queued proposals appear as "From cancelled turn".

The extension's real `EventNormalizer` must emit the same message shapes; the scenarios double as fixtures for its tests.

---

## 10. Integration hand-off to the extension (when TrueForge lands)

1. Extension registers `WebviewViewProvider` `forge.sidebar` + panel, loads `dist/webview/main.{js,css}` with a nonce CSP.
2. Host posts `state.snapshot` on `ready`, then incremental events from `EventNormalizer` (TrueForge SSE → `TimelineEvent`/`stream.delta`/…).
3. Host handles intents: `task.submit` → `sessions.createTurnStream`; `turn.cancel` → `sessions.cancel`; `approval.decide` → `user.tool_approval`; `review.*` → Diff Engine.
4. Swap `lib/protocol` import for `@forge/protocol`; delete the mirror.
5. Inline edit's in-editor diff (CodeLens/decorations) is native extension code; the webview only mirrors its hunks in Review.

---

## 11. Quality gates

- `npx tsc --noEmit` and `npm run lint` green on every change (Agents.md §G).
- No `next/*` imports under `components/` or `lib/` (grep check).
- No raw hex in `.tsx` (grep check); tokens only.
- Accessibility: visible focus everywhere, ARIA tabs, `role="log"` for messages, one polite live region for state changes, `role="alert"` for errors, `+`/`−` glyphs alongside diff colours.
- Performance: rAF-batched deltas; timeline virtualised above 200 rows (F9).

## 12. Open questions

1. ADR-009 split (Next harness + esbuild webview) — still pending owner confirmation in the decision log; this plan assumes it.
2. Protocol additions in §5 need agreement with whoever owns `packages/protocol` / the extension.
3. Exact TrueForge error payloads (spike S4) decide the copy in `ErrorBanner`; the UI uses the classification codes from architecture §B.7 until then.

---

## 13. Status (2026-11-20)

F0–F9 done for the standalone UI: 7 Playwright checks pass (inline edit, agent mode, offline, fallback, cancel, axe in dark and light). Typecheck, lint and build are clean.

**Not done: integration.** The extension on `main` does not load `client-end/dist/webview`; it renders its own simple page (`packages/extension/src/webviewHtml.ts`) and speaks a different wire format from `lib/protocol` (flat messages, a different state snapshot, no `reset`/`review.file`/`session.*` intents, `turn.cancel` requires a session id). Closing this needs an adapter between the two formats plus loading the bundle in the webview provider. Still unverified: behaviour inside real VS Code, themes beyond dark/light, widths below 360 px.
