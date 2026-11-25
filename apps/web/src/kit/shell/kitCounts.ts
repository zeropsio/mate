import { useEffect, useState } from "react";

/** What a guard keeps: the look of the app, its motion, or how it reads and says its data. */
export const KIT_GUARD_AREAS = ["The look", "Motion", "Data and words"] as const;
export type KitGuardArea = (typeof KIT_GUARD_AREAS)[number];

/**
 * Every guard the build runs over the web client whose exception ledger measures how far the app
 * still is from its rule: every entry is a place that breaks it, kept on purpose or still to fix.
 * Each says, in plain words, what it catches.
 */
export const KIT_GUARDS = [
  {
    rule: "no-raw-controls",
    area: "The look",
    name: "Raw controls",
    line: "A press, field or choice drawn from raw HTML instead of the kit",
  },
  {
    rule: "no-restyle",
    area: "The look",
    name: "Restyled kit components",
    line: "A kit component restyled with className instead of a variant",
  },
  {
    rule: "no-arbitrary-values",
    area: "The look",
    name: "Values off the scale",
    line: "A value off the scale, like p-[13px]",
  },
  {
    rule: "no-theme-escape-hatches",
    area: "The look",
    name: "Colours around the theme",
    line: "A colour or surface that bypasses the theme's tokens",
  },
  {
    rule: "no-unknown-classes",
    area: "The look",
    name: "Unknown classes",
    line: "A class Tailwind does not generate",
  },
  {
    rule: "require-static-classes",
    area: "The look",
    name: "Classes built at runtime",
    line: "A class name put together while the app runs, which no check can read",
  },
  {
    rule: "prefer-text",
    area: "The look",
    name: "Hand-styled words",
    line: "Words styled by hand instead of a Text role",
  },
  {
    rule: "prefer-failure",
    area: "The look",
    name: "Hand-said failures",
    line: "A failure said in red words by hand instead of Failure or Text's error",
  },
  {
    rule: "no-sized-slot-icon",
    area: "The look",
    name: "Icons sized by hand",
    line: "An icon given its own size inside a kit slot that sizes it",
  },
  {
    rule: "prefer-item-grounds",
    area: "The look",
    name: "Hand-lit rows",
    line: "A row's hover or picked ground drawn by hand instead of the item grounds",
  },
  {
    rule: "no-hand-drawn-box",
    area: "The look",
    name: "Hand-drawn boxes",
    line: "A box, a corner on a ground, drawn by hand instead of a Card",
  },
  {
    rule: "no-hand-drawn-rules",
    area: "The look",
    name: "Hand-drawn dividers",
    line: "A divider drawn by hand instead of a List or Separator",
  },
  {
    rule: "prefer-marks",
    area: "The look",
    name: "Hand-drawn marks",
    line: "A dot or a count drawn by hand instead of Dot or Badge",
  },
  {
    rule: "prefer-meter",
    area: "The look",
    name: "Hand-drawn quantities",
    line: "A bar or a swatch sized from data by hand instead of Meter or ShareBar",
  },
  {
    rule: "prefer-code-block",
    area: "The look",
    name: "Hand-set machine text",
    line: "Machine text in a raw <pre> instead of CodeBlock or LogView",
  },
  {
    rule: "no-hand-popup",
    area: "The look",
    name: "Hand-floated popups",
    line: "A popup floated by hand instead of Popover, Tooltip or Overlay",
  },
  {
    rule: "page-title-is-page-header",
    area: "The look",
    name: "Hand-made page titles",
    line: "A page's title as its own <h1> instead of PageHeader",
  },
  {
    rule: "no-infinite-motion",
    area: "Motion",
    name: "Endless motion",
    line: "An animation that never stops, kept only where it was reviewed",
  },
  {
    rule: "no-frame-per-tick",
    area: "Motion",
    name: "Frames spent at rest",
    line: "Something that asks for a frame on every tick while the page rests",
  },
  {
    rule: "reduced-motion-home",
    area: "Motion",
    name: "Reduced motion read by hand",
    line: "Whether the person asked for less motion, read anywhere but its one home",
  },
  {
    rule: "no-legacy-vocabulary",
    area: "Data and words",
    name: "Old words",
    line: "An old product word in something the person reads",
  },
  {
    rule: "no-failure-to-empty",
    area: "Data and words",
    name: "Failures shown as empty",
    line: "A fact that failed or was never read, shown as if there were none",
  },
  {
    rule: "web-never-derives",
    area: "Data and words",
    name: "Verdicts worked out here",
    line: "A status, grant or readiness the client works out instead of reading it",
  },
  {
    rule: "no-remote-io-outside-data-layer",
    area: "Data and words",
    name: "Stray network calls",
    line: "A fetch, socket or client call made anywhere but the data layer's adapters",
  },
  {
    rule: "no-remote-data-in-browser-storage",
    area: "Data and words",
    name: "Stored answers",
    line: "Data a source answered, kept in browser storage instead of memory",
  },
  {
    rule: "no-legacy-notice-policy",
    area: "Data and words",
    name: "Notice policy out of place",
    line: "When a notice shows, decided anywhere but its owner",
  },
  {
    rule: "protected-roots-render-only",
    area: "Data and words",
    name: "Protected roots that do more",
    line: "A protected root that reaches past rendering through what it imports",
  },
  {
    rule: "no-retired-mechanism",
    area: "Data and words",
    name: "Retired mechanisms",
    line: "A new use of a mechanism the data layer retired",
  },
] as const satisfies ReadonlyArray<{
  readonly rule: string;
  readonly area: KitGuardArea;
  readonly name: string;
  readonly line: string;
}>;

/** A ledger entry as far as the kit reads it: when it is due. */
interface LedgerEntry {
  readonly path: string;
  readonly expires?: string;
}

/** The kit is the web client's: a ledger's entries for other clients are not its to count. */
const WEB_CLIENT = "apps/web/";

// Every ledger, read at build by every build: they ride in the kit's own chunk, never the app's.
// `phases.json` is the data layer's migration record, not a guard's ledger.
const ledgers: Readonly<Record<string, readonly LedgerEntry[]>> = import.meta.glob<
  readonly LedgerEntry[]
>(
  [
    "../../../../../oxlint-plugin-t3code/exceptions/*.json",
    "!../../../../../oxlint-plugin-t3code/exceptions/phases.json",
  ],
  {
    eager: true,
    import: "default",
  },
);

/** A guard's ledger: the places still to fix, and those it keeps on purpose (`expires: "never"`). */
export interface KitGuardCount {
  readonly toFix: number;
  readonly kept: number;
}

/** Each guard's ledger, by rule. */
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

/**
 * A ledger with entries in the web client that `KIT_GUARDS` does not name yet: shown by its rule,
 * so a new guard is counted from its first landing.
 */
export const KIT_UNNAMED_GUARDS: readonly string[] = [...KIT_GUARD_COUNTS]
  .filter(
    ([rule, count]) =>
      count.toFix + count.kept > 0 && !KIT_GUARDS.some((guard) => guard.rule === rule),
  )
  .map(([rule]) => rule);

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
