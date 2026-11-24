import { useEffect, useState } from "react";

import type { KitSection } from "../kitSection";

/**
 * The design-system guards whose exception ledgers measure how far the app still is from the kit:
 * every entry is a place that breaks the rule on purpose, until it is fixed.
 */
export const KIT_GUARDS = [
  {
    rule: "no-raw-controls",
    line: "A press, field or choice drawn from raw HTML instead of the kit",
  },
  { rule: "no-restyle", line: "A kit component restyled with className instead of a variant" },
  { rule: "no-arbitrary-values", line: "A value off the scale, like p-[13px]" },
  { rule: "no-theme-escape-hatches", line: "A colour or surface that bypasses the theme's tokens" },
  { rule: "no-unknown-classes", line: "A class Tailwind does not generate" },
] as const;

// The ledgers are read at build, and only where the build carries the design harness: production's
// kit counts none and bundles none.
const ledgers: Readonly<Record<string, readonly unknown[]>> =
  import.meta.env.VITE_DESIGN_HARNESS === ""
    ? {}
    : import.meta.glob<readonly unknown[]>(
        "../../../../../oxlint-plugin-t3code/exceptions/{no-raw-controls,no-restyle,no-arbitrary-values,no-theme-escape-hatches,no-unknown-classes}.json",
        { eager: true, import: "default" },
      );

/** Each guard's entry count, by rule; absent when this build does not carry the ledgers. */
export const KIT_GUARD_COUNTS: ReadonlyMap<string, number> = new Map(
  Object.entries(ledgers).map(([path, entries]) => [
    path.slice(path.lastIndexOf("/") + 1, -".json".length),
    entries.length,
  ]),
);

/** What the sections' sources draw, counted from their text. */
export interface KitSourceCounts {
  /** Specimens across every section: each `Specimen`, census specimen and matrix. */
  readonly specimens: number;
  /** Home-made looks the census still lists. */
  readonly looks: number;
  /** Looks per census section, by the section's id. */
  readonly looksBySection: ReadonlyMap<string, number>;
}

const sources = import.meta.glob<string>("../sections/*.tsx", { query: "?raw", import: "default" });
// The registry's own modules, already loaded: which section each source file is.
const sectionOfFile = import.meta.glob<KitSection>("../sections/*.tsx", {
  eager: true,
  import: "default",
});

let loaded: Promise<KitSourceCounts> | undefined;

/** Counts the sections' specimens and looks; loaded once, on the first page that asks. */
function loadSourceCounts(): Promise<KitSourceCounts> {
  loaded ??= Promise.all(
    Object.entries(sources).map(async ([path, load]) => [path, await load()] as const),
  ).then((texts) => {
    let specimens = 0;
    let looks = 0;
    const looksBySection = new Map<string, number>();
    for (const [path, text] of texts) {
      specimens += (text.match(/<(?:Specimen|CensusSpecimen|SpecimenMatrix)\b/gu) ?? []).length;
      const sectionLooks = (text.match(/<CensusLook\b/gu) ?? []).length;
      looks += sectionLooks;
      const section = sectionOfFile[path];
      if (section !== undefined) looksBySection.set(section.id, sectionLooks);
    }
    return { specimens, looks, looksBySection };
  });
  return loaded;
}

export function useKitSourceCounts(): KitSourceCounts | undefined {
  const [counts, setCounts] = useState<KitSourceCounts | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadSourceCounts().then((next) => {
      if (live) setCounts(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return counts;
}
