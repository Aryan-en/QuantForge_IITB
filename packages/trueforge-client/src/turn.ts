import { isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";
import type { TrueForge } from "@truefoundry/trueforge-sdk";
import type { ApprovalDecision, ForgeStreamEvent, RunTurnOptions, ToolCallInfo, TurnOutcome } from "./types.js";
import { ForgeClientError } from "./types.js";
import { classifyMessage, classifyThrown } from "./classify.js";

type Ev = { type: string; id: string; threadId?: string | null; [k: string]: any };

/**
 * Run ONE turn on an existing TrueForge session: stream events, merge deltas, surface approvals to the caller,
 * resume after decisions, honour cancellation and stall detection. TrueForge owns the loop; this only drives the protocol.
 */
export async function runTurn(client: TrueForge, o: RunTurnOptions): Promise<TurnOutcome> {
  const emit = o.onEvent ?? (() => undefined);
  const stallMs = o.stallTimeoutMs ?? 45_000;
  const graceMs = o.cancelGraceMs ?? 5_000;
  const index = new Map<string, Ev>();
  const announced = new Set<string>();
  const toolNames = new Map<string, string>();
  const subagents = new Set<string>();
  let turnId = "";
  let lastId: string | undefined;
  let outcome: TurnOutcome | null = null;
  let cancelled = false;
  let cancelSent = false;
  const streamAbort = new AbortController();

  const sendCancel = (): void => {
    if (cancelSent) return;
    cancelSent = true;
    cancelled = true;
    void client.sessions.cancel(o.sessionId).catch(() => undefined);
    // If TrueForge does not confirm in time, stop listening and report a local cancel.
    setTimeout(() => streamAbort.abort(), graceMs).unref?.();
  };
  let detached = false;
  const onDetach = (): void => {
    detached = true;
    streamAbort.abort();
  };
  o.detach?.addEventListener("abort", onDetach, { once: true });
  if (o.signal?.aborted) sendCancel();
  o.signal?.addEventListener("abort", sendCancel, { once: true });

  const toCall = (c: any, threadId: string): ToolCallInfo => ({ callId: c.id, tool: c.toolInfo?.name ?? c.function?.name ?? "?", server: c.toolInfo?.serverId ?? c.toolInfo?.serverName, args: c.function?.arguments ?? "", threadId });

  const announce = (m: Ev): void => {
    if (announced.has(m.id) || m.finishReason == null) return;
    announced.add(m.id);
    const threadId = m.threadId ?? "main";
    for (const c of m.toolCalls ?? []) {
      const info = toCall(c, threadId);
      toolNames.set(info.callId, info.tool);
      emit({ type: "tool.call", call: info });
    }
    emit({ type: "message.complete", threadId, messageId: m.id, text: m.content ?? "", model: m.model?.name, usage: m.usage ? { inputTokens: m.usage.inputTokens, outputTokens: m.usage.outputTokens } : undefined });
  };

  const handle = (ev: Ev): "paused" | "done" | null => {
    lastId = ev.id ?? lastId;
    if (isEventDelta(ev as never)) {
      const base = index.get(ev.id);
      if (base) {
        mergeEventDelta(base as never, ev as never);
        const piece = typeof ev.content === "string" ? ev.content : "";
        if (piece) emit({ type: "text.delta", threadId: ev.threadId ?? "main", messageId: ev.id, text: piece });
        announce(base);
      }
      return null;
    }
    index.set(ev.id, ev);
    switch (ev.type) {
      case "turn.created": turnId = ev.turnId; emit({ type: "turn.started", turnId, sessionId: o.sessionId }); break;
      case "mcp.initialize": emit({ type: "mcp.ready", servers: (ev.mcpServers ?? []).map((s: any) => s.name) }); break;
      case "model.message": announce(ev); break;
      case "tool.response": {
        const c = String(ev.content ?? "");
        let ok = true;
        let preview = c;
        try {
          const j = JSON.parse(c) as { ok?: boolean; error?: unknown };
          if (j && j.error !== undefined) {
            // TrueForge wraps an MCP tool failure as {"error":[{"type":"text","text":"<tool json>"}]}
            ok = false;
            const inner = Array.isArray(j.error) ? j.error.map((x: { text?: string }) => x?.text ?? "").join("") : String(j.error);
            preview = inner;
            try {
              const jj = JSON.parse(inner) as { error?: { code?: string; message?: string } };
              if (jj.error?.message) preview = `${jj.error.code ?? "ERROR"}: ${jj.error.message}`;
            } catch { /* inner text is not JSON */ }
          } else if (j?.ok === false) ok = false;
        } catch { /* non-JSON tool output */ }
        emit({ type: "tool.result", callId: ev.toolCallId, tool: toolNames.get(ev.toolCallId), ok, preview: preview.slice(0, 300), threadId: ev.threadId ?? "main" });
        break;
      }
      case "tool.approval_required": {
        const calls = (ev.toolCalls ?? []).map((r: any) => {
          const src = index.get(r.sourceEventId);
          const c = src?.toolCalls?.find((t: any) => t.id === r.id);
          return { ...toCall(c ?? { id: r.id }, ev.threadId ?? "main"), sourceEventId: r.sourceEventId };
        });
        pending.push({ threadId: ev.threadId ?? "main", calls });
        emit({ type: "approval.required", threadId: ev.threadId ?? "main", calls });
        break;
      }
      case "thread.created": subagents.add(String(ev.threadId)); emit({ type: "subagent.start", threadId: String(ev.threadId), title: ev.title ?? "subagent" }); break;
      case "thread.done": emit({ type: "subagent.done", threadId: String(ev.threadId), ok: ev.state?.status === "done" }); break;
      case "turn.update":
        if (ev.state?.status === "paused") { emit({ type: "paused" }); return "paused"; }
        if (ev.state?.status === "running") emit({ type: "resumed" });
        break;
      case "turn.done": {
        const st = ev.state ?? {};
        const out = st.output?.content ?? "";
        const m = st.metrics ?? {};
        if (st.status === "error") {
          const cls = classifyMessage(String(st.message ?? ""));
          outcome = { status: "error", turnId, sessionId: o.sessionId, text: out, errorMessage: String(st.message ?? "unknown error"), errorClass: cls.errorClass, totalTokens: m.totalTokens, costUsd: m.totalCostInUsd };
        } else if (st.status === "cancelled") {
          outcome = { status: "cancelled", turnId, sessionId: o.sessionId, text: out, cancelReason: st.reason, totalTokens: m.totalTokens, costUsd: m.totalCostInUsd };
        } else outcome = { status: "done", turnId, sessionId: o.sessionId, text: out, totalTokens: m.totalTokens, costUsd: m.totalCostInUsd };
        return "done";
      }
      default: break;
    }
    return null;
  };

  const pending: { threadId: string; calls: (ToolCallInfo & { sourceEventId: string })[] }[] = [];

  /** Consume a stream until it pauses or the turn is done; enforces stall timeout. */
  const consume = async (stream: AsyncIterable<unknown>): Promise<"paused" | "done" | "ended"> => {
    const it = (stream as AsyncIterable<Ev>)[Symbol.asyncIterator]();
    for (;;) {
      let timer: NodeJS.Timeout | undefined;
      const stalled = new Promise<never>((_, rej) => {
        if (stallMs > 0) timer = setTimeout(() => rej(new ForgeClientError("STALLED", `no events for ${stallMs} ms (stalled)`)), stallMs);
      });
      let r: IteratorResult<Ev>;
      try {
        r = await Promise.race([it.next(), stalled]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (r.done) return "ended";
      const res = handle(r.value);
      if (res) return res;
    }
  };

  /** Rebuild index/pending state from TrueForge's stored events when resuming (no events are emitted for history). */
  const prime = async (): Promise<void> => {
    turnId = o.resume!.turnId;
    const answered = new Set<string>();
    const events: Ev[] = [];
    for await (const ev of (await client.sessions.listTurnEvents(o.sessionId, turnId)) as unknown as AsyncIterable<Ev>) events.push(ev);
    for (const ev of events) {
      lastId = ev.id ?? lastId;
      index.set(ev.id, ev);
      if (ev.type === "model.message") { announced.add(ev.id); for (const c of ev.toolCalls ?? []) toolNames.set(c.id, c.toolInfo?.name ?? c.function?.name ?? "?"); }
      if (ev.type === "user.tool_approval" || ev.type === "tool.response") answered.add(String(ev.toolCallId));
    }
    for (const ev of events) {
      if (ev.type === "tool.approval_required") {
        const calls = (ev.toolCalls ?? []).filter((r: any) => !answered.has(r.id)).map((r: any) => {
          const c = index.get(r.sourceEventId)?.toolCalls?.find((x: any) => x.id === r.id);
          return { ...toCall(c ?? { id: r.id }, ev.threadId ?? "main"), sourceEventId: r.sourceEventId };
        });
        if (calls.length) pending.push({ threadId: ev.threadId ?? "main", calls });
      }
      if (ev.type === "turn.done") handle(ev);
    }
    emit({ type: "turn.started", turnId, sessionId: o.sessionId });
  };

  try {
    let stream: AsyncIterable<unknown> | null = null;
    let startPaused = false;
    if (o.resume) {
      await prime();
      if (!outcome) {
        if (pending.length) startPaused = true;
        else stream = (await client.sessions.subscribeToTurn(o.sessionId, turnId, { afterEventId: lastId }, { abortSignal: streamAbort.signal, timeoutInSeconds: 3600, maxRetries: 0 })) as AsyncIterable<unknown>;
      }
    } else {
      stream = (await client.sessions.createTurnStream(o.sessionId, { input: [{ type: "user.message", content: o.text }] }, { maxRetries: 0, abortSignal: streamAbort.signal, timeoutInSeconds: 3600 })) as AsyncIterable<unknown>;
    }
    for (;;) {
      if (outcome) break;
      const state = startPaused ? ((startPaused = false), "paused" as const) : await consume(stream!);
      if (state === "done") break;
      if (state === "ended") {
        if (cancelled) { outcome = { status: "cancelled", turnId, sessionId: o.sessionId, text: "", cancelReason: "client-cancelled" }; break; }
        throw new ForgeClientError("UNKNOWN", "event stream ended before the turn completed");
      }
      // paused: gather decisions from the human, post them, subscribe for the continuation
      const batch = pending.splice(0);
      const decisions: { type: "user.tool_approval"; threadId: string; toolCallId: string; approval: ApprovalDecision }[] = [];
      for (const p of batch) for (const call of p.calls) {
        const d: ApprovalDecision = cancelled ? { status: "deny", reason: "cancelled" } : o.onApproval ? await o.onApproval(call) : { status: "deny", reason: "no approval handler configured" };
        decisions.push({ type: "user.tool_approval", threadId: p.threadId, toolCallId: call.callId, approval: d });
      }
      stream = (await client.sessions.subscribeToTurn(o.sessionId, turnId, { afterEventId: lastId }, { abortSignal: streamAbort.signal, timeoutInSeconds: 3600, maxRetries: 0 })) as AsyncIterable<unknown>;
      await client.sessions.createTurnEvents(o.sessionId, turnId, { events: decisions as never });
    }
  } catch (e) {
    if (detached) outcome = { status: "cancelled", turnId, sessionId: o.sessionId, text: "", cancelReason: "detached" };
    else if (cancelled || streamAbort.signal.aborted) outcome = { status: "cancelled", turnId, sessionId: o.sessionId, text: "", cancelReason: "client-cancelled" };
    else if (e instanceof ForgeClientError && e.errorClass === "STALLED") {
      void client.sessions.cancel(o.sessionId).catch(() => undefined);
      outcome = { status: "error", turnId, sessionId: o.sessionId, text: "", errorMessage: e.message, errorClass: "STALLED" };
    } else {
      const c = classifyThrown(e);
      throw new ForgeClientError(c.errorClass, `${c.title}: ${(e as Error).message}`, e);
    }
  } finally {
    o.signal?.removeEventListener("abort", sendCancel);
    o.detach?.removeEventListener("abort", onDetach);
  }
  const final = outcome ?? { status: "error" as const, turnId, sessionId: o.sessionId, text: "", errorMessage: "turn ended without a result", errorClass: "UNKNOWN" as const };
  emit({ type: "turn.done", outcome: final });
  return final;
}
