import { mateFeedReadsAtom } from "./mateFeedReads.ts";
import { mateActions } from "./projections/mateActions.ts";
/** Command bindings dispatch through the account executor and never reach a remote directly. */
import * as Effect from "effect/Effect";
import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import {
  createRuntimeCommand,
  type AtomCommandConcurrency,
  type AtomCommandScheduler,
} from "../state/runtime.ts";
import { MateActionUnavailable, type makeMateActions } from "./operations/executors/mateActions.ts";
import type { EnvironmentRpcInput } from "../rpc/client.ts";
import type { MateAction, MateActionInput } from "./operations/mateActions.ts";
export const mateActionsAtom = Atom.make<ReturnType<typeof makeMateActions> | null>(null).pipe(
  Atom.keepAlive,
);
export function mateActionCommand<R, E, A extends MateAction>(
  runtime: Atom.AtomRuntime<R, E>,
  action: A,
  options?: {
    readonly scheduler?: AtomCommandScheduler;
    readonly concurrency?: AtomCommandConcurrency<{
      readonly environmentId: EnvironmentId;
      readonly input: MateActionInput<A>;
    }>;
  },
) {
  return createRuntimeCommand(runtime, {
    label: `mate:${action}`,
    ...options,
    execute: (
      target: { readonly environmentId: EnvironmentId; readonly input: MateActionInput<A> },
      registry,
    ) =>
      Effect.gen(function* () {
        const owner = registry.get(mateActionsAtom);
        if (owner === null)
          return yield* Effect.fail(
            new MateActionUnavailable({ message: "The account is not ready." }),
          );
        return yield* owner.execute(action, target.environmentId, target.input);
      }),
  });
}
export function mateAuthCheckCommand<R, E>(runtime: Atom.AtomRuntime<R, E>) {
  return createRuntimeCommand(runtime, {
    label: "mate:agentAuth:check",
    execute: (
      target: {
        readonly environmentId: EnvironmentId;
        readonly input: EnvironmentRpcInput<typeof WS_METHODS.zeropsAgentAuthCheck>;
      },
      registry,
    ) =>
      Effect.gen(function* () {
        const owner = registry.get(mateActionsAtom);
        if (owner === null)
          return yield* Effect.fail(
            new MateActionUnavailable({ message: "The account is not ready." }),
          );
        return yield* owner.check(target.environmentId, target.input);
      }),
  });
}

export const mateActionsForEnvironmentAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const host = get(mateFeedReadsAtom);
    return host === null ? [] : get(host.data.project(mateActions, environmentId));
  }),
);
