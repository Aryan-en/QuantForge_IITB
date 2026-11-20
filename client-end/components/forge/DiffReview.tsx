"use client";

import {
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FilePlus2,
  FileText,
  GitCompare,
  GitPullRequest,
  RotateCcw,
  ShieldCheck,
  Undo2,
  X,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip, type Tone } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { basename, dirname, pluralize } from "@/lib/format";
import type { FileChange, Hunk, HunkState, ReviewQueueState } from "@/lib/protocol";
import { reviewStats } from "@/lib/store/reducer";

const STATE_TONE: Record<HunkState, Tone> = {
  pending: "neutral",
  accepted: "success",
  rejected: "danger",
  applied: "accent",
  stale: "warning",
  conflicted: "danger",
  undone: "neutral",
};

const STATE_LABEL: Record<HunkState, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  applied: "Applied",
  stale: "Stale",
  conflicted: "Conflicted",
  undone: "Undone",
};

const ORIGIN_LABEL: Record<NonNullable<ReviewQueueState["origin"]>, string> = {
  review_gate: "Review gate · submit_changes",
  local_review: "Local review",
  cancelled_turn: "From cancelled turn",
  inline_edit: "Inline edit",
};

export type DiffReviewProps = {
  queue: ReviewQueueState;
  onHunk: (proposalId: string, hunkId: string, action: "accept" | "reject" | "reset") => void;
  onFile: (proposalId: string, action: "accept" | "reject") => void;
  onBulk: (action: "acceptAll" | "rejectAll" | "apply" | "undo") => void;
  onOpenDiff: (proposalId: string) => void;
  compact?: boolean;
};

