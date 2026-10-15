import type { ReactNode } from "react";

/** Who made what a section shows: the shared kit, or a feature's own version of the same thing. */
export const KIT_GROUPS = ["Kit", "Home-made"] as const;
export type KitGroup = (typeof KIT_GROUPS)[number];

/** What a component is for; the index lists sections by it inside each group. */
export const KIT_KINDS = [
  "Actions",
  "Labels",
  "Containers",
  "Feedback",
  "Overlays",
  "Fields",
  "Data",
  "Navigation",
] as const;
export type KitKind = (typeof KIT_KINDS)[number];

/**
 * One section of the kit page. A file in `kit/sections/` default-exports one; the registry finds it
 * by itself, so adding a section touches only its own file.
 */
export interface KitSection {
  /** The anchor: unique, lowercase, `#id` on the page. */
  readonly id: string;
  readonly title: string;
  /** One line: what the component is for. */
  readonly purpose: string;
  readonly group: KitGroup;
  readonly kind: KitKind;
  /** The file the component lives in, repository-relative. */
  readonly source: string;
  readonly render: () => ReactNode;
}

export function defineKitSection(section: KitSection): KitSection {
  return section;
}

/** A component the page cannot show, and why; listed at the page's end. */
export interface KitOmission {
  readonly name: string;
  readonly source: string;
  readonly reason: string;
}
