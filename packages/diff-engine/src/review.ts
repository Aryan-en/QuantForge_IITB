import { randomUUID } from "node:crypto";
import type { HunkState, ProposalView, ReviewQueueState } from "@forge/protocol";
import { applyEdits, contentHash, EditError, type AnyEdit } from "./text.js";
import { applyHunks, makeHunks, type Hunk } from "./hunks.js";
import type { FileStore, FileChange } from "./stores.js";
import type { UndoJournal } from "./journal.js";

export type ProposeErrorCode = "STALE_BASE" | "NOT_FOUND" | "INVALID_INPUT";
export class ProposeError extends Error {
  constructor(readonly code: ProposeErrorCode, message: string) {
    super(message);
    this.name = "ProposeError";
  }
}

export interface Proposal {
  id: string;
  path: string;
  kind: "modify" | "create" | "delete";
  baseText: string | null;
  baseHash: string | null;
  proposedText: string | null;
  rationale: string;
  hunks: Hunk[];
  states: Map<string, HunkState>;
  turnId: string | undefined;
  fromCancelledTurn: boolean;
}

export interface ProposeInput {
  path: string;
  edits?: AnyEdit[];
  newContent?: string;
  create?: boolean;
  delete?: boolean;
  rationale: string;
  baseHash?: string | undefined;
  turnId?: string | undefined;
}

export interface QueueSnapshot {
  v: 1;
  verified?: boolean;
  proposals: { id: string; path: string; kind: "modify" | "create" | "delete"; baseText: string | null; proposedText: string | null; rationale: string; turnId: string | undefined; fromCancelledTurn: boolean; states: Record<string, string> }[];
}

export interface ApplyReport {
  ok: boolean;
  batchId: string | null;
  applied: { proposalId: string; hunkId: string }[];
  rejected: { proposalId: string; hunkId: string }[];
  conflicted: { proposalId: string; hunkId: string }[];
  filesChanged: string[];
}
export interface UndoReport {
  ok: boolean;
  restored: string[];
  conflicts: string[];
}

/**
 * Holds proposed edits until a human decides. The only way text reaches the FileStore is apply(),
 * and only for hunks in the "accepted" state.
 */
export class ReviewQueue {
  private proposals = new Map<string, Proposal>();
  private lastBatchId: string | null = null;
  /** Bumped on every proposal change; verification is only valid for the version it was made against. */
  private version = 0;
  private verifiedVersion = -1;
  private gateDenials = 0;

  constructor(private readonly store: FileStore, private readonly journal: UndoJournal) {}

  /** Text a tool should see for `path`: the pending proposed text if any, else what is on disk. */
  async effectiveText(path: string): Promise<{ text: string | null; fromProposal: boolean }> {
    const existing = this.byPath(path);
    if (existing && existing.kind !== "delete" && existing.proposedText !== null) return { text: existing.proposedText, fromProposal: true };
    if (existing && existing.kind === "delete") return { text: null, fromProposal: true };
    return { text: await this.store.read(path), fromProposal: false };
  }

  private byPath(path: string): Proposal | undefined {
    for (const p of this.proposals.values()) if (p.path === path && !this.isSettled(p)) return p;
    return undefined;
  }

  private isSettled(p: Proposal): boolean {
    return [...p.states.values()].every((s) => s === "applied" || s === "undone" || s === "rejected");
  }

