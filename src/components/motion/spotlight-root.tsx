"use client";

import { useEffect } from "react";

/**
 * One delegated pointer listener for every `.spotlight` surface on the page.
 * On move it writes the pointer's position, relative to the hovered element,
 * into that element's own --mx/--my custom properties; CSS draws the highlight.
 *
 * Mounted once per app layout. Skipped entirely for reduced-motion visitors and
 * for coarse pointers, where a cursor highlight has nothing to track. Writes
 * happen on an animation frame and never touch React state, so hovering a card
 * costs no re-render.
 */
export function SpotlightRoot() {
  useEffect(() => {
    const allowed =
      window.matchMedia("(prefers-reduced-motion: no-preference)").matches &&
      window.matchMedia("(pointer: fine)").matches;
    if (!allowed) return;

    let frame = 0;
    let pending: { el: HTMLElement; x: number; y: number } | null = null;

    const onMove = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const el = target?.closest?.(".spotlight") as HTMLElement | null;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      pending = { el, x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!pending) return;
        pending.el.style.setProperty("--mx", `${pending.x}px`);
        pending.el.style.setProperty("--my", `${pending.y}px`);
      });
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
