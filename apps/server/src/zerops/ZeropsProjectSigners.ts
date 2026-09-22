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
import type { ZeropsAgentId } from "@t3tools/contracts";
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

/** D6's record, on the Mate's own project: `mate:signer:{agent}:{userId}`. */
export const MATE_SIGNER_TAG_PREFIX = "mate:signer";

/** The agents this build knows how to record a signer for. */
const KNOWN_AGENT_IDS: ReadonlyArray<ZeropsAgentId> = ["claude-code", "codex"];

/** Where each agent CLI keeps the credential a sign-out removes. */
export const AGENT_CREDENTIAL_SEGMENTS: Readonly<Record<ZeropsAgentId, ReadonlyArray<string>>> = {
  "claude-code": [".claude", ".credentials.json"],
  codex: [".codex", "auth.json"],
};

/** Agent id → the Zerops user id of whoever signed it in. */
export type ProjectSigners = Readonly<Partial<Record<ZeropsAgentId, string>>>;

export function signerTag(agentId: ZeropsAgentId, userId: string): string {
  return `${MATE_SIGNER_TAG_PREFIX}:${agentId}:${userId}`;
}

/**
 * Reads the signer tags off a project's tag list.
 *
 * Tolerant by design: an unknown agent id, an empty user id and a tag with the
 * wrong number of parts each drop out on their own. A tag list is a shared
 * space — people put their own tags there — and one it does not understand
 * must never cost it the ones it does.
 *
 * Last one wins when a project somehow carries two for the same agent: a
 * re-sign-in writes the new tag, and the reconcile that removes the old one is
 * the app's.
 */
export function parseSignerTags(tagList: ReadonlyArray<string> | undefined): ProjectSigners {
  const signers: Partial<Record<ZeropsAgentId, string>> = {};
  for (const tag of tagList ?? []) {
    if (!tag.startsWith(`${MATE_SIGNER_TAG_PREFIX}:`)) continue;
    const rest = tag.slice(MATE_SIGNER_TAG_PREFIX.length + 1);
    const separator = rest.indexOf(":");
    if (separator <= 0) continue;
    const agentId = rest.slice(0, separator);
    const userId = rest.slice(separator + 1);
    if (userId.length === 0) continue;
    const known = KNOWN_AGENT_IDS.find((entry) => entry === agentId);
    if (known === undefined) continue;
    signers[known] = userId;
  }
  return signers;
}

/**
 * Whether this session may start a turn on this agent (D6).
 *
 * - a **token**-authorized agent is nobody's personal login, so it is
 *   unaffected: `flagToken` means the container was given an API key, and an
 *   API key belongs to the project;
 * - an agent with **no credential** has no identity to protect;
 * - an agent whose recorded signer **is** this session's subject: yes;
 * - anything else — someone else's, or no record at all — no. D6 keeps no
 *   backward compatibility here: a login with no recorded signer (an older
 *   one, a terminal login, a copied file) cannot run until somebody signs in
 *   through Mate, because "unrecorded" and "somebody else's" are the same
 *   thing to everyone but the person who knows.
 */
export function mayStartTurn(input: {
  readonly signer: string | undefined;
  readonly subject: string | undefined;
  readonly credPresent: boolean;
  readonly tokenAuthorized: boolean;
}): boolean {
  if (input.tokenAuthorized) return true;
  if (!input.credPresent) return true;
  if (input.signer === undefined || input.signer.length === 0) return false;
  return input.subject !== undefined && input.subject === input.signer;
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
    const signer = input.signers[agentId];
    return signer !== undefined && signer.length > 0 && !activeMemberIds.has(signer);
  });
}

/**
 * The commands that spend somebody's subscription by starting a turn. Every
 * other command — interrupting a runaway turn, archiving, renaming — stays
 * open to every member who can open the Mate: a colleague must be able to stop
 * an agent they are not allowed to start.
 */
export function isTurnStartingCommand(type: string): boolean {
  return type === "thread.turn.start";
}

/** How long a read of the project's tags stays good for the dispatch gate. */
export const SIGNERS_CACHE_TTL = Duration.seconds(30);

export class ZeropsProjectSigners extends Context.Service<
  ZeropsProjectSigners,
  {
    /** Who signed each agent in, from a read no older than {@link SIGNERS_CACHE_TTL}. */
    readonly signers: Effect.Effect<ProjectSigners>;
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

  const signers: ZeropsProjectSigners["Service"]["signers"] =
    environment === undefined
      ? Effect.succeed({})
      : Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const held = yield* Ref.get(cache);
          if (held !== null && now - held.at < Duration.toMillis(SIGNERS_CACHE_TTL)) {
            return held.value;
          }
          const read = yield* withHttp(readProjectSigners({ environment }));
          // A read that failed keeps whatever was last known rather than
          // inventing an empty record: forgetting a signer would lock the
          // person who signed in out of their own agent.
          if (read === undefined) return held?.value ?? {};
          yield* Ref.set(cache, { at: now, value: read });
          return read;
        });

  const checkLeaversNow: ZeropsProjectSigners["Service"]["checkLeaversNow"] =
    environment === undefined
      ? Effect.succeed(0)
      : Effect.gen(function* () {
          const read = yield* withHttp(readProjectSigners({ environment }));
          if (read !== undefined) {
            yield* Ref.set(cache, { at: yield* Clock.currentTimeMillis, value: read });
          }
          const current = read ?? (yield* Ref.get(cache))?.value ?? {};
          if (Object.keys(current).length === 0) return 0;
          const activeMemberIds = yield* withHttp(readActiveMemberIds({ environment }));
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

  return ZeropsProjectSigners.of({ signers, checkLeaversNow });
});

export const layer = Layer.effect(ZeropsProjectSigners, make);
