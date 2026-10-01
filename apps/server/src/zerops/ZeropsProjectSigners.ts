/**
 * ZeropsProjectSigners — who signed each agent in, recorded where this
 * container cannot rewrite it.
 *
 * ## Why a project tag
 *
 * An agent CLI's credential is a *personal* one: under the vendors' consumer
 * terms a subscription login is yours to use on your own machines and nobody
 * else's. A Zerops project has members, though, and everyone who can open this
 * Mate reaches the same agent — so the product has to know whose identity a
 * turn is about to spend, and refuse the ones that are not theirs (D6).
 *
 * The record used to be a file in this container, which the Mate, its agent
 * and anything the agent runs could all rewrite. So it moved onto the Mate's
 * **project**, as a tag `mate:signer:{agent}:{userId}`, written by the app
 * **as the person** at the moment their sign-in succeeds. A Mate's own key is
 * `BASIC_USER` on its project and cannot write tags (measured 2026-09-16), so
 * neither it nor its agent can forge the record. This server only ever reads
 * it, with its own key.
 *
 * Said out loud, because it matters: this is a guardrail, not a lock. Everyone
 * who can open a Mate can also write in it and open a terminal as the agent's
 * user, so any of them could copy the credential file, and the Mate's owner can
 * rewrite the tag besides. What D6 buys is that an org owner or admin does not
 * run a colleague's agent by habit or by accident, and that there is a record
 * of who signed it in. It does not claim to stop theft.
 *
 * ## The leave check
 *
 * A signer who is no longer an `ACTIVE` member of the org is not going to come
 * back for their credential, and leaving it here means the next person to open
 * this Mate spends a subscription belonging to someone who has left. So on the
 * same timer the server reads the member list with its own key and, when a
 * recorded signer is gone, **removes that agent's credential artifact**.
 *
 * A member list that cannot be read signs nobody out. Absence of evidence is
 * not evidence of a leaver, and the read is the one thing standing between a
 * platform blip and a room full of deleted logins.
 *
 * @module ZeropsProjectSigners
 */
import type {
  OrchestrationThreadActivity,
  ZeropsAgentAuth,
  ZeropsAgentId,
  ZeropsAgentLoginState,
  ZeropsLoginState,
} from "@t3tools/contracts";
import {
  classifyZeropsAgentAuth,
  knownSigner,
  latestSucceededSignIn,
  readSignerTags,
  type SignerRecord,
  type ZeropsAgentAuthFields,
  type ZeropsAgentAuthKind,
} from "@t3tools/shared/zeropsAgentAuth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as NodeOS from "node:os";

import * as ServerConfig from "../config.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { requestWithMateKey } from "./ZeropsMateKey.ts";
import { readJson, zeropsGet } from "./zeropsApiRead.ts";
import { readMemberEntries, readOrgMembers } from "./ZeropsThrowawayIdentity.ts";
import { readProjectRoles } from "./ZeropsMembershipWatch.ts";
import { isLoginSignerKey } from "./zeropsLoginIds.ts";

/** D6's record, on the Mate's own project: `mate:signer:{agent}:{userId}`. */
export const MATE_SIGNER_TAG_PREFIX = "mate:signer";

/** The agents this build knows how to record a signer for. */
const KNOWN_AGENT_IDS: ReadonlyArray<ZeropsAgentId> = ["claude-code", "codex"];

/** Where each agent CLI keeps the credential a sign-out removes. */
export const AGENT_CREDENTIAL_SEGMENTS: Readonly<Record<ZeropsAgentId, ReadonlyArray<string>>> = {
  "claude-code": [".claude", ".credentials.json"],
  codex: [".codex", "auth.json"],
};

/**
 * Signer key → the Zerops user id of whoever signed that login in. The keys
 * are the agent ids for the two default logins and the login's own id for
 * every other one (`zeropsLoginIds.ts`).
 */
export type ProjectSigners = Readonly<Partial<Record<string, SignerRecord>>>;

