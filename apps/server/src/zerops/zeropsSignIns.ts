/**
 * Who signed each login in last, as this server knows it: the one record of whose a login is.
 *
 * The turn gate (`ZeropsProjectSigners`), the logins' rows and the Mate's overview to its HQ all
 * go by it. Two writers: the person this server watched sign a login in — the subject of the door
 * session that started it — and HQ, which keeps each login's last signer the Mate reported
 * (`lastSignedInBy`) and sends the map on the link (`signers`) after every `hello` and again when
 * an HQ write moves it. That is how whose a login is outlives a restart, or a container that
 * boots with nothing: the server keeps no file of who may act.
 *
 * A sign-in watched here is kept with when it happened, by this server's clock (`signedAt`), in the
 * server's state directory (`sign-ins.json`, `{ [key]: { by, at } }`), because HQ's map names no
 * time and the Mate restarts on every update. The time is reported only while the login's signer is
 * the one that file names; a signer HQ's map fills in for another person has none. The Mate reports
 * that time to HQ (`lastSignedInAt`): a new one is a sign-in, which moves the Mate's owner in HQ.
 *
 * When the credential goes, its entry becomes display history and never authorizes a turn. A
 * login nobody signed in here and HQ names nobody for — one signed in from a terminal — is
 * nobody's until somebody signs it in here.
 *
 * @module zeropsSignIns
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";

/** One login's latest signer. */
export interface SignInRecord {
  readonly by: string;
  /** Display history only after logout; never credential authority. */
  readonly credentialCleared?: true;
}

export type SignInRecords = Readonly<Record<string, SignInRecord>>;

export interface SignInStore {
  /** Current credential authority, by signer key; excludes logout history. */
  readonly load: Effect.Effect<SignInRecords>;
  /** The last recorded signer, including logins whose credentials are gone. */
  readonly lastSigners: Effect.Effect<Readonly<Record<string, string>>>;
  /**
   * When the last recorded signer signed each login in (ISO 8601), for the sign-ins this server
   * watched, before a restart too; a login whose signer another sign-in than the watched one
   * named has none.
   */
  readonly signedAt: Effect.Effect<Readonly<Record<string, string>>>;
  /** Records that `record.by` signed the login `key` in now, stamped with this server's clock. */
  readonly save: (key: string, record: SignInRecord) => Effect.Effect<void>;
  readonly clear: (key: string) => Effect.Effect<void>;
  /** Fill logins without a signer from HQ's `signers` frame. */
  readonly heard: (signers: Readonly<Record<string, string>>) => Effect.Effect<void>;
  /** Fires after each save, clear or map that moved a record: whose a login is may have moved. */
  readonly changes: Stream.Stream<void>;
}

/** Current authority excludes display history left by a credential that went. */
const activeRecords = (records: SignInRecords): SignInRecords =>
  Object.fromEntries(Object.entries(records).filter(([, record]) => !record.credentialCleared));
const lastSignersOf = (records: SignInRecords): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.by]));

/**
 * Fill gaps in `current` from HQ's map. Existing records, including logout history, stay in place.
 * `undefined` when nothing moves.
 */
const applySigners = (
  current: SignInRecords,
  signers: Readonly<Record<string, string>>,
): SignInRecords | undefined => {
  const moved: Record<string, SignInRecord> = {};
  for (const [key, by] of Object.entries(signers)) {
    if (current[key] !== undefined) continue;
    moved[key] = { by };
  }
  return Object.keys(moved).length === 0 ? undefined : { ...current, ...moved };
};

/** A sign-in watched here: who signed the login in, and when (ISO 8601), by this server's clock. */
const SignedAt = Schema.Struct({ by: Schema.String, at: Schema.String });
const SignedAtMap = Schema.Record(Schema.String, SignedAt);
type SignedAtMap = typeof SignedAtMap.Type;
const decodeSignedAt = Schema.decodeUnknownEffect(Schema.fromJsonString(SignedAtMap));
const encodeSignedAt = Schema.encodeEffect(Schema.fromJsonString(SignedAtMap));

/** Where the watched sign-ins' times outlive the process. */
export interface SignedAtKeep {
  readonly read: Effect.Effect<SignedAtMap>;
  readonly write: (all: SignedAtMap) => Effect.Effect<void>;
}

