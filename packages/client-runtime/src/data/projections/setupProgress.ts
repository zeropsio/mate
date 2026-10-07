import type { MateSetup, MateSetupFailure } from "../../zerops/mateSetup.ts";
import { mateSetupScope } from "../families/mateSetup.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface SetupProgress {
  readonly setup: MateSetup | undefined;
  readonly failure: MateSetupFailure | undefined;
}
export const NO_SETUP_PROGRESS: SetupProgress = { setup: undefined, failure: undefined };
export const setupProgress: Projection<string, SetupProgress> = {
  name: "setupProgress",
  keyOf: (ownerId) => ownerId,
  equals: sameValue,
  derive: (read, ownerId) => {
    const fact = read.fact("mateSetup", ownerId);
    const stream = read.stream(mateSetupScope(ownerId));
    return {
      setup: fact.kind === "known" && fact.value.kind === "setup" ? fact.value.setup : undefined,
      failure:
        stream.phase === "refused"
          ? read.stream(`mate:${ownerId}`).fault?.code === "invalid"
            ? "invalid"
            : "refused"
          : undefined,
    };
  },
};
