import type { EnvironmentId, VcsStatusResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import type { ScopeKey } from "../model.ts";
import type { Projection } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";
export interface VcsKey {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly cwd: string };
}
export const vcsId = (key: VcsKey): string => JSON.stringify([key.environmentId, key.input.cwd]);
export const vcsScope = (key: VcsKey): ScopeKey =>
  `mate:${encodeURIComponent(key.environmentId)}:workspace-vcs:${encodeURIComponent(key.input.cwd)}`;
export const mateVcs: Projection<VcsKey, AsyncResult.AsyncResult<VcsStatusResult, StreamFault>> = {
  name: "mateVcs",
  keyOf: vcsId,
  derive: (read, key) => {
    const fact = read.fact("mateVcs", vcsId(key));
    const stream = read.stream(vcsScope(key));
    const waiting = ["idle", "connecting", "baselining"].includes(stream.phase);
    const previousSuccess =
      fact.kind === "known" ? Option.some(AsyncResult.success(fact.value)) : Option.none();
    if (stream.fault !== null) return AsyncResult.fail(stream.fault, { previousSuccess, waiting });
    return fact.kind === "known"
      ? AsyncResult.success(fact.value, { waiting })
      : AsyncResult.initial(waiting);
  },
  equals: sameValue,
};
