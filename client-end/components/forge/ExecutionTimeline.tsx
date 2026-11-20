"use client";

import {
  Activity,
  ArrowDownToLine,
  CircleAlert,
  CircleCheck,
  Cpu,
  ExternalLink,
  FlaskConical,
  GitPullRequest,
  MessageSquare,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
  Shrink,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { TimelineEvent, TimelineKind } from "@/lib/protocol";

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  "session.start": Play,
  "user.message": MessageSquare,
  "model.call": Cpu,
  "tool.call": Wrench,
  "approval.requested": ShieldCheck,
  "approval.decided": GitPullRequest,
  "subagent.start": Network,
  "subagent.done": Network,
  "tool.deferred_load": ArrowDownToLine,
  "context.compaction": Shrink,
  "test.run": FlaskConical,
  "model.retry": RefreshCw,
  "model.fallback": RefreshCw,
  "turn.done": CircleCheck,
};

type Filter = "all" | "tools" | "model" | "errors";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tools", label: "Tools" },
  { id: "model", label: "Model" },
  { id: "errors", label: "Errors" },
];

function matches(e: TimelineEvent, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "errors") return e.status === "error" || e.status === "warning";
  if (f === "model") return e.kind === "model.call" || e.kind === "model.retry" || e.kind === "model.fallback" || e.kind === "context.compaction";
  return e.kind === "tool.call" || e.kind === "tool.deferred_load" || e.kind === "test.run" || e.kind.startsWith("approval") || e.kind.startsWith("subagent");
}

const DOT: Record<TimelineEvent["status"], string> = {
  info: "text-muted",
  running: "text-accent",
  success: "text-success",
  warning: "text-warning",
  error: "text-danger",
};

export function TimelineRow({ event, startAt }: { event: TimelineEvent; startAt: number }) {
  const [open, setOpen] = useState(false);
  const Icon = event.status === "error" ? CircleAlert : KIND_ICON[event.kind];
  const offset = Math.max(0, event.at - startAt);
  return (
    <li className="relative pl-6">
      <span aria-hidden className="absolute left-[9px] top-0 h-full w-px bg-border-subtle" />
      <span className={cn("absolute left-[2px] top-1.5 grid size-4 place-items-center rounded-full bg-bg", DOT[event.status])}>
        <Icon size={12} strokeWidth={2} aria-hidden />
      </span>
      <button
        type="button"
        aria-expanded={event.data ? open : undefined}
        onClick={() => event.data && setOpen((v) => !v)}
        className={cn("flex w-full min-w-0 flex-col rounded px-1.5 py-1 text-left", event.data && "hover:bg-raised")}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className="tabular w-11 shrink-0 font-mono text-meta text-faint">+{(offset / 1000).toFixed(1)}s</span>
          <span className="min-w-0 truncate text-secondary text-fg">{event.title}</span>
          {event.code ? <span className="shrink-0 rounded-sm bg-danger-soft px-1 font-mono text-meta text-fg">{event.code}</span> : null}
          {event.durationMs !== undefined ? <span className="tabular ml-auto shrink-0 text-meta text-faint">{formatDuration(event.durationMs)}</span> : null}
        </span>
        {event.detail ? <span className="ml-[3.25rem] min-w-0 truncate font-mono text-meta text-muted">{event.detail}</span> : null}
      </button>
      {open && event.data ? (
        <pre className="forge-scroll mb-1 ml-[3.25rem] mr-1 overflow-x-auto rounded border border-border bg-bg p-2 font-mono text-meta text-muted">{JSON.stringify(event.data, null, 2)}</pre>
      ) : null}
    </li>
  );
}

export function ExecutionTimeline({ events, onOpenInTrueForge, sessionId }: { events: TimelineEvent[]; onOpenInTrueForge: () => void; sessionId: string | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  const visible = useMemo(() => events.filter((e) => matches(e, filter)), [events, filter]);
  const startAt = events[0]?.at ?? 0;
  const CAP = 300; // keeps very long runs responsive; earlier rows are one click away
  const shown = showAll ? visible : visible.slice(-CAP);
  const toolCount = events.filter((e) => e.kind === "tool.call").length;

  if (events.length === 0) return <EmptyState icon={Activity} title="No activity yet" body="Model calls, tool calls and approvals appear here." />;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-bg/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-mono text-meta text-muted" title={sessionId ?? undefined}>
            session {sessionId ?? "—"}
          </span>
          <span className="tabular shrink-0 text-meta text-faint">· {toolCount} tool calls</span>
          <Button size="sm" variant="ghost" icon={ExternalLink} className="ml-auto shrink-0" onClick={onOpenInTrueForge}>
            Open in TrueForge
          </Button>
        </div>
        <div role="radiogroup" aria-label="Filter events" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-6 rounded px-2 text-meta font-medium transition-colors",
                filter === f.id ? "bg-raised text-fg" : "text-muted hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ol className="flex flex-col px-2 py-2" role="list" aria-label="Execution timeline">
        {shown.length < visible.length ? (
          <li className="pb-1 pl-6">
            <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
              Show {visible.length - shown.length} earlier events
            </Button>
          </li>
        ) : null}
        {shown.map((e) => (
          <TimelineRow key={e.id} event={e} startAt={startAt} />
        ))}
      </ol>
    </div>
  );
}
