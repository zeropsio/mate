import type { MateSetup } from "../../zerops/mateSetup.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type MateSetupValue =
  | { readonly kind: "setup"; readonly setup: MateSetup }
  | { readonly kind: "absent" };
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateSetup: MateSetupValue;
  }
}
export const mateSetupFamily: FamilySpec<"mateSetup"> = {
  family: "mateSetup",
  authority: "mate",
  scope: { source: "mate", suffix: "setup", leaving: "removed", demand: "detail", mode: "sampled" },
};
export const mateSetupOwner = (orgId: string, origin: string) =>
  encodeURIComponent(JSON.stringify([orgId, origin]));
export const mateSetupScope = (ownerId: string) => scopeOf(mateSetupFamily, ownerId);

/** Sampling may stop only after the source says the setup steps settled. */
export function mateSetupSettled(setup: MateSetup): boolean {
  return (
    (setup.git === undefined || setup.git === "done") &&
    (setup.runtimes === "none" ||
      setup.runtimes === "done" ||
      setup.runtimes === "failed" ||
      setup.runtimes === "unknown") &&
    (setup.standup === "none" || setup.standup === "done" || setup.standup === "failed")
  );
}
