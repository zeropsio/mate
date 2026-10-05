/**
 * Where HQ places a project: in an application as one of its kinds, or a Mate in none. Leaving
 * HQ's navigation scope unplaces it; it deletes nothing.
 *
 * @module data/families/placement
 */
import { scopeOf, type FamilySpec } from "./spec.ts";

export type PlacementValue =
  | {
      readonly kind: "app";
      readonly appId: string;
      readonly appName: string;
      readonly role: string;
    }
  | { readonly kind: "outside" };

declare module "../model.ts" {
  interface FamilyValues {
    readonly placement: PlacementValue;
  }
}

export const placementFamily: FamilySpec<"placement"> = {
  family: "placement",
  authority: "hq",
  scope: { source: "hq", suffix: "navigation", leaving: "removed" },
  /** Project ids by the application HQ places them in, while navigation lists them. */
  index: {
    name: "apps",
    keyOf: (value, listed) => (value.kind === "app" && listed === "member" ? value.appId : null),
  },
};

export const navigationScope = (orgId: string) => scopeOf(placementFamily, orgId);
