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
 * unsure carries nothing: two people named, no credential, a key no build signs in.
 *
 * What it covers, and what not:
 *
 * - **A login made after the carry-over began is never carried.** Its first attempt keeps which
 *   logins held a credential then, before it reads anything, and no later start carries any
 *   other; it closes for good once the tags and HQ have both answered, or at its third start. A
 *   terminal or copied login made after that is nobody's until somebody signs it in through Mate,
 *   as D6 has it.
 * - **A credential already here at the update is taken to be the one its tag was written for.**
 *   Nothing on the container dates it against the tag. 0.12.3 deleted a login's entry when it
 *   signed out and kept the tag, so a terminal login made on 0.12.3 after the tag's signer signed
 *   out is carried as theirs — exactly as 0.12.3 itself admitted it. This is 0.12.3's trust model,
 *   kept on purpose for this one carry-over, not a new one.
 *
 * It runs before anything reads the record (the gate, the logins' rows, the login walker and the
 * Mate's overview to HQ), and reads Zerops and HQ only at a start while it is open.
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

/**
 * How far the carry-over got: open since its first attempt, with the logins whose credential was
 * here then — the only ones it may ever carry — and how many starts have tried; or done.
 */
export type CarryOverMarker =
  | {
      readonly state: "open";
      readonly eligible: ReadonlyArray<string>;
      readonly starts: number;
    }
  | { readonly state: "done" };

/** The most starts the carry-over stays open for while Zerops or HQ does not answer. */
export const CARRY_OVER_STARTS = 3;

/** Where the carry-over reads the old record from, and where it keeps how far it got. */
export interface CarryOverSources {
  /** How far an earlier start got; `undefined` when none has tried. */
  readonly marker: Effect.Effect<CarryOverMarker | undefined>;
  /** Keeps how far it got, atomically; `false` when it could not. */
  readonly keepMarker: (marker: CarryOverMarker) => Effect.Effect<boolean>;
  /** The logins whose credential is here now, by signer key. */
  readonly heldLogins: Effect.Effect<ReadonlyArray<string>>;
  /** The project's tags as the Mate reads them; `undefined` when they could not be read. */
  readonly readTags: Effect.Effect<ReadonlyArray<string> | undefined>;
  /** HQ's saved signers of this Mate; `{}` with no HQ, `undefined` when HQ did not answer. */
  readonly readSaved: Effect.Effect<Readonly<Record<string, string>> | undefined>;
}

/**
 * Carries the old signers into `store` while the carry-over is open: answers the logins it
 * carried.
 *
 * Its first attempt keeps the logins whose credential is here then before it reads anything, and
 * no later start carries any other: a credential that turns up afterwards is never carried,
 * whatever Zerops or HQ answer. A start that cannot keep that carries nothing. Tags that cannot
 * be read carry nothing that start. The carry-over closes at the first start both the tags and HQ
 * answer, and at its {@link CARRY_OVER_STARTS}th start whatever they answered: an HQ that never
 * answers leaves only the tags' signers carried.
 */
export const carrySignersOver = (store: SignInStore, sources: CarryOverSources) =>
  Effect.gen(function* () {
    const before = yield* sources.marker;
    if (before?.state === "done") return [];
    const eligible = new Set(before?.eligible ?? (yield* sources.heldLogins));
    const starts = (before?.starts ?? 0) + 1;
    if (!(yield* sources.keepMarker({ state: "open", eligible: [...eligible], starts }))) {
      yield* Effect.logWarning("zerops sign-ins: the old signers' carry-over could not start");
      return [];
    }
    const [tags, saved] = yield* Effect.all([sources.readTags, sources.readSaved], {
      concurrency: "unbounded",
    });
    let carried: ReadonlyArray<string> = [];
    if (tags === undefined) {
      yield* Effect.logWarning("zerops sign-ins: the old signers could not be read", { starts });
    } else {
      const present = new Set(yield* sources.heldLogins);
      const plan = planSignerCarryOver({
        named: new Set(Object.keys(yield* store.lastSigners)),
        held: new Set([...eligible].filter((key) => present.has(key))),
        tags,
        saved: saved ?? {},
      });
      const at = yield* Clock.currentTimeMillis;
      for (const [key, by] of Object.entries(plan)) yield* store.save(key, { by, at });
      carried = Object.keys(plan);
      if (carried.length > 0) {
        yield* Effect.logInfo("zerops sign-ins: carried old signers over", { logins: carried });
      }
    }
    if ((tags !== undefined && saved !== undefined) || starts >= CARRY_OVER_STARTS) {
      yield* sources.keepMarker({ state: "done" });
    }
    return carried;
  }).pipe(
    Effect.catchTag("SignInSaveError", (error) =>
      Effect.logWarning("zerops sign-ins: an old signer could not be kept", {
        key: error.key,
      }).pipe(Effect.as([])),
    ),
  );

/** Where the carry-over keeps how far it got, beside the record. */
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

/** HQ's saved signers out of its answer; `undefined` for a body that is not HQ's Mate. */
const savedSignersOf = (body: unknown): Readonly<Record<string, string>> | undefined => {
  const signers =
    typeof body === "object" && body !== null
      ? (body as { readonly signers?: unknown }).signers
      : undefined;
  if (typeof signers !== "object" || signers === null || Array.isArray(signers)) return undefined;
  return Object.fromEntries(
    Object.entries(signers).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    }),
  );
};

const OpenMarker = Schema.fromJsonString(
  Schema.Struct({
    state: Schema.Literal("open"),
    eligible: Schema.Array(Schema.String),
    starts: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }),
);
const decodeOpenMarker = Schema.decodeUnknownEffect(OpenMarker);

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
        if (response.status === 200) return savedSignersOf(yield* response.json);
        // HQ keeps no such Mate: nothing of this Mate's is saved. Any other answer — a refusal
        // that may pass, a timeout, a busy or failing HQ — is none, for the next start.
        return response.status === 404 ? {} : undefined;
      }),
    );

    const held = (key: string) => {
      const file = loginCredentialPath(input.homeDir, key);
      return file === undefined
        ? Effect.succeed(false)
        : fs.exists(file).pipe(Effect.orElseSucceed(() => false));
    };

    return {
      // A marker that is there but cannot be read as open closes the carry-over.
      marker: Effect.gen(function* () {
        if (!(yield* fs.exists(marker))) return undefined;
        return yield* decodeOpenMarker(yield* fs.readFileString(marker));
      }).pipe(Effect.orElseSucceed((): CarryOverMarker => ({ state: "done" }))),
      keepMarker: (next) =>
        writeFileStringAtomically({ filePath: marker, contents: encodeJson(next) }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning("zerops sign-ins: could not keep the carry-over's marker", {
              cause,
            }).pipe(Effect.as(false)),
          ),
        ),
      heldLogins: Effect.gen(function* () {
        const others = yield* fs
          .readDirectory(path.join(input.homeDir, ".mate", "logins"))
          .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
        const keys = ["claude-code", "codex", ...others.filter(isSignerKey)];
        const present: Array<string> = [];
        for (const key of keys) if (yield* held(key)) present.push(key);
        return present;
      }),
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
