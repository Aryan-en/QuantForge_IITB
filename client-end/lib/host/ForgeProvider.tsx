"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { envelope, type ForgeSettings, type Mention } from "@/lib/protocol";
import { INITIAL_VIEW_STATE, reducer, type ViewState } from "@/lib/store/reducer";
import type { Host } from "./types";

export type ForgeActions = {
  submitTask(text: string, mentions: Mention[]): void;
  cancelTurn(): void;
  decideApproval(callId: string, decision: "allow" | "deny", reason?: string): void;
  reviewHunk(proposalId: string, hunkId: string, action: "accept" | "reject" | "reset"): void;
  reviewFile(proposalId: string, action: "accept" | "reject"): void;
  reviewBulk(action: "acceptAll" | "rejectAll" | "apply" | "undo"): void;
  dismissError(id: string): void;
  dismissToast(): void;
  updateSettings(patch: Partial<ForgeSettings>): void;
  testModel(): void;
  setFallbacks(fallbacks: string[]): void;
  checkConnection(): void;
  startTrueForge(): void;
  newSession(): void;
  selectSession(sessionId: string): void;
  openInTrueForge(): void;
  openFile(path: string, line?: number): void;
  openDiff(proposalId: string): void;
};

type ForgeContextValue = { state: ViewState; actions: ForgeActions; hostKind: Host["kind"] };

const ForgeContext = createContext<ForgeContextValue | null>(null);

export function ForgeProvider({ host, children }: { host: Host; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_VIEW_STATE);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Stream deltas are buffered and flushed once per animation frame (Ui-regitry §B.6 / plan NFR).
  const pending = useRef<Record<string, string>>({});
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      frame.current = null;
      const chunks = pending.current;
      pending.current = {};
      if (Object.keys(chunks).length) dispatch({ type: "stream.flush", chunks });
    };
    const unsubscribe = host.subscribe((message) => {
      if (message.type === "stream.delta") {
        // Late-event guard happens here too, so buffered text from a closed turn is never shown.
        if (stateRef.current.closedTurnIds.includes(message.payload.turnId)) return;
        const { itemId, text } = message.payload;
        pending.current[itemId] = (pending.current[itemId] ?? "") + text;
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
        return;
      }
      if (message.type === "stream.end" || message.type === "turn.status") {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        flush();
      }
      dispatch({ type: "host", message, at: Date.now() });
    });
    host.post(envelope("ready", {}));
    return () => {
      unsubscribe();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [host]);

  const post = host.post.bind(host);

  const cancelTurn = useCallback(() => {
    const t = stateRef.current.app.turn;
    if (t.status !== "running" && t.status !== "paused") return;
    dispatch({ type: "local.cancelRequested", at: Date.now() });
    host.post(envelope("turn.cancel", { sessionId: stateRef.current.app.activeSessionId, turnId: t.id }));
  }, [host]);

  const actions = useMemo<ForgeActions>(
    () => ({
      submitTask: (text, mentions) => post(envelope("task.submit", { text, mentions })),
      cancelTurn,
      decideApproval: (callId, decision, reason) => {
        dispatch({ type: "local.approvalSent", callId, decision });
        post(envelope("approval.decide", { callId, decision, reason }));
      },
      reviewHunk: (proposalId, hunkId, action) => {
        dispatch({ type: "local.hunk", proposalId, hunkId, action });
        post(envelope("review.hunk", { proposalId, hunkId, action }));
      },
      reviewFile: (proposalId, action) => {
        dispatch({ type: "local.file", proposalId, action });
        post(envelope("review.file", { proposalId, action }));
      },
      reviewBulk: (action) => {
        if (action === "acceptAll" || action === "rejectAll") dispatch({ type: "local.bulk", action });
        post(envelope("review.bulk", { action, batchId: stateRef.current.review.batchId }));
      },
      dismissError: (id) => dispatch({ type: "local.dismissError", id }),
      dismissToast: () => dispatch({ type: "local.dismissToast" }),
      updateSettings: (patch) => post(envelope("settings.update", { patch })),
      testModel: () => post(envelope("model.test", {})),
      setFallbacks: (fallbacks) => post(envelope("model.fallbacks", { fallbacks })),
      checkConnection: () => post(envelope("connection.check", {})),
      startTrueForge: () => post(envelope("trueforge.start", {})),
      newSession: () => {
        dispatch({ type: "local.reset" });
        post(envelope("session.new", {}));
      },
      selectSession: (sessionId) => post(envelope("session.select", { sessionId })),
      openInTrueForge: () => post(envelope("session.openInTrueForge", { sessionId: stateRef.current.app.activeSessionId })),
      openFile: (path, line) => post(envelope("file.open", { path, line })),
      openDiff: (proposalId) => post(envelope("diff.open", { proposalId })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `post` is a stable bind of `host`
    [host, cancelTurn],
  );

  const value = useMemo(() => ({ state, actions, hostKind: host.kind }), [state, actions, host.kind]);
  return <ForgeContext.Provider value={value}>{children}</ForgeContext.Provider>;
}

export function useForge(): ForgeContextValue {
  const ctx = useContext(ForgeContext);
  if (!ctx) throw new Error("useForge must be used inside <ForgeProvider>");
  return ctx;
}
