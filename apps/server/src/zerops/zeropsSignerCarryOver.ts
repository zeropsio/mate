/**
 * An old Mate's signers, carried once into the server's own record of who signed each login in.
 *
 * Up to 0.12.3 the app wrote whose a login was onto the Mate's project, as the person, the moment
 * their sign-in succeeded: a tag `mate:signer:{key}:{userId}` (`withMateSignerTag`), keyed by the
 * agent id for a default login and by the login's own id for any other. From v0.11.79 the server
 * also kept its own record (`zeropsSignIns`), and a login with nothing kept there still went by
 * its tag (5bf76e265). 0.13 reads its own record alone (D6), writes no tag, and HQ's tag port keeps
 * the tags' signers on the Mate's HQ record before it removes them; zcp seeds the record from HQ,
 * only while the server keeps none at all. A login signed in before the record began, and never
 * since, would then run for nobody after an update — its own signer refused like everyone else.
 *
 * So the server carries the old record over, once: for each login whose credential is here and
 * that its record has never named — not even as history — the one person the tags and HQ's saved
 * signer name becomes its signer, as if the record had existed when they signed in. Anything
 * unsure carries nothing: two people named, no credential, a key no build signs in. Once the tags
 * and HQ have both answered, it never runs again, so a credential that turns up later — a terminal
 * login — is nobody's until somebody signs it in through Mate, as D6 has it.
 *
 * It runs before anything reads the record (the gate, the logins' rows, the login walker and the
 * Mate's overview to HQ), and reads Zerops and HQ only at a start that has not finished it.
 *
 * @module zeropsSignerCarryOver
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as NodeOS from "node:os";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { mateLoginCredentialPath, mateLoginHome } from "./ZeropsLogins.ts";
import { extraLoginAgent } from "./zeropsLoginIds.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { requestWithMateKey } from "./ZeropsMateKey.ts";
import { readJson, zeropsGet } from "./zeropsApiRead.ts";
import { fileSignInStore, signInsPath, ZeropsSignIns, type SignInStore } from "./zeropsSignIns.ts";

/** The tag 0.12.3's app wrote for a login's signer: `mate:signer:{key}:{userId}`. */
export const SIGNER_TAG_PREFIX = "mate:signer:";

/** The longest user id the record keeps (`zeropsSignIns`). */
const MAX_USER_ID_LENGTH = 128;

/** How long a start waits on Zerops or HQ for the old signers before it goes on without them. */
export const CARRY_OVER_READ_WAIT = Duration.seconds(4);

/** A login this build records a signer for: an agent's default, or another login's own id. */
const isSignerKey = (key: string): boolean =>
  key === "claude-code" || key === "codex" || extraLoginAgent(key) !== undefined;

const isUserId = (userId: string): boolean =>
  userId.length > 0 && userId.length <= MAX_USER_ID_LENGTH;

/** Everybody the signer tags name, by login key. */
export function readSignerTags(
  tags: ReadonlyArray<string>,
): Readonly<Record<string, ReadonlyArray<string>>> {
  const named: Record<string, Array<string>> = {};
  for (const tag of tags) {
    if (!tag.startsWith(SIGNER_TAG_PREFIX)) continue;
    const rest = tag.slice(SIGNER_TAG_PREFIX.length);
    const separator = rest.indexOf(":");
    if (separator <= 0) continue;
    const key = rest.slice(0, separator);
    const userId = rest.slice(separator + 1);
    if (!isSignerKey(key) || !isUserId(userId)) continue;
    (named[key] ??= []).push(userId);
  }
  return named;
}

/**
 * The signer each login takes from the old record: a login whose credential is here (`held`),
 * that the server's own record has never named (`named`, history included), and for which the
 * tags and HQ's saved signers name exactly one person between them.
 */
