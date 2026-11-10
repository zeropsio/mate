import { MOTION } from "@t3tools/shared/brand";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * What grows in place: when what it holds gets taller — a plan bringing a step the places did not
 * hold, a step opening its import, a group arriving after the page drew — it eases there, so what
 * stands under it goes down and never jumps. Getting shorter is not eased. Reduced motion cuts.
 */
export function GrowsInPlace({ children }: { readonly children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  const stood = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const node = box.current;
    if (node === null) return;
    // Its laid-out height: a sheet's entrance scales what a client rect would say.
    const now = node.offsetHeight;
    const before = stood.current;
    stood.current = now;
    if (before === undefined || now - before < 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.animate(
      [
        { height: `${String(before)}px`, overflow: "clip" },
        { height: `${String(now)}px`, overflow: "clip" },
      ],
      { duration: MOTION.duration.base, easing: MOTION.easing.out },
    );
  });
  return <div ref={box}>{children}</div>;
}
