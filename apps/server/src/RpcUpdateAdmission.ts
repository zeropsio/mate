import { EnvironmentAuthorizationError, WS_METHODS } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { requiredScopeForRpcMethod } from "./auth/RpcAuthorization.ts";

export type RpcAdmit = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  updateContinuation?: boolean,
) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;

export const makeRpcUpdateAdmission = Effect.fnUntraced(function* () {
  let closed = false;
  let active = 0;
  const changes = yield* PubSub.sliding<void>(1);
  const changed = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  return {
    begin: Effect.sync(() => {
      closed = true;
    }).pipe(Effect.andThen(changed)),
    cancel: Effect.sync(() => {
      closed = false;
    }).pipe(Effect.andThen(changed)),
    facts: Effect.sync(() => ({
      idle: active === 0,
      blockers: active === 0 ? [] : ["accepted client operation"],
    })),
    changes: Stream.fromPubSub(changes),
    subscribeChanges: PubSub.subscribe(changes).pipe(
      Effect.map((subscription) => ({ changes: Stream.fromSubscription(subscription) })),
    ),
    run: <A, E, R, F>(
      effect: Effect.Effect<A, E, R>,
      refused: F,
      continuation: boolean,
    ): Effect.Effect<A, E | F, R> =>
      Effect.suspend<A, E | F, R>(() => {
        if (closed && !continuation) return Effect.fail(refused);
        active++;
        return effect.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              active--;
            }).pipe(Effect.andThen(changed)),
          ),
        );
      }),
  };
});
export class RpcUpdateAdmission extends Context.Service<
  RpcUpdateAdmission,
  Effect.Success<ReturnType<typeof makeRpcUpdateAdmission>>
>()("t3/RpcUpdateAdmission") {}
export const rpcUpdateAdmissionLayer = Layer.effect(RpcUpdateAdmission, makeRpcUpdateAdmission());

// While a Mate update waits, a call that changes something is refused, unless it continues
// work already accepted; the update starts once nothing admitted is running.
export const rpcAdmitOf =
  (updateAdmission: RpcUpdateAdmission["Service"] | undefined): RpcAdmit =>
  <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
    updateContinuation = false,
  ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> =>
    updateAdmission === undefined || requiredScopeForRpcMethod(method).endsWith(":read")
      ? effect
      : updateAdmission.run(
          effect,
          new EnvironmentAuthorizationError({
            message: "Update ready; waiting for your work to finish. Try again after the update.",
            requiredScope: requiredScopeForRpcMethod(method),
          }),
          updateContinuation ||
            [
              WS_METHODS.providerInstallCancel,
              WS_METHODS.providerAuthSubscribe,
              WS_METHODS.engineAnswer,
              WS_METHODS.engineDismiss,
              WS_METHODS.engineStop,
              WS_METHODS.terminalWrite,
              WS_METHODS.terminalClose,
              WS_METHODS.providerAuthComplete,
              WS_METHODS.providerAuthRespond,
              WS_METHODS.providerAuthCancel,
              WS_METHODS.zeropsAgentLoginCancel,
              WS_METHODS.zeropsAgentLoginSubmitCode,
            ].some((candidate) => candidate === method),
        );
