import type { VcsStatusResult } from "@t3tools/contracts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateVcs: VcsStatusResult;
  }
}
export const mateVcsFamily: FamilySpec<"mateVcs"> = {
  family: "mateVcs",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-vcs",
    leaving: "removed",
    demand: "detail",
    mode: "realtime",
  },
};
