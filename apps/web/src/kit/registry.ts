import { KIT_GROUPS, KIT_KINDS, type KitSection } from "./kitSection";

/** Ordered by group, then kind, then title: the order the index and the page show them in. */
export function orderKitSections(sections: readonly KitSection[]): readonly KitSection[] {
  return sections.toSorted(
    (a, b) =>
      KIT_GROUPS.indexOf(a.group) - KIT_GROUPS.indexOf(b.group) ||
      KIT_KINDS.indexOf(a.kind) - KIT_KINDS.indexOf(b.kind) ||
      a.title.localeCompare(b.title),
  );
}

// Every file in `sections/` is a section: dropping one in is the whole registration.
const modules = import.meta.glob<{ default: KitSection }>("./sections/*.tsx", { eager: true });

export const KIT_SECTIONS: readonly KitSection[] = orderKitSections(
  Object.values(modules).map((module) => module.default),
);
