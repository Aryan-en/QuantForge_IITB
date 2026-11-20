"use client";

import { AtSign, Ban, Braces, ChevronRight, Eye, FileText, Layers, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip, type Tone } from "@/components/ui/Chip";
import { EmptyState, SectionHeader } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { basename, dirname, formatTokens, pluralize } from "@/lib/format";
import type { ContextItem, ContextState, ContextTier } from "@/lib/protocol";

const TIER_LABEL: Record<ContextTier, string> = { full: "Full", symbols: "Symbols", skeleton: "Skeleton", path: "Path" };
const TIER_TONE: Record<ContextTier, Tone> = { full: "accent", symbols: "info", skeleton: "neutral", path: "neutral" };
/** Fills for the stacked budget bar — token-backed classes only. */
const TIER_FILL: Record<ContextTier, string> = { full: "bg-accent", symbols: "bg-info", skeleton: "bg-muted", path: "bg-faint" };
const TIER_HELP: Record<ContextTier, string> = {
  full: "Full text of the file or range",
  symbols: "Signatures + docstrings of relevant symbols",
  skeleton: "Outline: classes, functions, imports",
  path: "Path only — the agent can read it on demand",
};

export function BudgetMeter({ used, budget, byTier }: { used: number; budget: number; byTier: Record<ContextTier, number> }) {
  const pct = budget > 0 ? used / budget : 0;
  const tone = pct > 0.95 ? "text-danger" : pct > 0.8 ? "text-warning" : "text-fg";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className={cn("tabular text-section font-semibold", tone)}>{formatTokens(used)}</span>
        <span className="tabular text-secondary text-muted">/ {formatTokens(budget)} tokens</span>
        <span className="tabular ml-auto text-secondary text-muted">{Math.round(pct * 100)}%</span>
      </div>
      <div
        role="meter"
        aria-label="Context token budget"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={used}
        aria-valuetext={`${used} of ${budget} tokens used`}
        className="flex h-2 w-full overflow-hidden rounded-full bg-raised"
      >
        {(Object.keys(byTier) as ContextTier[]).map((t) =>
          byTier[t] > 0 ? (
            <div
              key={t}
              title={`${TIER_LABEL[t]}: ${byTier[t]} tokens`}
              className={cn("h-full transition-[width] duration-[var(--forge-dur-slow)] first:rounded-l-full", TIER_FILL[t])}
              style={{ width: `${(byTier[t] / budget) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {(Object.keys(byTier) as ContextTier[]).map((t) => (
          <span key={t} className="tabular flex items-center gap-1 text-meta text-muted" title={TIER_HELP[t]}>
            <span aria-hidden className={cn("size-2 rounded-sm", TIER_FILL[t])} />
            {TIER_LABEL[t]} {formatTokens(byTier[t])}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ContextItemRow({ item, onOpen }: { item: ContextItem; onOpen: (path: string, line?: number) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.path, item.range?.startLine)}
        className="group flex w-full flex-col gap-1 rounded px-2 py-1.5 text-left hover:bg-raised"
      >
        <div className="flex w-full min-w-0 items-center gap-1.5">
          <Chip tone={TIER_TONE[item.tier]} title={TIER_HELP[item.tier]} className="w-[4.75rem] shrink-0 justify-center">
            {TIER_LABEL[item.tier]}
          </Chip>
          <span className="min-w-0 truncate font-mono text-secondary" title={item.path}>
            <span className="text-fg group-hover:underline">{basename(item.path)}</span>
            {item.range ? <span className="text-muted">:{item.range.startLine}-{item.range.endLine}</span> : null}
            <span className="text-faint"> {dirname(item.path)}</span>
          </span>
          <span className="tabular ml-auto shrink-0 font-mono text-meta text-muted">{formatTokens(item.tokens)}</span>
          <span className="flex w-12 shrink-0 items-center" title={`Relevance score ${item.score.toFixed(2)}`}>
            <span className="h-1 w-full overflow-hidden rounded-full bg-raised">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(item.score * 100)}%` }} />
            </span>
          </span>
        </div>
        <ul className="flex flex-wrap gap-1 pl-[5.125rem]" aria-label="Why this was selected">
          {item.source === "mention" ? (
            <li>
              <Chip tone="accent" icon={AtSign}>
                mentioned by you
              </Chip>
            </li>
          ) : null}
          {item.source === "read_by_agent" ? (
            <li>
              <Chip tone="info" icon={Eye}>
                read by agent
              </Chip>
            </li>
          ) : null}
          {item.reasons.map((r) => (
            <li key={r}>
              <Chip>{r}</Chip>
            </li>
          ))}
        </ul>
      </button>
    </li>
  );
}

export function ContextInspector({
  context,
  onOpen,
  onIncludeAnyway,
}: {
  context: ContextState;
  onOpen: (path: string, line?: number) => void;
  onIncludeAnyway: (path: string) => void;
}) {
  const [showExcluded, setShowExcluded] = useState(true);
  const byTier = useMemo(() => {
    const acc: Record<ContextTier, number> = { full: 0, symbols: 0, skeleton: 0, path: 0 };
    for (const i of context.items) acc[i.tier] += i.tokens;
    return acc;
  }, [context.items]);

  if (context.items.length === 0 && context.searches.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No context yet"
        body="Context appears here once the agent starts looking at your code. Type @ to add files or symbols yourself."
      />
    );
  }

  const sorted = [...context.items].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col pb-4">
      <div className="mx-3 mt-3 rounded-md border border-border bg-surface p-3">
        <BudgetMeter used={context.usedTokens} budget={context.budgetTokens} byTier={byTier} />
        {context.strategy ? <p className="mt-2 border-t border-border-subtle pt-2 text-meta leading-[1.5] text-muted">{context.strategy}</p> : null}
      </div>

      <SectionHeader title="Selected" meta={`${pluralize(sorted.length, "item")}`} />
      <ul className="flex flex-col px-1" aria-label="Selected context">
        {sorted.map((i) => (
          <ContextItemRow key={`${i.path}:${i.range?.startLine ?? 0}`} item={i} onOpen={onOpen} />
        ))}
      </ul>

      {context.searches.length ? (
        <>
          <SectionHeader title="Searches" meta={context.searches.length} />
          <ul className="flex flex-col gap-0.5 px-3">
            {context.searches.map((s, i) => (
              <li key={i} className="flex min-w-0 items-center gap-2 py-0.5 text-secondary">
                {s.tool === "find_symbol" ? <Braces size={12} className="shrink-0 text-info" aria-hidden /> : <Search size={12} className="shrink-0 text-muted" aria-hidden />}
                <span className="min-w-0 truncate font-mono text-fg">{s.query}</span>
                <span className="tabular ml-auto shrink-0 text-meta text-muted">{pluralize(s.matches, "match", "matches")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {context.excluded.length ? (
        <>
          <SectionHeader
            title="Left out"
            meta={context.excluded.length}
            actions={
              <button type="button" aria-expanded={showExcluded} onClick={() => setShowExcluded((v) => !v)} className="rounded p-0.5 text-faint hover:text-fg" aria-label="Toggle excluded files">
                <ChevronRight size={12} className={cn("transition-transform", showExcluded && "rotate-90")} aria-hidden />
              </button>
            }
          />
          {showExcluded ? (
            <ul className="flex flex-col px-1">
              {context.excluded.map((e) => (
                <li key={e.path} className="group flex min-w-0 items-center gap-2 rounded px-2 py-1 hover:bg-raised">
                  <Ban size={12} className="shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 truncate font-mono text-secondary text-muted" title={e.path}>
                    {e.path}
                  </span>
                  <Chip tone={e.reason.startsWith("denied") ? "warning" : "neutral"} className="ml-auto shrink-0">
                    {e.reason}
                  </Chip>
                  {e.reason === "over budget" || e.reason === "low score" ? (
                    <Button size="sm" variant="ghost" icon={Plus} className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onIncludeAnyway(e.path)}>
                      Include
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <p className="flex items-center gap-1.5 px-3 pt-3 text-meta text-faint">
        <FileText size={11} aria-hidden /> Click a row to open it in the editor.
      </p>
    </div>
  );
}
