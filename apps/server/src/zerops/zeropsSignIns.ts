/**
 * Who signed each login in last, kept where a restart does not lose it.
 *
 * The turn gate goes by the person who signed a login in last on this server
 * (`ZeropsProjectSigners`): a signer tag naming anybody else runs nothing,
 * since any project member can write the tag by API, without the app. The
 * credential itself lives on under `/home/zerops` across a restart, so the
 * knowledge of whose it is has to as well — or after one, a tag written over
 * the sign-in admits its writer on somebody else's credential.
 *
 * One small document beside the logins' homes (`~/.mate/signed-in.json`),
 * written atomically, written with every sign-in that succeeds (a fresh one
 * replaces it) and cleared when the login's credential goes. A login with
 * nothing kept here — a credential from before this record existed — is gated
 * by its tag, as it always was.
 *
 * @module zeropsSignIns
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

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

/** Only well-formed entries count: anything else is a login with nothing kept. */
const toRecords = (parsed: unknown): SignInRecords => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, SignInRecord> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { by, at } = value as { readonly by?: unknown; readonly at?: unknown };
    if (typeof by === "string" && by.length > 0 && typeof at === "number") {
      out[key] = { by, at };
    }
  }
  return out;
};

/**
 * The store over one file. A read that fails is nothing kept; a write that fails is logged
 * and leaves the gate on the sign-in it holds in memory until the next restart.
 */
export const fileSignInStore = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const lock = yield* Semaphore.make(1);
    const read = fs.readFileString(filePath).pipe(
      Effect.flatMap(decodeJson),
      Effect.map(toRecords),
      Effect.orElseSucceed((): SignInRecords => ({})),
    );
    const write = (next: SignInRecords) =>
      writeFileStringAtomically({ filePath, contents: JSON.stringify(next) }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.catchCause((cause) =>
          Effect.logWarning("zerops sign-ins: could not keep who signed in", { cause }),
        ),
      );
    const change = (update: (current: SignInRecords) => SignInRecords | undefined) =>
      Effect.gen(function* () {
        const next = update(yield* read);
        if (next !== undefined) yield* write(next);
      }).pipe(lock.withPermits(1));
    return {
      load: read,
      save: (key, record) => change((current) => ({ ...current, [key]: record })),
      clear: (key) =>
        change((current) => {
          if (current[key] === undefined) return undefined;
          const { [key]: _gone, ...rest } = current;
          return rest;
        }),
    } satisfies SignInStore;
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
