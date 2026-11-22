"use client";

import { ArrowUp, AtSign, Braces, FileText, Square } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { Mention, MentionCandidate } from "@/lib/protocol";

export type { MentionCandidate };

function candidateLabel(c: MentionCandidate): string {
  return c.kind === "file" ? c.path : c.name;
}

/**
 * Composer (Ui-regitry E.2): role="combobox" @-autocomplete, Enter sends, Shift+Enter newline,
 * Esc closes the list or stops the running turn. Disabled for new input while a turn runs.
 */
export function Composer({
  running,
  cancelling,
  disabled,
  disabledReason,
  mentionSource,
  remoteMentions = [],
  onMentionQuery,
  onSubmit,
  onStop,
  placeholder = "Describe a task. Type @ to add files or symbols.",
  initialText = "",
}: {
  running: boolean;
  cancelling: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Static suggestions (filtered locally). When empty, `remoteMentions` + `onMentionQuery` are used. */
  mentionSource: MentionCandidate[];
  remoteMentions?: MentionCandidate[];
  onMentionQuery?: (query: string) => void;
  onSubmit: (text: string, mentions: Mention[]) => void;
  onStop: () => void;
  placeholder?: string;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const remote = mentionSource.length === 0 && Boolean(onMentionQuery);
  const results = useMemo(() => {
    if (query === null) return [];
    if (remote) return remoteMentions.slice(0, 10);
    const q = query.toLowerCase();
    return mentionSource.filter((c) => candidateLabel(c).toLowerCase().includes(q)).slice(0, 8);
  }, [query, mentionSource, remote, remoteMentions]);

  // Ask the host for suggestions (debounced) when the picker is open and the host owns the index.
  useEffect(() => {
    if (!remote || query === null) return;
    const id = setTimeout(() => onMentionQuery?.(query), 120);
    return () => clearTimeout(id);
  }, [remote, query, onMentionQuery]);

  const listOpen = query !== null;

  const updateQuery = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([\w./-]*)$/.exec(before);
    setQuery(m ? m[2] : null);
    setHighlight(0);
  };

  const pick = (c: MentionCandidate) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([\w./-]*)$/, "");
    const after = text.slice(caret);
    const token = `@${c.insert ?? (c.kind === "file" ? c.path : c.name)}`;
    setText(`${before}${token} ${after}`);
    setMentions((ms) =>
      ms.some((m) => (m.kind === "file" && c.kind === "file" ? m.path === c.path : m.kind === "symbol" && c.kind === "symbol" && m.name === c.name))
        ? ms
        : [...ms, c.kind === "file" ? { kind: "file", path: c.path } : { kind: "symbol", name: c.name, path: c.path }],
    );
    setQuery(null);
    requestAnimationFrame(() => el?.focus());
  };

  const send = () => {
    const t = text.trim();
    if (!t || running || disabled) return;
    onSubmit(t, mentions);
    setText("");
    setMentions([]);
    setQuery(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (listOpen && results.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % results.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + results.length) % results.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(results[highlight]);
        return;
      }
    }
    if (e.key === "Escape") {
      if (listOpen) setQuery(null);
      else if (running) onStop();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const inputDisabled = disabled || running;

  return (
    <form
      className="relative border-t border-border bg-bg p-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {listOpen ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Mention suggestions"
          className="absolute inset-x-2 bottom-full mb-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-overlay p-1 shadow-md"
        >
          {results.length === 0 ? (
            <p className="px-2 py-1.5 text-secondary text-muted">No matches</p>
          ) : (
            results.map((c, i) => (
              <div
                key={`${c.kind}:${candidateLabel(c)}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1", i === highlight ? "bg-raised text-fg" : "text-muted")}
              >
                {c.kind === "file" ? <FileText size={13} aria-hidden /> : <Braces size={13} aria-hidden className="text-info" />}
                <span className="truncate font-mono text-secondary">{candidateLabel(c)}</span>
                {c.detail || c.kind === "symbol" ? <span className="ml-auto truncate font-mono text-meta text-faint">{c.detail ?? (c.kind === "symbol" ? c.path : "")}</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      <div
        className={cn(
          "rounded-lg border bg-surface transition-colors duration-[var(--forge-dur-med)] focus-within:border-accent/70",
          running ? "border-accent/40" : "border-border",
        )}
      >
        {mentions.length ? (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {mentions.map((m, i) => (
              <Chip
                key={i}
                tone="accent"
                mono
                icon={m.kind === "file" ? FileText : Braces}
                onRemove={() => setMentions((ms) => ms.filter((_, j) => j !== i))}
                removeLabel={`Remove mention ${m.kind === "file" ? m.path : m.name}`}
              >
                {m.kind === "file" ? m.path : m.name}
              </Chip>
            ))}
          </div>
        ) : null}
        <textarea
          ref={ref}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={listOpen && results.length ? `${listId}-${highlight}` : undefined}
          aria-autocomplete="list"
          aria-label="Task for QuantForge"
          value={text}
          rows={2}
          readOnly={inputDisabled}
          aria-disabled={inputDisabled || undefined}
          placeholder={running ? "QuantForge is working… press Esc to stop." : disabled ? disabledReason : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            updateQuery(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-2.5 py-2 text-body text-fg outline-none placeholder:text-faint focus-visible:outline-none"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <IconButton
            icon={AtSign}
            label="Add file or symbol"
            size="sm"
            disabled={inputDisabled}
            onClick={() => {
              setText((t) => (t.endsWith(" ") || t === "" ? `${t}@` : `${t} @`));
              setQuery("");
              ref.current?.focus();
            }}
          />
          <span className="hidden items-center gap-1 text-meta text-faint sm:flex">
            <Kbd>↵</Kbd> send <Kbd>⇧↵</Kbd> newline {running ? <><Kbd>Esc</Kbd> stop</> : null}
          </span>
          <div className="ml-auto">
            {running ? (
              <IconButton
                icon={Square}
                label={cancelling ? "Cancelling…" : "Stop (Esc)"}
                variant="danger"
                size="md"
                loading={cancelling}
                disabled={cancelling}
                onClick={onStop}
              />
            ) : (
              <IconButton
                icon={ArrowUp}
                label="Send (Enter)"
                variant="primary"
                size="md"
                type="submit"
                disabled={!text.trim() || disabled}
                disabledReason={disabled ? disabledReason : "Type a task first"}
              />
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
