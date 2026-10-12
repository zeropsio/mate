/** The Mac's live view, one slot per Mate: its state and the window it shows. */
import type { ZeropsMacViewState } from "../../zerops/macView.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface MateMacViewValue {
  readonly state: ZeropsMacViewState;
  /** A frame received in this source session, rather than retained from an earlier one. */
  readonly currentFrame: boolean;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateMacView: MateMacViewValue;
  }
}
export const mateMacViewFamily: FamilySpec<"mateMacView"> = {
  family: "mateMacView",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "mac-view",
    leaving: "removed",
    demand: "detail",
    mode: "realtime",
  },
};
export const mateMacViewScope = (environmentId: string) =>
  scopeOf(mateMacViewFamily, `mac-${environmentId}`);
export const mateMacViewId = (environmentId: string): string => JSON.stringify([environmentId]);
