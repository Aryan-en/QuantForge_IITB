"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  CircleAlert,
  Cpu,
  ExternalLink,
  Keyboard,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  Wand2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/Chip";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { AppState, ForgeSettings, ModelState } from "@/lib/protocol";
import { ForgeMark, MODEL_TEXT, MODEL_TONE } from "./Header";

function PushedView({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape") onBack();
      }}
    >
      <div className="flex h-9 items-center gap-1 border-b border-border px-1.5">
        <IconButton icon={ArrowLeft} label="Back (Esc)" size="sm" onClick={onBack} autoFocus />
        <h2 className="text-secondary font-semibold text-fg">{title}</h2>
      </div>
      <div className="forge-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function Card({ title, icon: Icon, children, className }: { title: string; icon: typeof Cpu; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border border-border bg-surface p-3", className)}>
      <h3 className="mb-2 flex items-center gap-1.5 text-meta font-semibold uppercase tracking-[0.08em] text-muted">
        <Icon size={12} aria-hidden /> {title}
      </h3>
      {children}
    </section>
  );
}

// ---------------- Welcome (D.1) ----------------
export function Welcome({
  app,
  onStart,
  onCheck,
  onNewSession,
  onOpenModel,
}: {
  app: AppState;
  onStart: () => void;
  onCheck: () => void;
  onNewSession: () => void;
  onOpenModel: () => void;
}) {
  const c = app.connection.status;
  const connected = c === "connected";
  const hasModel = Boolean(app.model.primary);
  return (
    <div className="forge-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex flex-col items-start gap-2 pb-2 pt-4">
        <div className="grid size-10 place-items-center rounded-lg border border-accent/40 bg-accent-soft text-accent">
          <ForgeMark className="size-5" />
        </div>
        <h1 className="text-title font-semibold tracking-tight text-fg">FORGE</h1>
        <p className="text-body text-muted">Think. Understand. Engineer. Verify.</p>
      </div>

      <Card title="TrueForge" icon={Server}>
        <div className="flex items-center gap-2">
          <StatusDot tone={connected ? "success" : c === "checking" ? "neutral" : c === "unreachable" ? "danger" : "warning"} pulse={c === "checking"} />
          <span className="text-secondary text-fg">
            {connected ? "Connected" : c === "checking" ? "Checking…" : c === "unreachable" ? "Unreachable" : "Not configured"}
          </span>
          <span className="ml-auto truncate font-mono text-meta text-muted">{app.connection.baseUrl}</span>
        </div>
        {c === "unreachable" ? (
          <p className="mt-2 text-secondary text-muted">
            Run <code className="rounded-sm bg-raised px-1 font-mono text-fg">npx @truefoundry/trueforge@latest</code>, then check again.
          </p>
        ) : null}
        <div className="mt-2.5 flex gap-1.5">
          {!connected ? (
            <Button size="sm" variant="primary" icon={Play} onClick={onStart}>
              Start TrueForge
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={onCheck} loading={c === "checking"}>
            Check again
          </Button>
        </div>
      </Card>

      <Card title="Model" icon={Cpu}>
        {hasModel ? (
          <>
            <div className="flex items-center gap-2">
              <StatusDot tone={MODEL_TONE[app.model.status]} />
              <span className="font-mono text-secondary text-fg">{app.model.primary}</span>
              <span className="ml-auto text-meta text-muted">{MODEL_TEXT[app.model.status]}</span>
            </div>
            <p className="mt-1 text-meta text-muted">
              Fallbacks: {app.model.fallbacks.length ? <span className="font-mono">{app.model.fallbacks.join(", ")}</span> : "none"}
            </p>
          </>
        ) : (
          <p className="text-secondary text-muted">No model configured. Models and keys live in TrueForge — FORGE stores model names only.</p>
        )}
        <Button size="sm" variant="ghost" icon={ExternalLink} className="mt-2" onClick={onOpenModel}>
          Model configuration
        </Button>
      </Card>

      <Button
        variant="primary"
        size="lg"
        icon={Bot}
        disabled={!connected || !hasModel}
        disabledReason={!connected ? "Connect to TrueForge first" : "Configure a model in TrueForge first"}
        onClick={onNewSession}
      >
        Start new agent session
      </Button>

      <div className="mt-1 flex flex-col gap-1.5 text-secondary text-muted">
        <p className="flex items-center gap-2">
          <Wand2 size={13} className="text-accent" aria-hidden /> Inline edit <Kbd>Ctrl</Kbd>
          <Kbd>Alt</Kbd>
          <Kbd>K</Kbd>
        </p>
        <p className="flex items-center gap-2">
          <ShieldCheck size={13} className="text-success" aria-hidden /> Nothing is written until you apply
        </p>
      </div>
    </div>
  );
}

// ---------------- Model configuration (D.7) ----------------
export function ModelConfigPanel({
  model,
  onBack,
  onTest,
  onFallbacksChange,
  onOpenSettings,
}: {
  model: ModelState;
  onBack: () => void;
  onTest: () => void;
  /** Absent when fallbacks are edited in VS Code settings rather than here. */
  onFallbacksChange?: (f: string[]) => void;
  onOpenSettings: () => void;
}) {
  const [draft, setDraft] = useState("");
  const fb = model.fallbacks;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fb.length) return;
    const next = fb.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onFallbacksChange?.(next);
  };
  return (
    <PushedView title="Model configuration" onBack={onBack}>
      <div className="flex flex-col gap-3 p-3">
        <Card title="Active model" icon={Cpu}>
          <div className="flex items-center gap-2">
            <StatusDot tone={MODEL_TONE[model.status]} pulse={model.status === "checking"} />
            <span className="font-mono text-body text-fg">{model.active ?? model.primary ?? "—"}</span>
            <span className="ml-auto text-meta text-muted">{MODEL_TEXT[model.status]}</span>
          </div>
          <p className="mt-1 text-meta text-muted">
            Primary <span className="font-mono">{model.primary ?? "—"}</span> · configured in TrueForge. FORGE never shows or stores API keys.
          </p>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={onTest} loading={model.status === "checking"}>
              Test connection
            </Button>
            <Button size="sm" variant="ghost" icon={Settings2} onClick={onOpenSettings}>
              Model settings
            </Button>
          </div>
        </Card>

        <Card title="Fallback models (in order)" icon={RefreshCw}>
          {fb.length === 0 ? <p className="text-secondary text-muted">No fallback models configured. Task C will end with a clear error instead of switching.</p> : null}
          <ol className="flex flex-col gap-1">
            {fb.map((f, i) => (
              <li key={f} className="flex items-center gap-1 rounded border border-border-subtle bg-bg px-2 py-1">
                <span className="tabular w-4 text-meta text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-secondary text-fg">{f}</span>
                {onFallbacksChange ? (
                  <>
                    <IconButton icon={ArrowUp} label={`Move ${f} up`} size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon={ArrowDown} label={`Move ${f} down`} size="sm" disabled={i === fb.length - 1} onClick={() => move(i, 1)} />
                    <IconButton icon={Trash2} label={`Remove ${f}`} size="sm" onClick={() => onFallbacksChange(fb.filter((x) => x !== f))} />
                  </>
                ) : null}
              </li>
            ))}
          </ol>
          {onFallbacksChange ? (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const v = draft.trim();
              if (v && !fb.includes(v)) onFallbacksChange?.([...fb, v]);
              setDraft("");
            }}
          >
            <label className="sr-only" htmlFor="forge-fallback-input">
              Fallback model name
            </label>
            <input
              id="forge-fallback-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="provider/model as named in TrueForge"
              className="h-7 min-w-0 flex-1 rounded border border-border bg-raised px-2 font-mono text-secondary text-fg placeholder:text-faint"
            />
            <Button size="md" variant="secondary" icon={Plus} type="submit" disabled={!draft.trim()}>
              Add
            </Button>
          </form>
          ) : (
            <Button size="sm" variant="secondary" icon={Settings2} className="mt-2" onClick={onOpenSettings}>
              Edit in settings
            </Button>
          )}
        </Card>

        <Card title="Retry policy" icon={ShieldCheck}>
          <p className="text-secondary text-fg">3 attempts · exponential backoff with jitter · stall timeout 45 s</p>
          <p className="mt-1 text-meta text-muted">Auth errors skip retries and go to the next fallback. A failed run never writes to disk.</p>
        </Card>

        {model.lastFailure ? (
          <Card title="Last failure" icon={CircleAlert}>
            <p className="font-mono text-secondary text-fg">{model.lastFailure.code}</p>
            <p className="text-meta text-muted">
              FORGE {model.lastFailure.action === "fell_back" ? "fell back to the next model" : model.lastFailure.action === "retried" ? "retried" : "stopped and showed an error"}.
            </p>
          </Card>
        ) : null}
      </div>
    </PushedView>
  );
}

