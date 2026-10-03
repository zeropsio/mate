/**
 * HQ's API as the client calls it (`apps/hq/src/api.ts`), through HQ's door.
 *
 * A person enters HQ as they enter a Mate: the app mints a throwaway named for HQ's project
 * (`mate-door:<hqProjectId>:<nonce>`), presents it once at `POST /api/door`, and deletes it
 * (`withThrowaway`). HQ answers a session of its own, which this client keeps in memory and sends
 * as `Authorization: Bearer` until HQ stops taking it; then it comes through the door once more.
 * Nothing of it is stored anywhere else.
 *
 * Every failure is an {@link HqError}: `unavailable` when HQ could not be reached or is not
 * serving (`503 not_active`, a standby or an HQ that is not the official one), `refused` when it
 * answered no — with HQ's own code and words — and `uncertain` when a write's answer was lost and
 * what HQ holds, read back at once, does not show it made.
 *
 * @module hq/client
 */
import {
  attachmentPath,
  ChangeDetailResponse,
  CommentListResponse,
  CompareResponse,
  HqChange,
  HqChangeComment,
  RepoListResponse,
  type AttachmentLink,
  type ChangeLink,
  type CompareQuery,
  type RepoListEntry,
} from "@t3tools/shared/hqChanges";
import { RecipeTierResponse, type RecipeTier } from "@t3tools/shared/hqRecipe";
import {
  Release,
  ReleaseListResponse,
  type CreateReleaseRequest,
  type RollbackRequest,
} from "@t3tools/shared/hqRelease";
import type { MateSummary } from "@t3tools/shared/mateLink";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { parseRetryAfterMs, type FetchImplementation } from "../api.ts";
import type { HqEnvironment } from "./environments.ts";
import { hqRefusalWords } from "./refusals.ts";
import { structureEventOf, type HqStructureEvent } from "./stream.ts";

/** An organization's HQ: its project, and the address its anchor names. */
export interface HqEndpoint {
  readonly projectId: string;
  readonly address: string;
}

/** A Mate's record in HQ: its name, and its face in the grammar `readMateFace` reads. */
export interface HqMateRecord {
  readonly name: string;
  readonly face: string;
}

/** A Mate's live summary, as HQ relays it to whoever may operate it (`observe_mate`). */
export interface HqMateLive {
  readonly online: boolean;
  /** When the summary was sent, or the Mate last went online or offline: ISO. */
  readonly at: string;
  readonly summary: MateSummary | null;
}

/** A Mate as HQ reads it: its record, its birth, and its live summary where HQ relays one. */
export interface HqMate extends HqMateRecord {
  /**
   * Who made it — whoever set its record up: a Mate recorded before HQ kept it is null; an older
   * HQ says nothing.
   */
  readonly madeBy?: string | null;
  /** Who asked for its stand-up (`recordStandUp`): nobody yet is null; an older HQ says nothing. */
  readonly standupRequestedBy?: string | null;
  /** Whether its project is closed off (`recordClosedOff`); an older HQ says nothing. */
  readonly closedOff?: boolean;
  readonly live?: HqMateLive;
}

/** What `GET /api/structure` answers: the applications as the reader sees them in Zerops. */
export interface HqStructure {
  /** The Mates HQ holds in no application: their project's name in Zerops, and their record. */
  readonly ungrouped: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    readonly mate: HqMate;
  }>;
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly projects: ReadonlyArray<{
      readonly projectId: string;
      readonly name: string;
      readonly kind: string;
      readonly mate: HqMate | null;
    }>;
    /**
     * Its stage and production with their deploys (`hq/environments.ts`), to whoever reads its
     * changes — none to one who only sees it; absent where HQ sent none this build can read.
     */
    readonly environments?: ReadonlyArray<HqEnvironment>;
  }>;
}

export interface HqAttach {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  /** The Mate's name and face; with kind `mate`, and only with it. */
  readonly mate?: HqMateRecord;
  /** A stage's or a production's environment name; HQ names it from its project without one. */
  readonly environment?: { readonly name: string };
}

