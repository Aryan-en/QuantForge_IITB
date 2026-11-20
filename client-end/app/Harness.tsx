"use client";

import { Bot, Files, GitBranch, PanelRight, Play, RotateCcw, Search, Settings2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ForgeApp } from "@/components/forge/ForgeApp";
import { ForgeMark } from "@/components/forge/Header";
import { cn } from "@/lib/cn";
import { ForgeProvider } from "@/lib/host/ForgeProvider";
import { createMockHost, type ScenarioId } from "@/lib/host/mockHost";
import { HELPERS_SOURCE, MENTION_SOURCE, TASK_A_INSTRUCTION, TASK_B_INSTRUCTION } from "@/lib/scenarios/fixtures";

const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Picks A or B from the task text" },
  { id: "A", label: "A · Inline edit", hint: "helpers.py → 2 hunks" },
  { id: "B", label: "B · Agent mode", hint: "flask config → 3 files" },
  { id: "C-error", label: "C · Error", hint: "Unreachable, no fallback" },
  { id: "C-fallback", label: "C · Fallback", hint: "Auth fail → fallback model" },
];

/**
 * Next.js harness: a VS Code–like frame around the real <ForgeApp/>, driven by a scripted mock host.
 * Clearly labelled — it is a rehearsal surface, not the product (frontend-plan.md §1).
 */
export function Harness() {
  const host = useMemo(() => createMockHost(), []);
  const [scenario, setScenario] = useState<ScenarioId>("auto");
  const [speed, setSpeed] = useState(1);
  const [layout, setLayout] = useState<"sidebar" | "panel">("sidebar");
  const [epoch, setEpoch] = useState(0);
  const [prefill, setPrefill] = useState<string | null>(null);

  const pick = (id: ScenarioId) => {
    setScenario(id);
    host.setScenario(id);
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* harness control bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-secondary font-semibold text-fg">
          <ForgeMark className="size-3.5 text-accent" /> FORGE UI harness
        </span>
        <span className="rounded-sm border border-warning/50 bg-warning-soft px-1.5 py-0.5 text-meta text-fg">Mock host — scripted events, not the real product</span>
        <div role="radiogroup" aria-label="Scenario" className="ml-2 flex flex-wrap gap-1">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={scenario === s.id}
              title={s.hint}
              onClick={() => pick(s.id)}
              className={cn("h-6 rounded px-2 text-meta font-medium", scenario === s.id ? "bg-accent text-accent-fg" : "bg-raised text-muted hover:text-fg")}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="secondary" icon={Play} onClick={() => setPrefill(TASK_A_INSTRUCTION)}>
            Task A text
          </Button>
          <Button size="sm" variant="secondary" icon={Play} onClick={() => setPrefill(TASK_B_INSTRUCTION)}>
            Task B text
          </Button>
          <label className="flex items-center gap-1 text-meta text-muted">
            Speed
            <select
              value={speed}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeed(v);
                host.setSpeed(v);
              }}
              className="h-6 rounded border border-border bg-raised px-1 text-meta text-fg"
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </label>
          <Button size="sm" variant="ghost" icon={PanelRight} onClick={() => setLayout((l) => (l === "sidebar" ? "panel" : "sidebar"))}>
            {layout === "sidebar" ? "Wide panel" : "Sidebar"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            onClick={() => {
              host.reset();
              setEpoch((e) => e + 1);
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* VS Code–like frame */}
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Activity bar (mock)" className="flex w-11 shrink-0 flex-col items-center gap-3 border-r border-border bg-bg py-3 text-faint">
          <Files size={18} aria-hidden />
          <Search size={18} aria-hidden />
          <GitBranch size={18} aria-hidden />
          <span className="rounded border-l-2 border-accent pl-2 text-accent">
            <Bot size={18} aria-hidden />
          </span>
          <Settings2 size={18} className="mt-auto" aria-hidden />
        </nav>

        {layout === "sidebar" ? (
          <>
            <aside className="w-[380px] shrink-0 border-r border-border">
              <ForgeProvider key={epoch} host={host}>
                <ForgeApp mentionSource={MENTION_SOURCE} />
                <Prefill text={prefill} onDone={() => setPrefill(null)} />
              </ForgeProvider>
            </aside>
            <EditorMock />
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <ForgeProvider key={epoch} host={host}>
              <ForgeApp mentionSource={MENTION_SOURCE} />
              <Prefill text={prefill} onDone={() => setPrefill(null)} />
            </ForgeProvider>
          </div>
        )}
      </div>

      <footer className="flex h-6 items-center gap-3 border-t border-border bg-surface px-3 text-meta text-muted">
        <span className="flex items-center gap-1">
          <Sparkles size={11} className="text-accent" aria-hidden /> FORGE · mock
        </span>
        <span className="flex items-center gap-1">
          <GitBranch size={11} aria-hidden /> flask @ 3.1.3
        </span>
        <span className="ml-auto font-mono">Python 3.12 · UTF-8 · LF</span>
      </footer>
    </div>
  );
}

/** Fills the composer textarea with the exact fixed-task wording (rehearsal convenience). */
function Prefill({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const ta = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task for FORGE"]');
    if (ta) {
      // Native setter so React's onChange fires for the controlled textarea.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
    }
    onDone();
  }, [text, onDone]);
  return null;
}

function EditorMock() {
  const lines = HELPERS_SOURCE.split("\n");
  return (
    <section aria-label="Editor (mock)" className="hidden min-w-0 flex-1 flex-col bg-surface lg:flex">
      <div className="flex h-8 items-end border-b border-border bg-bg">
        <div className="flex h-8 items-center gap-1.5 border-r border-t-2 border-border border-t-accent bg-surface px-3 text-secondary text-fg">
          <span className="font-mono">helpers.py</span>
          <span className="text-faint">src/flask</span>
        </div>
      </div>
      <pre className="forge-scroll min-h-0 flex-1 overflow-auto p-4 font-mono text-body leading-[1.6] text-muted">
        {lines.map((line, i) => (
          <div key={i} className={cn("flex", i >= 0 && "bg-accent-soft")}>
            <span className="tabular mr-4 w-8 select-none text-right text-faint">{27 + i}</span>
            <span className="text-fg">{line}</span>
          </div>
        ))}
        <p className="mt-6 max-w-lg font-sans text-secondary text-faint">
          Mock editor. In real VS Code this is the actual file: selecting the function and pressing Ctrl+Alt+K opens the instruction box, and accepted hunks are
          shown with CodeLens + decorations.
        </p>
      </pre>
    </section>
  );
}
