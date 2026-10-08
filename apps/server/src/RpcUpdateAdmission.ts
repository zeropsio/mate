import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { mateUpdateBootPending } from "./mateUpdateBoot.ts";

export const makeRpcUpdateAdmission = Effect.gen(function* () {
  let closed = mateUpdateBootPending();
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
  Effect.Success<typeof makeRpcUpdateAdmission>
>()("t3/RpcUpdateAdmission") {}
export const rpcUpdateAdmissionLayer = Layer.effect(RpcUpdateAdmission, makeRpcUpdateAdmission);