export class HqError extends Error {
  /**
   * `unavailable` when HQ could not be reached or is not serving; `refused` when it answered no;
   * `uncertain` when a write was sent and its answer lost — HQ may have made it.
   */
  readonly kind: "unavailable" | "refused" | "uncertain";
  /** HQ's code (`forbidden`, `conflict`, `not_active`, …), or `network`. */
  readonly code: string;
  /** HQ's reason code beside it, where it named one (`tag_taken`, `change_not_open`, …). */
  readonly reason: string | undefined;
  readonly status: number | undefined;
  constructor(input: {
    readonly kind: HqError["kind"];
    readonly code: string;
    readonly reason?: string | undefined;
    readonly status?: number | undefined;
    readonly message: string;
  }) {
    super(input.message);
    this.name = "HqError";
    this.kind = input.kind;
    this.code = input.code;
    this.reason = input.reason;
    this.status = input.status;
  }
}

export interface HqApi {
  readonly structure: (signal?: AbortSignal) => Promise<HqStructure>;
  /**
   * The structure as it changes (`stream.ts`), with the Mates the reader observes and the people
   * its view names (`mates.ts`), over a socket opened with a ticket for the session: every event
   * to `onEvent`, every message — events and pings alike — to `onAlive`. Ends when HQ hands the
   * reader to another Core, or ends the session (the next call enters the door again); fails when
   * the socket breaks; runs until `signal` aborts.
   */
  readonly streamStructure: (
    handlers: {
      readonly onEvent: (event: HqStructureEvent) => void;
      readonly onAlive: () => void;
    },
    signal: AbortSignal,
  ) => Promise<void>;
  /** A Mate's name or face, as HQ records them (`PATCH /api/mates/{projectId}`). */
  readonly updateMate: (
    projectId: string,
    change: { readonly name?: string; readonly face?: string },
  ) => Promise<void>;
  /** An application's name (`PATCH /api/apps/{id}`). */
  readonly renameApp: (appId: string, name: string) => Promise<void>;
  /** Deletes an application that holds nothing; HQ refuses one that does (`app_not_empty`). */
  readonly deleteApp: (appId: string) => Promise<void>;
  /**
   * A project into an application as `kind`, or a Mate out of every one — `appId: null` (`PUT
   * /api/projects/{projectId}/app`).
   */
  readonly moveProject: (
    projectId: string,
    to: { readonly appId: string | null; readonly kind: RoleProjectKind },
  ) => Promise<void>;
  /** A Mate set up on a project of its own, in no application (`POST /api/mates`). */
  readonly createMate: (mate: { readonly projectId: string } & HqMateRecord) => Promise<void>;
  /**
   * The Mate's birth, as its project's owner or admin records it: who asks for its stand-up — the
   * caller (`POST /api/mates/{projectId}/standup`) — and that its project is closed off (`POST
   * /api/mates/{projectId}/closed-off`). HQ refuses either on a Mate it holds no record of
   * (`mate_not_found`).
   */
  readonly recordStandUp: (projectId: string) => Promise<void>;
  readonly recordClosedOff: (projectId: string) => Promise<void>;
  readonly createApp: (name: string) => Promise<{ readonly id: string; readonly name: string }>;
  readonly attachProject: (appId: string, attach: HqAttach) => Promise<void>;
  /**
   * An environment's deploy token, minted by the person's own client, kept by HQ (`PUT
   * /api/apps/:appId/environments/:name/deploy-token`); the structure says only that it holds one.
   */
  readonly keepDeployToken: (appId: string, environment: string, token: string) => Promise<void>;
  /**
   * "Run again": the environment's newest deploy of `service`, at `sha`, failed, asked again as
   * the person (`POST /api/apps/:appId/environments/:name/redeploy`); HQ's stream brings it.
   */
  readonly redeploy: (
    appId: string,
    environment: string,
    deploy: { readonly service: string; readonly sha: string },
  ) => Promise<void>;
  /** A Mate's change with what its review reads (`GET /api/apps/:appId/changes/:repo/:n`). */
  readonly change: (link: ChangeLink, signal?: AbortSignal) => Promise<ChangeDetailResponse>;
  /** What was said on a change, oldest first. */
  readonly changeComments: (
    link: ChangeLink,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<HqChangeComment>>;
  /** Says `body` on a change, as the person. */
  readonly commentOnChange: (link: ChangeLink, body: string) => Promise<HqChangeComment>;
  /**
   * Squashes a change into `main` as the person, if its head is still `expectedHead` — the head
   * they were shown; HQ answers the change merged, or refuses with one of `MERGE_REFUSALS`.
   */
  readonly mergeChange: (link: ChangeLink, expectedHead: string) => Promise<HqChange>;
  /** Closes a change without merging it, as the person; its branch stays. */
  readonly closeChange: (link: ChangeLink) => Promise<HqChange>;
  /** A picture of a change, read as the person (`attachmentPath`). */
  readonly changeAttachment: (link: AttachmentLink, signal?: AbortSignal) => Promise<Blob>;
  /**
   * A tier of an application's recipe as its recipe repository's `main` holds it, read as the
   * person (`GET /api/apps/:appId/recipe/:tier`): `absent` where it is not there or declares no
   * service.
   */
  readonly recipeTier: (
    appId: string,
    tier: RecipeTier,
    signal?: AbortSignal,
  ) => Promise<RecipeTierResponse>;
  /**
   * An application's repositories, read as the person (`GET /api/apps/:appId/repos`): whoever may
   * read its changes.
   */
  readonly appRepos: (appId: string, signal?: AbortSignal) => Promise<ReadonlyArray<RepoListEntry>>;
  /**
   * What lies between two commits of an application's repository, by its name, read as the person
   * (`GET /api/apps/:appId/repos/:repo/compare`): git's `base..head`, whoever may read its changes.
   */
  readonly compare: (
    appId: string,
    repo: string,
    query: CompareQuery,
    signal?: AbortSignal,
  ) => Promise<CompareResponse>;
  /**
   * An application's releases, newest first by version, read as the person (`GET
   * /api/apps/:appId/releases`): whoever may read its changes.
   */
  readonly releases: (appId: string, signal?: AbortSignal) => Promise<ReadonlyArray<Release>>;
  /** A release made in HQ as the person, of what its offer showed; HQ tags and deploys it. */
  readonly release: (appId: string, request: CreateReleaseRequest) => Promise<Release>;
  /** Production back to `tag` as the person: a new release listing its entries. */
  readonly rollback: (appId: string, tag: string, request: RollbackRequest) => Promise<Release>;
}

/** A socket the structure stream reads, opened by the host (`WebSocket` in a browser). */
export interface HqSocket {
  readonly send: (data: string) => void;
  readonly close: () => void;
}

/** Opens `url`, telling `on` of every text message and of the close, with its code. */
export type OpenHqSocket = (
  url: string,
  on: { readonly message: (data: string) => void; readonly close: (code: number) => void },
) => HqSocket;

/** How HQ closes a structure socket (`apps/hq/src/stream.ts`). */
const SOCKET_CLOSE = {
  /** Another Core leads now, or this one is stopping: read again at once. */
  goingAway: 1001,
  /** The session ended: enter the door again. */
  sessionEnded: 4401,
} as const;

const PONG = JSON.stringify({ type: "pong" });

/** How long a read waits for HQ's answer. */
const CALL_TIMEOUT_MS = 20_000;
/**
 * How long the door and every write wait for HQ's answer. HQ reads the org from Zerops for each,
 * which took tens of seconds on a slow Zerops (measured 2026-10-03): a door given up at 20 s threw
 * HQ's answer away, and the next caller minted another throwaway for a door queued behind the
 * first; a release given up at 20 s told the person "HQ could not be reached." of a release under
 * way (F22).
 */
const WRITE_TIMEOUT_MS = 45_000;

/**
 * A call that changes what HQ holds: one HQ makes again the same if asked twice
 * (`idempotent` — it sets a value), or one it would make twice (`once`).
 */
type Write = "once" | "idempotent";

/**
 * What a write whose answer was lost says, when HQ holds nothing of it either: main's words for an
 * attempt that may have landed (`docs/internals/zerops/client-state-model.md`, command attempts).
 */
export const HQ_WRITE_UNCERTAIN =
  "HQ could not confirm whether this finished. Check the project before trying again.";

const uncertain = () =>
  new HqError({ kind: "uncertain", code: "uncertain", message: HQ_WRITE_UNCERTAIN });

/** HQ's code and reason in an answer's body; a body that is not HQ's JSON names neither. */
function said(text: string): { readonly code?: unknown; readonly reason?: unknown } {
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null ? body : { code: undefined };
  } catch {
    return { code: undefined };
  }
}

