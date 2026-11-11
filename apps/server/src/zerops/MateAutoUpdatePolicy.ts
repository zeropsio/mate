import { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ServerConfig } from "../config.ts";

export interface AutoUpdatePolicyLink {
  readonly receive: (policy: Option.Option<HqAutoUpdatePolicy>) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export class MateAutoUpdatePolicy extends Context.Service<
  MateAutoUpdatePolicy,
  {
    /** The last policy heard from HQ, kept across links and restarts; none until one was heard. */
    readonly current: Effect.Effect<Option.Option<HqAutoUpdatePolicy>>;
    /**
     * HQ's fresh, correlated answer on the current link; with no link, or no answer within the
     * link's bound, the last policy heard, so work in the container goes on while HQ is down.
     */
    readonly verify: Effect.Effect<Option.Option<HqAutoUpdatePolicy>>;
    readonly changes: Stream.Stream<Option.Option<HqAutoUpdatePolicy>>;
    readonly open: (
      verify?: Effect.Effect<Option.Option<HqAutoUpdatePolicy>>,
    ) => Effect.Effect<AutoUpdatePolicyLink>;
  }
>()("t3/zerops/MateAutoUpdatePolicy") {}

/** Where the holder keeps the last policy it heard: what it held at boot, and how it keeps a newer one. */
export interface HeardAutoUpdatePolicy {
  readonly heard: Option.Option<HqAutoUpdatePolicy>;
  readonly keep: (policy: HqAutoUpdatePolicy) => Effect.Effect<void>;
}

const PolicyJson = Schema.fromJsonString(HqAutoUpdatePolicy);
const decodePolicy = Schema.decodeUnknownOption(PolicyJson);
const encodePolicy = Schema.encodeEffect(PolicyJson);

/**
 * The file at `at`, replaced whole in one rename. A missing or unreadable file holds nothing, so it
 * never grants; a write that fails is logged and leaves the last file as it was.
 */
export const makeHeardAutoUpdatePolicyFile = (at: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.dirname(at);
    const staged = path.join(directory, `.${path.basename(at)}.next`);
    const heard = yield* fs.readFileString(at).pipe(
      Effect.map(decodePolicy),
      Effect.orElseSucceed(() => Option.none<HqAutoUpdatePolicy>()),
    );
    let written = Option.getOrUndefined(heard);
    return {
      heard,
      keep: (policy) =>
        Effect.gen(function* () {
          if (
            written?.orgId === policy.orgId &&
            written.revision === policy.revision &&
            written.enabled === policy.enabled
          )
            return;
          const json = yield* encodePolicy(policy);
          yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
          yield* fs.writeFileString(staged, json, { mode: 0o600 });
          yield* fs.rename(staged, at);
          written = policy;
        }).pipe(
          Effect.onError(() => fs.remove(staged, { force: true }).pipe(Effect.ignore)),
          Effect.catch((error) =>
            Effect.logWarning("mate auto-update policy: the file was not written", {
              path: at,
              reason: error._tag,
            }),
          ),
        ),
    } satisfies HeardAutoUpdatePolicy;
  });

export const makeMateAutoUpdatePolicy = (kept: HeardAutoUpdatePolicy) =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.make(kept.heard);
    // One policy is published and kept at a time, so the file never falls behind `current`.
    const publishing = yield* Semaphore.make(1);
    let allocated = 0;
    let selected = 0;
    let newest = Option.getOrUndefined(kept.heard);
    const admit = (policy: Option.Option<HqAutoUpdatePolicy>): boolean => {
      if (Option.isNone(policy)) return false;
      if (
        newest?.orgId === policy.value.orgId &&
        (policy.value.revision < newest.revision ||
          (policy.value.revision === newest.revision && policy.value.enabled !== newest.enabled))
      ) {
        return false;
      }
      newest = policy.value;
      return true;
    };
    const publish = publishing.withPermits(1)(
      Effect.uninterruptible(
        Effect.suspend(() => {
          const latest = newest;
          return latest === undefined
            ? Effect.void
            : SubscriptionRef.set(current, Option.some(latest)).pipe(
                Effect.andThen(kept.keep(latest)),
              );
        }),
      ),
    );
    // No policy (an omitted one, no answer, no link) and an older one change nothing heard.
    const hear = (policy: Option.Option<HqAutoUpdatePolicy>) =>
      Effect.suspend(() => (admit(policy) ? publish : Effect.void));
    let verifySelected: Effect.Effect<Option.Option<HqAutoUpdatePolicy>> = Effect.succeedNone;
    return MateAutoUpdatePolicy.of({
      current: SubscriptionRef.get(current),
      verify: Effect.suspend(() => verifySelected).pipe(
        Effect.flatMap(hear),
        Effect.andThen(SubscriptionRef.get(current)),
      ),
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
                verifySelected = verify.pipe(
                  Effect.map((received) =>
                    closed || selected !== id ? Option.none<HqAutoUpdatePolicy>() : received,
                  ),
                );
                return hear(policy);
              }),
            close: Effect.sync(() => {
              closed = true;
              if (id === selected) verifySelected = Effect.succeedNone;
            }),
          };
        }),
    });
  });

/** The holder over `auto-update-policy.json` in the server's state directory. */
export const mateAutoUpdatePolicyLayer = Layer.effect(
  MateAutoUpdatePolicy,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return yield* makeMateAutoUpdatePolicy(
      yield* makeHeardAutoUpdatePolicyFile(path.join(config.stateDir, "auto-update-policy.json")),
    );
  }),
);
