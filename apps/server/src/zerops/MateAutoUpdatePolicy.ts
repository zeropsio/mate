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
  /**
   * The policy this link's HQ states for the Mate, in the order the link heard it: a state frame's
   * (none: HQ states no policy for it) and each answer to the link's ask.
   */
  readonly receive: (policy: Option.Option<HqAutoUpdatePolicy>) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export class MateAutoUpdatePolicy extends Context.Service<
  MateAutoUpdatePolicy,
  {
    /**
     * The policy the current link's HQ stated last; before a link stated one, the one kept from an
     * earlier run against the same HQ; none when there is neither.
     */
    readonly current: Effect.Effect<Option.Option<HqAutoUpdatePolicy>>;
    /**
     * HQ's fresh, correlated answer on the current link; with no link, or no answer within the
     * link's bound, the current policy, so work in the container goes on while HQ is down.
     */
    readonly verify: Effect.Effect<Option.Option<HqAutoUpdatePolicy>>;
    readonly changes: Stream.Stream<Option.Option<HqAutoUpdatePolicy>>;
    /**
     * A link to HQ; `ask` asks its HQ for the policy and waits, bounded, for the answer, which the
     * link hands to `receive` before `ask` ends.
     */
    readonly open: (ask?: Effect.Effect<void>) => Effect.Effect<AutoUpdatePolicyLink>;
  }
>()("t3/zerops/MateAutoUpdatePolicy") {}

/** Where the holder keeps the last policy it heard: what it held at boot, and how it keeps the next. */
export interface HeardAutoUpdatePolicy {
  readonly heard: Option.Option<HqAutoUpdatePolicy>;
  /** None: the HQ states no policy, and nothing stays kept. */
  readonly keep: (policy: Option.Option<HqAutoUpdatePolicy>) => Effect.Effect<void>;
}

/** The kept policy and the HQ that stated it: revisions and organizations are that HQ's. */
const KeptAutoUpdatePolicy = Schema.Struct({ hqOrigin: Schema.String, policy: HqAutoUpdatePolicy });
const KeptJson = Schema.fromJsonString(KeptAutoUpdatePolicy);
const decodeKept = Schema.decodeUnknownOption(KeptJson);
const encodeKept = Schema.encodeEffect(KeptJson);

const samePolicy = (
  left: Option.Option<HqAutoUpdatePolicy>,
  right: Option.Option<HqAutoUpdatePolicy>,
) =>
  Option.isNone(left)
    ? Option.isNone(right)
    : Option.isSome(right) &&
      left.value.orgId === right.value.orgId &&
      left.value.revision === right.value.revision &&
      left.value.enabled === right.value.enabled;

/**
 * The file at `at`, replaced whole in one rename, for the HQ at `hqOrigin`. A missing or unreadable
 * file, or one another HQ stated, holds nothing, so it never grants; a write that fails is logged
 * and leaves the last file as it was.
 */
export const makeHeardAutoUpdatePolicyFile = (at: string, hqOrigin: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.dirname(at);
    const staged = path.join(directory, `.${path.basename(at)}.next`);
    const heard = yield* fs.readFileString(at).pipe(
      Effect.map((text) =>
        decodeKept(text).pipe(
          Option.filter((kept) => kept.hqOrigin === hqOrigin),
          Option.map((kept) => kept.policy),
        ),
      ),
      Effect.orElseSucceed(() => Option.none<HqAutoUpdatePolicy>()),
    );
    let written = heard;
    return {
      heard,
      keep: (policy) =>
        Effect.gen(function* () {
          if (samePolicy(written, policy)) return;
          if (Option.isNone(policy)) {
            yield* fs.remove(at, { force: true });
          } else {
            const json = yield* encodeKept({ hqOrigin, policy: policy.value });
            yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
            yield* fs.writeFileString(staged, json, { mode: 0o600 });
            yield* fs.rename(staged, at);
          }
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

/** Nothing kept and nothing to keep: a server with no HQ hears no policy. */
const nothingKept: HeardAutoUpdatePolicy = { heard: Option.none(), keep: () => Effect.void };

/**
 * The current link's word replaces the policy whatever its revision: revisions are counted per HQ
 * database, and a deleted policy row reads as revision 0. Only an older link is not heard.
 */
export const makeMateAutoUpdatePolicy = (kept: HeardAutoUpdatePolicy) =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.make(kept.heard);
    // One policy is published and kept at a time, so the file never falls behind `current`.
    const publishing = yield* Semaphore.make(1);
    let allocated = 0;
    let selected = 0;
    let latest = kept.heard;
    const publish = publishing.withPermits(1)(
      Effect.uninterruptible(
        Effect.suspend(() => {
          const heard = latest;
          return SubscriptionRef.set(current, heard).pipe(Effect.andThen(kept.keep(heard)));
        }),
      ),
    );
    let askSelected: Effect.Effect<void> = Effect.void;
    return MateAutoUpdatePolicy.of({
      current: SubscriptionRef.get(current),
      verify: Effect.suspend(() => askSelected).pipe(Effect.andThen(SubscriptionRef.get(current))),
      changes: SubscriptionRef.changes(current),
      open: (ask = Effect.void) =>
        Effect.sync(() => {
          const id = ++allocated;
          let closed = false;
          return {
            receive: (policy) =>
              Effect.suspend(() => {
                if (closed || id < selected) return Effect.void;
                selected = id;
                askSelected = ask;
                latest = policy;
                return publish;
              }),
            close: Effect.sync(() => {
              closed = true;
              if (id === selected) askSelected = Effect.void;
            }),
          };
        }),
    });
  });

/** The holder over `auto-update-policy.json` in the server's state directory, for its one HQ. */
export const mateAutoUpdatePolicyLayer = Layer.effect(
  MateAutoUpdatePolicy,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return yield* makeMateAutoUpdatePolicy(
      config.zerops === undefined
        ? nothingKept
        : yield* makeHeardAutoUpdatePolicyFile(
            path.join(config.stateDir, "auto-update-policy.json"),
            config.zerops.hqOrigin,
          ),
    );
  }),
);