const keptNowhere: SignedAtKeep = { read: Effect.succeed({}), write: () => Effect.void };

/**
 * The times as one JSON file at `at`, replaced whole in one rename. A missing file is no sign-in
 * yet; an unreadable one or a failed write is logged and leaves the times this process holds.
 */
export const signedAtFile = (at: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.dirname(at);
    const staged = path.join(directory, `.${path.basename(at)}.next`);
    return {
      read: fs.readFileString(at).pipe(
        Effect.flatMap(decodeSignedAt),
        Effect.catch((error) =>
          error._tag === "PlatformError" && error.reason._tag === "NotFound"
            ? Effect.succeed({})
            : Effect.logWarning("zerops sign-ins: times unreadable", { reason: error._tag }).pipe(
                Effect.as({}),
              ),
        ),
      ),
      write: (all) =>
        Effect.gen(function* () {
          const json = yield* encodeSignedAt(all);
          yield* fs.makeDirectory(directory, { recursive: true });
          yield* fs.writeFileString(staged, json, { mode: 0o600 });
          yield* fs.rename(staged, at);
        }).pipe(
          Effect.onError(() => fs.remove(staged, { force: true }).pipe(Effect.ignore)),
          Effect.catch((error) =>
            Effect.logWarning("zerops sign-ins: times not kept", { reason: error._tag }),
          ),
          Effect.uninterruptible,
        ),
    } satisfies SignedAtKeep;
  });

/**
 * The store, starting from `initial`: empty in a running server, until HQ's map or a sign-in. The
 * times of the sign-ins it watched start from and go to `keep`.
 */
export const memorySignInStore = (initial: SignInRecords = {}, keep: SignedAtKeep = keptNowhere) =>
  Effect.gen(function* () {
    const records = yield* Ref.make(initial);
    const signedAt = yield* Ref.make<SignedAtMap>(yield* keep.read);
    // One write at a time, in the order the sign-ins were kept.
    const stamps = yield* Semaphore.make(1);
    const moved = yield* PubSub.unbounded<void>();
    const told = PubSub.publish(moved, undefined);
    return {
      load: Ref.get(records).pipe(Effect.map(activeRecords)),
      lastSigners: Ref.get(records).pipe(Effect.map(lastSignersOf)),
      signedAt: Effect.all([Ref.get(records), Ref.get(signedAt)]).pipe(
        Effect.map(([current, stamped]) =>
          Object.fromEntries(
            Object.entries(stamped)
              .filter(([key, { by }]) => current[key]?.by === by)
              .map(([key, { at }]) => [key, at]),
          ),
        ),
      ),
      save: (key, record) =>
        stamps
          .withPermits(1)(
            DateTime.now.pipe(
              Effect.flatMap((now) =>
                Ref.updateAndGet(signedAt, (current) => ({
                  ...current,
                  [key]: { by: record.by, at: DateTime.formatIso(now) },
                })),
              ),
              Effect.flatMap(keep.write),
            ),
          )
          .pipe(
            Effect.andThen(Ref.update(records, (current) => ({ ...current, [key]: record }))),
            Effect.andThen(told),
          ),
      clear: (key) =>
        Ref.modify(records, (current) => {
          const record = current[key];
          return record === undefined || record.credentialCleared
            ? [false, current]
            : [true, { ...current, [key]: { ...record, credentialCleared: true as const } }];
        }).pipe(Effect.flatMap((cleared) => (cleared ? told : Effect.void))),
      heard: (signers) =>
        Ref.modify(records, (current) => {
          const next = applySigners(current, signers);
          return next === undefined ? [false, current] : [true, next];
        }).pipe(Effect.flatMap((changed) => (changed ? told : Effect.void))),
      changes: Stream.fromPubSub(moved),
    } satisfies SignInStore;
  });

/**
 * The one store of a running server: the login walker and HQ's link write it, and the gate, the
 * logins' rows and the Mate's overview read it.
 */
export class ZeropsSignIns extends Context.Service<ZeropsSignIns, SignInStore>()(
  "t3/zerops/zeropsSignIns",
) {}

export const layer = Layer.effect(
  ZeropsSignIns,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return yield* memorySignInStore(
      {},
      yield* signedAtFile(path.join(config.stateDir, "sign-ins.json")),
    );
  }),
);
