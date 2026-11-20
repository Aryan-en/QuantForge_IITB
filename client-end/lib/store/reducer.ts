/**
 * Webview render-state store. Folds HostToWebview messages into ViewState.
 * Holds no business logic: the extension host is authoritative. The only local
 * (optimistic) transitions are the ones Ui-regitry §F allows: Stop → Cancelling,
 * hunk accept/reject marks. "Applied" is never set locally — the human owns the write
 * and the UI never implies a write the host has not confirmed.
 */
import type {
  AppState,
  ApprovalRequest,
  ContextState,
  ConversationItem,
  ErrorCode,
  HostToWebview,
  HunkState,
  PlanStep,
  ReviewQueueState,
  Subagent,
  TimelineEvent,
  ToolCall,
  TurnState,
  TurnStatus,
  UserFacingError,
} from "@/lib/protocol";

export type RetryInfo = { attempt: number; maxAttempts: number; delayMs: number; code: ErrorCode; model: string; scheduledAt: number };
export type ToastInfo = { id: string; tone: "success" | "info" | "warning"; message: string; action?: { label: string; intent: "undo" } };

export type ViewState = {
  ready: boolean;
  app: AppState;
  conversation: ConversationItem[];
  toolCalls: Record<string, ToolCall>;
  subagents: Record<string, Subagent>;
  approvals: Record<string, ApprovalRequest>;
  context: ContextState;
  plan: { steps: PlanStep[]; ignoredInvalid: boolean };
  review: ReviewQueueState;
  timeline: TimelineEvent[];
  errors: UserFacingError[];
  retry: RetryInfo | null;
  toast: ToastInfo | null;
  /** Turn ids whose late events must be ignored (architecture §E.6). */
  closedTurnIds: string[];
};

export type LocalAction =
  | { type: "local.cancelRequested"; at: number }
  | { type: "local.hunk"; proposalId: string; hunkId: string; action: "accept" | "reject" | "reset" }
  | { type: "local.file"; proposalId: string; action: "accept" | "reject" }
  | { type: "local.bulk"; action: "acceptAll" | "rejectAll" }
  | { type: "local.dismissError"; id: string }
  | { type: "local.dismissToast" }
  | { type: "local.approvalSent"; callId: string; decision: "allow" | "deny" }
  | { type: "local.reset" }
  | { type: "stream.flush"; chunks: Record<string, string> };

export type StoreAction = { type: "host"; message: HostToWebview; at: number } | LocalAction;

export const DEFAULT_APP_STATE: AppState = {
  connection: { status: "unknown", baseUrl: "http://localhost:8790" },
  model: { primary: null, fallbacks: [], active: null, status: "unknown" },
  sessions: [],
  activeSessionId: null,
  turn: { id: null, status: "idle" },
  settings: {
    "context.budgetTokens": 24000,
    "context.maxFiles": 20000,
    "context.exclude": ["**/node_modules/**", "**/.venv/**", "**/*.lock"],
    "context.includeSecrets": false,
    "review.autoOpenOnPause": true,
    "terminal.useShadowWorkspace": true,
    "ui.density": "comfortable",
    "ui.showToolDetails": false,
    stallTimeoutMs: 45000,
  },
};

export const EMPTY_CONTEXT: ContextState = { items: [], excluded: [], searches: [], usedTokens: 0, budgetTokens: 24000 };
export const EMPTY_REVIEW: ReviewQueueState = { batchId: null, files: [] };

export const INITIAL_VIEW_STATE: ViewState = {
  ready: false,
  app: DEFAULT_APP_STATE,
  conversation: [],
  toolCalls: {},
  subagents: {},
  approvals: {},
  context: EMPTY_CONTEXT,
  plan: { steps: [], ignoredInvalid: false },
  review: EMPTY_REVIEW,
  timeline: [],
  errors: [],
  retry: null,
  toast: null,
  closedTurnIds: [],
};

// ---- turn state machine (architecture §E.2) ----
const TURN_TRANSITIONS: Record<TurnStatus, TurnStatus[]> = {
  idle: ["running"],
  running: ["paused", "cancelling", "cancelled", "done", "error"],
  paused: ["running", "cancelling", "cancelled", "error"],
  cancelling: ["cancelled"],
  cancelled: ["running"],
  done: ["running"],
  error: ["running"],
};

