import type { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export interface AutoUpdatePolicyLink {
  readonly receive: (policy: Option.Option<HqAutoUpdatePolicy>) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export class MateAutoUpdatePolicy extends Context.Service<
  MateAutoUpdatePolicy,
  {
    /** Permission exists only while an authenticated HQ link supplies it. */
    readonly current: Effect.Effect<Option.Option<HqAutoUpdatePolicy>>;
    /** A correlated answer from the current authenticated HQ link, never a remembered allow. */
    readonly verify: Effect.Effect<Option.Option<HqAutoUpdatePolicy>>;
    readonly changes: Stream.Stream<Option.Option<HqAutoUpdatePolicy>>;
    readonly open: (
      verify?: Effect.Effect<Option.Option<HqAutoUpdatePolicy>>,
    ) => Effect.Effect<AutoUpdatePolicyLink>;
  }
>()("t3/zerops/MateAutoUpdatePolicy") {}

export const makeMateAutoUpdatePolicy = Effect.gen(function* () {
  const current = yield* SubscriptionRef.make<Option.Option<HqAutoUpdatePolicy>>(Option.none());
  let allocated = 0;
  let selected = 0;
  let newest: HqAutoUpdatePolicy | undefined;
  const admit = (policy: Option.Option<HqAutoUpdatePolicy>): Option.Option<HqAutoUpdatePolicy> => {
    if (Option.isNone(policy)) return policy;
    if (
      newest?.orgId === policy.value.orgId &&
      (policy.value.revision < newest.revision ||
        (policy.value.revision === newest.revision && policy.value.enabled !== newest.enabled))
    ) {
      return Option.none();
    }
    newest = policy.value;
    return policy;
  };
  let verifySelected: Effect.Effect<Option.Option<HqAutoUpdatePolicy>> = Effect.succeedNone;
  return MateAutoUpdatePolicy.of({
    current: SubscriptionRef.get(current),
    verify: Effect.suspend(() => verifySelected),
    changes: SubscriptionRef.changes(current),
    open: (verify = Effect.succeedNone) =>
      Effect.sync(() => {
        const id = ++allocated;
        let closed = false;
        return {
          receive: (policy) =>
            Effect.suspend(() => {
              if (closed || id < selected) return Effect.void;
              selected = id;
              verifySelected = Effect.gen(function* () {
                const received = yield* verify;
                if (closed || selected !== id) return Option.none<HqAutoUpdatePolicy>();
                const answer = admit(received);
                yield* SubscriptionRef.set(current, answer);
                return answer;
              });
              return SubscriptionRef.set(current, admit(policy));
            }),
          close: Effect.suspend(() => {
            closed = true;
            if (id === selected) verifySelected = Effect.succeedNone;
            return id === selected ? SubscriptionRef.set(current, Option.none()) : Effect.void;
          }),
        };
      }),
  });
});

export const mateAutoUpdatePolicyLayer = Layer.effect(
  MateAutoUpdatePolicy,
  makeMateAutoUpdatePolicy,
);
