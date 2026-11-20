/**
 * TEMPORARY mirror of `packages/protocol` (architecture.md §B.2, frontend-plan.md §5).
 * When FORGE-010 lands, replace imports of "@/lib/protocol" with "@forge/protocol"; names and shapes match.
 * The webview sends ids and decisions only — never file contents to write.
 */

export type Path = string;
export type Range = { startLine: number; endLine: number };

// ---------- connection & model ----------
export type ConnectionStatus = "unknown" | "checking" | "connected" | "unreachable" | "not_configured";
export type ModelStatus = "unknown" | "checking" | "connected" | "degraded" | "unreachable" | "auth_failed" | "fallback_active";

export type ModelState = {
  primary: string | null;
  fallbacks: string[];
  active: string | null;
  status: ModelStatus;
  lastCheckedAt?: number;
  lastFailure?: { code: ErrorCode | string; action: "retried" | "fell_back" | "stopped"; at: number };
};

// ---------- errors (architecture §B.7 classification codes) ----------
export type ErrorCode =
  | "TRUEFORGE_UNREACHABLE"
  | "MODEL_AUTH"
  | "MODEL_UNREACHABLE"
  | "MODEL_RATE_LIMIT"
  | "MODEL_SERVER"
  | "MODEL_STALL"
  | "TOOL_FAILED"
  | "STALE_BASE"
  | "INTERNAL";

export type UserFacingError = {
  id: string;
  /** Classification shown as a small code chip; omitted when the host has none. */
  code?: ErrorCode | string;
  tone?: "danger" | "warning" | "info";
  title: string;
  message: string;
  /** What the user can do next. `command` runs a host (VS Code) command. */
  action?: { label: string; intent: "retry" | "openModelConfig" | "startTrueForge" | "dismiss" | "command"; command?: string };
  details?: string;
  workspaceUnchanged?: boolean;
};

// ---------- session & turn ----------
export type TurnStatus = "idle" | "running" | "paused" | "cancelling" | "cancelled" | "done" | "error";

export type TurnPhase =
  | "thinking"
  | "reading"
  | "searching"
  | "planning"
  | "editing"
  | "verifying"
  | "awaiting_approval"
  | "retrying"
  | "cancelling";

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  turns: number;
  agent: "forge-agent" | "forge-inline-edit";
  trueforgeUrl?: string;
};

export type TurnState = {
  id: string | null;
  status: TurnStatus;
  phase?: TurnPhase;
  phaseDetail?: string;
  startedAt?: number;
  endedAt?: number;
  tokens?: { input: number; output: number };
  model?: string;
};

// ---------- mentions ----------
/** A suggestion for the @-picker. `insert` is the exact token the host expects after "@". */
export type MentionCandidate =
  | { kind: "file"; path: string; insert?: string; detail?: string }
  | { kind: "symbol"; name: string; path: string; insert?: string; detail?: string };

export type Mention =
  | { kind: "file"; path: Path; range?: Range }
  | { kind: "symbol"; name: string; path?: Path };

// ---------- conversation ----------
export type ToolName =
  | "read_file"
  | "search_workspace"
  | "find_symbol"
  | "get_file_structure"
  | "get_context"
  | "propose_edit"
  | "submit_changes"
  | "run_terminal"
  | "get_diagnostics"
  | "get_git_status"
  | "update_plan";

export type ToolCallStatus = "requested" | "awaiting_approval" | "running" | "succeeded" | "failed" | "denied" | "aborted";

export type ToolCall = {
  callId: string;
  tool: ToolName;
  /** One-line human summary of the args, e.g. "src/flask/cli.py:1-120". */
  summary: string;
  args?: Record<string, unknown>;
  status: ToolCallStatus;
  startedAt: number;
  durationMs?: number;
  resultSummary?: string;
  error?: string;
  threadId?: string;
};

export type ConversationItem =
  | { kind: "user"; id: string; text: string; mentions: Mention[]; at: number }
  | { kind: "assistant"; id: string; threadId: string; text: string; streaming: boolean; at: number; interrupted?: boolean }
  | { kind: "tool"; id: string; callId: string }
  | { kind: "subagent"; id: string; threadId: string }
  | { kind: "approval"; id: string; callId: string }
  | { kind: "notice"; id: string; tone: "info" | "success" | "warning" | "danger"; text: string; at: number };

