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
 * A sign-in watched here is kept with when it happened, by this server's clock (`signedAt`). HQ's
 * map names no time, so a signer it fills in has none. The Mate reports that time to HQ
 * (`lastSignedInAt`): a new one is a sign-in, which moves the Mate's owner in HQ.
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
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

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
   * watched; a login whose signer only HQ's map named has none.
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

/** The store, starting from `initial`: empty in a running server, until HQ's map or a sign-in. */
export const memorySignInStore = (initial: SignInRecords = {}) =>
  Effect.gen(function* () {
    const records = yield* Ref.make(initial);
    const signedAt = yield* Ref.make<Readonly<Record<string, string>>>({});
    const moved = yield* PubSub.unbounded<void>();
    const told = PubSub.publish(moved, undefined);
    return {
      load: Ref.get(records).pipe(Effect.map(activeRecords)),
      lastSigners: Ref.get(records).pipe(Effect.map(lastSignersOf)),
      signedAt: Ref.get(signedAt),
      save: (key, record) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            Ref.update(signedAt, (current) => ({ ...current, [key]: DateTime.formatIso(now) })),
          ),
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

export const layer = Layer.effect(ZeropsSignIns, memorySignInStore());
