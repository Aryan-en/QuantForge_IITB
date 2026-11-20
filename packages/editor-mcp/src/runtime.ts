import path from "node:path";
import os from "node:os";
import { NodeWorkspace, RepoIndex } from "@forge/context-engine";
import { NodeFileStore, ReviewQueue, type FileStore, UndoJournal, FileJournalStore, MemoryJournalStore } from "@forge/diff-engine";
import { CancelRegistry, DEFAULT_LIMITS, limitsForContext, type ForgeEvent, type ToolContext } from "./context.js";
import { ShadowWorkspace } from "./shadow.js";

export interface RuntimeOptions {
  root: string;
  /** Where FORGE keeps shadow copies and the undo journal. MUST be outside the workspace (ADR-013). */
  storageDir?: string;
  sessionId?: string;
  shadow?: boolean;
  reviewMode?: "host" | "auto-accept";
  excludeGlobs?: string[];
  onEvent?: (e: ForgeEvent) => void;
  persistJournal?: boolean;
  extraPath?: string[];
  /** Context window (tokens) of the smallest model that may run the task; sizes tool output accordingly. */
  modelContextTokens?: number;
  /** Replace the default filesystem store (the extension supplies a WorkspaceEdit-backed one). */
  store?: FileStore;
  diagnostics?: ToolContext["diagnostics"];
}

export async function createToolContext(o: RuntimeOptions): Promise<ToolContext> {
  const root = path.resolve(o.root);
  const storageDir = o.storageDir ?? path.join(os.tmpdir(), "forge-storage");
  if (path.resolve(storageDir).startsWith(root + path.sep) || path.resolve(storageDir) === root) throw new Error("storageDir must be outside the workspace");
  const ws = new NodeWorkspace(root, { excludeGlobs: o.excludeGlobs ?? [] });
  const store = o.store ?? new NodeFileStore(root);
  const journal = new UndoJournal(o.persistJournal ? new FileJournalStore(path.join(storageDir, "undo-journal.json")) : new MemoryJournalStore());
  await journal.init();
  const review = new ReviewQueue(store, journal);
  const sessionId = o.sessionId ?? `s_${Date.now().toString(36)}`;
  return {
    cancel: new CancelRegistry(),
    limits: o.modelContextTokens ? limitsForContext(o.modelContextTokens) : DEFAULT_LIMITS,
    root, ws, index: new RepoIndex(ws), review, store,
    shadow: o.shadow === false ? null : new ShadowWorkspace(ws, storageDir, sessionId, review),
    reviewMode: o.reviewMode ?? "host",
    extraPath: o.extraPath,
    diagnostics: o.diagnostics,
    emit: o.onEvent ?? (() => undefined),
  };
}