  async propose(input: ProposeInput): Promise<{ proposal: Proposal }> {
    const prior = this.byPath(input.path);
    const eff = await this.effectiveText(input.path);
    if (input.baseHash !== undefined && eff.text !== null && contentHash(eff.text) !== input.baseHash) {
      throw new ProposeError("STALE_BASE", `${input.path} changed since it was read; re-read the file and retry`);
    }
    let kind: Proposal["kind"] = "modify";
    let proposedText: string | null;
    const original = prior ? prior.baseText : eff.text;
    if (input.delete) {
      if (eff.text === null) throw new ProposeError("NOT_FOUND", `${input.path} does not exist`);
      kind = "delete";
      proposedText = null;
    } else if (input.newContent !== undefined) {
      if (eff.text === null) {
        if (input.create === false) throw new ProposeError("NOT_FOUND", `${input.path} does not exist`);
        kind = "create";
      }
      proposedText = input.newContent;
    } else if (input.edits) {
      if (eff.text === null) throw new ProposeError("NOT_FOUND", `${input.path} does not exist; use newContent with create:true`);
      try {
        proposedText = applyEdits(eff.text, input.edits);
      } catch (e) {
        if (e instanceof EditError) throw new ProposeError("INVALID_INPUT", e.message);
        throw e;
      }
    } else throw new ProposeError("INVALID_INPUT", "no edits, newContent or delete provided");

    if (prior?.kind === "create" && kind !== "delete") kind = "create";
    if (original === null && kind === "modify") kind = "create";
    const baseText = original;
    const baseHash = baseText === null ? null : contentHash(baseText);
    if (kind === "modify" && proposedText === baseText) {
      if (prior) this.proposals.delete(prior.id);
      throw new ProposeError("INVALID_INPUT", "edit produces no change");
    }
    let hunks: Hunk[];
    if (kind === "create") hunks = makeHunks(input.path, "none", "", proposedText ?? "");
    else if (kind === "delete") hunks = makeHunks(input.path, baseHash ?? "", baseText ?? "", "");
    else hunks = makeHunks(input.path, baseHash ?? "", baseText ?? "", proposedText ?? "");

    if (prior) this.proposals.delete(prior.id);
    const proposal: Proposal = {
      id: prior?.id ?? `p_${randomUUID().slice(0, 8)}`,
      path: input.path,
      kind,
      baseText,
      baseHash,
      proposedText,
      rationale: input.rationale,
      hunks,
      states: new Map(hunks.map((h) => [h.id, "pending" as HunkState])),
      turnId: input.turnId,
      fromCancelledTurn: false,
    };
    this.proposals.set(proposal.id, proposal);
    this.version++;
    return { proposal };
  }

  /** The agent proved (verify_changes) that every requirement maps to a line it added, for the CURRENT set of proposals. */
  markVerified(): void {
    this.verifiedVersion = this.version;
    this.gateDenials = 0;
  }
  isVerified(): boolean {
    return this.verifiedVersion === this.version;
  }
  /**
   * Called by whoever answers TrueForge's approval for `submit_changes`, BEFORE the human is asked. Declines (twice at most) when the
   * agent has not verified its requirement checklist, so a model that did half the task is sent back instead of wasting a review.
   */
  submitGate(): { pass: true; unverified?: boolean } | { pass: false; reason: string } {
    if (this.list().length === 0 || this.isVerified()) return { pass: true };
    if (this.gateDenials >= 2) return { pass: true, unverified: true };
    this.gateDenials++;
    return { pass: false, reason: "Not reviewed yet: call verify_changes first with a checklist that maps EVERY requirement of the task to evidence (an exact line you added with propose_edit). If a requirement has no evidence, add the missing edit with propose_edit, then verify_changes, then call submit_changes again." };
  }

  /** Serialisable snapshot so pending proposals survive a window reload. Hunks are recomputed on restore (ids are stable). */
  snapshot(): QueueSnapshot {
    return {
      v: 1,
      verified: this.isVerified(),
      proposals: this.list().map((p) => ({ id: p.id, path: p.path, kind: p.kind, baseText: p.baseText, proposedText: p.proposedText, rationale: p.rationale, turnId: p.turnId, fromCancelledTurn: p.fromCancelledTurn, states: Object.fromEntries(p.states) })),
    };
  }
  /** Replace the queue with a snapshot, then re-check every hunk against the current files. */
  async restore(s: QueueSnapshot): Promise<void> {
    this.proposals.clear();
    this.gateDenials = 0;
    if (s?.v !== 1) return;
    for (const sp of s.proposals) {
      const baseHash = sp.baseText === null ? null : contentHash(sp.baseText);
      const hunks = sp.kind === "create" ? makeHunks(sp.path, "none", "", sp.proposedText ?? "") : sp.kind === "delete" ? makeHunks(sp.path, baseHash ?? "", sp.baseText ?? "", "") : makeHunks(sp.path, baseHash ?? "", sp.baseText ?? "", sp.proposedText ?? "");
      this.proposals.set(sp.id, {
        id: sp.id, path: sp.path, kind: sp.kind, baseText: sp.baseText, baseHash, proposedText: sp.proposedText, rationale: sp.rationale, hunks,
        states: new Map(hunks.map((h) => [h.id, (sp.states[h.id] ?? "pending") as HunkState])), turnId: sp.turnId, fromCancelledTurn: sp.fromCancelledTurn,
      });
    }
    this.version++;
    if (s.verified) this.verifiedVersion = this.version;
    await this.refresh();
  }

