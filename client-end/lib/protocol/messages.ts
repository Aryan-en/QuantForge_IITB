import { z } from "zod";
import type {
  AppState,
  ApprovalRequest,
  ContextState,
  ConversationItem,
  ErrorCode,
  ForgeSettings,
  Mention,
  ModelState,
  PlanStep,
  ReviewQueueState,
  Subagent,
  TimelineEvent,
  ToolCall,
  TurnState,
  UserFacingError,
} from "./types";

/** Every message: { v: 1, id, type, payload } (Ui-regitry §H.6). */
export type Envelope<T extends string, P> = { v: 1; id: string; type: T; payload: P };

// ---------------- Host -> Webview ----------------
export type HostToWebview =
  | Envelope<"state.snapshot", { state: AppState }>
  | Envelope<"turn.status", { turn: TurnState }>
  | Envelope<"conversation.append", { item: ConversationItem }>
  | Envelope<"stream.delta", { turnId: string; threadId: string; itemId: string; text: string }>
  | Envelope<"stream.end", { itemId: string; interrupted?: boolean }>
  | Envelope<"tool.updated", { call: ToolCall }>
  | Envelope<"subagent.updated", { subagent: Subagent }>
  | Envelope<"approval.requested", { approval: ApprovalRequest }>
  | Envelope<"approval.resolved", { callId: string; status: "allowed" | "denied" }>
  | Envelope<"timeline.event", { event: TimelineEvent }>
  | Envelope<"context.updated", { context: ContextState }>
  | Envelope<"plan.updated", { steps: PlanStep[] }>
  | Envelope<"review.updated", { queue: ReviewQueueState }>
  | Envelope<"model.status", { model: ModelState }>
  | Envelope<"error.notify", { error: UserFacingError }>
  | Envelope<"error.clear", { id?: string; code?: ErrorCode }>
  | Envelope<"retry.scheduled", { attempt: number; maxAttempts: number; delayMs: number; code: ErrorCode; model: string }>
  | Envelope<"toast", { tone: "success" | "info" | "warning"; message: string; action?: { label: string; intent: "undo" } }>;

export type HostMessageType = HostToWebview["type"];

// ---------------- Webview -> Host ----------------
export type WebviewToHost =
  | Envelope<"ready", Record<string, never>>
  | Envelope<"task.submit", { text: string; mentions: Mention[] }>
  | Envelope<"turn.cancel", { sessionId: string | null; turnId: string | null }>
  | Envelope<"approval.decide", { callId: string; decision: "allow" | "deny"; reason?: string }>
  | Envelope<"review.hunk", { proposalId: string; hunkId: string; action: "accept" | "reject" | "reset" }>
  | Envelope<"review.file", { proposalId: string; action: "accept" | "reject" }>
  | Envelope<"review.bulk", { action: "acceptAll" | "rejectAll" | "apply" | "undo"; batchId?: string | null }>
  | Envelope<"settings.update", { patch: Partial<ForgeSettings> }>
  | Envelope<"model.test", Record<string, never>>
  | Envelope<"model.fallbacks", { fallbacks: string[] }>
  | Envelope<"connection.check", Record<string, never>>
  | Envelope<"trueforge.start", Record<string, never>>
  | Envelope<"session.new", Record<string, never>>
  | Envelope<"session.select", { sessionId: string }>
  | Envelope<"session.openInTrueForge", { sessionId: string | null }>
  | Envelope<"file.open", { path: string; line?: number }>
  | Envelope<"diff.open", { proposalId: string }>
  | Envelope<"mention.query", { query: string }>;

export type WebviewMessageType = WebviewToHost["type"];
export type WebviewPayload<T extends WebviewMessageType> = Extract<WebviewToHost, { type: T }>["payload"];

// Light runtime validation at the trust boundary (ADR-011). Payload shapes are validated
// in full by packages/protocol; here we reject anything that isn't a well-formed envelope
// of a known type so unknown messages are dropped and logged, never executed.
const HOST_TYPES = [
  "state.snapshot",
  "turn.status",
  "conversation.append",
  "stream.delta",
  "stream.end",
  "tool.updated",
  "subagent.updated",
  "approval.requested",
  "approval.resolved",
  "timeline.event",
  "context.updated",
  "plan.updated",
  "review.updated",
  "model.status",
  "error.notify",
  "error.clear",
  "retry.scheduled",
  "toast",
] as const satisfies readonly HostMessageType[];

const hostEnvelopeSchema = z
  .object({
    v: z.literal(1),
    id: z.string().min(1),
    type: z.enum(HOST_TYPES),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export function parseHostMessage(raw: unknown): HostToWebview | null {
  const result = hostEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    console.warn("[forge] dropped invalid host message", result.error.issues[0]?.message);
    return null;
  }
  // Envelope verified; payload typing is trusted from the host's own schema validation.
  return result.data as unknown as HostToWebview;
}

let counter = 0;
export function messageId(prefix = "m"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function envelope<T extends WebviewMessageType>(type: T, payload: WebviewPayload<T>): WebviewToHost {
  return { v: 1, id: messageId("w"), type, payload } as WebviewToHost;
}

export type { ModelState };
