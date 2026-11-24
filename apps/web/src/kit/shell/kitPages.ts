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
  | { readonly kind: "census"; readonly at: string | undefined }
  | { readonly kind: "missing"; readonly page: string };

/** A component is a section the system offers; the home-made ones are the census's. */
export const isComponentSection = (section: KitSection) =>
  section.group !== "Home-made" && section.kind !== "Foundations";

export function resolveKitPage(
  page: string | undefined,
  sections: readonly KitSection[],
  flows: readonly KitShellFlow[],
): KitPageRef {
  if (page === undefined || page === "overview") return { kind: "overview" };
  if (page === "census") return { kind: "census", at: undefined };
  if (page.startsWith("census:")) return { kind: "census", at: page.slice("census:".length) };
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
  if (section === undefined) return { kind: "missing", page };
  if (section.group === "Home-made") return { kind: "census", at: section.id };
  if (section.kind === "Foundations") return { kind: "foundation", foundation: FOUNDATIONS[0] };
  return { kind: "component", section };
}

/** The same page, as the shell keys what it renders: a census anchor is still the census. */
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
    case "census":
      return "census";
    case "missing":
      return `missing:${ref.page}`;
  }
}

export const NAV_GROUPS = ["Overview", "Foundations", "Components", "Flows", "Census"] as const;
export type NavGroupName = (typeof NAV_GROUPS)[number];

/** One entry in the navigation: a page, a flow's state, or a census section's place. */
export interface NavEntry {
  /** Unique across the navigation; also the entry's DOM id's suffix. */
  readonly key: string;
  readonly group: NavGroupName;
  /** The heading it sits under inside its group: a component's kind, a flow's area. */
  readonly sub?: string;
  readonly label: string;
  /** Shown while searching, so a state found alone still says whose it is. */
  readonly context?: string;
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
  const components = sections.filter(isComponentSection);
  for (const kind of KIT_KINDS) {
    for (const section of components.filter((candidate) => candidate.kind === kind)) {
      entries.push({
        key: section.id,
        group: "Components",
        sub: kind satisfies KitKind,
        label: section.title,
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
  entries.push({
    key: "census",
    group: "Census",
    label: "All home-made looks",
    page: "census",
    depth: 0,
  });
  for (const section of sections.filter((candidate) => candidate.group === "Home-made")) {
    entries.push({
      key: `census:${section.id}`,
      group: "Census",
      label: section.title,
      page: `census:${section.id}`,
      depth: 0,
    });
  }
  entries.push({
    key: "census:not-shown",
    group: "Census",
    label: "Not shown",
    page: "census:not-shown",
    depth: 0,
  });
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

/** Where a query matches an entry's label, ignoring case; `null` when it does not. */
export function matchRange(label: string, query: string): readonly [number, number] | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return null;
  const at = label.toLowerCase().indexOf(needle);
  return at < 0 ? null : [at, at + needle.length];
}

/**
 * Every entry whose label holds the query, with a flow's states when the flow's name holds it and
 * a kind's components when the kind's name starts with it.
 */
export function searchNavEntries(entries: readonly NavEntry[], query: string): readonly NavEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries;
  return entries.filter(
    (entry) =>
      entry.label.toLowerCase().includes(needle) ||
      (entry.context?.toLowerCase().includes(needle) ?? false) ||
      (entry.sub?.toLowerCase().startsWith(needle) ?? false),
  );
}
