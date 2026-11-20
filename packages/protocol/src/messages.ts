import { z } from "zod";
import { MentionSchema } from "./common.js";

const Envelope = { v: z.literal(1), id: z.string().min(1).max(64) };

/** Webview -> Extension Host. The webview sends ids and decisions, never content to write. */
export const WebviewToHost = z.discriminatedUnion("type", [
  z.object({ ...Envelope, type: z.literal("ready") }).strict(),
  z.object({ ...Envelope, type: z.literal("task.submit"), text: z.string().min(1).max(20_000), mentions: z.array(MentionSchema).max(50) }).strict(),
  z.object({ ...Envelope, type: z.literal("turn.cancel"), sessionId: z.string().min(1) }).strict(),
  z.object({ ...Envelope, type: z.literal("approval.decide"), callId: z.string().min(1), decision: z.enum(["allow", "deny"]), reason: z.string().max(500).optional() }).strict(),
  z.object({ ...Envelope, type: z.literal("review.hunk"), proposalId: z.string(), hunkId: z.string(), action: z.enum(["accept", "reject"]) }).strict(),
  z.object({ ...Envelope, type: z.literal("review.bulk"), action: z.enum(["acceptAll", "rejectAll", "apply", "undo"]), batchId: z.string().optional() }).strict(),
  z.object({ ...Envelope, type: z.literal("mention.query"), query: z.string().max(200) }).strict(),
  z.object({ ...Envelope, type: z.literal("review.openDiff"), proposalId: z.string().min(1) }).strict(),
  z.object({ ...Envelope, type: z.literal("command.run"), command: z.string().regex(/^forge\.[A-Za-z.]+$/) }).strict(),
  z.object({ ...Envelope, type: z.literal("settings.update"), patch: z.record(z.string(), z.unknown()) }).strict(),
]);
export type WebviewToHost = z.infer<typeof WebviewToHost>;

export type HunkState = "pending" | "accepted" | "rejected" | "applied" | "stale" | "conflicted" | "undone";

export interface HunkView {
  id: string;
  header: string;
  lines: { kind: "context" | "add" | "del"; text: string }[];
  state: HunkState;
}
export interface ProposalView {
  id: string;
  path: string;
  kind: "modify" | "create" | "delete";
  rationale: string;
  linesAdded: number;
  linesRemoved: number;
  hunks: HunkView[];
  fromCancelledTurn?: boolean;
}
export interface ReviewQueueState {
  batchId: string;
  proposals: ProposalView[];
  awaitingApproval: boolean;
  canUndo: boolean;
}

export type TimelineKind =
  | "session.start" | "user.message" | "model.call" | "tool.call" | "tool.result" | "approval.requested"
  | "approval.decided" | "subagent.start" | "subagent.done" | "test.run" | "retry" | "fallback" | "turn.done" | "error";

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  status?: "running" | "ok" | "error" | "cancelled";
  durationMs?: number;
}

export interface UserFacingError {
  code: ErrorClass;
  title: string;
  message: string;
  action?: { label: string; command: string };
}

export const ERROR_CLASSES = ["TRUEFORGE_UNREACHABLE", "MODEL_AUTH", "MODEL_RATE_LIMIT", "MODEL_UNAVAILABLE", "STALLED", "CANCELLED", "UNKNOWN"] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export type HostToWebview =
  | { v: 1; id: string; type: "state.snapshot"; state: unknown }
  | { v: 1; id: string; type: "timeline.event"; event: TimelineEvent }
  | { v: 1; id: string; type: "stream.delta"; turnId: string; threadId: string; text: string }
  | { v: 1; id: string; type: "review.updated"; queue: ReviewQueueState }
  | { v: 1; id: string; type: "mention.results"; query: string; items: { kind: "file" | "symbol"; label: string; insert: string; detail?: string }[] }
  | { v: 1; id: string; type: "error.notify"; error: UserFacingError };

export function parseWebviewMessage(raw: unknown): { ok: true; msg: WebviewToHost } | { ok: false; error: string } {
  const r = WebviewToHost.safeParse(raw);
  return r.success ? { ok: true, msg: r.data } : { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