async function errorOf(response: Response): Promise<HqError> {
  const body = said(await response.text());
  const code = typeof body.code === "string" ? body.code : `http_${response.status}`;
  if (response.status >= 500 || response.status === 429) {
    return new HqError({
      kind: "unavailable",
      code,
      status: response.status,
      message: "HQ is not answering right now.",
    });
  }
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  return new HqError({
    kind: "refused",
    code,
    reason,
    status: response.status,
    message: hqRefusalWords({ code, reason }),
  });
}

/** A call stopped by its caller or by its own timeout: never one to try again. */
const stopped = (cause: unknown, signal: AbortSignal | null | undefined) =>
  signal?.aborted === true ||
  (cause instanceof DOMException && (cause.name === "AbortError" || cause.name === "TimeoutError"));

/**
 * One call to HQ: its answer, or an {@link HqError}. A read whose connection drops under it is
 * tried once more — a kept-alive connection is cut as HQ's Core is redeployed (measured on the rig,
 * 2026-10-02) — and HQ's own answer never is.
 *
 * A write HQ would make twice is never sent twice: one whose answer was lost — its deadline passed,
 * its connection dropped, or HQ failed it on its way (`5xx`, but `not_active`) — is `uncertain`,
 * for what HQ holds to decide. A write that sets a value HQ answered `503` with a `Retry-After` is
 * asked once more after it, a wait of 45 s at most (F22: HQ could not read Zerops in time).
 */
