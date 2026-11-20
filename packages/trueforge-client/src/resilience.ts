import type { TrueForge } from "@truefoundry/trueforge-sdk";
import type { UserFacingError } from "@forge/protocol";
import type { AgentSpec, TrueForgeApi } from "./client.js";
import { backoffDelayMs, classifyMessage, classifyThrown } from "./classify.js";
import { runTurn } from "./turn.js";
import type { ApprovalDecision, ForgeStreamEvent, ToolCallInfo, TurnOutcome } from "./types.js";
import { ForgeClientError } from "./types.js";

export type Notice =
  | { kind: "attempt"; model: string; attempt: number }
  | { kind: "retry"; model: string; attempt: number; delayMs: number; reason: string }
  | { kind: "fallback"; from: string; to: string; reason: string }
  | { kind: "failed"; error: UserFacingError };

export interface ResilientRunOptions {
  text: string;
  /** Primary model first, then fallbacks, all TrueForge model names ("provider/model"). */
  models: string[];
  specFor: (model: string) => AgentSpec;
  signal?: AbortSignal | undefined;
  detach?: AbortSignal | undefined;
  onEvent?: ((e: ForgeStreamEvent) => void) | undefined;
  onNotice?: ((n: Notice) => void) | undefined;
  onApproval?: ((call: ToolCallInfo & { sourceEventId: string }) => Promise<ApprovalDecision>) | undefined;
  /** Summary of work already queued, appended to the task when switching model (the fallback session starts fresh). */
  describeProgress?: (() => string) | undefined;
  stallTimeoutMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  rng?: (() => number) | undefined;
}

export interface ResilientResult {
  outcome: TurnOutcome | null;
  modelUsed: string | null;
  sessionId: string | null;
  attempts: { model: string; status: string; errorClass?: string | undefined; message?: string | undefined }[];
  error?: UserFacingError | undefined;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Retry with exponential backoff + jitter for transient failures, then fall back to the next configured TrueForge
 * model. This orchestrates TrueForge sessions only: it never calls a model provider and never loops over tool calls
 * (that loop belongs to TrueForge). Failed turns can only leave PROPOSALS behind, never workspace writes, so a retry
 * or fallback is always safe.
 */
export async function runResilient(api: TrueForgeApi, o: ResilientRunOptions): Promise<ResilientResult> {
  const sleep = o.sleep ?? defaultSleep;
  const result: ResilientResult = { outcome: null, modelUsed: null, sessionId: null, attempts: [] };
  const notice = (n: Notice): void => o.onNotice?.(n);
  let lastError: UserFacingError | undefined;

  for (let mi = 0; mi < o.models.length; mi++) {
    const model = o.models[mi]!;
    let sessionId: string;
    try {
      sessionId = await api.createSession(o.specFor(model));
    } catch (e) {
      const c = classifyThrown(e);
      lastError = { code: c.errorClass, title: c.title, message: (e as Error).message, action: { label: "Start TrueForge", command: "forge.startTrueForge" } };
      result.attempts.push({ model, status: "error", errorClass: c.errorClass, message: (e as Error).message });
      if (c.errorClass === "TRUEFORGE_UNREACHABLE") break; // the loop owner is down: no model can help
      continue;
    }
    result.sessionId = sessionId;
    const handoff = mi > 0 && o.describeProgress ? `\n\n[FORGE handoff] A previous model failed on this task. ${o.describeProgress()}` : "";
    let attempt = 0;
    for (;;) {
      if (o.signal?.aborted) return { ...result, outcome: { status: "cancelled", turnId: "", sessionId, text: "", cancelReason: "client-cancelled" }, modelUsed: model };
      notice({ kind: "attempt", model, attempt });
      let outcome: TurnOutcome;
      try {
        outcome = await runTurn(api.sdk as TrueForge, { sessionId, text: attempt === 0 ? o.text + handoff : `Continue the task. (Retry ${attempt}.)`, signal: o.signal, detach: o.detach, onEvent: o.onEvent, onApproval: o.onApproval, stallTimeoutMs: o.stallTimeoutMs });
      } catch (e) {
        const fe = e instanceof ForgeClientError ? e : new ForgeClientError(classifyThrown(e).errorClass, (e as Error).message, e);
        const c = classifyThrown(fe.cause ?? fe);
        lastError = { code: fe.errorClass, title: c.title, message: fe.message, action: { label: "Start TrueForge", command: "forge.startTrueForge" } };
        result.attempts.push({ model, status: "error", errorClass: fe.errorClass, message: fe.message });
        notice({ kind: "failed", error: lastError });
        return { ...result, error: lastError, modelUsed: model };
      }
      result.outcome = outcome;
      result.modelUsed = model;
      result.attempts.push({ model, status: outcome.status, errorClass: outcome.errorClass, message: outcome.errorMessage });
      if (outcome.status !== "error") return result;

      const cls = classifyMessage(outcome.errorMessage ?? "");
      outcome.errorClass = outcome.errorClass ?? cls.errorClass;
      lastError = { code: outcome.errorClass, title: cls.title, message: `${cls.hint} (${outcome.errorMessage ?? ""})` };
      if (cls.retryable && attempt + 1 < cls.maxAttempts) {
        const delayMs = backoffDelayMs(attempt, o.rng);
        notice({ kind: "retry", model, attempt: attempt + 1, delayMs, reason: cls.title });
        await sleep(delayMs);
        attempt++;
        continue;
      }
      break; // not retryable or retries exhausted → next model
    }
    const next = o.models[mi + 1];
    if (next) notice({ kind: "fallback", from: model, to: next, reason: lastError?.title ?? "model failure" });
  }
  const err = lastError ?? { code: "UNKNOWN" as const, title: "The agent run failed", message: "no model could complete the task" };
  notice({ kind: "failed", error: err });
  return { ...result, error: err };
}
