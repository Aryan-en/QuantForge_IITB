"use client";

import type { LucideIcon } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TabItem<T extends string> = { id: T; label: string; icon?: LucideIcon; badge?: ReactNode };

/** WAI-ARIA tabs: arrows move, Home/End, roving tabindex (Ui-regitry E.1). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  compact,
  idPrefix = "forge-tab",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  compact?: boolean;
  idPrefix?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(items[next].id);
      refs.current[next]?.focus();
    }
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex items-stretch gap-0.5 overflow-x-auto px-2">
      {items.map((t, idx) => {
        const selected = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            role="tab"
            id={`${idPrefix}-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            title={compact ? t.label : undefined}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative flex h-8 shrink-0 items-center gap-1.5 px-2 text-secondary font-medium transition-colors duration-[var(--forge-dur-med)]",
              selected ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {Icon ? <Icon size={14} strokeWidth={1.75} aria-hidden /> : null}
            <span className={cn(compact && "sr-only")}>{t.label}</span>
            {t.badge}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-1.5 -bottom-px h-0.5 rounded-full transition-colors duration-[var(--forge-dur-med)]",
                selected ? "bg-accent" : "bg-transparent",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, active, idPrefix = "forge-tab", children, className }: { id: string; active: boolean; idPrefix?: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-${id}`}
      hidden={!active}
      className={className}
    >
      {active ? children : null}
    </div>
  );
}
