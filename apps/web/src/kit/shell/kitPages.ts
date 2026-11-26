import type { KitFlow } from "../kitFlows";
import { KIT_KINDS, type KitKind, type KitSection } from "../kitSection";

/** A flow as the shell reads it: its states and area, once the flow carries them. */
export type KitShellFlow = KitFlow & {
  readonly states?: readonly {
    readonly id: string;
    readonly label: string;
    readonly search: string;
  }[];
  readonly area?: string;
};

export const FOUNDATIONS = [
  { id: "colour", title: "Colour", line: "Theme roles and status tones, light and dark" },
  { id: "type", title: "Type", line: "Five steps, from caption to display" },
  { id: "spacing", title: "Spacing", line: "One 4 px grid" },
  { id: "radius", title: "Radius", line: "Control inside card inside sheet" },
  { id: "motion", title: "Motion", line: "Three durations, two curves" },
] as const;
export type FoundationId = (typeof FOUNDATIONS)[number]["id"];

/** What `?page=` names, resolved against the kit's sections and flows. */
export type KitPageRef =
  | { readonly kind: "overview" }
  | { readonly kind: "foundation"; readonly foundation: (typeof FOUNDATIONS)[number] }
  | { readonly kind: "component"; readonly section: KitSection }
  | { readonly kind: "flow"; readonly flow: KitShellFlow }
  | { readonly kind: "missing"; readonly page: string };

export function resolveKitPage(
  page: string | undefined,
  sections: readonly KitSection[],
  flows: readonly KitShellFlow[],
): KitPageRef {
  if (page === undefined || page === "overview") return { kind: "overview" };
  if (page.startsWith("foundations:")) {
    const foundation = FOUNDATIONS.find(({ id }) => `foundations:${id}` === page);
    return foundation === undefined
      ? { kind: "missing", page }
      : { kind: "foundation", foundation };
  }
  if (page.startsWith("flow:")) {
    const flow = flows.find(({ id }) => `flow:${id}` === page);
    return flow === undefined ? { kind: "missing", page } : { kind: "flow", flow };
  }
  const section = sections.find(({ id }) => id === page);
  return section === undefined ? { kind: "missing", page } : { kind: "component", section };
}

/** The page as the shell keys what it renders. */
export function kitPageKey(ref: KitPageRef): string {
  switch (ref.kind) {
    case "overview":
      return "overview";
    case "foundation":
      return `foundations:${ref.foundation.id}`;
    case "component":
      return ref.section.id;
    case "flow":
      return `flow:${ref.flow.id}`;
    case "missing":
      return `missing:${ref.page}`;
  }
}

export const NAV_GROUPS = ["Overview", "Foundations", "Components", "Flows"] as const;
export type NavGroupName = (typeof NAV_GROUPS)[number];

/** One entry in the navigation: a page, or a flow's state. */
export interface NavEntry {
  /** Unique across the navigation; also the entry's DOM id's suffix. */
  readonly key: string;
  readonly group: NavGroupName;
  /** The heading it sits under inside its group: a component's kind, a flow's area. */
  readonly sub?: string;
  readonly label: string;
  /** Shown while searching, so a state found alone still says whose it is. */
  readonly context?: string;
  /** A component's job in one line, which the search reads as well as its name. */
  readonly purpose?: string;
  /** A component's file, repository-relative: where the search reads its doc comments. */
  readonly source?: string;
  readonly page: string;
  readonly state?: string;
  /** A flow's state sits under its flow. */
  readonly depth: 0 | 1;
}

export function kitNavEntries(
  sections: readonly KitSection[],
  flows: readonly KitShellFlow[],
): readonly NavEntry[] {
  const entries: NavEntry[] = [
    { key: "overview", group: "Overview", label: "Overview", page: "overview", depth: 0 },
  ];
  for (const foundation of FOUNDATIONS) {
    entries.push({
      key: `foundations:${foundation.id}`,
      group: "Foundations",
      label: foundation.title,
      page: `foundations:${foundation.id}`,
      depth: 0,
    });
  }
  for (const kind of KIT_KINDS) {
    for (const section of sections.filter((candidate) => candidate.kind === kind)) {
      entries.push({
        key: section.id,
        group: "Components",
        sub: kind satisfies KitKind,
        label: section.title,
        purpose: section.purpose,
        source: section.source,
        page: section.id,
        depth: 0,
      });
    }
  }
  const byArea = flows.toSorted(
    (left, right) =>
      (left.area ?? "").localeCompare(right.area ?? "") || left.title.localeCompare(right.title),
  );
  for (const flow of byArea) {
    entries.push({
      key: `flow:${flow.id}`,
      group: "Flows",
      ...(flow.area === undefined ? {} : { sub: flow.area }),
      label: flow.title,
      page: `flow:${flow.id}`,
      depth: 0,
    });
    for (const state of flow.states ?? []) {
      entries.push({
        key: `flow:${flow.id}:${state.id}`,
        group: "Flows",
        ...(flow.area === undefined ? {} : { sub: flow.area }),
        label: state.label,
        context: flow.title,
        page: `flow:${flow.id}`,
        state: state.id,
        depth: 1,
      });
    }
  }
  return entries;
}