export function DiffReview({ queue, onHunk, onFile, onBulk, onOpenDiff, compact }: DiffReviewProps) {
  const s = reviewStats(queue);
  const [confirmRejectAll, setConfirmRejectAll] = useState(false);

  if (queue.files.length === 0 && !queue.lastApplied) {
    return <EmptyState icon={GitCompare} title="Nothing to review" body="Proposed edits appear here before anything is written." />;
  }

  const decided = s.accepted + s.rejected;
  const reviewable = s.pending + s.accepted + s.rejected;
  const canApply = s.accepted > 0 && s.pending === 0 && s.blocked === 0 && !queue.applying;
  const applyReason = s.blocked
    ? "Resolve stale or conflicted hunks first"
    : s.pending
      ? `Decide ${pluralize(s.pending, "pending hunk")} first`
      : s.accepted === 0
        ? "No hunks accepted"
        : undefined;
  const allRejectedDecision = reviewable > 0 && s.accepted === 0 && s.pending === 0 && s.rejected > 0;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-bg/95 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          {queue.gateCallId ? <ShieldCheck size={14} className="text-warning" aria-hidden /> : <GitCompare size={14} className="text-muted" aria-hidden />}
          <p className="tabular text-secondary text-fg">
            <span className="font-semibold">{pluralize(s.files, "file")}</span>
            <span className="text-muted"> · {pluralize(s.hunks, "hunk")} · </span>
            <span className="text-diff-add-fg">+{s.added}</span> <span className="text-diff-del-fg">−{s.removed}</span>
          </p>
          {reviewable > 0 ? (
            <span className="tabular ml-auto text-meta text-faint" aria-live="polite">
              {decided}/{reviewable} decided
            </span>
          ) : null}
        </div>
        {queue.origin ? <p className="text-meta text-muted">{ORIGIN_LABEL[queue.origin]}</p> : null}
        {queue.summary ? <p className="text-secondary text-fg">{queue.summary}</p> : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {reviewable > 0 ? (
            <>
              <Button size="sm" variant="ghost" icon={CheckCheck} onClick={() => onBulk("acceptAll")} disabled={s.pending + s.rejected === 0}>
                Accept all
              </Button>
              {confirmRejectAll ? (
                <span role="alertdialog" aria-label="Confirm reject all" className="flex items-center gap-1 text-meta text-muted">
                  Discard {s.accepted} accepted?
                  <Button size="sm" variant="danger" onClick={() => (onBulk("rejectAll"), setConfirmRejectAll(false))}>
                    Reject all
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRejectAll(false)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={X}
                  disabled={s.pending + s.accepted === 0}
                  onClick={() => (s.accepted > 0 ? setConfirmRejectAll(true) : onBulk("rejectAll"))}
                >
                  Reject all
                </Button>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {allRejectedDecision ? (
                  <Button size="sm" variant="secondary" icon={X} onClick={() => onBulk("apply")} loading={queue.applying}>
                    {queue.gateCallId ? "Send rejection" : "Discard"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={queue.gateCallId ? GitPullRequest : Check}
                    disabled={!canApply}
                    disabledReason={applyReason}
                    loading={queue.applying}
                    onClick={() => onBulk("apply")}
                    title="Apply accepted hunks (Ctrl+Enter)"
                  >
                    Apply {s.accepted > 0 ? s.accepted : ""} accepted
                  </Button>
                )}
              </div>
            </>
          ) : null}
          {queue.lastApplied && !queue.lastApplied.undone ? (
            <Button size="sm" variant="secondary" icon={Undo2} onClick={() => onBulk("undo")} className={reviewable > 0 ? "" : "ml-auto"}>
              Undo last batch
            </Button>
          ) : null}
        </div>
        {queue.lastApplied ? (
          <p className="text-meta text-muted" aria-live="polite">
            {queue.lastApplied.undone
              ? `Reverted ${pluralize(queue.lastApplied.files, "file")} to their exact previous contents.`
              : `Applied ${pluralize(queue.lastApplied.hunks, "hunk")} across ${pluralize(queue.lastApplied.files, "file")} as one undoable batch.`}
          </p>
        ) : null}
      </div>

      {/* Files */}
      <ul className="flex flex-col gap-2 p-2" aria-label="Changed files">
        {queue.files.map((f) => (
          <FileDiffRow key={f.proposalId} file={f} onHunk={onHunk} onFile={onFile} onOpenDiff={onOpenDiff} compact={compact} />
        ))}
      </ul>
    </div>
  );
}

function FileDiffRow({
  file,
  onHunk,
  onFile,
  onOpenDiff,
  compact,
}: {
  file: FileChange;
  onHunk: DiffReviewProps["onHunk"];
  onFile: DiffReviewProps["onFile"];
  onOpenDiff: DiffReviewProps["onOpenDiff"];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const states = file.hunks.map((h) => h.state);
  const allAccepted = states.every((s) => s === "accepted" || s === "applied");
  const decidable = states.some((s) => s === "pending" || s === "accepted" || s === "rejected");
  return (
    <li className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRight size={12} aria-hidden className={cn("shrink-0 text-faint transition-transform duration-[var(--forge-dur-med)]", open && "rotate-90")} />
          <span
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-sm font-mono text-[10px] font-bold",
              file.status === "A" ? "bg-success-soft text-success" : file.status === "D" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
            )}
            title={file.status === "A" ? "Added" : file.status === "D" ? "Deleted" : "Modified"}
          >
            {file.status}
          </span>
          {file.status === "A" ? <FilePlus2 size={13} className="shrink-0 text-muted" aria-hidden /> : <FileText size={13} className="shrink-0 text-muted" aria-hidden />}
          <span className="min-w-0 truncate font-mono text-secondary" title={file.path}>
            <span className="text-fg">{basename(file.path)}</span>
            {!compact ? <span className="text-faint"> {dirname(file.path)}</span> : null}
          </span>
          <span className="tabular ml-auto shrink-0 pl-2 font-mono text-meta">
            <span className="text-diff-add-fg">+{file.added}</span> <span className="text-diff-del-fg">−{file.removed}</span>
          </span>
        </button>
        {decidable ? (
          <>
            <IconButton icon={Check} label={`Accept all hunks in ${file.path}`} size="sm" onClick={() => onFile(file.proposalId, "accept")} active={allAccepted} />
            <IconButton icon={X} label={`Reject all hunks in ${file.path}`} size="sm" onClick={() => onFile(file.proposalId, "reject")} />
          </>
        ) : null}
        <IconButton icon={ExternalLink} label={`Open ${file.path} diff in editor`} size="sm" onClick={() => onOpenDiff(file.proposalId)} />
      </div>
      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-border-subtle bg-bg p-1.5">
          {file.hunks.map((h) => (
            <HunkCard key={h.hunkId} hunk={h} onHunk={onHunk} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function HunkCard({ hunk, onHunk }: { hunk: Hunk; onHunk: DiffReviewProps["onHunk"] }) {
  const decidable = hunk.state === "pending" || hunk.state === "accepted" || hunk.state === "rejected";
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!decidable || e.target !== e.currentTarget) return;
    if (e.key === "a" || e.key === "A") onHunk(hunk.proposalId, hunk.hunkId, "accept");
    if (e.key === "r" || e.key === "R") onHunk(hunk.proposalId, hunk.hunkId, "reject");
  };
  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`Hunk ${hunk.header}, ${STATE_LABEL[hunk.state]}`}
      className={cn(
        "overflow-hidden rounded border bg-surface transition-[border-color,opacity] duration-[var(--forge-dur-med)]",
        hunk.state === "accepted" ? "border-success/50" : hunk.state === "rejected" ? "border-danger/40 opacity-60" : hunk.state === "applied" ? "border-accent/50" : "border-border",
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1">
        <span className="min-w-0 truncate font-mono text-meta text-info">{hunk.header}</span>
        <Chip tone={STATE_TONE[hunk.state]} className="ml-auto shrink-0">
          {STATE_LABEL[hunk.state]}
        </Chip>
        {decidable ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="sm"
              variant={hunk.state === "accepted" ? "success" : "ghost"}
              icon={Check}
              aria-pressed={hunk.state === "accepted"}
              onClick={() => onHunk(hunk.proposalId, hunk.hunkId, hunk.state === "accepted" ? "reset" : "accept")}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant={hunk.state === "rejected" ? "danger" : "ghost"}
              icon={X}
              aria-pressed={hunk.state === "rejected"}
              onClick={() => onHunk(hunk.proposalId, hunk.hunkId, hunk.state === "rejected" ? "reset" : "reject")}
            >
              Reject
            </Button>
          </div>
        ) : null}
      </div>
      {hunk.rationale ? <p className="border-b border-border-subtle px-2 py-1 text-secondary text-muted">{hunk.rationale}</p> : null}
      {hunk.state === "stale" ? (
        <p className="flex items-center gap-1.5 border-b border-border-subtle bg-warning-soft px-2 py-1 text-secondary text-fg">
          <RotateCcw size={12} aria-hidden /> File changed since the agent read it — re-base needed.
        </p>
      ) : null}
      {hunk.state === "conflicted" ? (
        <p className="flex items-center gap-1.5 border-b border-border-subtle bg-danger-soft px-2 py-1 text-secondary text-fg">
          <CircleAlert size={12} aria-hidden /> Conflicts with your edits — resolve in the editor.
        </p>
      ) : null}
      <DiffLines lines={hunk.lines} />
    </div>
  );
}

export function DiffLines({ lines, className }: { lines: Hunk["lines"]; className?: string }) {
  return (
    <div className={cn("forge-scroll overflow-x-auto", className)}>
      <table className="w-full border-collapse font-mono text-secondary leading-[1.5]">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={l.kind === "add" ? "bg-diff-add-bg" : l.kind === "del" ? "bg-diff-del-bg" : undefined}>
              <td className="tabular w-8 select-none pr-1 text-right align-top text-[11px] text-faint">{l.oldNo ?? ""}</td>
              <td className="tabular w-8 select-none pr-1 text-right align-top text-[11px] text-faint">{l.newNo ?? ""}</td>
              <td
                aria-hidden
                className={cn(
                  "w-4 select-none text-center align-top",
                  l.kind === "add" ? "text-diff-add-fg" : l.kind === "del" ? "text-diff-del-fg" : "text-faint",
                )}
              >
                {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
              </td>
              <td className={cn("whitespace-pre pr-3", l.kind === "add" ? "text-fg" : l.kind === "del" ? "text-fg/80" : "text-muted")}>
                <span className="sr-only">{l.kind === "add" ? "added: " : l.kind === "del" ? "removed: " : ""}</span>
                {l.text || " "}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