async function send(
  fetch: FetchImplementation,
  url: string,
  init: RequestInit,
  write?: Write,
): Promise<Response> {
  const response = await sendOnce(fetch, url, init, write);
  if (write !== "idempotent" || response.status !== 503) return answered(response, write);
  // @effect-diagnostics-next-line globalDate:off -- an HTTP date is read against the wall clock it names.
  const wait = parseRetryAfterMs(response.headers.get("retry-after"), Date.now());
  if (wait === null) return answered(response, write);
  // @effect-diagnostics-next-line globalTimers:off -- plain promises: the wait HQ asked for.
  await new Promise((resolve) => setTimeout(resolve, Math.min(wait, WRITE_TIMEOUT_MS)));
  return answered(await sendOnce(fetch, url, init, write), write);
}

/**
 * HQ's answer as the call's outcome. A write HQ failed on its way (`5xx`) may have landed — but
 * for a Core that does not lead (`not_active`), which writes nothing.
 */
async function answered(response: Response, write: Write | undefined): Promise<Response> {
  if (response.ok) return response;
  const error = await errorOf(response);
  if (write === "once" && response.status >= 500 && error.code !== "not_active") {
    throw uncertain();
  }
  throw error;
}

/** The call sent, with its deadline, and HQ's answer whatever it says. */
async function sendOnce(
  fetch: FetchImplementation,
  url: string,
  init: RequestInit,
  write: Write | undefined,
): Promise<Response> {
  const signal =
    init.signal ?? AbortSignal.timeout(write === undefined ? CALL_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  const headers = {
    Accept: "application/json",
    ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...init.headers,
  };
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal, headers });
    } catch (cause) {
      if (write !== undefined) throw uncertain();
      if (attempt === 0 && !stopped(cause, signal)) continue;
      throw new HqError({
        kind: "unavailable",
        code: "network",
        message: "HQ could not be reached.",
      });
    }
    return response;
  }
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/**
 * An answer read through the contract's schema (`@t3tools/shared/hqChanges`): one this version of
 * Mate cannot read is refused, never drawn in part.
 */
