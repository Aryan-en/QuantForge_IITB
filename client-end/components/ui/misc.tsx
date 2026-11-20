"use client";

import { Check, Copy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "./Chip";

export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="forge-pulse h-3 rounded-sm bg-raised" style={{ width: `${90 - i * 17}%` }} />
      ))}
    </div>
  );
}

const barTone: Record<Tone, string> = {
  neutral: "bg-muted",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function ProgressBar({ value, max, tone = "accent", label, className }: { value: number; max: number; tone?: Tone; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-raised", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-[var(--forge-dur-slow)]", barTone[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CodeBlock({ code, className, copy = true, label }: { code: string; className?: string; copy?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("group relative rounded border border-border bg-bg", className)}>
      <pre className="forge-scroll overflow-x-auto px-3 py-2 font-mono text-secondary leading-[1.5] text-fg" tabIndex={0} aria-label={label}>
        <code>{code}</code>
      </pre>
      {copy ? (
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy to clipboard"}
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="absolute right-1.5 top-1.5 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-raised hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 grid size-10 place-items-center rounded-lg border border-border bg-surface text-faint">
        <Icon size={20} strokeWidth={1.5} aria-hidden />
      </div>
      <h3 className="text-emph font-semibold text-fg">{title}</h3>
      {body ? <p className="max-w-64 text-secondary text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, meta, actions, className }: { title: string; meta?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 px-3 pb-1.5 pt-3", className)}>
      <h3 className="text-meta font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
      {meta ? <span className="tabular text-meta text-faint">{meta}</span> : null}
      <div className="ml-auto flex items-center gap-1">{actions}</div>
    </div>
  );
}

/** Scroll container that sticks to bottom unless the user scrolls up (Ui-regitry D.2). */
export function useStickToBottom<T extends HTMLElement>(dep: unknown): {
  ref: React.RefObject<T | null>;
  atBottom: boolean;
  jump: () => void;
} {
  const ref = useRef<T | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      atBottomRef.current = near;
      setAtBottom(near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [dep]);

  return {
    ref,
    atBottom,
    jump: () => {
      const el = ref.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    },
  };
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-border bg-raised px-1 font-mono text-[10px] leading-none text-muted">
      {children}
    </kbd>
  );
}
