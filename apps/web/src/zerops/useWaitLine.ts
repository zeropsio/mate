/**
 * Whether a wait's one line shows now (`waitLine.logic.ts`): after its beat — from the page's load
 * or from this wait's first frame — or at once where the layer it takes over from was saying the
 * same words. State and a timer; the clock is read when the wait mounts and when its words change.
 */
import { useEffect, useLayoutEffect, useState } from "react";

import { waitLineDueInMs } from "./waitLine.logic";

/** The line on screen, and how many waits say it; cleared a task after the last one goes. */
let said: { text: string; holders: number } | null = null;

function say(text: string): () => void {
  if (said?.text === text) said.holders += 1;
  else said = { text, holders: 1 };
  const held = said;
  return () => {
    held.holders -= 1;
    if (held.holders > 0) return;
    // The layer taking over mounts in the same commit and reads the words before they go.
    setTimeout(() => {
      if (said === held && held.holders === 0) said = null;
    }, 0);
  };
}

function dueInMs(
  text: string | null,
  startedAt: number,
  delayMs: number,
  now: number,
): number | null {
  return waitLineDueInMs({ text, said: said?.text ?? null, elapsedMs: now - startedAt, delayMs });
}

export function useWaitLine(
  text: string | null,
  options: { readonly delayMs: number; readonly from: "load" | "mount" },
): boolean {
  const { delayMs, from } = options;
  const [startedAt] = useState(() => (from === "load" ? 0 : performance.now()));
  const [shownText, setShownText] = useState<string | null>(() =>
    dueInMs(text, startedAt, delayMs, performance.now()) === 0 ? text : null,
  );
  const showing = text !== null && shownText === text;
  useEffect(() => {
    if (showing) return;
    const due = dueInMs(text, startedAt, delayMs, performance.now());
    if (due === null) return;
    const timer = setTimeout(() => setShownText(text), due);
    return () => clearTimeout(timer);
  }, [delayMs, showing, startedAt, text]);
  useLayoutEffect(() => (showing && text !== null ? say(text) : undefined), [showing, text]);
  return showing;
}