const decoded =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  async (response: Response): Promise<S["Type"]> => {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw unreadable();
    }
    return Option.getOrThrowWith(Schema.decodeUnknownOption(schema)(body), unreadable);
  };

const unreadable = () =>
  new HqError({
    kind: "refused",
    code: "unreadable",
    message: "HQ answered in a form this version of Mate does not read.",
  });

const readChangeDetail = decoded(ChangeDetailResponse);
const readComments = decoded(CommentListResponse);
const readComment = decoded(HqChangeComment);
const readChange = decoded(HqChange);
const readRecipeTier = decoded(RecipeTierResponse);

const readAppRepos = decoded(RepoListResponse);
const readCompare = decoded(CompareResponse);
const readReleases = decoded(ReleaseListResponse);
const readRelease = decoded(Release);

/** Whether two releases put the same commits live: each service at the same commit. */
const sameEntries = (
  made: ReadonlyArray<{ readonly service: string; readonly sha: string }>,
  asked: ReadonlyArray<{ readonly service: string; readonly sha: string }>,
): boolean =>
  made.length === asked.length &&
  asked.every((entry) =>
    made.some((other) => other.service === entry.service && other.sha === entry.sha),
  );

/** An application's releases' path at HQ's API. */
const releasesPath = (appId: string): string => `/api/apps/${encodeURIComponent(appId)}/releases`;

/** A comparison of two of a repository's commits at HQ's API; no `base` is from its first. */
const comparePath = (appId: string, repo: string, { base, head }: CompareQuery): string =>
  `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/compare?${new URLSearchParams(
    base === undefined ? { head } : { base, head },
  ).toString()}`;

/** A change's own path at HQ's API. */
const changePath = ({ appId, repo, number }: ChangeLink): string =>
  `/api/apps/${encodeURIComponent(appId)}/changes/${encodeURIComponent(repo)}/${String(number)}`;

/**
 * What HQ's `/health` says (`apps/hq/src/health.ts`): `healthy` while it leads as the official
 * HQ; `unchecked` while it leads but cannot check Zerops right now — HQ's grace keeps it the
 * official HQ for ten minutes past its last answer (`apps/hq/src/official.ts`), and it serves
 * meanwhile; `not-ready` while it answers as anything else — a standby, an HQ whose anchor is
 * missing; `unreachable` while nothing answers as Core does.
 */
export type HqHealth =
  | { readonly kind: "healthy"; readonly build: string }
  | { readonly kind: "unchecked"; readonly build: string }
  | { readonly kind: "not-ready"; readonly state: string; readonly official: string }
  | { readonly kind: "unreachable" };

