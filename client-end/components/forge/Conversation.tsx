"use client";

import {
  ArrowDown,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  FileText,
  GitPullRequest,
  Info,
  Network,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CodeBlock, useStickToBottom } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { ApprovalRequest, ConversationItem, Mention, Subagent, ToolCall } from "@/lib/protocol";
import { Markdown } from "./Markdown";
import { TOOL_ICON } from "./icons";

export type ConversationProps = {
  items: ConversationItem[];
  toolCalls: Record<string, ToolCall>;
  subagents: Record<string, Subagent>;
  approvals: Record<string, ApprovalRequest>;
  running: boolean;
  onDecide: (callId: string, decision: "allow" | "deny") => void;
  onOpenFile: (path: string, line?: number) => void;
  onOpenReview: () => void;
  emptyState: React.ReactNode;
};

/** MessageList (Ui-regitry E.2): role="log", sticks to bottom, "Jump to latest" when scrolled up. */
export function MessageList(props: ConversationProps) {
  const { items, toolCalls, subagents, approvals } = props;
  const lastText = items.length ? JSON.stringify(items[items.length - 1]).length : 0;
  const { ref, atBottom, jump } = useStickToBottom<HTMLDivElement>(`${items.length}:${lastText}:${Object.keys(toolCalls).length}`);

  // Group consecutive top-level tool calls so long runs stay compact.
  const topLevel = items.filter((it) => !(it.kind === "tool" && toolCalls[it.callId]?.threadId));

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} role="log" aria-live="off" aria-label="Agent conversation" className="forge-scroll absolute inset-0 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          props.emptyState
        ) : (
          <ol className="flex flex-col gap-2.5">
            {topLevel.map((it) => (
              <li key={it.id} className="forge-enter">
                <Item item={it} {...props} toolCalls={toolCalls} subagents={subagents} approvals={approvals} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {!atBottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <Button size="sm" variant="secondary" icon={ArrowDown} onClick={jump} className="pointer-events-auto shadow-md">
            Jump to latest
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Item({ item, ...p }: { item: ConversationItem } & ConversationProps) {
  switch (item.kind) {
    case "user":
      return <UserMessage text={item.text} mentions={item.mentions} />;
    case "assistant":
      return <AssistantMessage text={item.text} streaming={item.streaming} interrupted={item.interrupted} />;
    case "tool": {
      const call = p.toolCalls[item.callId];
      return call ? <ToolActivityCard call={call} onOpenFile={p.onOpenFile} /> : null;
    }
    case "subagent": {
      const sa = p.subagents[item.threadId];
      const calls = Object.values(p.toolCalls).filter((c) => c.threadId === item.threadId);
      return sa ? <SubagentCard subagent={sa} calls={calls} onOpenFile={p.onOpenFile} /> : null;
    }
    case "approval": {
      const a = p.approvals[item.callId];
      return a ? <ApprovalCard approval={a} onDecide={p.onDecide} onOpenReview={p.onOpenReview} /> : null;
    }
    case "notice":
      return <Notice tone={item.tone} text={item.text} />;
  }
}

export function UserMessage({ text, mentions }: { text: string; mentions: Mention[] }) {
  return (
    <div className="ml-6 rounded-md border border-border bg-raised px-3 py-2">
      <p className="whitespace-pre-wrap text-body text-fg">{text}</p>
      {mentions.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {mentions.map((m, i) => (
            <Chip key={i} icon={m.kind === "file" ? FileText : Braces} mono>
              {m.kind === "file" ? m.path : m.name}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AssistantMessage({ text, streaming, interrupted }: { text: string; streaming: boolean; interrupted?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <div className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded", streaming ? "bg-accent text-accent-fg" : "bg-raised text-muted")}>
        <Bot size={12} strokeWidth={2} aria-hidden />
      </div>
      <div className={cn("min-w-0 flex-1", streaming && "forge-caret-host")}>
        {text ? <Markdown text={text} /> : streaming ? <span className="text-muted">Thinking…</span> : null}
        {streaming ? <span className="forge-caret" aria-hidden /> : null}
        {interrupted ? <p className="mt-1 text-meta text-faint">Stopped — response incomplete.</p> : null}
      </div>
    </div>
  );
}

const statusIcon = (call: ToolCall) => {
  switch (call.status) {
    case "running":
    case "requested":
      return <Spinner size={12} label="Running" />;
    case "awaiting_approval":
      return <ShieldCheck size={12} className="text-warning" aria-label="Awaiting approval" />;
    case "succeeded":
      return <Check size={12} className="text-success" aria-label="Succeeded" />;
    case "failed":
      return <CircleAlert size={12} className="text-danger" aria-label="Failed" />;
    case "denied":
      return <CircleSlash size={12} className="text-warning" aria-label="Denied" />;
    case "aborted":
      return <X size={12} className="text-faint" aria-label="Aborted" />;
  }
};

export function ToolActivityCard({ call, onOpenFile, nested }: { call: ToolCall; onOpenFile?: (path: string) => void; nested?: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[call.tool];
  const path = typeof call.args?.path === "string" ? (call.args.path as string) : null;
  const hasDetails = Boolean(call.args || call.resultSummary || call.error);
  return (
    <div className={cn("rounded border bg-surface", call.status === "failed" ? "border-danger/50" : "border-border-subtle", nested && "bg-bg")}>
      <button
        type="button"
        aria-expanded={open}
        disabled={!hasDetails}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent"
      >
        <ChevronRight size={12} aria-hidden className={cn("shrink-0 text-faint transition-transform duration-[var(--forge-dur-med)]", open && "rotate-90", !hasDetails && "opacity-0")} />
        <Icon size={13} strokeWidth={1.75} aria-hidden className={cn("shrink-0", call.status === "running" ? "text-accent" : "text-muted")} />
        <span className="shrink-0 font-mono text-secondary text-fg">{call.tool}</span>
        <span className="min-w-0 truncate font-mono text-secondary text-muted" title={call.summary}>
          {call.summary}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
          {call.resultSummary && !open ? <span className="hidden truncate text-meta text-faint sm:inline">{call.resultSummary}</span> : null}
          {call.durationMs !== undefined ? <span className="tabular text-meta text-faint">{formatDuration(call.durationMs)}</span> : null}
          {statusIcon(call)}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-border-subtle px-2 py-2">
          {call.args ? <CodeBlock code={JSON.stringify(call.args, null, 2)} label={`${call.tool} arguments`} /> : null}
          {call.resultSummary ? <p className="text-secondary text-muted">→ {call.resultSummary}</p> : null}
          {call.error ? <p className="text-secondary text-fg">⚠ {call.error}</p> : null}
          {path && onOpenFile ? (
            <div>
              <Button size="sm" variant="ghost" icon={FileText} onClick={() => onOpenFile(path)}>
                Open {path}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SubagentCard({ subagent, calls, onOpenFile }: { subagent: Subagent; calls: ToolCall[]; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(true);
  const running = subagent.status === "running";
  return (
    <div className={cn("rounded-md border bg-surface", running ? "border-info/50" : "border-border")}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <ChevronRight size={12} aria-hidden className={cn("text-faint transition-transform duration-[var(--forge-dur-med)]", open && "rotate-90")} />
        <Network size={13} aria-hidden className="text-info" />
        <span className="text-meta font-semibold uppercase tracking-[0.06em] text-info">Subagent</span>
        <span className="min-w-0 truncate text-secondary text-fg">{subagent.title}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="tabular whitespace-nowrap text-meta text-faint">{calls.length} calls</span>
          {running ? <Spinner size={12} label="Subagent running" /> : subagent.status === "cancelled" ? <X size={12} className="text-faint" aria-label="Subagent cancelled" /> : <CircleCheck size={12} className="text-success" aria-label="Subagent done" />}
        </span>
      </button>
      {open ? (
        <div className="ml-4 flex flex-col gap-1 border-l border-info/30 py-1 pl-3 pr-2">
          {calls.map((c) => (
            <ToolActivityCard key={c.callId} call={c} onOpenFile={onOpenFile} nested />
          ))}
          {subagent.result ? (
            <p className="py-1 text-secondary text-muted">
              <span className="text-faint">Returned → </span>
              {subagent.result}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ApprovalCard({
  approval,
  onDecide,
  onOpenReview,
}: {
  approval: ApprovalRequest;
  onDecide: (callId: string, decision: "allow" | "deny") => void;
  onOpenReview: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pending = approval.status === "pending";
  // Focus moves here when it appears (Ui-regitry E.2 ApprovalCard).
  useEffect(() => {
    if (pending) ref.current?.focus();
  }, [pending]);

  const isGate = approval.tool === "submit_changes";
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={pending ? "alertdialog" : "group"}
      aria-label={isGate ? "Review gate: approval required" : "Terminal command needs approval"}
      className={cn(
        "rounded-md border px-3 py-2.5 outline-none",
        pending ? "border-warning/60 bg-warning-soft" : "border-border bg-surface",
      )}
    >
      <div className="flex items-center gap-2">
        {isGate ? <GitPullRequest size={14} className="text-warning" aria-hidden /> : <Terminal size={14} className="text-warning" aria-hidden />}
        <span className="text-secondary font-semibold text-fg">{isGate ? "Review gate — submit_changes" : "Run command?"}</span>
        <Chip tone={approval.risk === "high" ? "danger" : approval.risk === "medium" ? "warning" : "neutral"} className="ml-auto">
          {approval.risk} risk
        </Chip>
        {approval.ranIn ? <Chip tone="info">{approval.ranIn === "shadow" ? "shadow workspace" : "real workspace"}</Chip> : null}
      </div>
      <p className="mt-1 text-secondary text-muted">{approval.reason}</p>
      {approval.command ? <CodeBlock className="mt-2" code={approval.command} label="Command to run" /> : null}
      {approval.summary ? <p className="mt-1.5 text-secondary text-fg">{approval.summary}</p> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {pending ? (
          isGate ? (
            <>
              <Button variant="primary" size="sm" icon={GitPullRequest} onClick={onOpenReview}>
                Review changes
              </Button>
              <span className="text-meta text-muted">Paused until you decide.</span>
            </>
          ) : (
            <>
              <Button variant="primary" size="sm" icon={Check} onClick={() => onDecide(approval.callId, "allow")}>
                Allow
              </Button>
              <Button variant="secondary" size="sm" icon={X} onClick={() => onDecide(approval.callId, "deny")}>
                Deny
              </Button>
            </>
          )
        ) : (
          <span className={cn("inline-flex items-center gap-1 text-secondary", approval.status === "allowed" ? "text-success" : "text-warning")}>
            {approval.status === "allowed" ? <Check size={12} aria-hidden /> : <CircleSlash size={12} aria-hidden />}
            {approval.status === "allowed" ? (isGate ? "Approved — accepted hunks applied" : "Allowed") : isGate ? "Rejected — nothing written" : "Denied"}
          </span>
        )}
      </div>
    </div>
  );
}

export function Notice({ tone, text }: { tone: "info" | "success" | "warning" | "danger"; text: string }) {
  const Icon = tone === "success" ? CircleCheck : tone === "warning" ? TriangleAlert : tone === "danger" ? CircleAlert : Info;
  const color = { info: "text-info", success: "text-success", warning: "text-warning", danger: "text-danger" }[tone];
  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-secondary text-muted">
      <Icon size={13} className={color} aria-hidden />
      <span>{text}</span>
    </div>
  );
}
