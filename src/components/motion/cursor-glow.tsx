"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient light that tracks the pointer, used only on the signed-out screens.
 * It is decorative: aria-hidden, pointer-events none, and it never renders for
 * a reduced-motion visitor or a device without a fine pointer (a phone would
 * just show a static blob). Position is written to CSS custom properties on an
 * rAF, so pointer events never trigger React renders.
 */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const allowed =
      window.matchMedia("(prefers-reduced-motion: no-preference)").matches &&
      window.matchMedia("(pointer: fine)").matches;
    if (!allowed) return;

    node.style.opacity = "1";
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        node.style.setProperty("--mx", `${event.clientX}px`);
        node.style.setProperty("--my", `${event.clientY}px`);
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={ref} aria-hidden className="cursor-glow fixed opacity-0" />;
}
