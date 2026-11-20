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

/** Lets the host abort every in-flight tool call (user pressed Stop). TrueForge's cancel waits for running MCP calls, so FORGE must abort its own. */
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

export interface ToolContext {
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
