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
  ZeropsLoginState,
} from "@t3tools/contracts";
import {
  classifyZeropsAgentAuth,
  type ZeropsAgentAuthFields,
  type ZeropsAgentAuthKind,
} from "@t3tools/shared/zeropsAgentAuth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
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

/**
 * One login's record: the Zerops user id of whoever signed it in, or — where the project carries
 * records for two or more people — who it may be, sorted, since whose it is is not known.
 */
export type SignerRecord = string | { readonly among: ReadonlyArray<string> };

/** The one person a record names, or undefined where it names nobody or is not known. */
export const knownSigner = (record: SignerRecord | undefined): string | undefined =>
  typeof record === "string" && record.length > 0 ? record : undefined;

export function signerTag(key: string, userId: string): string {
  return `${MATE_SIGNER_TAG_PREFIX}:${key}:${userId}`;
}

/**
 * Reads the signer tags off a project's tag list: one per agent's default
 * login, and one per other login under that login's own id.
 *
 * Tolerant by design: an unknown login key, an empty user id and a tag with the
 * wrong number of parts each drop out on their own. A tag list is a shared
 * space — people put their own tags there — and one it does not understand
 * must never cost it the ones it does.
 *
 * A project that carries records for two or more people on one login (two sign-ins racing their
 * tag writes, a hand edit) says who it may be, never whose it is: the order the platform lists
 * tags in is no evidence. A re-sign-in writes its tag over every other (`withMateSignerTag`).
 */
export function parseSignerTags(tagList: ReadonlyArray<string> | undefined): ProjectSigners {
  const named = new Map<string, Set<string>>();
  for (const tag of tagList ?? []) {
    if (!tag.startsWith(`${MATE_SIGNER_TAG_PREFIX}:`)) continue;
    const rest = tag.slice(MATE_SIGNER_TAG_PREFIX.length + 1);
    const separator = rest.indexOf(":");
    if (separator <= 0) continue;
    const key = rest.slice(0, separator);
    const userId = rest.slice(separator + 1);
    if (userId.length === 0 || !isLoginSignerKey(key)) continue;
    named.set(key, (named.get(key) ?? new Set()).add(userId));
  }
  const signers: Partial<Record<string, SignerRecord>> = {};
  for (const [key, users] of named) {
    const [only, ...more] = [...users].toSorted();
    if (only === undefined) continue;
    signers[key] = more.length === 0 ? only : { among: [only, ...more] };
  }
  return signers;
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
  | { readonly kind: "someone-else" };

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
  if (typeof signer === "object") {
    // Whose it is is not known: somebody it may be is admitted, nobody else.
    return input.subject !== undefined && signer.among.includes(input.subject)
      ? undefined
      : { kind: "someone-else" };
  }
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
    // A record that names two people says of neither that the login is theirs.
    const signer = knownSigner(input.signers[agentId]);
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

export class ZeropsProjectSigners extends Context.Service<
  ZeropsProjectSigners,
  {
    /** Who signed each agent in, from a read no older than {@link SIGNERS_CACHE_TTL}. */
    readonly signers: Effect.Effect<ProjectSigners>;
    /**
     * {@link turnRefusal} for this session on `agentId`. A refusal that rests
     * on the signer record and came from the cache — or from what was last
     * known after a failed read — reads the tags once more and answers from
     * that read: a sign-in written inside the cache's lifetime is not refused
     * on the record from before it.
     */
    readonly turnRefusal: (input: {
      readonly agentId: ZeropsAgentId;
      readonly agent: ZeropsAgentAuthFields & Pick<ZeropsAgentAuth, "flagToken">;
      readonly subject: string | undefined;
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
export const readProjectSigners = Effect.fn("ZeropsProjectSigners.read")(function* (input: {
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
  return parseSignerTags(
    Array.isArray(tagList) ? tagList.filter((tag): tag is string => typeof tag === "string") : [],
  );
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
  const cache = yield* Ref.make<{ readonly at: number; readonly value: ProjectSigners } | null>(
    null,
  );
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
      const read = yield* withHttp(readProjectSigners({ environment }));
      if (read === undefined) {
        return { value: (yield* Ref.get(cache))?.value ?? {}, fresh: false };
      }
      yield* Ref.set(cache, { at: now, value: read });
      return { value: read, fresh: true };
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

  /** `refuse` against the signer of `key`: from the cache, and once more from a fresh read. */
  const gate = (
    key: string,
    refuse: (signer: SignerRecord | undefined) => TurnRefusal | undefined,
  ) =>
    Effect.gen(function* () {
      if (environment === undefined) return refuse(undefined);
      const held = yield* cachedOrRead(environment);
      const refusal = refuse(held.value[key]);
      if (refusal === undefined || refusal.kind === "not-signed-in" || held.fresh) return refusal;
      const reread = yield* readThrough(environment);
      return refuse(reread.value[key]);
    });

  const gateTurn: ZeropsProjectSigners["Service"]["turnRefusal"] = ({ agentId, agent, subject }) =>
    gate(agentId, (signer) => turnRefusal({ agent, signer, subject }));

  const gateLogin: ZeropsProjectSigners["Service"]["loginRefusal"] = ({
    key,
    state,
    token,
    subject,
  }) => gate(key, (signer) => loginTurnRefusal({ state, token, signer, subject }));

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

  return ZeropsProjectSigners.of({
    signers,
    turnRefusal: gateTurn,
    loginRefusal: gateLogin,
    isActiveMember,
    checkLeaversNow,
  });
});

export const layer = Layer.effect(ZeropsProjectSigners, make);
