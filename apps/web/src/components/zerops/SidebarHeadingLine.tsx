/**
 * What a project's places are doing as this tab watches them (D′): what landed stands for
 * `LANDING_MS`, for the environment tag on the project's row (`SidebarProjectSites.tsx`). What it
 * says is `SidebarHeadingLine.logic.ts`'s.
 */
import { useEffect, useState } from "react";

import {
  headingLanding,
  headingLine,
  LANDING_MS,
  type HeadingLanding,
  type HeadingLine,
  type HeadingLineInput,
} from "./SidebarHeadingLine.logic";

/**
 * The line for `input`, with what this tab watched land standing on it for {@link LANDING_MS}.
 * Read whether the project's row is open or folded, so a release that lands while folded is
 * still watched.
 */
export function useHeadingLine(input: HeadingLineInput | undefined): {
  readonly line: HeadingLine | undefined;
  /** What this tab watched land, while it stands: its pill wears ok. */
  readonly landing: HeadingLanding | undefined;
} {
  const [landing, setLanding] = useState<HeadingLanding | undefined>(undefined);
  const [before, setBefore] = useState<HeadingLineInput | undefined>(input);
  if (before !== input) {
    setBefore(input);
    const landed = input === undefined ? undefined : headingLanding(before, input);
    if (landed !== undefined) setLanding(landed);
  }
  useEffect(() => {
    if (landing === undefined) return;
    const timer = setTimeout(() => {
      setLanding(undefined);
    }, LANDING_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [landing]);
  return { line: input === undefined ? undefined : headingLine(input, landing), landing };
}
