import { useEffect, useState } from "react";

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

/** A ledger entry as far as the kit reads it: when it is due. */
interface LedgerEntry {
  readonly path: string;
  readonly expires?: string;
}

/** The kit is the web client's: a ledger's entries for other clients are not its to count. */
const WEB_CLIENT = "apps/web/";

// The ledgers are read at build, and only where the build carries the design harness: production's
// kit counts none and bundles none.
const ledgers: Readonly<Record<string, readonly LedgerEntry[]>> =
  import.meta.env.VITE_DESIGN_HARNESS === ""
    ? {}
    : import.meta.glob<readonly LedgerEntry[]>(
        "../../../../../oxlint-plugin-t3code/exceptions/{no-raw-controls,no-restyle,no-arbitrary-values,no-theme-escape-hatches,no-unknown-classes}.json",
        { eager: true, import: "default" },
      );

/** A guard's ledger: the places still to fix, and those it keeps on purpose (`expires: "never"`). */
export interface KitGuardCount {
  readonly toFix: number;
  readonly kept: number;
}

/** Each guard's ledger, by rule; absent when this build does not carry the ledgers. */
export const KIT_GUARD_COUNTS: ReadonlyMap<string, KitGuardCount> = new Map(
  Object.entries(ledgers).map(([path, all]) => {
    const entries = all.filter((entry) => entry.path.startsWith(WEB_CLIENT));
    const kept = entries.filter((entry) => entry.expires === "never").length;
    return [
      path.slice(path.lastIndexOf("/") + 1, -".json".length),
      { toFix: entries.length - kept, kept },
    ];
  }),
);

/** What the sections' sources draw, counted from their text. */
export interface KitSourceCounts {
  /** Specimens across every section: each `Specimen` and matrix. */
  readonly specimens: number;
}

const sources = import.meta.glob<string>("../sections/*.tsx", { query: "?raw", import: "default" });

let loaded: Promise<KitSourceCounts> | undefined;

/** Counts the sections' specimens; loaded once, on the first page that asks. */
function loadSourceCounts(): Promise<KitSourceCounts> {
  loaded ??= Promise.all(Object.values(sources).map((load) => load())).then((texts) => ({
    specimens: texts.reduce(
      (total, text) => total + (text.match(/<(?:Specimen|SpecimenMatrix)\b/gu) ?? []).length,
      0,
    ),
  }));
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
