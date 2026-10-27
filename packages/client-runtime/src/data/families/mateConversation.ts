/** Conversation snapshots and replay cursors belong to this account, never another cache. */
import type { EnvironmentShellState } from "../adapters/mateShellReplay.ts";
import type { FamilySpec } from "./spec.ts";
export interface MateShellValue {
  readonly state: EnvironmentShellState;
}
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateShell: MateShellValue;
  }
}
export const mateShellFamily: FamilySpec<"mateShell"> = {
  family: "mateShell",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "conversation-shell",
    demand: "detail",
    leaving: "removed",
    mode: "realtime",
  },
};