export type Subagent = {
  threadId: string;
  title: string;
  status: "running" | "done" | "failed" | "cancelled";
  steps: string[];
  startedAt: number;
  endedAt?: number;
  result?: string;
};

export type ApprovalRequest = {
  callId: string;
  tool: "run_terminal" | "submit_changes";
  /** run_terminal: literal command. submit_changes: summary of the batch. */
  command?: string;
  summary?: string;
  reason: string;
  risk: "low" | "medium" | "high";
  ranIn?: "shadow" | "workspace";
  status: "pending" | "allowed" | "denied";
};

// ---------- context (get_context, architecture §B.4) ----------
export type ContextTier = "full" | "symbols" | "skeleton" | "path";

export type ContextItem = {
  path: Path;
  range?: Range;
  tier: ContextTier;
  tokens: number;
  score: number; // 0..1
  reasons: string[];
  source: "get_context" | "mention" | "read_by_agent";
};

export type ContextExclusion = {
  path: Path;
  reason: string;
  tokens?: number;
};

export type ContextSearch = { query: string; tool: "search_workspace" | "find_symbol"; matches: number; at: number; topPaths: Path[] };

export type ContextState = {
  items: ContextItem[];
  excluded: ContextExclusion[];
  searches: ContextSearch[];
  usedTokens: number;
  budgetTokens: number;
  strategy?: string;
};

// ---------- plan (update_plan) ----------
export type PlanStep = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "skipped";
  files?: Path[];
  dependsOn?: string[];
};

// ---------- review (diff engine, architecture §E.4) ----------
export type HunkState = "pending" | "accepted" | "rejected" | "applied" | "stale" | "conflicted" | "undone";

export type DiffLine = { kind: "context" | "add" | "del"; text: string; oldNo?: number; newNo?: number };

export type Hunk = {
  hunkId: string;
  proposalId: string;
  header: string; // "@@ -79,13 +79,17 @@ def get_debug_flag"
  lines: DiffLine[];
  state: HunkState;
  rationale?: string;
  added: number;
  removed: number;
};

export type FileChange = {
  proposalId: string;
  path: Path;
  status: "M" | "A" | "D";
  added: number;
  removed: number;
  hunks: Hunk[];
};

export type ReviewQueueState = {
  batchId: string | null;
  summary?: string;
  files: FileChange[];
  /** True when TrueForge is paused on the approval-gated submit_changes call (Review Gate). */
  gateCallId?: string;
  origin?: "review_gate" | "local_review" | "cancelled_turn" | "inline_edit";
  applying?: boolean;
  lastApplied?: { batchId: string; files: number; hunks: number; at: number; undone?: boolean };
};

// ---------- timeline ----------
export type TimelineKind =
  | "session.start"
  | "user.message"
  | "model.call"
  | "tool.call"
  | "approval.requested"
  | "approval.decided"
  | "subagent.start"
  | "subagent.done"
  | "tool.deferred_load"
  | "context.compaction"
  | "test.run"
  | "model.retry"
  | "model.fallback"
  | "turn.done"
  | "tool.result"
  | "error";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  at: number;
  title: string;
  detail?: string;
  durationMs?: number;
  status: "info" | "running" | "success" | "warning" | "error";
  code?: string;
  data?: Record<string, unknown>;
};

// ---------- settings ----------
export type ForgeSettings = {
  "context.budgetTokens": number;
  "context.maxFiles": number;
  "context.exclude": string[];
  "context.includeSecrets": boolean;
  "review.autoOpenOnPause": boolean;
  "terminal.useShadowWorkspace": boolean;
  "ui.density": "comfortable" | "compact";
  "ui.showToolDetails": boolean;
  stallTimeoutMs: number;
};

// ---------- app snapshot ----------
export type AppState = {
  connection: { status: ConnectionStatus; baseUrl: string };
  model: ModelState;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  turn: TurnState;
  settings: ForgeSettings;
};