// ---------------- Settings (D.8) ----------------
export function SettingsPanel({ settings, onBack, onChange }: { settings: ForgeSettings; onBack: () => void; onChange: (p: Partial<ForgeSettings>) => void }) {
  const row = (id: keyof ForgeSettings, label: string, control: ReactNode, help?: string) => (
    <div className="flex flex-col gap-1 py-2" title={`forge.${id}`}>
      <div className="flex items-center gap-2">
        <label htmlFor={`s-${id}`} className="text-secondary text-fg">
          {label}
        </label>
        <div className="ml-auto">{control}</div>
      </div>
      {help ? <p className="text-meta text-muted">{help}</p> : null}
    </div>
  );
  const toggle = (id: keyof ForgeSettings, value: boolean) => (
    <button
      id={`s-${id}`}
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange({ [id]: !value } as Partial<ForgeSettings>)}
      className={cn("relative h-4 w-7 rounded-full transition-colors disabled:opacity-60", value ? "bg-accent" : "bg-raised border border-border")}
    >
      <span className={cn("absolute top-0.5 size-3 rounded-full bg-fg transition-[left]", value ? "left-3.5" : "left-0.5")} />
    </button>
  );
  return (
    <PushedView title="Settings" onBack={onBack}>
      <div className="flex flex-col gap-3 p-3">
        <fieldset className="rounded-md border border-border bg-surface px-3 py-1">
          <legend className="px-1 text-meta font-semibold uppercase tracking-[0.08em] text-muted">Context</legend>
          {row(
            "context.budgetTokens",
            "Token budget",
            <input
              id="s-context.budgetTokens"
              type="number"
              min={2000}
              max={200000}
              step={1000}
              value={settings["context.budgetTokens"]}
              onChange={(e) => onChange({ "context.budgetTokens": Number(e.target.value) })}
              className="tabular h-6 w-24 rounded border border-border bg-raised px-1.5 text-right font-mono text-secondary text-fg"
            />,
            "Hard cap for get_context bundles. Retrieval degrades Full → Symbols → Skeleton → Path to fit.",
          )}
          {row("context.includeSecrets", "Allow secret files (.env, *.pem)", toggle("context.includeSecrets", settings["context.includeSecrets"]), "Off by default. Turning this on lets the agent read files that often hold keys.")}
          <div className="py-2">
            <p className="text-secondary text-fg">Excluded globs</p>
            <p className="mt-1 font-mono text-meta text-muted">{settings["context.exclude"].join("  ·  ")}</p>
          </div>
        </fieldset>
        <fieldset className="rounded-md border border-border bg-surface px-3 py-1">
          <legend className="px-1 text-meta font-semibold uppercase tracking-[0.08em] text-muted">Agent behaviour</legend>
          {row("review.autoOpenOnPause", "Open Review when the agent pauses", toggle("review.autoOpenOnPause", settings["review.autoOpenOnPause"]))}
          {row("terminal.useShadowWorkspace", "Run commands in shadow workspace", toggle("terminal.useShadowWorkspace", settings["terminal.useShadowWorkspace"]), "Tests run against proposed edits without touching your files.")}
          <div className="flex flex-col gap-1 py-2">
            <div className="flex items-center gap-2">
              <span className="text-secondary text-fg">Require approval for terminal commands</span>
              <span role="switch" aria-checked aria-disabled aria-label="Require approval for terminal commands (locked on)" className="relative ml-auto h-4 w-7 rounded-full bg-accent opacity-60">
                <span className="absolute left-3.5 top-0.5 size-3 rounded-full bg-fg" />
              </span>
            </div>
            <p className="text-meta text-muted">Locked on. run_terminal is approval-gated by name in the agent definition.</p>
          </div>
        </fieldset>
        <fieldset className="rounded-md border border-border bg-surface px-3 py-1">
          <legend className="px-1 text-meta font-semibold uppercase tracking-[0.08em] text-muted">Interface</legend>
          {row("ui.showToolDetails", "Expand tool details by default", toggle("ui.showToolDetails", settings["ui.showToolDetails"]))}
        </fieldset>
        <section className="rounded-md border border-border bg-surface p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-meta font-semibold uppercase tracking-[0.08em] text-muted">
            <Keyboard size={12} aria-hidden /> Keyboard
          </h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-secondary">
            {[
              ["Inline edit", ["Ctrl", "Alt", "K"]],
              ["Open FORGE", ["Ctrl", "Alt", "F"]],
              ["Stop", ["Esc"]],
              ["Accept / reject hunk", ["A", "R"]],
              ["Apply accepted", ["Ctrl", "↵"]],
            ].map(([label, keys]) => (
              <div key={label as string} className="contents">
                <dt className="text-muted">{label as string}</dt>
                <dd className="flex gap-0.5">
                  {(keys as string[]).map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </PushedView>
  );
}
