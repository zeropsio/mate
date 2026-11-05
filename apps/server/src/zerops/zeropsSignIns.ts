/**
 * Who signed each login in last, as this server knows it: the one record of whose a login is.
 *
 * The turn gate (`ZeropsProjectSigners`), the logins' rows and the Mate's overview to its HQ all
 * go by it. Two writers: the person this server watched sign a login in — the subject of the door
 * session that started it — and HQ, which keeps each login's last signer the Mate reported
 * (`lastSignedInBy`) and sends the map on the link (`signers`) after every `hello` and again when
 * an HQ write moves it. That is how whose a login is outlives a restart, or a container that
 * boots with nothing: the server keeps no file of it.
 *
 * When the credential goes, its entry becomes display history and never authorizes a turn. A
 * login nobody signed in here and HQ names nobody for — one signed in from a terminal — is
 * nobody's until somebody signs it in here.
 *
 * @module zeropsSignIns
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

/** One login's latest sign-in: the Zerops user id, and when it started (epoch ms). */
export interface SignInRecord {
  readonly by: string;
  readonly at: number;
  /** Display history only after logout; never credential authority. */
  readonly credentialCleared?: true;
}

export type SignInRecords = Readonly<Record<string, SignInRecord>>;

export interface SignInStore {
  /** Current credential authority, by signer key; excludes logout history. */
  readonly load: Effect.Effect<SignInRecords>;
  /** The last recorded signer, including logins whose credentials are gone. */
  readonly lastSigners: Effect.Effect<Readonly<Record<string, string>>>;
  readonly save: (key: string, record: SignInRecord) => Effect.Effect<void>;
  readonly clear: (key: string) => Effect.Effect<void>;
  /**
   * HQ's map of each login's signer (the link's `signers` frame), written `at` (epoch ms) by HQ;
   * a map without its time is older than every sign-in here. See {@link applySigners}.
   */
  readonly heard: (signers: Readonly<Record<string, string>>, at?: number) => Effect.Effect<void>;
  /** Fires after each save, clear or map that moved a record: whose a login is may have moved. */
  readonly changes: Stream.Stream<void>;
}

/** Current authority excludes display history left by a credential that went. */
const activeRecords = (records: SignInRecords): SignInRecords =>
  Object.fromEntries(Object.entries(records).filter(([, record]) => !record.credentialCleared));
const lastSignersOf = (records: SignInRecords): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.by]));

/**
 * `current` with HQ's map written `at` applied: a login the map names someone else for takes the
 * map's signer, unless its sign-in here is younger than the map — one HQ had not heard of when it
 * wrote it. A login the map names the same person for keeps its record (and its logout history);
 * a login the map does not name keeps its own. `undefined` when nothing moves.
 */
const applySigners = (
  current: SignInRecords,
  signers: Readonly<Record<string, string>>,
  at: number,
): SignInRecords | undefined => {
  const moved: Record<string, SignInRecord> = {};
  for (const [key, by] of Object.entries(signers)) {
    const local = current[key];
    if (local !== undefined && (local.by === by || local.at > at)) continue;
    moved[key] = { by, at };
  }
  return Object.keys(moved).length === 0 ? undefined : { ...current, ...moved };
};

/** The store, starting from `initial`: empty in a running server, until HQ's map or a sign-in. */
export const memorySignInStore = (initial: SignInRecords = {}) =>
  Effect.gen(function* () {
    const records = yield* Ref.make(initial);
    const moved = yield* PubSub.unbounded<void>();
    const told = PubSub.publish(moved, undefined);
    return {
      load: Ref.get(records).pipe(Effect.map(activeRecords)),
      lastSigners: Ref.get(records).pipe(Effect.map(lastSignersOf)),
      save: (key, record) =>
        Ref.update(records, (current) => ({ ...current, [key]: record })).pipe(
          Effect.andThen(told),
        ),
      clear: (key) =>
        Ref.modify(records, (current) => {
          const record = current[key];
          return record === undefined || record.credentialCleared
            ? [false, current]
            : [true, { ...current, [key]: { ...record, credentialCleared: true as const } }];
        }).pipe(Effect.flatMap((cleared) => (cleared ? told : Effect.void))),
      heard: (signers, at = 0) =>
        Ref.modify(records, (current) => {
          const next = applySigners(current, signers, at);
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

export const layer = Layer.effect(ZeropsSignIns, memorySignInStore());