  list(): Proposal[] {
    return [...this.proposals.values()];
  }
  get(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }
  pendingCount(): number {
    return this.list().reduce((n, p) => n + [...p.states.values()].filter((s) => s === "pending" || s === "accepted" || s === "stale").length, 0);
  }

  decide(proposalId: string, hunkId: string, action: "accept" | "reject"): boolean {
    const p = this.proposals.get(proposalId);
    const s = p?.states.get(hunkId);
    if (!p || s === undefined) return false;
    if (s === "applied" || s === "undone" || s === "conflicted") return false;
    p.states.set(hunkId, action === "accept" ? "accepted" : "rejected");
    return true;
  }
  decideAll(action: "accept" | "reject"): void {
    for (const p of this.proposals.values()) for (const [h, s] of p.states) if (s === "pending" || s === "accepted" || s === "rejected" || s === "stale") p.states.set(h, action === "accept" ? "accepted" : "rejected");
  }

  /** Tag proposals created during a cancelled turn; they stay reviewable but nothing is applied implicitly. */
  markTurnCancelled(turnId: string): void {
    for (const p of this.proposals.values()) if (p.turnId === turnId) p.fromCancelledTurn = true;
  }

  /** Compare pending hunks against current disk state; flag stale/conflicted ones. */
  async refresh(): Promise<void> {
    for (const p of this.proposals.values()) {
      const cur = await this.store.read(p.path);
      const same = (cur === null && p.baseText === null) || (cur !== null && p.baseText !== null && contentHash(cur) === p.baseHash);
      for (const h of p.hunks) {
        const s = p.states.get(h.id);
        if (s !== "pending" && s !== "accepted" && s !== "stale") continue;
        if (same) {
          if (s === "stale") p.states.set(h.id, "pending");
          continue;
        }
        if (p.kind === "modify" && cur !== null && applyHunks(cur, [h]).conflicted.length === 0) p.states.set(h.id, s === "accepted" ? "accepted" : "stale");
        else p.states.set(h.id, "conflicted");
      }
    }
  }

  /** Apply accepted hunks atomically. Undecided hunks are treated as rejected. */
  async apply(opts: { rejectUndecided?: boolean } = {}): Promise<ApplyReport> {
    await this.refresh();
    const report: ApplyReport = { ok: true, batchId: null, applied: [], rejected: [], conflicted: [], filesChanged: [] };
    const changes: FileChange[] = [];
    const journalEntries: { path: string; preText: string | null; postHash: string | null }[] = [];
    const willApply: { p: Proposal; ids: string[] }[] = [];

    for (const p of this.proposals.values()) {
      if (opts.rejectUndecided) for (const [h, s] of p.states) if (s === "pending" || s === "stale") p.states.set(h, "rejected");
      const accepted = p.hunks.filter((h) => p.states.get(h.id) === "accepted");
      for (const [h, s] of p.states) {
        if (s === "rejected") report.rejected.push({ proposalId: p.id, hunkId: h });
        if (s === "conflicted") report.conflicted.push({ proposalId: p.id, hunkId: h });
      }
      if (accepted.length === 0) continue;
      const cur = await this.store.read(p.path);
      if (p.kind === "create") {
        if (cur !== null) {
          accepted.forEach((h) => { p.states.set(h.id, "conflicted"); report.conflicted.push({ proposalId: p.id, hunkId: h.id }); });
          continue;
        }
        changes.push({ path: p.path, newText: p.proposedText ?? "" });
        journalEntries.push({ path: p.path, preText: null, postHash: contentHash(p.proposedText ?? "") });
        willApply.push({ p, ids: accepted.map((h) => h.id) });
      } else if (p.kind === "delete") {
        if (cur === null || contentHash(cur) !== p.baseHash) {
          accepted.forEach((h) => { p.states.set(h.id, "conflicted"); report.conflicted.push({ proposalId: p.id, hunkId: h.id }); });
          continue;
        }
        changes.push({ path: p.path, newText: null });
        journalEntries.push({ path: p.path, preText: cur, postHash: null });
        willApply.push({ p, ids: accepted.map((h) => h.id) });
      } else {
        if (cur === null) {
          accepted.forEach((h) => { p.states.set(h.id, "conflicted"); report.conflicted.push({ proposalId: p.id, hunkId: h.id }); });
          continue;
        }
        const res = applyHunks(cur, accepted);
        res.conflicted.forEach((id) => { p.states.set(id, "conflicted"); report.conflicted.push({ proposalId: p.id, hunkId: id }); });
        if (res.applied.length === 0) continue;
        changes.push({ path: p.path, newText: res.text });
        journalEntries.push({ path: p.path, preText: cur, postHash: contentHash(res.text) });
        willApply.push({ p, ids: res.applied });
      }
    }
    if (changes.length === 0) return report;

    const batchId = `b_${randomUUID().slice(0, 8)}`;
    await this.journal.begin({ batchId, at: new Date().toISOString(), entries: journalEntries });
    const ok = await this.store.applyBatch(changes);
    if (!ok) {
      await this.journal.remove(batchId);
      report.ok = false;
      return report;
    }
    await this.journal.commit(batchId);
    for (const { p, ids } of willApply) {
      for (const id of ids) {
        p.states.set(id, "applied");
        report.applied.push({ proposalId: p.id, hunkId: id });
      }
      report.filesChanged.push(p.path);
    }
    report.batchId = batchId;
    this.lastBatchId = batchId;
    return report;
  }

