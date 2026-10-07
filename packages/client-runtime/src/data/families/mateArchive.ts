/** Archived conversation shells: one owner read per connected Mate, retained by the account. */
import type { EnvironmentId, OrchestrationShellSnapshot } from "@t3tools/contracts";
import type { ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateArchive: OrchestrationShellSnapshot;
  }
}
export const mateArchiveFamily: FamilySpec<"mateArchive"> = {
  family: "mateArchive",
  authority: "mate",
  scope: { source: "mate", suffix: "archive", leaving: "removed", demand: "detail", mode: "once" },
};
export const archiveScope = (environmentId: EnvironmentId): ScopeKey =>
  `mate:${encodeURIComponent(environmentId)}:archive`;
