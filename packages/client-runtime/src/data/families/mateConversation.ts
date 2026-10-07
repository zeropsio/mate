/** Conversation snapshots and replay cursors belong to this account, never another cache. */
import type { EnvironmentShellState } from "../adapters/mateShellReplay.ts";
import type { EnvironmentThreadState } from "../../state/threadState.ts";
import type { ThreadResumeSnapshot } from "../adapters/mateThreadReplay.ts";
import type { FamilySpec } from "./spec.ts";
export interface MateShellValue {
  readonly state: EnvironmentShellState;
}
export interface MateThreadValue {
  readonly state: EnvironmentThreadState;
  readonly resume?: ThreadResumeSnapshot;
}
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateShell: MateShellValue;
    readonly mateThread: MateThreadValue;
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
export const mateThreadFamily: FamilySpec<"mateThread"> = {
  family: "mateThread",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "conversation-thread",
    demand: "detail",
    leaving: "removed",
    mode: "realtime",
  },
};