export function signerTag(key: string, userId: string): string {
  return `${MATE_SIGNER_TAG_PREFIX}:${key}:${userId}`;
}

/**
 * Reads the signer tags off a project's tag list (`readSignerTags`, the one derivation the
 * client's owner reads too): one per agent's default login, and one per other login under that
 * login's own id. A re-sign-in writes its tag over every other (`withMateSignerTag`).
 */
export function parseSignerTags(tagList: ReadonlyArray<string> | undefined): ProjectSigners {
  return readSignerTags(tagList, isLoginSignerKey);
}

/** Why a turn may not start on an agent, or `undefined` when it may. */
export type TurnRefusal =
  /** The agent is not signed in on this project: the turn would only fail inside its CLI. */
  | {
      readonly kind: "not-signed-in";
      readonly auth: Exclude<ZeropsAgentAuthKind["kind"], "authorized" | "registering">;
    }
  /** Signed in, but no signer was recorded for it. */
  | { readonly kind: "unrecorded" }
  /** Signed in by somebody other than this session's person. */
  | { readonly kind: "someone-else" }
  /** The project records the sign-in for two or more people: nobody's until signed in again. */
  | { readonly kind: "unsettled" };

/**
 * Whether this session may start a turn on this agent.
 *
 * - an agent that is **not signed in** (never, or its login no longer works)
 *   is refused first: nothing it would run can succeed;
 * - a **token**-authorized agent is nobody's personal login, so it is
 *   unaffected by D6: `flagToken` means the container was given an API key,
 *   and an API key belongs to the project;
 * - an agent whose recorded signer **is** this session's subject: yes;
 * - anything else — someone else's, or no record at all — no. D6 keeps no
 *   backward compatibility here: a login with no recorded signer (an older
 *   one, a terminal login, a copied file) cannot run until somebody signs in
 *   through Mate, because "unrecorded" and "somebody else's" are the same
 *   thing to everyone but the person who knows.
 */
export function turnRefusal(input: {
  readonly agent: ZeropsAgentAuthFields & Pick<ZeropsAgentAuth, "flagToken">;
  readonly signer: SignerRecord | undefined;
  readonly subject: string | undefined;
}): TurnRefusal | undefined {
  return loginTurnRefusal({
    state: classifyZeropsAgentAuth(input.agent).kind,
    token: input.agent.flagToken,
    signer: input.signer,
    subject: input.subject,
  });
}

/**
 * {@link turnRefusal} for any login, from its classified state: a default
 * login's comes from its agent row, another login's from its own check. The
 * same order — signed in at all, then a project token, then whose it is.
 */
export function loginTurnRefusal(input: {
  readonly state: ZeropsLoginState;
  readonly token: boolean;
  readonly signer: SignerRecord | undefined;
  readonly subject: string | undefined;
}): TurnRefusal | undefined {
  if (input.state !== "authorized" && input.state !== "registering") {
    return { kind: "not-signed-in", auth: input.state };
  }
  if (input.token) return undefined;
  const signer = input.signer;
  // Whose credential it is is not known: a stale signer must never run turns on another's, so
  // nobody does until somebody signs it in again, which writes the one record.
  if (typeof signer === "object") return { kind: "unsettled" };
  if (signer === undefined || signer.length === 0) return { kind: "unrecorded" };
  return input.subject === signer ? undefined : { kind: "someone-else" };
}

/**
 * Which agents to sign out: those whose recorded signer the org no longer
 * knows as an `ACTIVE` member.
 *
 * `activeMemberIds` of `undefined` means the member list could not be read,
 * and then nothing is signed out — absence of evidence is not evidence of a
 * leaver.
 */
export function planAgentSignOut(input: {
  readonly signers: ProjectSigners;
  readonly activeMemberIds: ReadonlySet<string> | undefined;
}): ReadonlyArray<ZeropsAgentId> {
  const activeMemberIds = input.activeMemberIds;
  if (activeMemberIds === undefined) return [];
  return KNOWN_AGENT_IDS.filter((agentId) => {
    const record = input.signers[agentId];
    // A record that names two people, one of whom has left: the credential may be theirs.
    if (typeof record === "object") return record.among.some((user) => !activeMemberIds.has(user));
    const signer = knownSigner(record);
    return signer !== undefined && !activeMemberIds.has(signer);
  });
}