  /** Recover from a crash that happened while a batch was being applied. Call once at startup. */
  async reconcile(): Promise<import("./journal.js").ReconcileReport> {
    return this.journal.reconcile((p) => this.store.read(p), contentHash);
  }

  /** Revert a batch only if every touched file still equals what FORGE wrote (never clobbers later edits). */
  async undo(batchId?: string): Promise<UndoReport> {
    const id = batchId ?? this.lastBatchId ?? this.journal.last()?.batchId;
    const batch = id ? this.journal.get(id) : undefined;
    if (!batch) return { ok: false, restored: [], conflicts: [] };
    const conflicts: string[] = [];
    for (const e of batch.entries) {
      const cur = await this.store.read(e.path);
      const matches = e.postHash === null ? cur === null : cur !== null && contentHash(cur) === e.postHash;
      if (!matches) conflicts.push(e.path);
    }
    if (conflicts.length) return { ok: false, restored: [], conflicts };
    const ok = await this.store.applyBatch(batch.entries.map((e) => ({ path: e.path, newText: e.preText })));
    if (!ok) return { ok: false, restored: [], conflicts: [] };
    await this.journal.remove(batch.batchId);
    const restored = new Set(batch.entries.map((e) => e.path));
    for (const p of this.proposals.values()) if (restored.has(p.path)) for (const [h, s] of p.states) if (s === "applied") p.states.set(h, "undone");
    if (this.lastBatchId === batch.batchId) this.lastBatchId = null;
    return { ok: true, restored: [...restored], conflicts: [] };
  }

  clearSettled(): void {
    for (const [id, p] of this.proposals) if (this.isSettled(p)) this.proposals.delete(id);
  }
  discardAll(): void {
    this.proposals.clear();
  }

  view(awaitingApproval = false): ReviewQueueState {
    const proposals: ProposalView[] = this.list().map((p) => ({
      id: p.id,
      path: p.path,
      kind: p.kind,
      rationale: p.rationale,
      linesAdded: p.hunks.reduce((n, h) => n + h.added, 0),
      linesRemoved: p.hunks.reduce((n, h) => n + h.removed, 0),
      fromCancelledTurn: p.fromCancelledTurn,
      hunks: p.hunks.map((h) => ({
        id: h.id,
        header: `@@ -${h.oldStart + 1},${h.oldLines.length} +${h.oldStart + 1},${h.newLines.length} @@`,
        lines: h.lines,
        state: p.states.get(h.id) ?? "pending",
      })),
    }));
    return { batchId: this.lastBatchId ?? "", proposals, awaitingApproval, canUndo: this.journal.size() > 0 };
  }
}
