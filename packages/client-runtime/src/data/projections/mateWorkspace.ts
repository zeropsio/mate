/** Workspace surfaces consume retained owner answers and the read's coverage separately. */
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import {
  WORKSPACE_READS,
  workspaceId,
  workspaceScope,
  type WorkspaceRead,
  type WorkspaceTarget,
  type WorkspaceValue,
} from "../families/mateWorkspace.ts";
import type { Projection } from "../store.ts";
import type { Coverage, PublicRead } from "../model.ts";
import type { StreamFault, StreamState } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";

export interface WorkspaceReading<A> {
  readonly fact: PublicRead<A>;
  readonly stream: StreamState;
  readonly result: AsyncResult.AsyncResult<A, StreamFault>;
  readonly coverage: Coverage;
  readonly refused: boolean;
}
export function workspaceReading<K extends WorkspaceRead>(
  kind: K,
): Projection<WorkspaceTarget<K>, WorkspaceReading<WorkspaceValue<K>>> {
  return {
    name: WORKSPACE_READS[kind].family,
    keyOf: workspaceId,
    derive: (read, target) => {
      const scope = workspaceScope(kind, target);
      const stream = read.stream(scope);
      const fact = read.fact(WORKSPACE_READS[kind].family, workspaceId(target));
      const expired =
        kind === "assetUrl" &&
        fact.kind === "known" &&
        typeof fact.value === "object" &&
        fact.value !== null &&
        "expired" in fact.value &&
        fact.value.expired === true;
      const value =
        fact.kind === "known" && !expired ? (fact.value as WorkspaceValue<K>) : undefined;
      const waiting =
        ["idle", "connecting", "baselining"].includes(stream.phase) ||
        (kind === "assetUrl" && ["recovering", "reauthenticating", "stale"].includes(stream.phase));
      const previousSuccess =
        value === undefined ? Option.none() : Option.some(AsyncResult.success(value));
      const result =
        stream.fault !== null
          ? AsyncResult.fail<StreamFault, WorkspaceValue<K>>(stream.fault, {
              previousSuccess,
              waiting,
            })
          : value === undefined
            ? AsyncResult.initial<WorkspaceValue<K>, StreamFault>(waiting)
            : AsyncResult.success<WorkspaceValue<K>, StreamFault>(value, { waiting });
      return {
        fact: fact as PublicRead<WorkspaceValue<K>>,
        stream,
        result,
        coverage: read.coverage(scope),
        refused: stream.phase === "refused",
      };
    },
    equals: sameValue,
  };
}
