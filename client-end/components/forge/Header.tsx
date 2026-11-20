"use client";

import { ChevronDown, Cpu, History, Plus, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { StatusDot, type Tone } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { ModelState, ModelStatus, SessionSummary } from "@/lib/protocol";

const MODEL_TONE: Record<ModelStatus, Tone> = {
  unknown: "neutral",
  checking: "neutral",
  connected: "success",
  degraded: "warning",
  unreachable: "danger",
  auth_failed: "danger",
  fallback_active: "info",
};

const MODEL_TEXT: Record<ModelStatus, string> = {
  unknown: "Unknown",
  checking: "Checking",
  connected: "Connected",
  degraded: "Degraded",
  unreachable: "Unreachable",
  auth_failed: "Auth failed",
  fallback_active: "Fallback active",
};

export function ForgeMark({ className }: { className?: string }) {
  // Wordmark glyph: an anvil-like "F" built from two bars — vector, token-colored.
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <rect x="2" y="2" width="12" height="3" rx="1" fill="currentColor" />
      <rect x="2" y="6.5" width="8" height="3" rx="1" fill="currentColor" opacity="0.75" />
      <rect x="2" y="11" width="3" height="3" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

export function ModelStatusChip({ model, onOpen }: { model: ModelState; onOpen: () => void }) {
  const name = model.active ?? model.primary;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Model ${name ?? "none"}, ${MODEL_TEXT[model.status]}. Open model configuration`}
      title={`${MODEL_TEXT[model.status]} — click for model configuration`}
      className="flex h-6 min-w-0 items-center gap-1.5 rounded border border-border bg-surface px-2 text-meta text-muted hover:bg-raised hover:text-fg"
    >
      <StatusDot tone={MODEL_TONE[model.status]} pulse={model.status === "checking"} />
      <Cpu size={11} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate font-mono">{name ?? "No model"}</span>
    </button>
  );
}

export function SessionSwitcher({
  sessions,
  activeId,
  onSelect,
  onNew,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(open, 30000);
  const active = sessions.find((s) => s.id === activeId);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 min-w-0 max-w-full items-center gap-1 rounded px-1.5 text-secondary text-fg hover:bg-raised"
      >
        <History size={12} className="shrink-0 text-faint" aria-hidden />
        <span className="min-w-0 truncate">{active?.title ?? "New session"}</span>
        <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="forge-enter absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-border bg-overlay p-1 shadow-md">
          {sessions.length === 0 ? <p className="px-2 py-1.5 text-secondary text-muted">No sessions yet</p> : null}
          {sessions.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              type="button"
              onClick={() => {
                onSelect(s.id);
                setOpen(false);
              }}
              className={cn("flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-raised", s.id === activeId && "bg-raised")}
            >
              <span className="truncate text-secondary text-fg">{s.title}</span>
              <span className="tabular text-meta text-faint">
                {s.agent} · {s.turns} turns · {now ? formatRelative(s.createdAt, now) : ""}
              </span>
            </button>
          ))}
          <div className="my-1 h-px bg-border-subtle" />
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-secondary text-fg hover:bg-raised"
          >
            <Plus size={13} aria-hidden /> New session
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Header({
  sessions,
  activeSessionId,
  model,
  running,
  onSelectSession,
  onNewSession,
  onOpenModel,
  onOpenSettings,
}: {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  model: ModelState;
  running: boolean;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenModel: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <header role="banner" className="flex flex-col border-b border-border bg-bg">
      <div className="flex h-9 items-center gap-1.5 px-2">
        <ForgeMark className={cn("size-3.5 shrink-0", running ? "text-accent" : "text-fg")} />
        <span className="shrink-0 text-meta font-bold tracking-[0.14em] text-fg">FORGE</span>
        <span className="mx-0.5 h-3 w-px shrink-0 bg-border" aria-hidden />
        <SessionSwitcher sessions={sessions} activeId={activeSessionId} onSelect={onSelectSession} onNew={onNewSession} />
        <div className="ml-auto flex min-w-0 shrink items-center gap-0.5">
          <ModelStatusChip model={model} onOpen={onOpenModel} />
          <IconButton icon={Plus} label="New session" size="sm" onClick={onNewSession} />
          <IconButton icon={Settings} label="Settings" size="sm" onClick={onOpenSettings} />
        </div>
      </div>
      {running ? <div className="forge-rail" aria-hidden /> : <div className="h-0.5" aria-hidden />}
    </header>
  );
}

export { MODEL_TEXT, MODEL_TONE };