function nextTurn(current: TurnState, incoming: TurnState): TurnState {
  const newTurn = incoming.id !== null && incoming.id !== current.id;
  if (newTurn) return incoming.status === "running" || incoming.status === "idle" ? incoming : current;
  if (incoming.status === current.status) return { ...current, ...incoming };
  // A turn that finishes while we are cancelling is reported as cancelled (Cancelled locally).
  if (current.status === "cancelling" && (incoming.status === "done" || incoming.status === "error")) {
    return { ...current, ...incoming, status: "cancelled" };
  }
  if (!TURN_TRANSITIONS[current.status].includes(incoming.status)) return current;
  return { ...current, ...incoming };
}

// ---- hunk state machine (architecture §E.4), local subset ----
function localHunkState(state: HunkState, action: "accept" | "reject" | "reset"): HunkState {
  if (action === "accept" && (state === "pending" || state === "rejected")) return "accepted";
  if (action === "reject" && (state === "pending" || state === "accepted")) return "rejected";
  if (action === "reset" && (state === "accepted" || state === "rejected")) return "pending";
  return state;
}

function mapHunks(review: ReviewQueueState, fn: (proposalId: string, hunkId: string, state: HunkState) => HunkState): ReviewQueueState {
  return {
    ...review,
    files: review.files.map((f) => ({
      ...f,
      hunks: f.hunks.map((h) => ({ ...h, state: fn(h.proposalId, h.hunkId, h.state) })),
    })),
  };
}

function upsertTimeline(list: TimelineEvent[], event: TimelineEvent): TimelineEvent[] {
  const i = list.findIndex((e) => e.id === event.id);
  if (i === -1) return [...list, event];
  const copy = list.slice();
  copy[i] = event;
  return copy;
}

function isTurnClosed(state: ViewState, turnId: string): boolean {
  return state.closedTurnIds.includes(turnId);
}

function applyHost(state: ViewState, msg: HostToWebview, at: number): ViewState {
  switch (msg.type) {
    case "state.snapshot":
      return { ...state, ready: true, app: msg.payload.state };

    case "turn.status": {
      const turn = nextTurn(state.app.turn, msg.payload.turn);
      const closed =
        turn.id && (turn.status === "cancelled" || turn.status === "done" || turn.status === "error") && !state.closedTurnIds.includes(turn.id)
          ? [...state.closedTurnIds, turn.id]
          : state.closedTurnIds;
      // When a turn closes, any still-streaming assistant item stops streaming.
      const conversation =
        turn.status === "cancelled" || turn.status === "error"
          ? state.conversation.map((c) => (c.kind === "assistant" && c.streaming ? { ...c, streaming: false, interrupted: true } : c))
          : turn.status === "done"
            ? state.conversation.map((c) => (c.kind === "assistant" && c.streaming ? { ...c, streaming: false } : c))
            : state.conversation;
      // A closed turn leaves nothing "running": in-flight tools/subagents are shown as aborted.
      const ended = turn.status === "cancelled" || turn.status === "error";
      const toolCalls = ended
        ? Object.fromEntries(
            Object.entries(state.toolCalls).map(([id, c]) => [
              id,
              c.status === "running" || c.status === "requested" || c.status === "awaiting_approval" ? { ...c, status: "aborted" as const } : c,
            ]),
          )
        : state.toolCalls;
      const subagents = ended
        ? Object.fromEntries(Object.entries(state.subagents).map(([id, a]) => [id, a.status === "running" ? { ...a, status: "cancelled" as const } : a]))
        : state.subagents;
      return {
        ...state,
        app: { ...state.app, turn },
        closedTurnIds: closed,
        conversation,
        toolCalls,
        subagents,
        retry: turn.status === "running" ? state.retry : null,
      };
    }

    case "conversation.append": {
      if (state.conversation.some((c) => c.id === msg.payload.item.id)) return state;
      return { ...state, conversation: [...state.conversation, msg.payload.item] };
    }

    case "stream.delta": {
      if (isTurnClosed(state, msg.payload.turnId)) return state; // late-event guard
      return appendText(state, { [msg.payload.itemId]: msg.payload.text });
    }

    case "stream.end":
      return {
        ...state,
        conversation: state.conversation.map((c) =>
          c.kind === "assistant" && c.id === msg.payload.itemId ? { ...c, streaming: false, interrupted: msg.payload.interrupted } : c,
        ),
      };

    case "tool.updated":
      return { ...state, toolCalls: { ...state.toolCalls, [msg.payload.call.callId]: msg.payload.call } };

    case "subagent.updated":
      return { ...state, subagents: { ...state.subagents, [msg.payload.subagent.threadId]: msg.payload.subagent } };

    case "approval.requested":
      return { ...state, approvals: { ...state.approvals, [msg.payload.approval.callId]: msg.payload.approval } };

    case "approval.resolved": {
      const existing = state.approvals[msg.payload.callId];
      if (!existing) return state;
      return { ...state, approvals: { ...state.approvals, [msg.payload.callId]: { ...existing, status: msg.payload.status } } };
    }

    case "timeline.event":
      return { ...state, timeline: upsertTimeline(state.timeline, msg.payload.event) };

    case "context.updated":
      return { ...state, context: msg.payload.context };

    case "plan.updated": {
      const steps = msg.payload.steps;
      const ids = new Set(steps.map((s) => s.id));
      const valid = steps.length <= 30 && ids.size === steps.length;
      return valid ? { ...state, plan: { steps, ignoredInvalid: false } } : { ...state, plan: { ...state.plan, ignoredInvalid: true } };
    }

    case "review.updated":
      return { ...state, review: msg.payload.queue };

    case "model.status":
      return { ...state, app: { ...state.app, model: msg.payload.model } };

    case "error.notify": {
      const others = state.errors.filter((e) => e.id !== msg.payload.error.id);
      return { ...state, errors: [...others, msg.payload.error], retry: null };
    }

    case "error.clear":
      return {
        ...state,
        errors: state.errors.filter((e) => (msg.payload.id ? e.id !== msg.payload.id : msg.payload.code ? e.code !== msg.payload.code : false)),
      };

    case "retry.scheduled":
      return { ...state, retry: { ...msg.payload, scheduledAt: at } };

    case "toast":
      return { ...state, toast: { id: msg.id, ...msg.payload } };
  }
}