export function planSignerCarryOver(input: {
  readonly named: ReadonlySet<string>;
  readonly held: ReadonlySet<string>;
  readonly tags: ReadonlyArray<string>;
  readonly saved: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const people: Record<string, Set<string>> = {};
  for (const [key, users] of Object.entries(readSignerTags(input.tags))) {
    for (const user of users) (people[key] ??= new Set()).add(user);
  }
  for (const [key, user] of Object.entries(input.saved)) {
    if (isSignerKey(key) && isUserId(user)) (people[key] ??= new Set()).add(user);
  }
  const carried: Record<string, string> = {};
  for (const [key, users] of Object.entries(people)) {
    if (input.named.has(key) || !input.held.has(key) || users.size !== 1) continue;
    const [only] = users;
    if (only !== undefined) carried[key] = only;
  }
  return carried;
}

/** Where the carry-over reads the old record from, and where it keeps that it is done. */
export interface CarryOverSources {
  /** Whether an earlier start has finished it. */
  readonly done: Effect.Effect<boolean>;
  /** Keeps that it is finished, with the logins it carried. */
  readonly markDone: (carried: ReadonlyArray<string>) => Effect.Effect<void>;
  /** Whether the login keyed `key` holds a credential now. */
  readonly credentialHeld: (key: string) => Effect.Effect<boolean>;
  /** The project's tags as the Mate reads them; `undefined` when they could not be read. */
  readonly readTags: Effect.Effect<ReadonlyArray<string> | undefined>;
  /** HQ's saved signers of this Mate; `{}` with no HQ, `undefined` when HQ did not answer. */
  readonly readSaved: Effect.Effect<Readonly<Record<string, string>> | undefined>;
}

/**
 * Carries the old signers into `store` unless an earlier start has: answers the logins it
 * carried. Tags that cannot be read carry nothing, and the next start tries again; an HQ that
 * does not answer leaves the tags' signers carried and the rest to the next start.
 */
export const carrySignersOver = (store: SignInStore, sources: CarryOverSources) =>
  Effect.gen(function* () {
    if (yield* sources.done) return [];
    const [tags, saved] = yield* Effect.all([sources.readTags, sources.readSaved], {
      concurrency: "unbounded",
    });
    if (tags === undefined) {
      yield* Effect.logWarning("zerops sign-ins: the old signers could not be read; next start");
      return [];
    }
    const candidates = new Set([...Object.keys(readSignerTags(tags)), ...Object.keys(saved ?? {})]);
    const held = new Set<string>();
    for (const key of candidates) if (yield* sources.credentialHeld(key)) held.add(key);
    const plan = planSignerCarryOver({
      named: new Set(Object.keys(yield* store.lastSigners)),
      held,
      tags,
      saved: saved ?? {},
    });
    const at = yield* Clock.currentTimeMillis;
    for (const [key, by] of Object.entries(plan)) yield* store.save(key, { by, at });
    const carried = Object.keys(plan);
    if (carried.length > 0) {
      yield* Effect.logInfo("zerops sign-ins: carried old signers over", { logins: carried });
    }
    if (saved !== undefined) yield* sources.markDone(carried);
    return carried;
  }).pipe(
    Effect.catchTag("SignInSaveError", (error) =>
      Effect.logWarning("zerops sign-ins: an old signer could not be kept; next start", {
        key: error.key,
      }).pipe(Effect.as([])),
    ),
  );

/** Where the carry-over keeps that it is done, beside the record. */
export const carriedMarkerPath = (path: Path.Path, homeDir: string): string =>
  path.join(homeDir, ".mate", "signers-carried.json");

/** The credential file of the login keyed `key` under `homeDir`, as its CLI writes it. */
export const loginCredentialPath = (homeDir: string, key: string): string | undefined => {
  if (key === "claude-code") return `${homeDir}/.claude/.credentials.json`;
  if (key === "codex") return `${homeDir}/.codex/auth.json`;
  const agent = extraLoginAgent(key);
  return agent === undefined
    ? undefined
    : mateLoginCredentialPath({ agent, home: mateLoginHome(homeDir, key) });
};

const EnrollmentFile = Schema.fromJsonString(
  Schema.Struct({ hq: Schema.String, credential: Schema.String }),
);
const decodeEnrollment = Schema.decodeUnknownEffect(EnrollmentFile);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const savedSignersOf = (body: unknown): Readonly<Record<string, string>> => {
  const signers =
    typeof body === "object" && body !== null
      ? (body as { readonly signers?: unknown }).signers
      : undefined;
  if (typeof signers !== "object" || signers === null || Array.isArray(signers)) return {};
  return Object.fromEntries(
    Object.entries(signers).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    }),
  );
};