export async function readHqHealth(
  fetch: FetchImplementation,
  address: string,
  signal?: AbortSignal,
): Promise<HqHealth> {
  try {
    const response = await fetch(`${address.replace(/\/+$/u, "")}/health`, {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const body = (await response.json()) as {
      readonly state?: unknown;
      readonly official?: unknown;
      readonly build?: unknown;
    };
    if (typeof body.state !== "string" || typeof body.official !== "string") {
      return { kind: "unreachable" };
    }
    const build = typeof body.build === "string" ? body.build : "";
    if (response.ok && body.state === "active" && body.official === "ok") {
      return { kind: "healthy", build };
    }
    return response.ok && body.state === "active" && body.official === "unknown"
      ? { kind: "unchecked", build }
      : { kind: "not-ready", state: body.state, official: body.official };
  } catch {
    return { kind: "unreachable" };
  }
}

export function makeHqApi(input: {
  /** HQ's origin, as its anchor names it. */
  readonly address: string;
  readonly fetch: FetchImplementation;
  /** Mints a throwaway for HQ's door, hands its value to `use` alone, and deletes it. */
  readonly throughDoor: <T>(use: (token: string) => Promise<T>) => Promise<T>;
  readonly openSocket: OpenHqSocket;
}): HqApi {
  const origin = input.address.replace(/\/+$/u, "");
  /** The session HQ issued, or the door exchange under way that will issue it. */
  let session: Promise<string> | null = null;

  const enter = () => {
    const entering = input
      .throughDoor(async (token) =>
        json<{ readonly session: string }>(
          await send(input.fetch, `${origin}/api/door`, {
            method: "POST",
            body: JSON.stringify({ token }),
            signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
          }),
        ),
      )
      .then((answer) => answer.session);
    // A door that refused is not a session: the next call asks again.
    entering.catch(() => {
      if (session === entering) session = null;
    });
    session = entering;
    return entering;
  };

  /** A call as the session's holder; a session HQ no longer takes is replaced once. */
  const authorized = async (
    path: string,
    init: RequestInit = {},
    write?: Write,
  ): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
      const held = session ?? enter();
      const token = await held;
      try {
        return await send(
          input.fetch,
          `${origin}${path}`,
          { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } },
          write,
        );
      } catch (cause) {
        const stale = cause instanceof HqError && cause.code === "session_required";
        if (!stale || attempt > 0) throw cause;
        if (session === held) session = null;
      }
    }
  };

  /**
   * A write whose answer was lost, decided by what HQ holds now: `holds` reads it back — what the
   * write would have answered, or `undefined` while HQ holds nothing of it. Nothing held, or no
   * answer to the read either, leaves it uncertain.
   *
   * HQ finishes a write whose client went away (F22), so one pressed again can meet itself: a
   * refusal for one of `itself` — HQ's reasons that may be this very write made already — is read
   * back the same way, and stands where HQ holds nothing of it.
   */
  const confirmed = async <T>(
    write: () => Promise<T>,
    holds: () => Promise<T | undefined>,
    itself: ReadonlyArray<string> = [],
  ): Promise<T> => {
    try {
      return await write();
    } catch (cause) {
      const lost = cause instanceof HqError && cause.kind === "uncertain";
      const met =
        cause instanceof HqError &&
        cause.kind === "refused" &&
        cause.reason !== undefined &&
        itself.includes(cause.reason);
      if (!lost && !met) throw cause;
      let held: T | undefined;
      try {
        held = await holds();
      } catch {
        // No answer to the read either: the write stays as it was answered.
        throw cause;
      }
      if (held === undefined) throw cause;
      return held;
    }
  };

  /** {@link confirmed} for a write that answers nothing: `holds` says whether HQ holds it made. */
  const confirmedDone = async (
    write: () => Promise<unknown>,
    holds: () => Promise<boolean>,
  ): Promise<void> => {
    await confirmed(
      async () => {
        await write();
        return true;
      },
      async () => ((await holds()) ? true : undefined),
    );
  };

  const structureOf = async (signal?: AbortSignal) =>
    json<HqStructure>(await authorized("/api/structure", signal === undefined ? {} : { signal }));
  const appOf = async (appId: string) => (await structureOf()).apps.find((app) => app.id === appId);
  const releasesOf = async (appId: string, signal?: AbortSignal) =>
    (
      await readReleases(
        await authorized(releasesPath(appId), signal === undefined ? {} : { signal }),
      )
    ).releases;
  const changeOf = async (link: ChangeLink, signal?: AbortSignal) =>
    readChangeDetail(await authorized(changePath(link), signal === undefined ? {} : { signal }));
  const commentsOf = async (link: ChangeLink, signal?: AbortSignal) =>
    (
      await readComments(
        await authorized(`${changePath(link)}/comments`, signal === undefined ? {} : { signal }),
      )
    ).comments;
  /** The change as HQ holds it, if it is in `state`. */
  const changeIn = async (link: ChangeLink, state: HqChange["state"]) => {
    const { change } = await changeOf(link);
    return change.state === state ? change : undefined;
  };

  return {
    structure: structureOf,
    streamStructure: async (handlers, signal) => {
      const { ticket } = await json<{ readonly ticket: string }>(
        await authorized("/api/stream-ticket", { method: "POST", signal }),
      );
      /** The session the ticket was minted for. */
      const held = session;
      const url = `${origin.replace(/^http/u, "ws")}/api/structure/ws?ticket=${encodeURIComponent(ticket)}`;
      await new Promise<void>((resolve, reject) => {
        const socket = input.openSocket(url, {
          message: (data) => {
            handlers.onAlive();
            let message: unknown;
            try {
              message = JSON.parse(data);
            } catch {
              return;
            }
            if ((message as { readonly type?: unknown } | null)?.type === "ping") {
              socket.send(PONG);
              return;
            }
            const event = structureEventOf(message);
            if (event !== undefined) handlers.onEvent(event);
          },
          close: (code) => {
            signal.removeEventListener("abort", stop);
            if (code === SOCKET_CLOSE.sessionEnded) {
              // The next call enters the door again, the next socket with it.
              if (session === held) session = null;
              resolve();
            } else if (code === SOCKET_CLOSE.goingAway) {
              resolve();
            } else {
              reject(
                new HqError({
                  kind: "unavailable",
                  code: `socket_${code}`,
                  message: "HQ's stream broke.",
                }),
              );
            }
          },
        });
        const stop = () => socket.close();
        signal.addEventListener("abort", stop, { once: true });
      });
    },
    // An application has no name of HQ's to ask for before it is made: the one by this name is
    // taken for it.
    createApp: (name) =>
      confirmed(
        async () =>
          json<{ readonly id: string; readonly name: string }>(
            await authorized(
              "/api/apps",
              { method: "POST", body: JSON.stringify({ name }) },
              "once",
            ),
          ),
        async () => {
          const made = (await structureOf()).apps.find((app) => app.name === name);
          return made === undefined ? undefined : { id: made.id, name: made.name };
        },
      ),
    attachProject: (appId, attach) =>
      confirmedDone(
        () =>
          authorized(
            `/api/apps/${encodeURIComponent(appId)}/projects`,
            { method: "POST", body: JSON.stringify(attach) },
            "once",
          ),
        async () =>
          (await appOf(appId))?.projects.some(
            (project) => project.projectId === attach.projectId && project.kind === attach.kind,
          ) === true,
      ),
    keepDeployToken: async (appId, environment, token) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/environments/${encodeURIComponent(environment)}/deploy-token`,
        { method: "PUT", body: JSON.stringify({ token }) },
        "idempotent",
      );
    },
    redeploy: async (appId, environment, deploy) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/environments/${encodeURIComponent(environment)}/redeploy`,
        { method: "POST", body: JSON.stringify(deploy) },
        "once",
      );
    },
    updateMate: async (projectId, change) => {
      await authorized(
        `/api/mates/${encodeURIComponent(projectId)}`,
        { method: "PATCH", body: JSON.stringify(change) },
        "idempotent",
      );
    },
    renameApp: (appId, name) =>
      confirmedDone(
        () =>
          authorized(
            `/api/apps/${encodeURIComponent(appId)}`,
            { method: "PATCH", body: JSON.stringify({ name }) },
            "idempotent",
          ),
        async () => (await appOf(appId))?.name === name,
      ),
    deleteApp: (appId) =>
      confirmedDone(
        () => authorized(`/api/apps/${encodeURIComponent(appId)}`, { method: "DELETE" }, "once"),
        async () => (await appOf(appId)) === undefined,
      ),
    moveProject: async (projectId, to) => {
      await authorized(
        `/api/projects/${encodeURIComponent(projectId)}/app`,
        { method: "PUT", body: JSON.stringify(to) },
        "idempotent",
      );
    },
    createMate: (mate) =>
      confirmedDone(
        () => authorized("/api/mates", { method: "POST", body: JSON.stringify(mate) }, "once"),
        async () => {
          const { ungrouped, apps } = await structureOf();
          return (
            ungrouped.some((held) => held.projectId === mate.projectId) ||
            apps.some((app) =>
              app.projects.some(
                (project) => project.projectId === mate.projectId && project.mate !== null,
              ),
            )
          );
        },
      ),
    change: changeOf,
    changeComments: commentsOf,
    // A comment has no name of its own: the newest said on the change, in the very words, is taken
    // for it.
    commentOnChange: (link, body) =>
      confirmed(
        async () =>
          readComment(
            await authorized(
              `${changePath(link)}/comments`,
              { method: "POST", body: JSON.stringify({ body }) },
              "once",
            ),
          ),
        async () => {
          const newest = (await commentsOf(link)).at(-1);
          return newest?.body === body ? newest : undefined;
        },
      ),
    mergeChange: (link, expectedHead) =>
      confirmed(
        async () =>
          readChange(
            await authorized(
              `${changePath(link)}/merge`,
              { method: "POST", body: JSON.stringify({ expectedHead }) },
              "once",
            ),
          ),
        () => changeIn(link, "merged"),
        ["already_merged", "change_not_open"],
      ),
    closeChange: (link) =>
      confirmed(
        async () =>
          readChange(await authorized(`${changePath(link)}/close`, { method: "POST" }, "once")),
        () => changeIn(link, "closed"),
        ["change_not_open"],
      ),
    changeAttachment: async (link, signal) =>
      (
        await authorized(attachmentPath(link.appId, link.repo, link.number, link.id), {
          headers: { Accept: "image/png" },
          ...(signal === undefined ? {} : { signal }),
        })
      ).blob(),
    appRepos: async (appId, signal) =>
      (
        await readAppRepos(
          await authorized(
            `/api/apps/${encodeURIComponent(appId)}/repos`,
            signal === undefined ? {} : { signal },
          ),
        )
      ).repos,
    compare: async (appId, repo, query, signal) =>
      readCompare(
        await authorized(comparePath(appId, repo, query), signal === undefined ? {} : { signal }),
      ),
    releases: releasesOf,
    // A release is named by its tag, which HQ gives no second one: the one HQ holds under it is
    // this one where it tags the same `main` with the same commits.
    release: (appId, request) =>
      confirmed(
        async () =>
          readRelease(
            await authorized(
              releasesPath(appId),
              { method: "POST", body: JSON.stringify(request) },
              "once",
            ),
          ),
        async () =>
          (await releasesOf(appId)).find(
            (made) =>
              made.tag === request.tag &&
              made.sha === request.groupHead &&
              sameEntries(made.entries, request.entries),
          ),
        ["tag_taken"],
      ),
    // A roll back is a new release HQ names: the newest, rolling back to `tag` at the same `main`,
    // is taken for it.
    rollback: (appId, tag, request) =>
      confirmed(
        async () =>
          readRelease(
            await authorized(
              `${releasesPath(appId)}/${encodeURIComponent(tag)}/rollback`,
              { method: "POST", body: JSON.stringify(request) },
              "once",
            ),
          ),
        async () => {
          const [newest] = await releasesOf(appId);
          return newest?.rollbackOf === tag && newest.sha === request.groupHead
            ? newest
            : undefined;
        },
      ),
    recipeTier: async (appId, tier, signal) =>
      readRecipeTier(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/recipe/${tier}`,
          signal === undefined ? {} : { signal },
        ),
      ),
    recordStandUp: async (projectId) => {
      await authorized(
        `/api/mates/${encodeURIComponent(projectId)}/standup`,
        { method: "POST" },
        "once",
      );
    },
    recordClosedOff: async (projectId) => {
      await authorized(
        `/api/mates/${encodeURIComponent(projectId)}/closed-off`,
        { method: "POST" },
        "once",
      );
    },
  };
}

/**
 * Attaches a project to an application. HQ refuses a project attached already (`409 conflict`):
 * one attached there as asked is the same write run twice — a press tried again — and stands;
 * any other conflict is the refusal it is.
 */
export async function attachToApp(
  api: Pick<HqApi, "attachProject" | "structure">,
  appId: string,
  attach: HqAttach,
): Promise<void> {
  try {
    await api.attachProject(appId, attach);
  } catch (cause) {
    if (!(cause instanceof HqError && cause.code === "conflict")) throw cause;
    const { apps } = await api.structure();
    const there = apps
      .find((app) => app.id === appId)
      ?.projects.some(
        (project) => project.projectId === attach.projectId && project.kind === attach.kind,
      );
    if (there !== true) throw cause;
  }
}