function appendText(state: ViewState, chunks: Record<string, string>): ViewState {
  return {
    ...state,
    conversation: state.conversation.map((c) => {
      if (c.kind !== "assistant") return c;
      const add = chunks[c.id];
      return add ? { ...c, text: c.text + add } : c;
    }),
  };
}

export function reducer(state: ViewState, action: StoreAction): ViewState {
  switch (action.type) {
    case "host":
      return applyHost(state, action.message, action.at);

    case "stream.flush":
      return appendText(state, action.chunks);

    case "local.cancelRequested": {
      const t = state.app.turn;
      if (t.status !== "running" && t.status !== "paused") return state;
      return { ...state, app: { ...state.app, turn: { ...t, status: "cancelling", phase: "cancelling" } }, retry: null };
    }

    case "local.hunk":
      return {
        ...state,
        review: mapHunks(state.review, (p, h, s) => (p === action.proposalId && h === action.hunkId ? localHunkState(s, action.action) : s)),
      };

    case "local.file":
      return {
        ...state,
        review: mapHunks(state.review, (p, _h, s) => (p === action.proposalId ? localHunkState(s, action.action) : s)),
      };

    case "local.bulk":
      return {
        ...state,
        review: mapHunks(state.review, (_p, _h, s) => localHunkState(s, action.action === "acceptAll" ? "accept" : "reject")),
      };

    case "local.dismissError":
      return { ...state, errors: state.errors.filter((e) => e.id !== action.id) };

    case "local.dismissToast":
      return { ...state, toast: null };

    case "local.approvalSent": {
      const existing = state.approvals[action.callId];
      if (!existing || existing.status !== "pending") return state;
      return {
        ...state,
        approvals: { ...state.approvals, [action.callId]: { ...existing, status: action.decision === "allow" ? "allowed" : "denied" } },
      };
    }

    case "local.reset":
      return { ...INITIAL_VIEW_STATE, ready: state.ready, app: { ...state.app, turn: { id: null, status: "idle" } } };
  }
}

// ---- derived selectors ----
export function reviewStats(review: ReviewQueueState): {
  files: number;
  hunks: number;
  added: number;
  removed: number;
  pending: number;
  accepted: number;
  rejected: number;
  applied: number;
  blocked: number;
} {
  let hunks = 0,
    added = 0,
    removed = 0,
    pending = 0,
    accepted = 0,
    rejected = 0,
    applied = 0,
    blocked = 0;
  for (const f of review.files) {
    for (const h of f.hunks) {
      hunks += 1;
      added += h.added;
      removed += h.removed;
      if (h.state === "pending") pending += 1;
      else if (h.state === "accepted") accepted += 1;
      else if (h.state === "rejected") rejected += 1;
      else if (h.state === "applied") applied += 1;
      else if (h.state === "stale" || h.state === "conflicted") blocked += 1;
    }
  }
  return { files: review.files.length, hunks, added, removed, pending, accepted, rejected, applied, blocked };
}

export function isTurnActive(status: TurnStatus): boolean {
  return status === "running" || status === "paused" || status === "cancelling";
}