/**
 * The commands that spend somebody's subscription by starting a turn. Every
 * other command — interrupting a runaway turn, archiving, renaming — stays
 * open to every member who can open the Mate: a colleague must be able to stop
 * an agent they are not allowed to start.
 *
 * An answer to a question the agent asked in message mode is one of them: its
 * turn has ended, and the decider starts a new one with the answer as the
 * message. An answer to a native callback question is not — the agent's turn
 * is still running and waits on it. `request` is the question's latest
 * activity, which only an answer needs.
 */
export function isTurnStartingCommand(
  command: { readonly type: string },
  request?: Pick<OrchestrationThreadActivity, "kind" | "payload">,
): boolean {
  if (command.type === "thread.turn.start") return true;
  if (command.type !== "thread.user-input.respond" || request === undefined) return false;
  return (
    request.kind === "user-input.requested" &&
    typeof request.payload === "object" &&
    request.payload !== null &&
    (request.payload as { readonly responseMode?: unknown }).responseMode === "message"
  );
}

/**
 * How long a read stays good for the dispatch gate — of the project's tags,
 * and of the org's member list.
 */
export const SIGNERS_CACHE_TTL = Duration.seconds(30);

/**
 * How long a turn waits for the record of a sign-in its own person has just finished, or is
 * finishing. The app writes the record as the person the moment it sees the login succeed — the
 * same moment a new Mate's first turn (its stand-up) leaves — and the tag lands a few seconds on,
 * behind whatever else the app writes to the project then: a turn refused ahead of it was the
 * person's own, refused for a record already on its way (live runs, 2026-09-30 and 2026-10-01).
 */
export const SIGNER_RECORD_WAIT = Duration.seconds(30);
const SIGNER_RECORD_POLL = Duration.seconds(1);

/**
 * How often, and for how long, a feed reads the tags afresh ({@link ZeropsProjectSigners}'
 * `fresh`) after a sign-in this server walked, until the record names the person who signed in.
 * The app writes it a second or two after it sees the success, and retries a failed write for
 * ~20 s; meanwhile the cached read names the record from before — no record, or the earlier
 * signer — and with that one recorded nothing else would ever republish.
 */
export const SIGNER_RECORD_FRESH_POLL = Duration.seconds(2);
export const SIGNER_RECORD_FRESH_AWAIT = Duration.seconds(60);
/** A sign-in still running: its credential may already be written while its code is checked. */
const SIGN_IN_UNDER_WAY: ReadonlySet<ZeropsAgentLoginState["phase"]> = new Set([
  "starting",
  "menu",
  "awaiting-browser",
  "awaiting-code",
  "verifying-code",
]);

/** A login started longer ago than this has had its record written, or never will. */
const RECORD_ON_ITS_WAY_WITHIN = Duration.minutes(30);

/**
 * Who has just signed this agent in, by the login this server walked: its latest attempt that
 * succeeded — an attempt started, cancelled or failed after it changes nothing — not long ago,
 * naming who started it. Their app writes their record once it sees the success, so until it
 * lands the credential is theirs, whatever the record from before says.
 */
export function recentSignInBy(
  login:
    | Pick<ZeropsAgentLoginState, "phase" | "startedAt" | "startedBy" | "lastSucceeded">
    | undefined,
  nowMs: number,
): string | undefined {
  const success = latestSucceededSignIn(login);
  const by = success?.startedBy;
  if (success === undefined || by === undefined || by.length === 0) return undefined;
  const age = nowMs - DateTime.toEpochMillis(success.startedAt);
  return age < Duration.toMillis(RECORD_ON_ITS_WAY_WITHIN) ? by : undefined;
}

