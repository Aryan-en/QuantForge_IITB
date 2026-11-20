import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "border-border bg-raised text-muted",
  accent: "border-accent/40 bg-accent-soft text-fg",
  success: "border-success/40 bg-success-soft text-fg",
  warning: "border-warning/40 bg-warning-soft text-fg",
  danger: "border-danger/40 bg-danger-soft text-fg",
  info: "border-info/40 bg-info-soft text-fg",
};

const iconTone: Record<Tone, string> = {
  neutral: "text-faint",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export function Chip({
  tone = "neutral",
  icon: Icon,
  mono,
  children,
  onRemove,
  removeLabel,
  className,
  title,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  mono?: boolean;
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 rounded-sm border px-1.5 text-meta leading-none",
        toneClass[tone],
        mono && "font-mono",
        className,
      )}
    >
      {Icon ? <Icon size={11} strokeWidth={2} className={cn("shrink-0", iconTone[tone])} aria-hidden /> : null}
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? "Remove"}
          className="-mr-0.5 rounded-sm text-faint hover:text-fg"
        >
          <X size={11} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

export function Badge({ count, tone = "accent", label }: { count: number; tone?: Tone; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      className={cn(
        "tabular inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
        tone === "accent" ? "bg-accent text-accent-fg" : tone === "danger" ? "bg-danger text-fg" : "bg-overlay text-fg",
      )}
    >
      {count}
    </span>
  );
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  const bg: Record<Tone, string> = {
    neutral: "bg-faint",
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
  };
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", bg[tone], pulse && "forge-pulse")} />;
}
