"use client";

import { Clock, Cpu } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { formatElapsed, formatTokens } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { TurnPhase, TurnState } from "@/lib/protocol";

const PHASE_TEXT: Record<TurnPhase, string> = {
  thinking: "Thinking…",
  reading: "Reading files…",
  searching: "Searching the repository…",
  planning: "Planning…",
  editing: "Drafting edits…",
  verifying: "Verifying in shadow workspace…",
  awaiting_approval: "Waiting for your approval",
  retrying: "Retrying model…",
  cancelling: "Cancelling…",
};

/** StatusStrip (Ui-regitry E.2): live phase + elapsed + tokens; hidden when idle. role="status". */
export function StatusStrip({ turn }: { turn: TurnState }) {
  const active = turn.status === "running" || turn.status === "paused" || turn.status === "cancelling";
  const now = useNow(active, 250);
  if (!active || !turn.phase) return null;
  const elapsed = turn.startedAt && now ? now - turn.startedAt : 0;
  const paused = turn.status === "paused";
  return (
    <div role="status" className="flex h-7 items-center gap-2 border-t border-border-subtle bg-bg px-3 text-secondary">
      {paused ? <span className="size-2 rounded-full bg-warning" aria-hidden /> : <Spinner size={12} />}
      <span className={cn("truncate", paused ? "text-warning" : "text-fg")}>{PHASE_TEXT[turn.phase]}</span>
      {turn.phaseDetail ? <span className="min-w-0 truncate font-mono text-meta text-muted">{turn.phaseDetail}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-2.5 text-meta text-faint">
        {turn.model ? (
          <span className="hidden items-center gap-1 sm:flex">
            <Cpu size={11} aria-hidden /> <span className="font-mono">{turn.model}</span>
          </span>
        ) : null}
        {turn.tokens ? (
          <span className="tabular">
            {formatTokens(turn.tokens.input)} in · {formatTokens(turn.tokens.output)} out
          </span>
        ) : null}
        <span className="tabular flex items-center gap-1">
          <Clock size={11} aria-hidden />
          {formatElapsed(elapsed)}
        </span>
      </span>
    </div>
  );
}