export class ZeropsProjectSigners extends Context.Service<
  ZeropsProjectSigners,
  {
    /** Who signed each agent in, from a read no older than {@link SIGNERS_CACHE_TTL}. */
    readonly signers: Effect.Effect<ProjectSigners>;
    /**
     * Who signed each agent in, read now and cached — a failed read answers what was last known.
     * For a record known to be on its way: a sign-in this server has just walked.
     */
    readonly fresh: Effect.Effect<ProjectSigners>;
    /**
     * {@link turnRefusal} for this session on `agentId`. A refusal that rests
     * on the signer record and came from the cache — or from what was last
     * known after a failed read — reads the tags once more and answers from
     * that read: a sign-in written inside the cache's lifetime is not refused
     * on the record from before it. A login this very person has just
     * finished waits up to {@link SIGNER_RECORD_WAIT} for its record, and
     * the signer before it runs nothing on the credential meanwhile.
     */
    readonly turnRefusal: (input: {
      readonly agentId: ZeropsAgentId;
      readonly agent: ZeropsAgentAuthFields & Pick<ZeropsAgentAuth, "flagToken">;
      readonly subject: string | undefined;
      /** The agent's server-driven login as this server holds it (`ZeropsAgentLogin`). */
      readonly login?: ZeropsAgentLoginState | undefined;
      /** That login as it stands now, read again while the turn waits on it. */
      readonly currentLogin?: Effect.Effect<ZeropsAgentLoginState | undefined> | undefined;
    }) => Effect.Effect<TurnRefusal | undefined>;
    /**
     * {@link loginTurnRefusal} for this session on the login whose signer tag
     * is `key` — the same cache and the same one re-read as `turnRefusal`.
     */
    readonly loginRefusal: (input: {
      readonly key: string;
      readonly state: ZeropsLoginState;
      readonly token: boolean;
      readonly subject: string | undefined;
      /** That login's server-driven sign-in as this server holds it (`ZeropsAgentLogin`). */
      readonly login?: ZeropsAgentLoginState | undefined;
      /** That login as it stands now, read again while the turn waits on it. */
      readonly currentLogin?: Effect.Effect<ZeropsAgentLoginState | undefined> | undefined;
    }) => Effect.Effect<TurnRefusal | undefined>;
    /**
     * Whether the org lists `userId` as an `ACTIVE` member, from a read no
     * older than {@link SIGNERS_CACHE_TTL}; `undefined` when the member list
     * cannot be read and nothing was known before. A read that fails answers
     * from the last list read, as the signers do.
     */
    readonly isActiveMember: (userId: string) => Effect.Effect<boolean | undefined>;
    /** Runs one leave check now and answers how many agents it signed out. */
    readonly checkLeaversNow: Effect.Effect<number>;
  }
>()("t3/zerops/ZeropsProjectSigners") {}

/**
 * The project's tags, as the Mate. `undefined` for every failure alike: the
 * gate treats "cannot read" as "no record", which refuses rather than admits.
 */
export const readProjectTagList = Effect.fn("ZeropsProjectSigners.readTags")(function* (input: {
  readonly environment: ZeropsEnvironment;
}) {
  const { apiBaseUrl, projectId } = input.environment;
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const { response } = yield* requestWithMateKey(mateKey, (token) =>
    zeropsGet({ url: `${apiBaseUrl}/project/${encodeURIComponent(projectId)}`, token }),
  ).pipe(
    Effect.catchTag("ZeropsApiUnavailableError", () =>
      Effect.succeed({ token: undefined, response: undefined }),
    ),
  );
  if (response === undefined || response.status !== 200) return undefined;
  const body = yield* readJson(response).pipe(
    Effect.catchTag("ZeropsApiUnavailableError", () => Effect.succeed(undefined)),
  );
  if (readProjectRoles(body) === null) return undefined;
  const tagList = (body as { readonly tagList?: unknown }).tagList;
  return Array.isArray(tagList)
    ? tagList.filter((tag): tag is string => typeof tag === "string")
    : [];
});

