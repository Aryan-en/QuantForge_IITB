"use client";

import {
  ArrowLeftRight,
  Bell,
  Blocks,
  Bot,
  Bug,
  Check,
  CornerDownLeft,
  Files,
  GitBranch,
  Moon,
  PanelLeft,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Contrast,
  Unplug,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ForgeApp } from "@/components/forge/ForgeApp";
import { DiffLines } from "@/components/forge/DiffReview";
import { ForgeMark } from "@/components/forge/Header";
import { IconButton } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { ForgeProvider, useForge } from "@/lib/host/ForgeProvider";
import { createMockHost, type MockHost, type ScenarioId } from "@/lib/host/mockHost";
import { MENTION_SOURCE, TASK_A_INSTRUCTION, TASK_B_INSTRUCTION } from "@/lib/scenarios/fixtures";
import { reviewStats } from "@/lib/store/reducer";
import "./harness.css";
import { FILE_HEAD, FILE_TAIL, FUNC_ORIGINAL, FUNC_UPDATED, FUNC_UPDATED_MARKS, highlightPython } from "./pythonSource";

type Theme = "dark" | "light" | "hc";
const HELPERS = "src/flask/helpers.py";

const PRESETS: { id: ScenarioId; label: string; icon: typeof Bot; kind: "inline" | "agent" }[] = [
  { id: "A", label: "Inline edit", icon: Wand2, kind: "inline" },
  { id: "B", label: "Agent", icon: Bot, kind: "agent" },
  { id: "C-error", label: "Model offline", icon: Unplug, kind: "inline" },
  { id: "C-fallback", label: "Fallback", icon: ArrowLeftRight, kind: "inline" },
];

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.dataset.theme = t === "light" ? "light" : "dark";
  document.body.classList.remove("vscode-light", "vscode-high-contrast");
  if (t === "light") document.body.classList.add("vscode-light");
  if (t === "hc") document.body.classList.add("vscode-high-contrast");
}

