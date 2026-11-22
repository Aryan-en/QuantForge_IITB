import type { ErrorClass } from "@forge/protocol";

export interface ToolCallInfo {
  callId: string;
  tool: string;
  server?: string | undefined;
  /** Raw JSON arguments as sent by the model. */
  args: string;
  threadId: string;
}

/** TrueForge events normalised for QuantForge's UI/timeline. Field names follow the SDK's camelCase. */
export type ForgeStreamEvent =
  | { type: "turn.started"; turnId: string; sessionId: string }
  | { type: "mcp.ready"; servers: string[] }
  | { type: "text.delta"; threadId: string; messageId: string; text: string }
  | { type: "message.complete"; threadId: string; messageId: string; text: string; model?: string | undefined; usage?: Usage | undefined }
  | { type: "tool.call"; call: ToolCallInfo }
  | { type: "tool.result"; callId: string; tool?: string | undefined; ok: boolean; preview: string; threadId: string }
  | { type: "approval.required"; threadId: string; calls: (ToolCallInfo & { sourceEventId: string })[] }
  | { type: "subagent.start"; threadId: string; title: string }
  | { type: "subagent.done"; threadId: string; ok: boolean }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "turn.done"; outcome: TurnOutcome };

export interface Usage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}

export interface TurnOutcome {
  status: "done" | "cancelled" | "error";
  turnId: string;
  sessionId: string;
  text: string;
  errorMessage?: string | undefined;
  errorClass?: ErrorClass | undefined;
  cancelReason?: string | undefined;
  totalTokens?: number | undefined;
  costUsd?: number | undefined;
}

export type ApprovalDecision = { status: "allow" } | { status: "deny"; reason: string };

export interface RunTurnOptions {
  sessionId: string;
  text: string;
  /** Continue an existing turn (e.g. after a window reload) instead of starting a new one. `text` is ignored. */
  resume?: { turnId: string } | undefined;
  signal?: AbortSignal | undefined;
  /** Stop listening WITHOUT cancelling the TrueForge turn (window closed / reload). The turn keeps its state and can be resumed. */
  detach?: AbortSignal | undefined;
  onEvent?: ((e: ForgeStreamEvent) => void) | undefined;
  /** Called for every gated tool call; resolve with the human's decision. */
  onApproval?: ((call: ToolCallInfo & { sourceEventId: string }) => Promise<ApprovalDecision>) | undefined;
  /** No event for this long (while not paused) ⇒ STALLED. */
  stallTimeoutMs?: number | undefined;
  /** After cancel, how long to wait for TrueForge's confirmation before reporting "cancelled locally". */
  cancelGraceMs?: number | undefined;
}

export class ForgeClientError extends Error {
  readonly errorClass: ErrorClass;
  constructor(errorClass: ErrorClass, message: string, cause?: unknown) {
    super(message, { cause });
    this.errorClass = errorClass;
    this.name = "ForgeClientError";
  }
}
