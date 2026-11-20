"use client";

import { useEffect, useState } from "react";

/** Current time, ticking at `intervalMs` while `active`. Returns 0 until mounted (no Date.now() in render). */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    // Sync once on mount/activation, then tick. setState inside a timer callback, not the effect body.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    if (!active) return () => clearTimeout(first);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active, intervalMs]);
  return now;
}

/** Container width in px, for narrow/standard/wide layouts (Ui-regitry §G). */
export function useElementWidth<T extends HTMLElement>(ref: React.RefObject<T | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