/** The signers off the project's tags, as the Mate; `undefined` when they cannot be read. */
export const readProjectSigners = Effect.fn("ZeropsProjectSigners.read")(function* (input: {
  readonly environment: ZeropsEnvironment;
}) {
  const tagList = yield* readProjectTagList(input);
  return tagList === undefined ? undefined : parseSignerTags(tagList);
});

/**
 * Whether `body` claims the member list it carried is the whole thing.
 *
 * No paging field on `GET /client/{id}/user/list` has ever been measured
 * (`docs/internals/zerops/verified.md` — 21 members read back in one
 * unpaged `clientUserList`, no `nextCursor`, no `totalCount` seen on this
 * endpoint specifically). So a `totalCount` this build has never observed is
 * read defensively rather than ignored: present and it must match the row
 * count read, or the list is partial; absent, the whole array is the whole
 * list, matching every read measured so far.
 */
export function isMemberListComplete(body: unknown, entriesLength: number): boolean {
  if (typeof body !== "object" || body === null) return true;
  const totalCount = (body as Record<string, unknown>)["totalCount"];
  if (typeof totalCount !== "number" || !Number.isFinite(totalCount)) return true;
  return entriesLength >= totalCount;
}

/**
 * Every `ACTIVE` member of the org, or `undefined` when the list is
 * unreadable OR partial (S6) — a page that is not the whole list must not
 * sign someone out for merely being off it.
 */
