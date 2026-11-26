/**
 * *Shuffle*'s roll, for every form that makes a Mate (the New project page's Mate step, the add-Mate
 * dialog): a new colour, shape and name at each beat, the beats slowing like a die settling (1.3 s
 * in all, under the owner's 2 s), the last one the face and name it lands on. Reduced motion lands
 * at once.
 */
import {
  MATE_SHAPE_IDS,
  MATE_TINT_IDS,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "~/lib/reducedMotion";

const SHUFFLE_BEATS_MS = [50, 55, 60, 65, 75, 85, 100, 115, 135, 160, 190, 220] as const;

const anyOf = <T>(list: ReadonlyArray<T>): T => list[Math.floor(Math.random() * list.length)]!;

export function useMateShuffle({
  name,
  pickTint,
  pickShape,
  setName,
  proposeAnotherName,
}: {
  /** The name it rolls from. */
  readonly name: string;
  readonly pickTint: (tint: MateTintId) => void;
  readonly pickShape: (shape: MateShapeId) => void;
  readonly setName: (name: string) => void;
  /** Another name free on the account; absent, the name stays. */
  readonly proposeAnotherName: ((current: string) => string) | undefined;
}) {
  const [rolling, setRolling] = useState(false);
  const timers = useRef<Array<number>>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  // Each beat names from the name the beat before gave.
  const beat = (from: string) => {
    pickTint(anyOf(MATE_TINT_IDS));
    pickShape(anyOf(MATE_SHAPE_IDS));
    if (proposeAnotherName === undefined) return from;
    const next = proposeAnotherName(from);
    setName(next);
    return next;
  };
  const roll = () => {
    if (rolling) return;
    let current = name.replace(/\s+/g, " ").trim();
    if (prefersReducedMotion()) {
      beat(current);
      return;
    }
    setRolling(true);
    let at = 0;
    timers.current = SHUFFLE_BEATS_MS.map((wait, index) => {
      at += wait;
      return window.setTimeout(() => {
        current = beat(current);
        if (index === SHUFFLE_BEATS_MS.length - 1) setRolling(false);
      }, at);
    });
  };
  return { rolling, roll };
}

/** A roll, as the forms that make a Mate hold it. */
export type MateShuffle = ReturnType<typeof useMateShuffle>;