/** Whether the entry stands for the page (and state) the shell shows. */
export function isNavEntryActive(
  entry: NavEntry,
  page: string | undefined,
  state: string | undefined,
): boolean {
  const shown = page ?? "overview";
  if (entry.page !== shown) return false;
  return entry.state === state;
}

/**
 * Words a person adds around what they look for ("a divider", "something to copy a command"): the
 * search reads past them.
 */
const FILLER = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "with",
  "my",
  "some",
  "something",
  "thing",
  "that",
  "this",
  "is",
  "it",
  "i",
  "need",
  "want",
  "show",
]);

/** The words a query looks for: lowercase, filler dropped, a plural read as its singular. */
export function queryWords(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && !FILLER.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

/** Words of a text, each once, lowercase. */
export function textWords(text: string): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== ""),
  );
}

/**
 * Whether a looked-for word is among a text's words: one that starts with it ("divider" finds
 * "dividers"), or one it grows from ("copyable" finds "copy").
 */
const holds = (words: ReadonlySet<string>, wanted: string) => {
  if (words.has(wanted)) return true;
  for (const word of words) {
    if (word.startsWith(wanted) || (word.length >= 4 && wanted.startsWith(word))) return true;
  }
  return false;
};

/** Where a query matches an entry's label, ignoring case; `null` when it does not. */
export function matchRange(label: string, query: string): readonly [number, number] | null {
  const lower = label.toLowerCase();
  for (const needle of [query.trim().toLowerCase(), ...queryWords(query)]) {
    if (needle === "") continue;
    const at = lower.indexOf(needle);
    if (at >= 0) return [at, at + needle.length];
  }
  return null;
}

/**
 * How well an entry answers a query, best first: its name holds the query (or a flow's name, or
 * a kind's name starts with it) `0`; every word looked for is in its name or its one-line job `1`;
 * every word is there or in its doc words (`docs`, read from its source and its kit page) `2`;
 * `null` when it does not answer.
 */
function rankEntry(entry: NavEntry, query: string, docs: string | undefined): number | null {
  const needle = query.trim().toLowerCase();
  if (
    entry.label.toLowerCase().includes(needle) ||
    (entry.context?.toLowerCase().includes(needle) ?? false) ||
    (entry.sub?.toLowerCase().startsWith(needle) ?? false)
  )
    return 0;
  const wanted = queryWords(query);
  if (wanted.length === 0) return null;
  const named = textWords(`${entry.label} ${entry.context ?? ""}`);
  if (wanted.every((word) => holds(named, word))) return 0;
  const job = textWords(`${entry.label} ${entry.purpose ?? ""}`);
  if (wanted.every((word) => holds(job, word))) return 1;
  if (docs === undefined) return null;
  const all = textWords(`${entry.label} ${entry.purpose ?? ""} ${docs}`);
  return wanted.every((word) => holds(all, word)) ? 2 : null;
}

/**
 * Every entry that answers the query, by its name, its job or its doc words (`docs`, by entry key,
 * once loaded), each group's best answers first; a flow's states come with the flow's name.
 */
export function searchNavEntries(
  entries: readonly NavEntry[],
  query: string,
  docs?: ReadonlyMap<string, string>,
): readonly NavEntry[] {
  if (query.trim() === "") return entries;
  const ranked: Array<{ entry: NavEntry; rank: number; at: number }> = [];
  entries.forEach((entry, at) => {
    const rank = rankEntry(entry, query, docs?.get(entry.key));
    if (rank !== null) ranked.push({ entry, rank, at });
  });
  const groupOf = (entry: NavEntry) => NAV_GROUPS.indexOf(entry.group);
  return ranked
    .toSorted(
      (left, right) =>
        groupOf(left.entry) - groupOf(right.entry) ||
        // A flow keeps its states under it and its area's order; components rank by answer.
        (left.entry.group === "Components" ? left.rank - right.rank : 0) ||
        left.at - right.at,
    )
    .map(({ entry }) => entry);
}