export const readActiveMemberIds = Effect.fn("ZeropsProjectSigners.readMembers")(function* (input: {
  readonly environment: ZeropsEnvironment;
}) {
  const { apiBaseUrl, projectId } = input.environment;
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const { response: projectResponse } = yield* requestWithMateKey(mateKey, (token) =>
    zeropsGet({ url: `${apiBaseUrl}/project/${encodeURIComponent(projectId)}`, token }),
  ).pipe(
    Effect.catchTag("ZeropsApiUnavailableError", () =>
      Effect.succeed({ token: undefined, response: undefined }),
    ),
  );
  if (projectResponse === undefined || projectResponse.status !== 200) return undefined;
  const project = readProjectRoles(
    yield* readJson(projectResponse).pipe(
      Effect.catchTag("ZeropsApiUnavailableError", () => Effect.succeed(undefined)),
    ),
  );
  if (project === null) return undefined;

  const { response: memberResponse } = yield* requestWithMateKey(mateKey, (token) =>
    zeropsGet({
      url: `${apiBaseUrl}/client/${encodeURIComponent(project.clientId)}/user/list`,
      token,
    }),
  ).pipe(
    Effect.catchTag("ZeropsApiUnavailableError", () =>
      Effect.succeed({ token: undefined, response: undefined }),
    ),
  );
  if (memberResponse === undefined || memberResponse.status !== 200) return undefined;
  const memberBody = yield* readJson(memberResponse).pipe(
    Effect.catchTag("ZeropsApiUnavailableError", () => Effect.succeed(undefined)),
  );
  const entries = readMemberEntries(memberBody);
  // An empty list is an outage dressed as an answer, and acting on it would
  // delete every login in the container.
  if (entries === null || entries.length === 0) return undefined;
  // A partial page changes nothing (S6): a signer merely off this page is
  // not a signer the org lost.
  if (!isMemberListComplete(memberBody, entries.length)) return undefined;
  return new Set(
    readOrgMembers(entries)
      .filter((member) => member.status === "ACTIVE")
      .map((member) => member.userId),
  );
});

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const environment = config.zerops;
  const httpClient = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homeDir = NodeOS.homedir();
  /** `seq` orders reads by when they set out: a read that came back late is older than `seq`. */
  const cache = yield* Ref.make<{
    readonly at: number;
    readonly seq: number;
    readonly value: ProjectSigners;
  } | null>(null);
  const readSeq = yield* Ref.make(0);
  const members = yield* Ref.make<{
    readonly at: number;
    readonly value: ReadonlySet<string>;
  } | null>(null);
  // The process-wide reader, shared with the door and the watch — provided
  // by the layer this service's own layer composes above
  // (`zeropsFeedsLayer.ts`).
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;

  const withHttp = <A>(
    effect: Effect.Effect<A, never, HttpClient.HttpClient | ZeropsMateKeyModule.ZeropsMateKey>,
  ) =>
    effect.pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
    );

  /**
   * The tags read now, cached on success. A read that failed keeps whatever
   * was last known rather than inventing an empty record: forgetting a signer
   * would lock the person who signed in out of their own agent.
   */
  const readThrough = (environment: ZeropsEnvironment) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const seq = yield* Ref.updateAndGet(readSeq, (n) => n + 1);
      const read = yield* withHttp(readProjectSigners({ environment }));
      if (read === undefined) {
        return { value: (yield* Ref.get(cache))?.value ?? {}, fresh: false };
      }
      // A read that set out before the one the cache holds saw an older project: a record that
      // landed in between stays, and the late read answers with it.
      return yield* Ref.modify(cache, (held) =>
        held !== null && held.seq > seq
          ? [{ value: held.value, fresh: true }, held]
          : [
              { value: read, fresh: true },
              { at: now, seq, value: read },
            ],
      );
    });

  /** The signers, and whether they come from a read made for this call. */
  const cachedOrRead = (environment: ZeropsEnvironment) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const held = yield* Ref.get(cache);
      if (held !== null && now - held.at < Duration.toMillis(SIGNERS_CACHE_TTL)) {
        return { value: held.value, fresh: false };
      }
      return yield* readThrough(environment);
    });

  /** The org's active members read now, cached on success. */
  const readMembersThrough = (environment: ZeropsEnvironment) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const read = yield* withHttp(readActiveMemberIds({ environment }));
      if (read !== undefined) yield* Ref.set(members, { at: now, value: read });
      return read;
    });

  const isActiveMember: ZeropsProjectSigners["Service"]["isActiveMember"] = (userId) =>
    environment === undefined
      ? Effect.succeed(undefined)
      : Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const held = yield* Ref.get(members);
          if (held !== null && now - held.at < Duration.toMillis(SIGNERS_CACHE_TTL)) {
            return held.value.has(userId);
          }
          const read = yield* readMembersThrough(environment);
          return (read ?? held?.value)?.has(userId);
        });

  const signers: ZeropsProjectSigners["Service"]["signers"] =
    environment === undefined
      ? Effect.succeed({})
      : cachedOrRead(environment).pipe(Effect.map((read) => read.value));

  /**
   * `base` against the signer of `key`, with the sign-in this server walks for that login. From
   * the cache, and once more from a fresh read; a refusal on a record from before somebody's
   * sign-in is never a cached one. Whoever signed in last holds the credential, however long
   * ago: a record naming anybody else runs nothing. And the very person whose sign-in has just
   * finished here, or is finishing — the credential written while the code is still checked —
   * waits for it and for their record on its way, read afresh a second at a time, up to
   * {@link SIGNER_RECORD_WAIT}; the wait ends early on a sign-in that failed or was cancelled.
   */
  const gateSignedIn = (
    key: string,
    base: (signer: SignerRecord | undefined) => TurnRefusal | undefined,
    input: {
      readonly token: boolean;
      readonly subject: string | undefined;
      readonly login: ZeropsAgentLoginState | undefined;
      readonly currentLogin?: Effect.Effect<ZeropsAgentLoginState | undefined> | undefined;
    },
  ) =>
    Effect.gen(function* () {
      const { token, subject } = input;
      const person = subject !== undefined && subject.length > 0 ? subject : undefined;
      const judge = (login: ZeropsAgentLoginState | undefined, nowMs: number) => {
        const signedInBy = recentSignInBy(login, nowMs);
        const heldBy = latestSucceededSignIn(login)?.startedBy;
        const underWay =
          login !== undefined && SIGN_IN_UNDER_WAY.has(login.phase) ? login.startedBy : undefined;
        return {
          refuse: (signer: SignerRecord | undefined): TurnRefusal | undefined => {
            const refusal = base(signer);
            if (refusal !== undefined || token || heldBy === undefined || heldBy.length === 0) {
              return refusal;
            }
            return heldBy === subject ? undefined : { kind: "someone-else" };
          },
          recent: !token && (signedInBy !== undefined || underWay !== undefined),
          // This person's sign-in, finished here or finishing: their record is on its way.
          onItsWay: person !== undefined && (signedInBy === person || underWay === person),
        };
      };
      let now = judge(input.login, yield* Clock.currentTimeMillis);
      if (environment === undefined) return now.refuse(undefined);
      const held = yield* cachedOrRead(environment);
      let refusal = now.refuse(held.value[key]);
      if (refusal?.kind === "not-signed-in") return refusal;
      // A cached admission stands, unless somebody has just signed this login in: the record
      // from before the sign-in may name another person than the one it holds now.
      if (refusal === undefined && !now.recent) return refusal;
      if (!held.fresh) refusal = now.refuse((yield* readThrough(environment)).value[key]);
      if (!now.onItsWay) return refusal;
      const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(SIGNER_RECORD_WAIT);
      // No record, somebody else's from before, or one naming two people: each ends in this
      // person's own once it lands.
      while (
        refusal !== undefined &&
        refusal.kind !== "not-signed-in" &&
        now.onItsWay &&
        (yield* Clock.currentTimeMillis) < deadline
      ) {
        yield* Effect.sleep(SIGNER_RECORD_POLL);
        const login = input.currentLogin === undefined ? input.login : yield* input.currentLogin;
        now = judge(login, yield* Clock.currentTimeMillis);
        refusal = now.refuse((yield* readThrough(environment)).value[key]);
      }
      return refusal;
    });

  const gateTurn: ZeropsProjectSigners["Service"]["turnRefusal"] = ({
    agentId,
    agent,
    subject,
    login,
    currentLogin,
  }) =>
    gateSignedIn(agentId, (signer) => turnRefusal({ agent, signer, subject }), {
      token: agent.flagToken,
      subject,
      login,
      currentLogin,
    });

  const gateLogin: ZeropsProjectSigners["Service"]["loginRefusal"] = ({
    key,
    state,
    token,
    subject,
    login,
    currentLogin,
  }) =>
    gateSignedIn(key, (signer) => loginTurnRefusal({ state, token, signer, subject }), {
      token,
      subject,
      login,
      currentLogin,
    });

  const checkLeaversNow: ZeropsProjectSigners["Service"]["checkLeaversNow"] =
    environment === undefined
      ? Effect.succeed(0)
      : Effect.gen(function* () {
          const current = (yield* readThrough(environment)).value;
          if (Object.keys(current).length === 0) return 0;
          const activeMemberIds = yield* readMembersThrough(environment);
          const departed = planAgentSignOut({ signers: current, activeMemberIds });
          for (const agentId of departed) {
            yield* fs
              .remove(path.join(homeDir, ...AGENT_CREDENTIAL_SEGMENTS[agentId]), { force: true })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning("Could not sign a departed member's agent out.", {
                    agentId,
                    cause,
                  }),
                ),
                Effect.orElseSucceed(() => undefined),
              );
          }
          return departed.length;
        }).pipe(Effect.catchCause(() => Effect.succeed(0)));

  if (environment !== undefined) {
    yield* Effect.forkScoped(
      checkLeaversNow.pipe(Effect.repeat(Schedule.spaced(environment.roleRecheckInterval))),
    );
  }

  const fresh: ZeropsProjectSigners["Service"]["fresh"] =
    environment === undefined
      ? Effect.succeed({})
      : readThrough(environment).pipe(Effect.map((read) => read.value));

  return ZeropsProjectSigners.of({
    signers,
    fresh,
    turnRefusal: gateTurn,
    loginRefusal: gateLogin,
    isActiveMember,
    checkLeaversNow,
  });
});

export const layer = Layer.effect(ZeropsProjectSigners, make);
