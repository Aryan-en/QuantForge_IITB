"use client";

import { ChevronDown, CircleAlert, CircleCheck, Info, RefreshCw, ShieldCheck, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import type { ModelState, UserFacingError } from "@/lib/protocol";
import type { RetryInfo, ToastInfo } from "@/lib/store/reducer";

/** ErrorBanner (Ui-regitry E.2): danger rail + icon + plain-language message + next action; role="alert". */
export function ErrorBanner({
  error,
  onAction,
  onDismiss,
}: {
  error: UserFacingError;
  onAction: (action: NonNullable<UserFacingError["action"]>) => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const tone = error.tone ?? "danger";
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "forge-enter mx-2 mt-2 rounded-md border border-l-2 px-3 py-2",
        tone === "danger" && "border-danger/40 border-l-danger bg-danger-soft",
        tone === "warning" && "border-warning/40 border-l-warning bg-warning-soft",
        tone === "info" && "border-info/40 border-l-info bg-info-soft",
      )}
    >
      <div className="flex items-start gap-2">
        {tone === "info" ? (
          <Info size={15} className="mt-px shrink-0 text-info" aria-hidden />
        ) : (
          <CircleAlert size={15} className={cn("mt-px shrink-0", tone === "danger" ? "text-danger" : "text-warning")} aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-secondary font-semibold text-fg">
            {error.title}
            {error.code ? <span className="ml-1.5 rounded-sm bg-bg/60 px-1 font-mono text-meta font-normal text-muted">{error.code}</span> : null}
          </p>
          <p className="mt-0.5 text-secondary text-fg">{error.message}</p>
          {error.workspaceUnchanged ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-sm bg-bg/60 px-1.5 py-0.5 text-meta text-fg">
              <ShieldCheck size={12} className="text-success" aria-hidden /> Workspace unchanged — no files were written.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {error.action ? (
              <Button size="sm" variant="secondary" onClick={() => onAction(error.action!)}>
                {error.action.label}
              </Button>
            ) : null}
            {error.details ? (
              <Button size="sm" variant="ghost" iconRight={ChevronDown} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                Details
              </Button>
            ) : null}
          </div>
          {open && error.details ? <pre className="forge-scroll mt-1.5 overflow-x-auto rounded border border-border bg-bg p-2 font-mono text-meta text-muted">{error.details}</pre> : null}
        </div>
        <IconButton icon={X} label="Dismiss error" size="sm" onClick={onDismiss} />
      </div>
    </div>
  );
}

/** Retry-with-backoff banner: attempt n/N and live countdown (rubric B3 anchor 7). */
export function RetryBanner({ retry }: { retry: RetryInfo }) {
  const now = useNow(true, 100);
  const remaining = now ? Math.max(0, retry.scheduledAt + retry.delayMs - now) : retry.delayMs;
  const pct = 1 - remaining / retry.delayMs;
  return (
    <div role="status" className="forge-enter mx-2 mt-2 overflow-hidden rounded-md border border-warning/40 bg-warning-soft">
      <div className="flex items-center gap-2 px-3 py-2">
        <RefreshCw size={14} className="shrink-0 text-warning" aria-hidden />
        <p className="min-w-0 flex-1 text-secondary text-fg">
          <span className="font-semibold">Model call failed</span> <span className="font-mono text-meta text-muted">{retry.code}</span>
          <span className="block text-muted">
            Retry {retry.attempt}/{retry.maxAttempts} on <span className="font-mono">{retry.model}</span> in{" "}
            <span className="tabular">{(remaining / 1000).toFixed(1)}s</span> · exponential backoff with jitter
          </span>
        </p>
      </div>
      <div className="h-0.5 bg-bg/50">
        <div className="h-full bg-warning" style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
    </div>
  );
}

/** Shown while the fallback model is serving requests (rubric B3 anchor 10). */
export function FallbackBanner({ model }: { model: ModelState }) {
  if (model.status !== "fallback_active") return null;
  return (
    <div role="status" className="forge-enter mx-2 mt-2 flex items-start gap-2 rounded-md border border-info/40 bg-info-soft px-3 py-2">
      <Info size={14} className="mt-px shrink-0 text-info" aria-hidden />
      <p className="text-secondary text-fg">
        <span className="font-semibold">Switched to fallback model automatically.</span>{" "}
        <span className="text-muted">
          <span className="font-mono">{model.primary}</span> failed{model.lastFailure ? <> ({model.lastFailure.code})</> : null}; continuing on{" "}
          <span className="font-mono text-fg">{model.active}</span>. No action needed.
        </span>
      </p>
    </div>
  );
}

export function Toast({ toast, onAction, onDismiss }: { toast: ToastInfo; onAction: () => void; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.action) return; // never auto-dismiss when it carries an action (Ui-regitry E.1)
    const id = setTimeout(onDismiss, 4000);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);
  return (
    <div
      role="status"
      className={cn(
        "forge-enter pointer-events-auto flex items-center gap-2 rounded-lg border bg-overlay px-3 py-2 shadow-lg",
        toast.tone === "success" ? "border-success/40" : toast.tone === "warning" ? "border-warning/40" : "border-border",
      )}
    >
      {toast.tone === "success" ? <CircleCheck size={14} className="text-success" aria-hidden /> : <Info size={14} className="text-info" aria-hidden />}
      <span className="text-secondary text-fg">{toast.message}</span>
      {toast.action ? (
        <Button size="sm" variant="secondary" icon={Undo2} onClick={onAction}>
          {toast.action.label}
        </Button>
      ) : null}
      <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} />
    </div>
  );
}