/** The carry-over's sources in a Zerops container: its home, its project, its HQ. */
export const liveCarryOverSources = (input: {
  readonly homeDir: string;
  readonly environment: ZeropsEnvironment;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const http = yield* HttpClient.HttpClient;
    const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
    const marker = carriedMarkerPath(path, input.homeDir);
    const { apiBaseUrl, projectId, hqEnrollmentPath } = input.environment;
    const within = <A, E>(read: Effect.Effect<A | undefined, E>) =>
      read.pipe(
        Effect.timeoutOption(CARRY_OVER_READ_WAIT),
        Effect.map(Option.getOrUndefined),
        Effect.catchCause(() => Effect.succeed(undefined)),
      );

    const readTags = within(
      Effect.gen(function* () {
        const { response } = yield* requestWithMateKey(mateKey, (token) =>
          zeropsGet({ url: `${apiBaseUrl}/project/${encodeURIComponent(projectId)}`, token }),
        );
        if (response === undefined || response.status !== 200) return undefined;
        const body = yield* readJson(response);
        if (typeof body !== "object" || body === null) return undefined;
        const tagList = (body as { readonly tagList?: unknown }).tagList;
        return Array.isArray(tagList)
          ? tagList.filter((tag): tag is string => typeof tag === "string")
          : [];
      }).pipe(Effect.provideService(HttpClient.HttpClient, http)),
    );

    const readSaved = within(
      Effect.gen(function* () {
        if (hqEnrollmentPath === undefined) return {};
        if (!(yield* fs.exists(hqEnrollmentPath))) return {};
        const enrollment = yield* decodeEnrollment(yield* fs.readFileString(hqEnrollmentPath));
        const response = yield* http.get(`${enrollment.hq.replace(/\/+$/u, "")}/api/mate/self`, {
          headers: { authorization: `Mate ${enrollment.credential}`, accept: "application/json" },
        });
        if (response.status === 404) return {};
        if (response.status !== 200) return undefined;
        return savedSignersOf(yield* response.json);
      }),
    );

    return {
      done: fs.exists(marker).pipe(Effect.orElseSucceed(() => false)),
      markDone: (carried) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          yield* writeFileStringAtomically({
            filePath: marker,
            contents: encodeJson({ at, carried }),
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.catchCause((cause) =>
              Effect.logWarning("zerops sign-ins: could not keep that old signers are carried", {
                cause,
              }),
            ),
          );
        }),
      credentialHeld: (key) => {
        const file = loginCredentialPath(input.homeDir, key);
        return file === undefined
          ? Effect.succeed(false)
          : fs.exists(file).pipe(Effect.orElseSucceed(() => false));
      },
      readTags,
      readSaved,
    } satisfies CarryOverSources;
  });

/**
 * The server's record under `homeDir` (`zeropsSignIns`), with an old Mate's signers carried into
 * it first inside a Zerops container.
 */
export const makeCarriedSignIns = (homeDir: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const store = yield* fileSignInStore(signInsPath(path, homeDir));
    const environment = (yield* ServerConfig.ServerConfig).zerops;
    if (environment !== undefined) {
      yield* carrySignersOver(store, yield* liveCarryOverSources({ homeDir, environment }));
    }
    return store;
  });

/** The one record of a running server, the old signers carried in before anybody reads it. */
export const layer = Layer.effect(ZeropsSignIns, makeCarriedSignIns(NodeOS.homedir()));
