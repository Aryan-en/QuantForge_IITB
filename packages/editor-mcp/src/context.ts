import type { ContextBundle, NodeWorkspace, RepoIndex } from "@forge/context-engine";
import type { FileStore, ReviewQueue } from "@forge/diff-engine";
import type { PlanStep, TimelineEvent } from "@forge/protocol";
import type { ShadowWorkspace } from "./shadow.js";

export interface Diagnostic {
  path: string;
  line: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string | undefined;
  code?: string | undefined;
}

export type ForgeEvent =
  | { type: "context"; query: string; bundle: ContextBundle }
  | { type: "plan"; steps: PlanStep[] }
  | { type: "proposal"; proposalId: string; path: string }
  | { type: "review.requested"; summary: string }
  | { type: "review.settled"; decision: string }
  | { type: "timeline"; event: TimelineEvent };

/** Lets the host abort every in-flight tool call (user pressed Stop). TrueForge's cancel waits for running MCP calls, so QuantForge must abort its own. */
export class CancelRegistry {
  private ctl = new AbortController();
  get signal(): AbortSignal {
    return this.ctl.signal;
  }
  /** Abort everything currently running, then arm a fresh signal for the next turn. */
  cancel(reason = "cancelled by user"): void {
    this.ctl.abort(new Error(reason));
    this.ctl = new AbortController();
  }
}

/** Output sizes tuned to the smallest model QuantForge may use, so tool results never overflow a small model's context window. */
export interface OutputLimits {
  defaultBudgetTokens: number;
  maxBudgetTokens: number;
  maxOutputChars: number;
}
export const DEFAULT_LIMITS: OutputLimits = { defaultBudgetTokens: 24_000, maxBudgetTokens: 200_000, maxOutputChars: 64 * 1024 };

/** Derive limits from a model's context window (tokens): context budget ≈ 20% (max 30%), single tool output ≈ 12%. */
export function limitsForContext(contextTokens: number | undefined): OutputLimits {
  if (!contextTokens || contextTokens <= 0) return DEFAULT_LIMITS;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  return {
    defaultBudgetTokens: clamp(Math.floor(contextTokens * 0.2), 1000, DEFAULT_LIMITS.defaultBudgetTokens),
    maxBudgetTokens: clamp(Math.floor(contextTokens * 0.3), 1500, DEFAULT_LIMITS.maxBudgetTokens),
    maxOutputChars: clamp(Math.floor(contextTokens * 4 * 0.12), 4000, DEFAULT_LIMITS.maxOutputChars),
  };
}

export interface ToolContext {
  /** Mutable: the host updates this when the selected model(s) change. */
  limits: OutputLimits;
  cancel: CancelRegistry;
  root: string;
  ws: NodeWorkspace;
  index: RepoIndex;
  review: ReviewQueue;
  store: FileStore;
  /** null disables the shadow (commands then run in the real workspace; weaker isolation). */
  shadow: ShadowWorkspace | null;
  /**
   * "host": hunk decisions come from the human via the extension UI before `submit_changes` runs (production).
   * "auto-accept": accept every pending hunk on submit — ONLY for the headless evaluation harness, where it stands in
   * for the human clicking "Accept all".
   */
  reviewMode: "host" | "auto-accept";
  /** Extra directories prepended to PATH for commands (e.g. a venv's bin). A `.venv`/`venv` inside the workspace is detected automatically. */
  extraPath?: string[] | undefined;
  turnId?: (() => string | undefined) | undefined;
  diagnostics?: ((paths: string[] | undefined, severity: "error" | "warning" | "all") => Promise<Diagnostic[]>) | undefined;
  emit: (e: ForgeEvent) => void;
}

export type Handler<I> = (input: I, ctx: ToolContext, signal: AbortSignal) => Promise<unknown>;
