/**
 * Who signed each login in last, as this server saw it: the one record of whose a login is.
 *
 * The turn gate (`ZeropsProjectSigners`), the logins' rows and the Mate's summary to its HQ all
 * go by the person this server watched sign a login in — the subject of the door session that
 * started it. The credential lives on under `/home/zerops` across a restart, so the knowledge of
 * whose it is has to as well.
 *
 * One small document beside the logins' homes (`~/.mate/signed-in.json`), written atomically,
 * written with every sign-in that succeeds (a fresh one replaces it) and cleared when the login's
 * credential goes. It is read once, at start: while the server runs, what it saw is the record,
 * whatever the document says by then. A login with nothing kept — a credential from before this
 * record existed, or one signed in from a terminal — is nobody's until somebody signs it in here.
 *
 * @module zeropsSignIns
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as NodeOS from "node:os";

import { writeFileStringAtomically } from "../atomicWrite.ts";

/** One login's latest successful sign-in: the Zerops user id, and when it started (epoch ms). */
export interface SignInRecord {
  readonly by: string;
  readonly at: number;
}

export type SignInRecords = Readonly<Record<string, SignInRecord>>;

export interface SignInStore {
  /** Every login's kept sign-in, by signer key. */
  readonly load: Effect.Effect<SignInRecords>;
  readonly save: (key: string, record: SignInRecord) => Effect.Effect<void>;
  readonly clear: (key: string) => Effect.Effect<void>;
}

/** Where the document lives under the server's home. */
export const signInsPath = (path: Path.Path, homeDir: string): string =>
  path.join(homeDir, ".mate", "signed-in.json");

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** The latest instant a `DateTime` holds, in epoch ms: anything past it is no time at all. */
const MAX_EPOCH_MS = 8_640_000_000_000_000;
/** A Zerops user id is a short token; anything longer is not one. */
const MAX_USER_ID_LENGTH = 128;

/**
 * Only well-formed entries count, and anything else is a login with nothing kept: the file sits
 * where the agent's own user can write it, so whatever it holds, the server still starts.
 */
export const toRecords = (parsed: unknown): SignInRecords => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, SignInRecord> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const { by, at } = value as { readonly by?: unknown; readonly at?: unknown };
    if (typeof by !== "string" || by.length === 0 || by.length > MAX_USER_ID_LENGTH) continue;
    if (typeof at !== "number" || !Number.isSafeInteger(at) || at < 0 || at > MAX_EPOCH_MS) {
      continue;
    }
    out[key] = { by, at };
  }
  return out;
};

/** How the store reaches its document: read it (absent when there is none), write it, remove it. */
export interface SignInDocument {
  readonly read: Effect.Effect<string | undefined>;
  /** `true` once the whole document is written. */
  readonly write: (contents: string) => Effect.Effect<boolean>;
  /** `true` once there is no document. */
  readonly remove: Effect.Effect<boolean>;
}

/**
 * The store over one document, read once: a read that fails is nothing kept. A save that cannot
 * be written never leaves the sign-in before it standing on disk — after a restart that one would
 * be trusted: the login's entry goes instead, and failing that, the whole document. This server
 * goes by the sign-in it saw either way.
 */
export const makeSignInStore = (document: SignInDocument) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1);
    const kept = yield* document.read.pipe(
      Effect.flatMap((contents) =>
        contents === undefined
          ? Effect.succeed<SignInRecords>({})
          : decodeJson(contents).pipe(Effect.map(toRecords)),
      ),
      Effect.orElseSucceed((): SignInRecords => ({})),
    );
    const records = yield* Ref.make(kept);
    const without = (current: SignInRecords, key: string): SignInRecords => {
      const { [key]: _gone, ...rest } = current;
      return rest;
    };
    const forget = (current: SignInRecords, key: string) =>
      Effect.gen(function* () {
        if (yield* document.write(encodeJson(without(current, key)))) return;
        if (yield* document.remove) return;
        yield* Effect.logWarning("zerops sign-ins: could not let go of a sign-in", { key });
      });
    return {
      load: Ref.get(records),
      save: (key, record) =>
        Effect.gen(function* () {
          const current = yield* Ref.updateAndGet(records, (held) => ({ ...held, [key]: record }));
          if (yield* document.write(encodeJson(current))) return;
          yield* Effect.logWarning("zerops sign-ins: could not keep who signed in", { key });
          yield* forget(current, key);
        }).pipe(lock.withPermits(1)),
      clear: (key) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(records);
          if (current[key] === undefined) return;
          yield* Ref.set(records, without(current, key));
          yield* forget(current, key);
        }).pipe(lock.withPermits(1)),
    } satisfies SignInStore;
  });

/** The store over one file, written atomically. */
export const fileSignInStore = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* makeSignInStore({
      read: fs.exists(filePath).pipe(
        Effect.flatMap((exists) =>
          exists ? fs.readFileString(filePath) : Effect.succeed(undefined),
        ),
        Effect.orElseSucceed(() => undefined),
      ),
      write: (contents) =>
        writeFileStringAtomically({ filePath, contents }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.as(true),
          Effect.catchCause(() => Effect.succeed(false)),
        ),
      remove: fs.remove(filePath, { force: true }).pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      ),
    });
  });

/** The store in memory: a test's, or a server that keeps nothing across restarts. */
export const memorySignInStore = (initial: SignInRecords = {}) =>
  Effect.gen(function* () {
    const records = yield* Ref.make(initial);
    return {
      load: Ref.get(records),
      save: (key, record) => Ref.update(records, (current) => ({ ...current, [key]: record })),
      clear: (key) =>
        Ref.update(records, (current) => {
          const { [key]: _gone, ...rest } = current;
          return rest;
        }),
    } satisfies SignInStore;
  });

/**
 * The one store of a running server: the login walker writes it, and the gate, the logins' rows
 * and the Mate's summary read it.
 */
export class ZeropsSignIns extends Context.Service<ZeropsSignIns, SignInStore>()(
  "t3/zerops/zeropsSignIns",
) {}

export const layer = Layer.effect(
  ZeropsSignIns,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return yield* fileSignInStore(signInsPath(path, NodeOS.homedir()));
  }),
);
