import type { ZeropsMacViewState } from "../../zerops/macView.ts";
import { mateMacViewId, mateMacViewScope } from "../families/mateMacView.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

/**
 * The Mac tab's view: `undefined` before the Mate answers, `"unavailable"` where it cannot show a
 * Mac (an older Mate, or a viewer not allowed to watch), else the state with the window while live.
 */
export const mateMacView: Projection<string, ZeropsMacViewState | "unavailable" | undefined> = {
  name: "mateMacView",
  keyOf: (environmentId) => environmentId,
  derive: (read, environmentId) => {
    const stream = read.stream(mateMacViewScope(environmentId));
    if (stream.phase === "refused" || stream.phase === "unsupported") return "unavailable";
    const fact = read.fact("mateMacView", mateMacViewId(environmentId));
    if (fact.kind !== "known") return undefined;
    const { frame: _frame, ...state } = fact.value.state;
    // While the Mate's own socket is down, nothing it said is current: the view is connecting.
    if (stream.phase !== "live") return { ...state, status: "connecting", inUse: false };
    if (!fact.value.currentFrame || state.status !== "live") return state;
    return fact.value.state;
  },
  equals: sameValue,
};