export function Harness() {
  const host = useMemo<MockHost>(() => createMockHost(), []);
  const [epoch, setEpoch] = useState(0);
  const [draft, setDraft] = useState("");
  const [inlineText, setInlineText] = useState<string | null>(null);
  const [layout, setLayout] = useState<"sidebar" | "panel">("sidebar");
  const [theme, setTheme] = useState<Theme>("dark");
  const [sidebarWidth, setSidebarWidth] = useState(400);

  // Optional URL params (?speed=2&w=320&theme=light) for rehearsal and automated tests.
  useEffect(() => {
    const id = setTimeout(() => {
      const q = new URLSearchParams(window.location.search);
      const speed = Number(q.get("speed"));
      if (speed > 0) host.setSpeed(speed);
      const w = Number(q.get("w"));
      if (w >= 240 && w <= 900) setSidebarWidth(w);
      const th = q.get("theme");
      if (th === "light" || th === "hc") {
        setTheme(th);
        applyTheme(th);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [host]);

  const run = (id: ScenarioId, kind: "inline" | "agent") => {
    host.reset();
    host.setScenario(id);
    setEpoch((e) => e + 1);
    if (kind === "agent") {
      setInlineText(null);
      setDraft(TASK_B_INSTRUCTION);
    } else {
      setDraft("");
      setInlineText(TASK_A_INSTRUCTION);
    }
  };

  const cycleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "hc" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <ForgeProvider key={epoch} host={host}>
      <div className="flex h-full flex-col overflow-hidden bg-bg text-fg">
        <TitleBar
          theme={theme}
          layout={layout}
          onPreset={run}
          onTheme={cycleTheme}
          onLayout={() => setLayout((l) => (l === "sidebar" ? "panel" : "sidebar"))}
          onReset={() => {
            host.reset();
            setEpoch((e) => e + 1);
            setDraft("");
            setInlineText(null);
          }}
        />
        <div className="flex min-h-0 flex-1">
          <ActivityBar />
          {layout === "sidebar" ? (
            <>
              <aside aria-label="FORGE" style={{ width: sidebarWidth }} className="shrink-0 border-r border-border">
                <ForgeApp mentionSource={MENTION_SOURCE} initialDraft={draft} />
              </aside>
              <EditorPane inlineText={inlineText} onCloseInline={() => setInlineText(null)} />
            </>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-9 shrink-0 items-end border-b border-border bg-bg">
                <div className="flex h-9 items-center gap-1.5 border-r border-t-2 border-border border-t-accent bg-surface px-3 text-secondary text-fg">
                  <ForgeMark className="size-3.5 text-accent" /> FORGE
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <ForgeApp mentionSource={MENTION_SOURCE} initialDraft={draft} />
              </div>
            </div>
          )}
        </div>
        <StatusBar />
      </div>
    </ForgeProvider>
  );
}

function TitleBar({
  theme,
  layout,
  onPreset,
  onTheme,
  onLayout,
  onReset,
}: {
  theme: Theme;
  layout: "sidebar" | "panel";
  onPreset: (id: ScenarioId, kind: "inline" | "agent") => void;
  onTheme: () => void;
  onLayout: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-bg px-3 text-secondary text-muted">
      <ForgeMark className="size-3.5 shrink-0 text-accent" />
      <nav aria-label="Menu" className="hidden items-center gap-3 md:flex">
        {["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"].map((m) => (
          <span key={m}>{m}</span>
        ))}
      </nav>
      <span className="mx-auto hidden truncate text-fg lg:block">helpers.py — flask</span>
      <div className="ml-auto flex items-center gap-0.5 lg:ml-0">
        {PRESETS.map((p) => (
          <IconButton key={p.id} icon={p.icon} label={p.label} size="sm" onClick={() => onPreset(p.id, p.kind)} />
        ))}
        <span className="mx-1 h-3.5 w-px bg-border" aria-hidden />
        <IconButton icon={PanelLeft} label={layout === "sidebar" ? "Open as editor panel" : "Back to sidebar"} size="sm" onClick={onLayout} />
        <IconButton icon={theme === "dark" ? Moon : theme === "light" ? Sun : Contrast} label={`Theme: ${theme === "hc" ? "high contrast" : theme}`} size="sm" onClick={onTheme} />
        <IconButton icon={RotateCcw} label="Reset" size="sm" onClick={onReset} />
      </div>
    </div>
  );
}

function ActivityBar() {
  return (
    <nav aria-label="Activity bar" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg py-2 text-faint">
      {[Files, Search, GitBranch, Bug, Blocks].map((Icon, i) => (
        <span key={i} className="grid size-9 place-items-center">
          <Icon size={19} strokeWidth={1.5} aria-hidden />
        </span>
      ))}
      <span className="relative grid size-9 place-items-center text-fg">
        <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-accent" />
        <Bot size={19} strokeWidth={1.5} aria-label="FORGE" />
      </span>
    </nav>
  );
}

function StatusBar() {
  const { state } = useForge();
  const m = state.app.model;
  const running = state.app.turn.status === "running" || state.app.turn.status === "paused";
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-meta text-muted">
      <span className="flex items-center gap-1">
        <GitBranch size={11} aria-hidden /> 3.1.3
      </span>
      <span className="flex items-center gap-1">
        <X size={11} aria-hidden /> 0 <Bell size={11} aria-hidden className="ml-1" /> 0
      </span>
      <span className="flex items-center gap-1 text-fg">
        {running ? <Spinner size={11} /> : <Sparkles size={11} className="text-accent" aria-hidden />}
        <span className="font-mono">{m.active ?? "No model"}</span>
      </span>
      <span className="ml-auto flex gap-3">
        <span>Ln 27, Col 1</span>
        <span>Spaces: 4</span>
        <span>UTF-8</span>
        <span>LF</span>
        <span>Python 3.12.4</span>
      </span>
    </footer>
  );
}

type Row = { no: number; node: React.ReactNode; mark?: "add" };

function EditorPane({ inlineText, onCloseInline }: { inlineText: string | null; onCloseInline: () => void }) {
  const { state, actions } = useForge();
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [inlineRun, setInlineRun] = useState(false); // this run started from the editor, not the agent panel
  const inputRef = useRef<HTMLInputElement>(null);
  const defRef = useRef<HTMLDivElement>(null);

  const file = state.review.files.find((f) => f.path === HELPERS);
  const hunks = file?.hunks ?? [];
  const s = reviewStats(state.review);
  const applied = hunks.length > 0 && hunks.every((h) => h.state === "applied" || h.state === "rejected") && hunks.some((h) => h.state === "applied");
  const proposing = hunks.some((h) => h.state === "pending" || h.state === "accepted");
  const running = state.app.turn.status === "running" || state.app.turn.status === "paused";

  // Opening the instruction box: from the preset buttons (prefilled) or Ctrl+Alt+K.
  const [seen, setSeen] = useState<string | null>(null);
  if (inlineText !== seen) {
    setSeen(inlineText);
    if (inlineText) {
      setTyped(inlineText);
      setOpen(true);
    }
  }
  // Keep the function being edited in view when the editor mounts and when a proposal arrives.
  useEffect(() => {
    defRef.current?.scrollIntoView({ block: "start" });
  }, [proposing, applied]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setTyped("");
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const text = typed.trim();
    if (!text) return;
    actions.submitTask(text, [{ kind: "file", path: HELPERS, range: { startLine: 27, endLine: 32 } }]);
    setOpen(false);
    setInlineRun(true);
    onCloseInline();
  };

  const func = applied ? FUNC_UPDATED : FUNC_ORIGINAL;
  const rows: Row[] = [];
  FILE_HEAD.forEach((t, i) => rows.push({ no: i + 1, node: highlightPython(t) }));
  func.forEach((t, i) => rows.push({ no: 27 + i, node: highlightPython(t), mark: applied && FUNC_UPDATED_MARKS.has(i) ? "add" : undefined }));
  FILE_TAIL.forEach((t, i) => rows.push({ no: 27 + func.length + i, node: highlightPython(t) }));
  const defIndex = 26;
  const funcEnd = defIndex + func.length;

  const lens = (children: React.ReactNode) => (
    <div className="flex h-5 items-center gap-3 pl-[3.5rem] text-meta text-muted">{children}</div>
  );
  const link = (label: string, onClick: () => void, strong?: boolean) => (
    <button type="button" onClick={onClick} className={cn("underline-offset-2 hover:underline", strong ? "text-accent" : "text-muted hover:text-fg")}>
      {label}
    </button>
  );

  return (
    <section aria-label="Editor" className="relative hidden min-w-0 flex-1 flex-col bg-surface lg:flex">
      <div className="flex h-9 shrink-0 items-end border-b border-border bg-bg">
        <div className="flex h-9 items-center gap-1.5 border-r border-t-2 border-border border-t-accent bg-surface px-3 text-secondary text-fg">
          <span className="font-mono text-warning">py</span>
          helpers.py
          {applied ? <span aria-label="Unsaved changes" className="ml-1 size-2 rounded-full bg-muted" /> : null}
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-1 px-4 text-meta text-muted">
        src <span className="text-faint">›</span> flask <span className="text-faint">›</span> helpers.py <span className="text-faint">›</span>
        <span className="text-fg">get_debug_flag</span>
      </div>

      {open ? (
        <div className="forge-enter absolute left-1/2 top-12 z-20 w-[min(560px,90%)] -translate-x-1/2 rounded-lg border border-border bg-overlay p-1.5 shadow-lg">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Wand2 size={15} className="ml-1.5 shrink-0 text-accent" aria-hidden />
            <input
              ref={inputRef}
              aria-label="Describe the change"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  onCloseInline();
                }
              }}
              placeholder="Describe the change to get_debug_flag"
              className="h-8 min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-faint"
            />
            <IconButton icon={CornerDownLeft} label="Generate edit" variant="primary" size="md" type="submit" disabled={!typed.trim()} />
          </form>
        </div>
      ) : null}

      <div tabIndex={0} aria-label="helpers.py" role="region" className="forge-scroll min-h-0 flex-1 overflow-auto py-2 font-mono text-body leading-[1.6]">
        {rows.map((r, idx) => (
          <div key={`${idx}-${r.no}`} ref={idx === defIndex ? defRef : undefined}>
            {idx === defIndex
              ? lens(
                  inlineRun && running && !hunks.length ? (
                    <>
                      <span className="flex items-center gap-1.5 text-fg">
                        <Spinner size={11} /> Generating edit
                      </span>
                      {link("Stop", actions.cancelTurn)}
                    </>
                  ) : proposing ? (
                    <>
                      <span className="flex items-center gap-1 text-fg">
                        <Sparkles size={11} className="text-accent" aria-hidden /> {s.hunks} changes
                      </span>
                      {link("Accept all", () => actions.reviewBulk("acceptAll"))}
                      {link("Reject all", () => actions.reviewBulk("rejectAll"))}
                      {s.accepted > 0 && s.pending === 0 ? link(`Apply ${s.accepted}`, () => actions.reviewBulk("apply"), true) : null}
                    </>
                  ) : applied && state.review.lastApplied && !state.review.lastApplied.undone ? (
                    <>
                      <span className="flex items-center gap-1 text-fg">
                        <Check size={11} className="text-success" aria-hidden /> Applied
                      </span>
                      {link("Undo", () => actions.reviewBulk("undo"))}
                    </>
                  ) : (
                    <span className="flex items-center gap-1 text-faint">
                      <Sparkles size={11} aria-hidden /> Ctrl+Alt+K to edit with FORGE
                    </span>
                  ),
                )
              : null}
            <div className={cn("flex", r.mark === "add" ? "bg-diff-add-bg" : idx >= defIndex && idx < funcEnd && !applied && !open ? "" : "")}>
              <span className="syn-gutter tabular w-12 shrink-0 select-none pr-4 text-right">{r.no}</span>
              <span className="whitespace-pre text-fg">{r.node || " "}</span>
            </div>
            {idx === funcEnd - 1 && proposing
              ? hunks.map((h) => (
                  <div key={h.hunkId} className={cn("my-1.5 ml-12 mr-4 overflow-hidden rounded border border-border bg-bg", h.state === "rejected" && "opacity-50")}>
                    <div className="flex h-6 items-center gap-3 border-b border-border-subtle px-2 text-meta">
                      <span className="font-mono text-info">{h.header}</span>
                      <span className="ml-auto flex items-center gap-3">
                        {h.state !== "pending" ? <span className={h.state === "accepted" ? "text-success" : "text-danger"}>{h.state === "accepted" ? "Accepted" : "Rejected"}</span> : null}
                        {link("Accept", () => actions.reviewHunk(h.proposalId, h.hunkId, h.state === "accepted" ? "reset" : "accept"))}
                        {link("Reject", () => actions.reviewHunk(h.proposalId, h.hunkId, h.state === "rejected" ? "reset" : "reject"))}
                      </span>
                    </div>
                    <DiffLines lines={h.lines} />
                  </div>
                ))
              : null}
          </div>
        ))}
      </div>
    </section>
  );
}
