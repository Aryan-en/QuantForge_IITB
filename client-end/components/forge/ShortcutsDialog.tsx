"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/misc";

const ROWS: [string, string[]][] = [
  ["Inline edit", ["Ctrl", "Alt", "K"]],
  ["Open QuantForge", ["Ctrl", "Alt", "F"]],
  ["Send", ["↵"]],
  ["New line", ["⇧", "↵"]],
  ["Stop", ["Esc"]],
  ["Accept hunk", ["A"]],
  ["Reject hunk", ["R"]],
  ["Apply accepted", ["Ctrl", "↵"]],
  ["Shortcuts", ["?"]],
];

/** Modal cheat-sheet. Focus moves to Close, Esc dismisses, focus returns to the opener (Ui-regitry E.1 Dialog). */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);
  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-bg/70 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Tab") {
          e.preventDefault();
          closeRef.current?.focus();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="forge-enter w-full max-w-72 rounded-lg border border-border bg-overlay p-3 shadow-lg">
        <div className="mb-2 flex items-center">
          <h2 className="text-secondary font-semibold text-fg">Keyboard shortcuts</h2>
          <IconButton ref={closeRef} icon={X} label="Close" size="sm" className="ml-auto" onClick={onClose} />
        </div>
        <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 text-secondary">
          {ROWS.map(([label, keys]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="flex gap-0.5">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
