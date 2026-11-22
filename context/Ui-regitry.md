# QuantForge — UI Registry (Design System and Component Catalogue)

> **Filename note:** `Ui-regitry.md` keeps the spelling requested by the project owner; do not "fix" it without updating every link in the six docs.
> **Frontend location:** all frontend code lives in this repository at `/Users/aryansingh/Documents/QuantForge_IITB/client-end/` (Next.js 16 / React 19 / Tailwind CSS 4 scaffold, per `client-end/package.json`). Components are shared between (a) the Next.js app — component gallery and mock-host harness — and (b) the VS Code webview bundle at `client-end/webview/` ([architecture.md ADR-009](architecture.md#i-architectural-decision-records)).
> **Implementation status (2026-11-22):** a React UI built from this registry now exists in `client-end/` and is bundled to `dist/webview`, which the extension prefers; I have not verified it inside VS Code. Before that, and still as the fallback, the extension ships a compact vanilla-JS sidebar (`packages/extension/src/webviewHtml.ts`: Agent, Context, Plan, Review, Timeline tabs, approval card, CodeLens/native diff in the editor). The React components below are **not built**; `client-end/` is frozen. The webview message contract is implemented in `packages/protocol/src/messages.ts` (including `review.openDiff` and `command.run`).
> **Original status note:** the repository contains **no QuantForge UI yet**. Everything below is **PLANNED** unless a component's *Status* says otherwise; at the time of writing none is implemented ([progress_tracker.md](progress_tracker.md)).
> **Related:** [architecture.md](architecture.md) · [plan.md](plan.md) · [Agents.md](Agents.md) · [README.md](../README.md)

---

## A. Design Philosophy

QuantForge should feel **premium, minimal, technical, professional, trustworthy, developer-centric, fast, intuitive**. Inspiration is the *quality bar* of Cursor, Linear, VS Code, Raycast, GitHub Desktop — dense information, calm surfaces, immediate feedback, keyboard-first — without copying any layout, icon set, or branding.

Principles (decisions, not slogans):
1. **Native first.** QuantForge lives inside VS Code. Use native surfaces where they exist (Activity Bar, editor decorations, CodeLens, diff editor, notifications for fatal errors, Problems/terminal) and a webview only for what VS Code cannot render (conversation, timeline, inspector, review queue).
2. **Show the work.** Every automatic decision (files chosen, tool called, command run) is visible with its reason. Trust comes from transparency.
3. **The human owns the write.** The strongest visual affordance in the product is the review control; nothing implies something was saved when it was not.
4. **Quiet by default.** Neutral surfaces, one accent color; semantic colors only for state (success, warning, danger, info).
5. **Fast.** No animation > 220 ms; streaming text never reflows the page; lists virtualize beyond 200 rows.
6. **Accessible.** Keyboard-complete, visible focus, screen-reader announcements for streaming and state changes.

---

## B. Visual Design System

### B.1 Token architecture

Three layers, defined once in `client-end/styles/tokens.css` (PLANNED) and consumed through Tailwind 4 `@theme inline` — **no hard-coded colors in components**.

1. **Host layer** — VS Code theme variables (`--vscode-editor-background`, `--vscode-foreground`, `--vscode-focusBorder`, …). In the webview, surfaces and text *inherit these* so QuantForge always matches the user's theme (including high contrast).
2. **QuantForge semantic tokens** — `--forge-*`. Default values fall back to the host layer; the *standalone* values below apply in the Next.js harness (no VS Code) and as fallbacks.
3. **Tailwind aliases** — `@theme inline { --color-surface: var(--forge-surface); … }` so classes like `bg-surface`, `text-muted`, `border-default` work.

```css
/* client-end/styles/tokens.css (PLANNED) */
:root {                                   /* standalone dark = default */
  --forge-bg:            var(--vscode-sideBar-background, #0b0d10);
  --forge-surface:       var(--vscode-editor-background,  #12151a);
  --forge-raised:        var(--vscode-editorWidget-background, #181c22);
  --forge-overlay:       var(--vscode-menu-background,    #1f242c);
  --forge-border:        var(--vscode-panel-border,       #2e3540);
  --forge-border-subtle: color-mix(in srgb, var(--forge-border) 50%, transparent);
  --forge-text:          var(--vscode-foreground,         #e6e9ee);
  --forge-text-muted:    var(--vscode-descriptionForeground, #a3acb9);
  --forge-text-faint:    #6e7886;
  --forge-accent:        #f5792a;           /* "ember" — QuantForge brand accent */
  --forge-accent-hover:  #ff8f4a;
  --forge-accent-fg:     #1a0e05;
  --forge-focus:         var(--vscode-focusBorder, #58a6ff);
  --forge-success:       #3fb950;  --forge-warning: #d29922;
  --forge-danger:        #f85149;  --forge-info:    #58a6ff;
  --forge-diff-add-bg:   rgba(63,185,80,.16);   --forge-diff-add-fg: #7ee787;
  --forge-diff-del-bg:   rgba(248,81,73,.16);   --forge-diff-del-fg: #ff7b72;
  --forge-diff-chg-bg:   rgba(210,153,34,.16);
}
body.vscode-light, :root[data-theme="light"] {
  --forge-bg: #f6f8fa;  --forge-surface: #ffffff;  --forge-raised: #ffffff;  --forge-overlay: #ffffff;
  --forge-border: #d0d7de;  --forge-text: #1f2328;  --forge-text-muted: #57606a;  --forge-text-faint: #8c959f;
  --forge-accent: #c2510f;  --forge-accent-hover: #a8430a;  --forge-accent-fg: #ffffff;
  --forge-success: #1a7f37; --forge-warning: #9a6700; --forge-danger: #cf222e; --forge-info: #0969da;
  --forge-diff-add-bg: rgba(26,127,55,.12);  --forge-diff-add-fg: #1a7f37;
  --forge-diff-del-bg: rgba(207,34,46,.12);  --forge-diff-del-fg: #cf222e;
}
body.vscode-high-contrast, body.vscode-high-contrast-light { /* use host variables only; borders 1px solid var(--vscode-contrastBorder) */ }
```

All text/background pairs must meet WCAG 2.1 AA (4.5:1 for body text, 3:1 for large text and UI boundaries). The hex values above are **proposed**; a contrast-check script (planned, FORGE-059) must confirm them and values change if it fails.

### B.2 Color palette (standalone values)

| Role | Dark | Light | Usage |
|---|---|---|---|
| `bg` | `#0b0d10` | `#f6f8fa` | Sidebar/page background |
| `surface` | `#12151a` | `#ffffff` | Cards, panels |
| `raised` | `#181c22` | `#ffffff` | Inputs, hovered rows |
| `overlay` | `#1f242c` | `#ffffff` | Menus, popovers, dialogs |
| `border` | `#2e3540` | `#d0d7de` | Dividers, outlines |
| `text` / `muted` / `faint` | `#e6e9ee` / `#a3acb9` / `#6e7886` | `#1f2328` / `#57606a` / `#8c959f` | Primary / secondary / metadata (faint is decorative only; never the sole carrier of meaning) |
| `accent` | `#f5792a` | `#c2510f` | Primary actions, active tab marker, progress |
| `success` `warning` `danger` `info` | `#3fb950` `#d29922` `#f85149` `#58a6ff` | `#1a7f37` `#9a6700` `#cf222e` `#0969da` | State only |
| Diff add / delete / change | see tokens | see tokens | Hunk backgrounds (always paired with `+`/`−` glyphs, never color alone) |

### B.3 Typography
- **Sans:** `var(--vscode-font-family)` (system UI stack in the harness). **Mono:** `var(--vscode-editor-font-family)`. The webview does not load web fonts (CSP, offline). The harness's `next/font` Geist is for the gallery only.
- Sizes (px): `11` meta · `12` secondary · **`13` body (default; follows `--vscode-font-size`)** · `14` emphasized · `16` section title · `20` welcome title.
- Weights: `400` body, `500` labels/buttons, `600` titles. Line height: `1.45` body, `1.3` titles, `1.5` code.
- Code, paths, tool names, token counts and commands always use mono. Numbers in tables use `font-variant-numeric: tabular-nums`.

### B.4 Spacing, radius, borders, shadows
- **Spacing scale (4 px base):** `0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48` (Tailwind: `0, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12`). Component padding: compact rows `4/8`, cards `12`, sections `16`.
- **Radius:** `2` (chips, inline code) · `4` (inputs, buttons) · `6` (cards) · `8` (dialogs/popovers) · `9999` (status dots, pills).
- **Borders:** 1 px `border` for containers; 1 px `border-subtle` for list separators. Prefer borders over shadows in dark mode.
- **Shadows:** `sm: 0 1px 2px rgba(0,0,0,.25)` · `md: 0 4px 12px rgba(0,0,0,.30)` · `lg: 0 8px 24px rgba(0,0,0,.35)`; menus/popovers use `md`, dialogs `lg`. No shadows on in-flow cards.

### B.5 Iconography
- **Lucide** (`lucide-react`), 16 px default (14 in dense rows, 20 in empty states), stroke 1.5, `currentColor`. Icons never carry meaning alone — pair with text or `aria-label`.
- Native VS Code surfaces (status bar, tree views, command palette) use **codicons** (`$(sparkle)` etc.). Do not mix the two in one component.
- Mapping (fixed): agent `Bot` · inline edit `Wand2` · file `FileText` · symbol `Braces` · search `Search` · terminal `Terminal` · git `GitBranch` · diff `GitCompare` · accept `Check` · reject `X` · undo `Undo2` · cancel `Square` · model `Cpu` · warning `TriangleAlert` · error `CircleAlert` · context `Layers` · plan `ListChecks` · settings `Settings`.

### B.6 Motion
- Durations: `80 ms` (hover/press), `140 ms` (expand/collapse, tab change), `220 ms` (panel/dialog enter). Easing `cubic-bezier(0.2, 0, 0, 1)`; exit uses `ease-in` at 80 %.
- Streaming text appears without animation (no typewriter easing); a 1-frame caret `▍` marks the live end.
- `@media (prefers-reduced-motion: reduce)`: all transitions → `0 ms`, spinners → static "Working…" text with pulsing disabled.

### B.7 States
| State | Rule |
|---|---|
| Hover | `raised` background; interactive text brightens one step; cursor `pointer` only on actionable elements |
| Focus | 2 px `focus` outline, 2 px offset, on **every** interactive element (`:focus-visible`); never `outline: none` without replacement |
| Active/pressed | `translateY(0)`, background one step darker; 80 ms |
| Disabled | `opacity .5`, `cursor: not-allowed`, `aria-disabled="true"`; tooltip explains *why* (e.g. "Nothing to undo") |
| Loading | Skeleton rows for lists (≤ 3 rows), inline spinner (16 px) for actions, determinate bar for budgets; always `aria-busy` on the region |
| Error | `danger` border-left 2 px + icon + plain-language message + next action; message text uses `text`, not `danger` color, for contrast |
| Success | `success` check icon + short message, auto-dismiss 4 s unless it contains an Undo action |
| Streaming | live region `aria-live="polite"` batched at sentence boundaries (not per token) |

---

## C. Application Layout

### C.1 Integration with VS Code (what is native vs. webview)

| Concern | Surface | Rationale |
|---|---|---|
| Entry point | **Activity Bar** icon "QuantForge" → `forge.sidebar` view container | Standard discoverability |
| Main experience | **Primary Sidebar webview view** (`WebviewViewProvider`); optional "Open in Editor Area" panel for wide layouts (`forge.openPanel`) | Narrow-first, can be widened |
| Inline edit | **Editor**: selection → command/keybinding → `showInputBox` for the instruction → decorations + CodeLens | Native, no webview latency |
| Per-hunk review in code | **CodeLens** (`Accept` · `Reject`) + decorations; side-by-side via native `vscode.diff` on `forge-proposed:` documents | Uses VS Code's own diff editor |
| Terminal | Commands run in the Shadow Workspace; output summarized in Timeline; "Open in Terminal" link opens a VS Code terminal | Don't reinvent the terminal |
| Status | **Status bar item** `$(sparkle) QuantForge · <model>` with connection state color; click → Model Configuration | Always visible, tiny |
| Fatal errors | `window.showErrorMessage` (blocking cases such as TrueForge unreachable, with action buttons) | Visible even if sidebar is collapsed |
| Notifications of progress | Sidebar timeline; no toast spam | |
| Settings | VS Code Settings (`forge.*`) for persistence; QuantForge Settings screen is a friendly view over the same keys | One source of truth |

### C.2 Sidebar anatomy (≥ 280 px wide)

```
┌───────────────────────────────┐
│ Header: [Session ▾] [Model●] [+]│  ← SessionSwitcher, ModelStatusChip, NewSession
├───────────────────────────────┤
│ Tabs: Agent | Context | Plan | Review(3) | Timeline │  ← TabBar (Review shows pending-hunk badge)
├───────────────────────────────┤
│                               │
│   Active tab content          │  ← scrolls; composer pinned below on Agent tab
│                               │
├───────────────────────────────┤
│ Composer: [@ mentions…] [Send ▶ / ■ Stop] │
└───────────────────────────────┘
```

- **Agent** tab: conversation (user messages, streamed assistant text, tool-activity cards, approval cards). **Context**: Context Inspector. **Plan**: Plan Viewer. **Review**: Diff Review (default focus when a turn pauses on `submit_changes`). **Timeline**: Execution Timeline. **Settings** and **Model Configuration** open from the header menu and status chip (pushed views with a back button).
- Error notifications: inline `ErrorBanner` at the top of the active tab (persists until dismissed or resolved) + `showErrorMessage` only for blocking conditions.

---

## D. UI Screens and Components

Each screen lists the components it composes (defined in §E).

### D.1 Welcome Screen
- **Shown when:** first run, or no TrueForge connection/model configured.
- **Content:** QuantForge wordmark + one-line tagline ("Think. Understand. Engineer. Verify."); *Connection card* (TrueForge URL, status: Connected / Unreachable / Not configured, button **Start TrueForge** → runs `forge.startTrueForge`, **Check again**); *Model card* (primary model name from TrueForge config, fallback list, status; link "How to configure a model in TrueForge" → opens TrueForge docs); **Start new agent session** (primary button; disabled with reason until connected); **Open documentation** (secondary; opens README).
- **States:** loading (checking connection, skeleton), connected (primary CTA enabled), unreachable (danger banner + instructions + retry), no model (warning banner + link), error (banner with code and `Copy details`).
- **Components:** `ConnectionCard`, `ModelStatusChip`, `Button`, `ErrorBanner`, `EmptyState`.

### D.2 Agent Workspace
- **Conversation interface:** chronological `MessageList` of `UserMessage`, `AssistantMessage` (markdown, streamed), `ToolActivityCard` (collapsed by default: icon, tool, one-line args e.g. `read_file src/flask/cli.py`, duration, status), `ApprovalCard` (when TrueForge pauses), `SubagentCard` (indented thread for subagents), `ErrorBanner`.
- **Task input:** `Composer` with `@` autocomplete (files, symbols), attached-context chips, `Enter` to send, `Shift+Enter` newline; disabled while a turn is active.
- **Execution status:** `StatusStrip` above the composer: `Thinking…` / `Reading files…` / `Waiting for your approval` / `Cancelling…`, elapsed time, token counters (from `turn.done` metrics when available).
- **Streaming output:** appended in place; auto-scroll sticks to bottom unless the user scrolls up (then a "Jump to latest" pill appears).
- **Cancel:** `■ Stop` replaces Send during a turn; `Esc` in the composer triggers it. States: Cancelling (spinner, button disabled) → Cancelled (inline note "Cancelled — workspace unchanged").
- **Session history:** `SessionSwitcher` dropdown lists sessions from `workspaceState` (title = first message, time, turn count); selecting resumes via TrueForge event replay. "Open in TrueForge" link opens the TrueForge Sessions UI for the id.

### D.3 Context Inspector
Purpose: make B1 visible — *which files the agent chose and why*.
- **Selected files / symbols:** table rows `[tier badge] path[:range] · tokens · score bar · reasons (chips)`. Tier badges: `Full`, `Symbols`, `Skeleton`, `Path`. Clicking opens the file at range; keyboard `Enter`.
- **Retrieval reason:** reasons come from `get_context` results (`"mentioned by user"`, `"matches 'get_debug_flag' (3 hits)"`, `"imported by cli.py"`); also lists files the agent read via `read_file` that were *not* in a `get_context` bundle, labeled "read by agent".
- **Token budget and utilization:** `BudgetMeter` (used / budget, color: neutral < 80 %, warning 80–95 %, danger > 95 %) plus per-tier stacked bar.
- **Excluded files:** collapsible list with reason (`over budget`, `ignored by .gitignore`, `lockfile`, `denied: secret`), each with **Include anyway** (adds an `@file` mention to the next turn).
- **Search results:** latest `search_workspace` queries with match counts; click to expand matches.
- **Empty state:** "Context appears here once the agent starts looking at your code. Type @ to add files or symbols yourself."

### D.4 Plan Viewer
- Fed by the agent's `update_plan` tool. Renders an ordered `PlanStep` list: status icon (pending ○, in-progress spinner, done ✓, skipped –), title, related files (chips), dependencies ("after step 2"). Steps are read-only (the user steers via the composer, not by editing steps).
- **Empty state:** "No plan yet — agents plan non-trivial tasks before editing." **Error:** if `update_plan` payload is invalid, show last valid plan plus a muted "Plan update ignored (invalid)".

### D.5 Diff Review
- **Header:** summary (`4 files · 9 hunks · +87 −12`), batch label, **Accept all**, **Reject all**, **Apply accepted** (primary; this is the TrueForge approval *Allow* when the turn is paused on `submit_changes`), **Undo last batch** (enabled after apply).
- **Changed files:** `FileDiffList`; each file row shows status (`M`odified / `A`dded / `D`eleted), path, `+/−` counts, per-file accept/reject, chevron.
- **Hunks:** `HunkCard` with unified diff (3 context lines), line numbers, `+`/`−` glyphs and background, per-hunk **Accept** / **Reject**, state chip (`Pending`, `Accepted`, `Rejected`, `Applied`, `Stale`, `Conflicted`, `Undone`), and the agent's *rationale* for the change ("Change explanation").
- **Open in editor:** per file, opens native `vscode.diff` (original ↔ proposed).
- **Stale/conflict:** `Stale` shows "File changed since the agent read it — Re-base" ; `Conflicted` shows both versions and requires a manual choice. Neither can be accepted until resolved.
- **Undo:** `Undo last batch` → confirm only if the files were edited since apply (diff shown); otherwise immediate with toast "Reverted 4 files — Redo not available".
- **Empty state:** "Nothing to review." **Loading:** skeleton hunks while a proposal is being computed. **Error:** hunk-level error chip with details.

### D.6 Execution Timeline
- Vertical, time-ordered events with icons: session start · user message · model call (with token usage) · tool invocation (`read_file`, `search_workspace`, `find_symbol`, `get_context`, `run_terminal`, `propose_edit`, `submit_changes`) · approval requested/decided · subagent start/finish · test run (exit code, duration) · fallback/retry events · completion/failure/cancellation.
- Each row: timestamp (relative), icon, title, one-line detail, duration, status. Expand → arguments/results (truncated, "Show more"), `Copy`. Filters: All / Tools / Model / Errors. Virtualized for > 200 rows.
- **Evidence mode:** "Open session in TrueForge" shows the same session in TrueForge's Sessions UI (needed for the demo of Task B).
- **Empty:** "No activity yet." **Error rows:** danger icon with classification code (`MODEL_AUTH`, `TRUEFORGE_UNREACHABLE`, …).

### D.7 Model Configuration
- **Active model:** name as configured in TrueForge (`provider/model`), connection status dot (Connected / Degraded / Unreachable / Auth failed) with last-checked time, **Test connection**.
- **Provider configuration status:** read-only summary + "Open TrueForge Settings → Models" button. QuantForge never shows or stores API keys.
- **Fallback configuration:** ordered list of fallback model names (drag handle or ↑/↓ buttons for keyboard users), add/remove; validation message if a name is unknown to TrueForge (when checkable).
- **Retry policy (read-only summary):** "3 attempts, exponential backoff with jitter" + stall timeout setting.
- **Error handling preview:** last failure classification and what QuantForge did (retried/fell back/stopped).

### D.8 Settings
- **Keyboard shortcuts:** list of QuantForge commands with current bindings and "Change in Keyboard Shortcuts" link (opens VS Code UI filtered on `forge.`).
- **Context:** token budget slider/number (`forge.context.budgetTokens`), exclude globs (`forge.context.exclude`), max files, include/exclude secrets toggle (default: excluded, with warning on enable).
- **UI preferences:** theme override (Auto/Dark/Light), density (Comfortable/Compact), show tool details by default, reduced motion (Auto/On).
- **Model configuration guidance:** link/summary to D.7 and TrueForge docs.
- **Agent behaviour:** auto-open Review when a turn pauses (`forge.review.autoOpenOnPause`, default on), require approval for all terminal commands (locked on), stall timeout, iteration limit hint (read-only; defined in agent file), "Run commands in shadow workspace" (default on).
- All values persist as `forge.*` VS Code settings; the screen shows the setting id on hover.

---

## E. Component Registry

**Status key:** PLANNED (none are implemented as of 2026-11-20). **Location root:** `client-end/components/`. `ui/` = generic primitives (shadcn/ui-based where compatible with the webview: Radix primitives, no `next/*` imports); `forge/` = product components. Shared components **must not import from `next/*`** so they run in the webview bundle.

Standard events: components emit callbacks (`onX`) only; they never call `postMessage` directly — only the `useHost()` hook in `lib/host` does.

### E.1 Primitives (`ui/`)
| Component | Purpose | Props | State | Events | Loading | Empty | Error | Accessibility |
|---|---|---|---|---|---|---|---|---|
| `Button` | All actions; variants `primary|secondary|ghost|danger`, sizes `sm|md` | `variant, size, loading?, disabled?, icon?, aria-label?` | pressed | `onClick` | spinner replaces icon, `aria-busy` | — | — | native `<button>`; visible focus; disabled has reason via `title` + `aria-describedby` |
| `IconButton` | Icon-only action | `icon, label (required), …Button` | — | `onClick` | as Button | — | — | `aria-label` mandatory; 24×24 min target |
| `Input` / `Textarea` | Text entry | `value, onChange, invalid?, describedBy?` | focus | `onChange, onSubmit` | — | placeholder | `aria-invalid` + message | associated `<label>` |
| `Tabs` | Section switching | `items[{id,label,badge?}], value` | active | `onChange` | — | — | — | WAI-ARIA tabs: arrows move, Home/End, roving tabindex |
| `Chip` | Reasons, mentions, status | `tone, icon?, removable?` | — | `onRemove` | — | — | — | remove button labelled |
| `Badge` | Counts (e.g. pending hunks) | `count, tone` | — | — | — | hidden at 0 | — | `aria-label="3 pending hunks"` |
| `Tooltip` | Short hints | `content, side` | open | — | — | — | — | shows on focus too; `aria-describedby` |
| `Dialog` | Confirmations | `title, description, actions` | open | `onConfirm, onCancel` | confirm shows spinner | — | inline error | focus trap, `Esc` cancels, focus returns to trigger |
| `DropdownMenu` | Session/Settings menus | `items` | open | `onSelect` | — | — | — | arrow navigation, typeahead |
| `Skeleton` | Loading placeholder | `lines` | — | — | is the loader | — | — | `aria-hidden`; parent `aria-busy` |
| `Spinner` | Inline progress | `size, label` | — | — | — | — | — | `role="status"` with visually-hidden label |
| `ProgressBar` | Budgets, counts | `value, max, tone, label` | — | — | indeterminate variant | — | — | `role="progressbar"` + values |
| `Toast` | Short confirmations (rare) | `tone, message, action?` | visible | `onAction, onDismiss` | — | — | — | `role="status"`; action keyboard reachable; no auto-dismiss if has action |
| `ScrollArea` | Scroll with sticky-bottom option | `stickToBottom?` | atBottom | `onReachBottom` | — | — | — | keyboard scrollable (`tabindex=0`) |
| `CodeBlock` | Mono code/command display | `code, language?, copy?` | — | `onCopy` | — | — | — | copy button labelled; wraps or scrolls, never clipped |

### E.2 Product components (`forge/`)
| Component | Purpose | Props | State | Events | Loading | Empty | Error | Accessibility |
|---|---|---|---|---|---|---|---|---|
| `AppShell` | Header + tabs + body + composer layout | `state: AppState` | active tab | `onTabChange` | skeleton body until first `state.snapshot` | Welcome screen | `ErrorBanner` | landmark roles (`banner`, `main`, `form`) |
| `ConnectionCard` | TrueForge status and start/check actions | `status, baseUrl` | checking | `onStart, onCheck` | spinner on check | — | unreachable guidance | status in text, not color only |
| `ModelStatusChip` | Active model + connection dot; opens D.7 | `model, status` | — | `onOpen` | pulse-free "Checking" | "No model" | tone danger/warning | `aria-label="Model openai/…, connected"` |
| `SessionSwitcher` | Choose/resume session | `sessions, activeId` | open | `onSelect, onNew` | skeleton items | "No sessions yet" | "Couldn't load sessions" | menu semantics |
| `Composer` | Task input, mentions, send/stop | `disabled, running, mentionSource` | text, mentions, caret | `onSubmit, onStop, onMentionQuery` | disabled w/ reason while running | placeholder "Describe a task. Type @ to add files or symbols." | inline "Couldn't send — retry" | `role="combobox"` autocomplete (`aria-activedescendant`); `Enter`/`Shift+Enter`; `Esc` closes list/stops |
| `MentionPicker` | `@file`/`@symbol` suggestions | `query, results` | highlighted | `onPick` | skeleton rows | "No matches" | "Search failed" | listbox semantics |
| `MessageList` | Conversation | `items, running` | stick-to-bottom | `onJumpLatest` | skeleton on resume | — | — | `role="log"` `aria-live="polite"` batched |
| `AssistantMessage` | Streamed markdown | `text, streaming` | — | — | caret while streaming | — | partial-text + error note | headings/links accessible; code blocks focusable |
| `ToolActivityCard` | One tool call | `tool, args, status, durationMs, result?` | expanded | `onToggle, onOpenFile` | spinner while `running` | — | danger status + message | `aria-expanded`; status text |
| `ApprovalCard` | Terminal approval (or generic tool approval) | `callId, tool, command, reason, risk` | pending | `onAllow, onDeny` | disabled after click | — | "Decision failed — retry" | focus moves here when it appears; `role="alertdialog"`-like; shows literal command in `CodeBlock` |
| `SubagentCard` | Indented subagent thread summary | `title, status, steps` | expanded | `onToggle` | spinner | — | error row | nested list semantics |
| `StatusStrip` | Live run status + elapsed + tokens | `phase, elapsedMs, tokens?` | — | — | — | hidden when idle | — | `role="status"` |
| `ContextInspector` | D.3 screen | `bundle, excluded, searches, budget` | filter | `onOpen, onIncludeAnyway` | skeleton | empty copy per D.3 | `ErrorBanner` | table semantics, sortable headers `aria-sort` |
| `ContextItemRow` | One selected item | `item` | — | `onOpen` | — | — | — | reasons readable as list |
| `BudgetMeter` | Used vs. budget, per-tier | `used, budget, byTier` | — | — | indeterminate | `0 / N` | — | `role="meter"` |
| `PlanViewer` / `PlanStep` | D.4 | `steps` | — | `onOpenFile` | skeleton | empty copy | stale-plan note | ordered list; status via text |
| `DiffReview` | D.5 container | `queue: ReviewQueueState, gate?` | filter | `onHunk, onBulk, onApply, onUndo, onOpenDiff` | skeleton | "Nothing to review" | per-hunk error chip | focus order: header actions → files → hunks; `A`/`R` shortcuts when a hunk is focused |
| `FileDiffList` / `FileDiffRow` | Changed files | `files` | expanded | `onToggle, onFileAction` | — | — | — | `aria-expanded` |
| `HunkCard` | One hunk with controls | `hunk, state, rationale` | focused | `onAccept, onReject` | — | — | conflict panel | diff text selectable; `+`/`−` glyphs not color-only; state announced |
| `ExecutionTimeline` / `TimelineRow` | D.6 | `events, filter` | expanded rows | `onFilter, onCopy` | skeleton | "No activity yet" | error rows | `role="list"`; virtualization keeps focus stable |
| `ModelConfigPanel` | D.7 | `model, status, fallbacks` | editing | `onTest, onFallbacksChange, onOpenTrueForgeSettings` | spinner on test | "No fallback models configured" | failure classification | reorder via keyboard (↑/↓ buttons) |
| `SettingsPanel` | D.8 | `settings` | draft | `onChange` | skeleton | — | validation messages | grouped with `fieldset/legend` |
| `ErrorBanner` | Persistent error with action | `error: UserFacingError` | dismissed | `onAction, onDismiss` | — | — | — | `role="alert"` (once), details collapsible |
| `EmptyState` | Friendly empty views | `icon, title, body, action?` | — | `onAction` | — | — | — | heading hierarchy |

**Planned host bridge (not a visual component):** `lib/host.ts` exposes `useHost()` (subscribe to `HostToWebview`, send `WebviewToHost` after zod validation). In the Next.js harness it is backed by a mock host with scripted scenarios (stream, approval pause, cancel, failure, fallback) so UI states are testable without VS Code.

---

## F. Interaction Guidelines

| Interaction | Exact behavior |
|---|---|
| Button clicks | Immediate visual press (80 ms); async actions show spinner and disable; double-click guarded (second click ignored while pending); result announced via live region |
| Keyboard shortcuts (defaults) | **Inline edit:** `Cmd+Alt+K` / `Ctrl+Alt+K` (editor focus, has selection). **Open QuantForge:** `Cmd+Alt+F` / `Ctrl+Alt+F`. **Send:** `Enter` in Composer (`Shift+Enter` newline). **Stop:** `Esc` in Composer or `Cmd/Ctrl+.` while a turn runs. **Review:** `A` accept / `R` reject on focused hunk; `Cmd/Ctrl+Enter` apply accepted; `Cmd/Ctrl+Z` in Review = Undo last batch (when Review has focus). All are contributed via `package.json` `keybindings` so users can rebind (verify conflicts at implementation) |
| Drag and drop | Only: (1) drop files/folders from the Explorer onto the Composer to add `@file` mentions; (2) reorder fallback models (with keyboard alternative buttons). No other drag interactions |
| Accept / reject | Hunk-level and file-level toggles are reversible until Apply. Accept marks; **nothing writes until Apply** (which answers the TrueForge approval). After apply, hunks show `Applied` and Undo becomes available. Reject never needs confirmation |
| Confirmation dialogs | Only for: Reject all with ≥ 1 accepted hunk (to prevent loss of decisions), Undo when files changed since apply, switching session while a turn is running ("Cancel the running turn?"). Never for Accept, single Reject, or Cancel |
| Cancellation | Click Stop or `Esc`: UI enters *Cancelling* in < 200 ms (target), Stop disabled; on `turn.done: cancelled` show "Cancelled — nothing was written." Proposals queued before cancel appear under Review as "From cancelled turn" and require explicit decisions |
| Loading indicators | < 300 ms: none; 300 ms–2 s: inline spinner; > 2 s: skeleton or progress with elapsed time. Long runs show `StatusStrip` phase text |
| Notifications | In-panel `ErrorBanner`/`Toast` first; `showErrorMessage` only when the sidebar may be hidden **and** the user must act (TrueForge unreachable, workspace untrusted). Max one toast at a time |
| Navigation | Tabs for peers; pushed views (Settings, Model) have a Back button and `Esc`. State of each tab persists across switches. Opening a file or diff uses the VS Code editor, never an in-webview editor |
| Keyboard accessibility | Every action reachable by keyboard; tab order follows visual order; focus never trapped except in Dialog; focus moves to the `ApprovalCard`/`DiffReview` when a turn pauses and returns to the Composer afterwards; `?` opens a shortcuts cheat-sheet |
| Screen readers | Streaming text announced at sentence boundaries; state changes ("Turn paused — approval needed", "Cancelled", "Applied 4 files") announced via a single polite live region; errors via `role="alert"` |

---

## G. Responsive Behaviour

| Condition | Behavior |
|---|---|
| **Narrow sidebar (280–360 px)** | Single column; tabs collapse to icons + tooltip with Review badge visible; hunk cards use unified diff only; tables become stacked rows (path above metadata); composer is one row with Send/Stop as icon button |
| **Standard (360–600 px)** | Labels visible; two-line rows; reasons wrap |
| **Wide panel / editor-area webview (≥ 700 px)** | Two-pane: left conversation, right Review/Context (resizable, `forge.layout.splitRatio`); side-by-side diff for hunks ≥ 900 px |
| **Minimum width** | 240 px usable: horizontal scroll disabled; paths middle-truncate (`src/…/cli.py`) with full path in tooltip and `title` |
| **Editor layouts** | Inline edit works in split editors (acts on the active editor) and untitled/unsaved buffers (proposal base = buffer content); diffs open in the active group beside it |
| **High-DPI** | Vector icons only; 1 px borders remain 1 CSS px (use `border-width: 1px`, no 0.5 px hacks); no raster assets in the webview |
| **Themes** | Webview follows VS Code theme via body classes (`vscode-dark`, `vscode-light`, `vscode-high-contrast`, `vscode-high-contrast-light`); QuantForge tokens recompute; accent contrast checked in both; high-contrast mode drops tinted backgrounds in favour of 1 px borders and underline/`+`/`−` markers |
| **Zoom / font size** | Layout in `rem`/`em` anchored to `--vscode-font-size`; no fixed-height text containers |

---

## H. UI Implementation Guidelines

### H.1 React component organisation (planned)
```
client-end/
├─ app/                    # Next.js: gallery + mock-host harness (NOT bundled into the extension)
├─ webview/                # esbuild entry (main.tsx), mounts <AppShell/>, wires real host bridge
├─ components/
│  ├─ ui/                  # generic primitives (E.1)
│  └─ forge/               # product components (E.2) — one folder per component: Comp.tsx, Comp.test.tsx, Comp.stories.tsx(optional)
├─ lib/                    # host.ts (bridge), hooks/, format.ts, a11y.ts
└─ styles/tokens.css       # §B.1
```
Rules: components are **presentational** (props in, callbacks out); data/state lives in `lib/hooks` fed by the host bridge; no `fetch`, no `next/*`, no `window.vscode` outside `lib/host.ts`.

### H.2 Tailwind conventions (Tailwind CSS 4, per `client-end/package.json`)
- Configure via CSS (`@import "tailwindcss"; @theme inline { … }`) as in the scaffold's `globals.css`; map tokens in §B.1 to theme variables; use only token-backed classes (`bg-surface`, `text-muted`, `border-default`, `text-accent`). **No arbitrary color values** (`bg-[#123456]`) and no raw hex in TSX.
- Spacing only from the scale in §B.4; radius from the radius scale; use `cn()` (clsx + tailwind-merge) for conditional classes; variants via `class-variance-authority` for primitives.
- Dark/light via host classes and tokens, not `dark:` utilities (so VS Code theme wins). The scaffold's `prefers-color-scheme` media query is removed in the webview build.
- Before writing Next.js-specific code in `client-end/app`, read `client-end/AGENTS.md` and the matching guide in `client-end/node_modules/next/dist/docs/` (this Next.js version differs from common knowledge).

### H.3 shadcn/ui usage
shadcn components are copied into `components/ui/` (they are source, not a dependency) and **restyled to QuantForge tokens**; only Radix-based primitives that work in a CSP-restricted webview are allowed. Any shadcn component that depends on `next/*` or portals to `document.body` outside the webview root must be adapted (portal container = app root). Mark adaptation in the file header.

### H.4 Naming
Components `PascalCase.tsx`; hooks `useThing.ts`; files in `lib` `camelCase.ts`; CSS variables `--forge-*`; test ids `data-testid="forge-<component>-<part>"`; message types `domain.verb` (`review.hunk`).

### H.5 Reusable-component rules
1. Before creating a component, search §E and the codebase; reuse or extend.
2. A third occurrence of a pattern becomes a component; do not abstract earlier.
3. New components require: an entry in §E (all columns), states (loading/empty/error) implemented, keyboard + ARIA, a Vitest/Playwright test, and a gallery scenario. Update progress_tracker.
4. No new colors, spacings, radii, or button styles outside §B; propose token changes via an ADR/PR to this file first.

### H.6 Webview messaging contract
Authoritative schemas: `packages/protocol` (zod) — mirrored in [architecture.md §B.2](architecture.md#b2-webview-ui). Rules: every message `{ v: 1, id, type, payload }`; the webview sends **ids and decisions, never file contents to write**; the host validates both directions and ignores unknown types; the webview renders from `state.snapshot` + incremental events and is resilient to missed events (it can request `state.snapshot` via `ready`); no message ever contains secrets.

### H.7 Accessibility standards
WCAG 2.1 AA target; automated axe checks in Playwright (0 serious/critical to ship); keyboard-only flow tests for: send task, approve command, review hunks, apply, undo, cancel; reduced-motion test; high-contrast snapshot; 200 % zoom check. Color is never the sole indicator.

### H.8 Status of this registry
| Section | Status |
|---|---|
| Tokens (`styles/tokens.css`) | PLANNED |
| Primitives (E.1) | PLANNED |
| Product components (E.2) | PLANNED |
| Screens D.1–D.8 | PLANNED |
| Gallery/mock-host harness in `client-end/app` | PLANNED (currently the unmodified template page) |
