import { GitCompare } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { pluralize } from "@/lib/format";
import type { ReviewQueueState } from "@/lib/protocol";
import { reviewStats } from "@/lib/store/reducer";

/** Pinned above the composer when edits are waiting for review and the Review view is not open. */
export function ReviewBar({ queue, onOpen }: { queue: ReviewQueueState; onOpen: () => void }) {
  const s = reviewStats(queue);
  const waiting = s.pending + s.accepted + s.rejected;
  if (waiting === 0) return null;
  return (
    <div className="forge-enter flex items-center gap-2 border-t border-accent/30 bg-accent-soft px-3 py-1.5">
      <GitCompare size={14} className="shrink-0 text-accent" aria-hidden />
      <p className="tabular min-w-0 truncate text-secondary text-fg">
        {pluralize(s.files, "file")} changed · {pluralize(s.hunks, "hunk")} <span className="text-diff-add-fg">+{s.added}</span>{" "}
        <span className="text-diff-del-fg">−{s.removed}</span>
      </p>
      <Button size="sm" variant="primary" className="ml-auto shrink-0" onClick={onOpen}>
        Review
      </Button>
    </div>
  );
}
