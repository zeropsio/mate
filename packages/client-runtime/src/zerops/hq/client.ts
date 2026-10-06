import { RASTER_CONTENT_TYPES } from "@t3tools/shared/hqAttachments";
/**
 * HQ's API as the client calls it (`apps/hq/src/api.ts`), through HQ's door.
 *
 * A person enters HQ as they enter a Mate: the app mints a throwaway named for HQ's project
 * (`mate-door:<hqProjectId>:<nonce>`), presents it once at `POST /api/door`, and deletes it
 * (`withThrowaway`). HQ answers a session of its own, which this client sends as `Authorization:
 * Bearer` until HQ stops taking it; then it comes through the door once more. Where the account
 * keeps it (`kept`, audit K7), a load presents the kept session before any door.
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
  type ChangeDetailQuery,
  HqChange,
  HqChangeComment,
  type AttachmentLink,
  type ChangeLink,
} from "@t3tools/shared/hqChanges";
import {
  GitCredential,
  GitCredentialList,
  type GitCredentialRecord,
  RepositorySource,
  type RepositoryQuery,
} from "@t3tools/shared/hqGit";
import { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { type HqDeployAnswer, WithDeploys } from "@t3tools/shared/hqDeploys";
import {
  Release,
  ReleaseListResponse,
  type CreateReleaseRequest,
  type RollbackRequest,
} from "@t3tools/shared/hqRelease";
import type { HqOffers } from "@t3tools/shared/hqOffers";
import type { OverviewLogins } from "@t3tools/shared/mateLink";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { type FetchImplementation } from "../api.ts";
import type { HqEnvironment } from "./environments.ts";
import { hqRefusalWords, ZEROPS_UNANSWERED } from "./refusals.ts";
import { hqStructureOf } from "./structure.ts";

/** An organization's HQ: its project, and the address its anchor names. */
export interface HqEndpoint {
  readonly projectId: string;
  readonly address: string;
}

/**
 * A Mate's record in HQ: its face in the grammar `readMateFace` reads. Its name is its project's in
 * Zerops (D3), never HQ's.
 */
export interface HqMateRecord {
  readonly face: string;
}

/**
 * A Mate's record as the write that makes it carries it: whether the person writing it asks for
 * its stand-up rides with it, so the record and its ask never part (audit B3).
 */
export interface HqNewMate extends HqMateRecord {
  readonly standUp?: boolean;
}

/**
 * A Mate's record as a set-up on a project holding its zcp service already writes it: naming that
 * service, the one Mate of its project (audit D2).
 */
export interface HqMateSetUp extends HqNewMate {
  readonly serviceId?: string;
}

/**
 * A Mate as HQ reads it: its record, its birth, and — joined from HQ's overview of it, where the
 * reader may observe it (`hqMates.ts`) — its agents' logins.
 */
export interface HqMate extends Partial<HqMateRecord> {
  readonly birthId?: string | null;
  readonly signers?: Readonly<Record<string, string>>;
  /**
   * Who made it — whoever set its record up: a Mate recorded before HQ kept it is null; an older
   * HQ says nothing.
   */
  readonly madeBy?: string | null | undefined;
  /** Who asked for its stand-up, with its record: nobody is null; an older HQ says nothing. */
  readonly standupRequestedBy?: string | null | undefined;
  /** Whether its project is closed off (`recordClosedOff`); an older HQ says nothing. */
  readonly closedOff?: boolean | undefined;
  /**
   * The key it last named reads other projects too — READ_ONLY grants on siblings an earlier client
   * gave it (ADR 0003's fallout): it needs *Finish setup*, whose harden takes them off. Absent where
   * it does not, and from an older HQ.
   */
  readonly keyWider?: boolean | undefined;
  /** Who signed each of its agents' logins in, as its overview says; absent where HQ holds none. */
  readonly logins?: OverviewLogins;
  /** A ready agent outside Mate's sign-in flow, relayed in its overview. */
  readonly runsWithoutSignIn?: boolean;
}

/**
 * What the reader may do with a Mate (`observe_mate`, `edit_mate_record`, `detach`); absent where
 * HQ sent none, or none this build can read. Where it may go HQ answers as the move opens.
 */
export interface HqMateOffers {
  readonly can?: HqOffers;
}

/** HQ's held records, including projects whose removal has not finished at HQ. */
export interface HqAppContents {
  /** The same project, change, release and code repository records that guard Delete. */
  readonly empty: boolean;
  /** By id: still held at HQ, deleting or absent in HQ's Zerops view. */
  readonly deletingProjectIds: ReadonlyArray<string>;
}

/** What `GET /api/structure` answers: the applications as the reader sees them in Zerops. */
export interface HqStructure {
  /** What the reader may do with the organization's applications; absent where HQ sent none. */
  readonly can?: HqOffers;
  /**
   * Each project the reader reads that HQ holds nowhere, by id, with whether they may write its
   * Mate's record (`create_mate_record`); absent where HQ sent none.
   */
  readonly unheld?: Readonly<Record<string, HqOffers>>;
  /**
   * When Zerops answered the org view HQ decides its offers over (ISO 8601): shown, never compared
   * with now. None until HQ's stream names one.
   */
  readonly rolesAnsweredAt?: string | null;
  readonly tools?: ReadonlyArray<{ readonly projectId: string; readonly kind: "gitea" }>;
  /** The Mates HQ holds in no application: their project's name in Zerops, and their record. */
  readonly ungrouped: ReadonlyArray<
    {
      readonly projectId: string;
      readonly name: string;
      readonly mate: HqMate;
    } & HqMateOffers
  >;
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly projects: ReadonlyArray<
      {
        readonly projectId: string;
        readonly name: string;
        readonly kind: string;
        readonly mate: HqMate | null | undefined;
      } & HqMateOffers
    >;
    /** What the reader may do with it: its changes, its deploys, its release; absent where none. */
    readonly can?: HqOffers;
    /** Absent from an older HQ: projected projects cannot establish emptiness. */
    readonly contents?: HqAppContents;
    /**
     * Its stage and production with their deploys (`hq/environments.ts`), to whoever reads its
     * changes; refused, with HQ's reason, to one who only sees it — never an empty list; absent
     * where HQ sent none this build can read.
     */
    readonly environments?: ReadonlyArray<HqEnvironment> | { readonly refused: string };
    /** The Mates on their way into it whose attach has not landed; absent from an older HQ. */
    readonly births?: ReadonlyArray<HqBirth>;
  }>;
}

export interface HqAttach {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  /**
   * The Mate's face and stand-up ask, and its zcp service where its project holds it; with
   * kind `mate`, and only with it. An attach that closes a birth intent takes the intent's ask
   * instead.
   */
  readonly mate?: HqMateSetUp;
  /** A stage's or a production's environment name; HQ names it from its project without one. */
  readonly environment?: { readonly name: string };
  /** The birth intent a Mate's project was created under (`recordBirth`): its attach closes it. */
  readonly birth?: string;
  /**
   * This client created the stage's or production's project for HQ to deploy: HQ turns its
   * services' subdomains on at their first deploy, and never otherwise (audit R1, D6).
   */
  readonly created?: true;
}

/**
 * A Mate's birth intent at HQ: where it goes and with which face, recorded before its Zerops project
 * exists, then bound by project id, until its attach closes it.
 */
export interface HqBirth {
  readonly projectId?: string | null;
  readonly id: string;
  /** Its face as its attach records it: empty where it wears its name's tint. */
  readonly face: string;
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

/**
 * A write that asked for deploys, and where HQ answered they stand (`@t3tools/shared/hqDeploys`);
 * none where its answer was lost and HQ's records were read back for it — HQ's stream brings the
 * jobs either way.
 */
export interface Asked<T> {
  readonly made: T;
  readonly deploys: HqDeployAnswer | undefined;
}

export interface HqApi {
  readonly structure: (signal?: AbortSignal) => Promise<HqStructure>;
  /**
   * One segment of HQ's scope stream (`@t3tools/shared/hqStream`): a socket opened with a fresh
   * ticket for the session, telling `on` of every text message and of its close code. A socket HQ
   * closed for its session (`4401`) forgets that session first, so the next segment's ticket
   * enters the door again.
   */
  readonly openScopeSocket: (
    on: { readonly message: (data: string) => void; readonly close: (code: number) => void },
    signal: AbortSignal,
  ) => Promise<HqSocket>;
  /**
   * The id of the key a Mate's container holds, as the Mate named it to HQ (`GET
   * /api/mates/{projectId}/key`); none where it named none. Told to the project's admin alone.
   */
  /** Authorizes completion before Zerops removes the project's roles. */
  readonly prepareProjectDeletion: (projectId: string) => Promise<string>;
  /** One attempt to verify absence and release HQ's held rows; refusal is visible to the caller. */
  readonly completeProjectDeletion: (projectId: string, completion: string) => Promise<void>;
  readonly mateKey: (projectId: string, signal?: AbortSignal) => Promise<string | null>;
  /** A Mate's face, as HQ records it (`PATCH /api/mates/{projectId}`). */
  readonly updateMate: (projectId: string, change: { readonly face: string }) => Promise<void>;
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
  readonly createMate: (mate: { readonly projectId: string } & HqMateSetUp) => Promise<void>;
  /**
   * That a Mate's project is closed off, as its project's owner or admin records it (`POST
   * /api/mates/{projectId}/closed-off`). HQ refuses it on a Mate it holds no record of
   * (`mate_not_found`).
   */
  readonly recordClosedOff: (projectId: string) => Promise<void>;
  /**
   * HQ reads the Mate's widened key again (`POST /api/mates/{projectId}/key-check`), asked by its
   * project's admin once *Finish setup* took its sibling grants off: its record stops saying
   * `keyWider` once the key reaches its own project alone.
   */
  readonly recheckKey: (projectId: string) => Promise<void>;
  readonly createApp: (name: string) => Promise<{ readonly id: string; readonly name: string }>;
  /**
   * A Mate's birth intent in an application, before its project exists (`POST /api/births`):
   * the attach that closes it records the caller as its stand-up's asker where `standUp` says so.
   */
  readonly recordBirth: (birth: { readonly appId: string } & HqNewMate) => Promise<HqBirth>;
  /**
   * Holds, or renews, a press for this browser's press `owner` (`PUT /api/presses/{projectId}`):
   * what it makes and into which application, with its container import's Zerops process once
   * Zerops answered it — another browser takes it for a press still running. Another press's hold
   * refuses it (`press_held`). A `renew` extends only this press's own live hold, never one its
   * end let go (`press_not_held`).
   */
  readonly holdPress: (
    projectId: string,
    press: {
      readonly owner: string;
      readonly kind: "mate" | "stage" | "production";
      readonly appId?: string;
      readonly importProcessId?: string;
      readonly renew?: boolean;
    },
  ) => Promise<void>;
  /**
   * This browser's press's end: one that `finished` leaves no record (`DELETE
   * /api/presses/{projectId}/{owner}`); one that stopped ends its hold and keeps its record, for its
   * setup to be finished for its kind (`POST …/stopped`).
   */
  readonly endPress: (projectId: string, owner: string, finished: boolean) => Promise<void>;
  readonly bindBirth: (birthId: string, projectId: string) => Promise<void>;
  readonly attachProject: (appId: string, attach: HqAttach) => Promise<void>;
  /**
   * An environment's deploy token, minted by the person's own client, kept by HQ (`PUT
   * /api/apps/:appId/environments/:name/deploy-token`); the structure says only that it holds one.
   */
  readonly keepDeployToken: (appId: string, environment: string, token: string) => Promise<void>;
  /**
   * "Run again": the environment's newest deploy of `service`, at `sha`, ended, asked again as the
   * person (`POST /api/apps/:appId/environments/:name/redeploy`): where HQ's submission of it
   * stands.
   */
  readonly redeploy: (
    appId: string,
    environment: string,
    deploy: { readonly service: string; readonly sha: string },
  ) => Promise<HqDeployAnswer>;
  /**
   * "Add <service>": a service the environment's tier declares, imported into its project and
   * deployed, as the person (`POST /api/apps/:appId/environments/:name/services`).
   */
  readonly addService: (
    appId: string,
    environment: string,
    service: string,
  ) => Promise<HqDeployAnswer>;
  /** The person's active Git password metadata; passwords are returned only on issue. */
  readonly gitCredentials: (appId: string) => Promise<ReadonlyArray<GitCredentialRecord>>;
  readonly issueGitCredential: (appId: string) => Promise<GitCredential>;
  readonly revokeGitCredential: (appId: string, id: string) => Promise<void>;
  /** Source content pinned to a commit; uses the same person read rule as changes. */
  readonly repositorySource: (
    appId: string,
    repo: string,
    query: RepositoryQuery,
    signal?: AbortSignal,
  ) => Promise<RepositorySource>;
  /** A Mate's change with what its review reads (`GET /api/apps/:appId/changes/:repo/:n`). */
  readonly change: (
    link: ChangeLink,
    signal?: AbortSignal,
    snapshot?: ChangeDetailQuery,
  ) => Promise<ChangeDetailResponse>;
  /** Says `body` on a change, as the person. */
  readonly commentOnChange: (link: ChangeLink, body: string) => Promise<HqChangeComment>;
  /**
   * Squashes a change into `main` as the person, if its head is still `expectedHead` — the head
   * they were shown; HQ answers the change merged, or refuses with one of `MERGE_REFUSALS`.
   */
  readonly mergeChange: (link: ChangeLink, expectedHead: string) => Promise<Asked<HqChange>>;
  /** Closes a change without merging it, as the person; its branch stays. */
  readonly closeChange: (link: ChangeLink) => Promise<HqChange>;
  /** A picture of a change, read as the person (`attachmentPath`). */
  readonly changeAttachment: (link: AttachmentLink, signal?: AbortSignal) => Promise<Blob>;
  /**
   * The Mate tier, as the person (`GET /api/apps/:appId/recipe/mate`): read on demand only where
   * HQ's stream does not carry it — a Core from before it did, or one that could not read it —
   * or while the stream is down.
   */
  readonly mateRecipe: (appId: string, signal?: AbortSignal) => Promise<RecipeTierResponse>;
  /** A release made in HQ as the person, of what its offer showed; HQ tags and deploys it. */
  readonly release: (appId: string, request: CreateReleaseRequest) => Promise<Asked<Release>>;
  /** Production back to `tag` as the person: a new release listing its entries. */
  readonly rollback: (
    appId: string,
    tag: string,
    request: RollbackRequest,
  ) => Promise<Asked<Release>>;
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

/** HQ closed a scope socket because its session ended (`hqStreamCloseFailure`). */
const HQ_SESSION_ENDED_CLOSE = 4401;

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

/** HQ's code for a write refused because Zerops did not answer its roles: nothing was written. */
const WROTE_NOTHING_ZEROPS = "zerops_unanswered";

async function errorOf(response: Response): Promise<HqError> {
  const body = said(await response.text());
  const code = typeof body.code === "string" ? body.code : `http_${response.status}`;
  if (response.status >= 500 || response.status === 429) {
    return new HqError({
      kind: "unavailable",
      code,
      status: response.status,
      message: code === WROTE_NOTHING_ZEROPS ? ZEROPS_UNANSWERED : "HQ is not answering right now.",
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

/**
 * HQ's answer as the call's outcome. A write HQ failed on its way (`5xx`) may have landed — but
 * for a Core that does not lead (`not_active`), and one refused because Zerops did not answer its
 * roles (`zerops_unanswered`): neither writes anything.
 */
async function answered(response: Response, write: boolean): Promise<Response> {
  if (response.ok) return response;
  const error = await errorOf(response);
  if (
    write &&
    response.status >= 500 &&
    error.code !== "not_active" &&
    error.code !== WROTE_NOTHING_ZEROPS
  ) {
    throw uncertain();
  }
  throw error;
}

/** One call to HQ, ending with its answer or a visible failure; another call is the caller's ask. */
async function send(
  fetch: FetchImplementation,
  url: string,
  init: RequestInit,
  write = false,
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(write ? WRITE_TIMEOUT_MS : CALL_TIMEOUT_MS);
  const headers = {
    Accept: "application/json",
    ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...init.headers,
  };
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal, headers });
  } catch {
    if (write) throw uncertain();
    throw new HqError({
      kind: "unavailable",
      code: "network",
      message: "HQ could not be reached.",
    });
  }
  return answered(response, write);
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/**
 * An answer read through the contract's schema (`@t3tools/shared/hqChanges`): one this version of
 * Mate cannot read is refused, never drawn in part.
 */
const decoded =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  async (response: Response): Promise<S["Type"]> =>
    Option.getOrThrowWith(Schema.decodeUnknownOption(schema)(await bodyOf(response)), unreadable);

const bodyOf = async (response: Response): Promise<unknown> => {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw unreadable();
  }
};

/**
 * {@link decoded} for a write that asked for deploys: what it made, and the deploys beside it —
 * none where this version of Mate cannot read them, for HQ's stream brings their jobs.
 */
const readDeploysBeside = Schema.decodeUnknownOption(WithDeploys);

const decodedAsked =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  async (response: Response): Promise<Asked<S["Type"]>> => {
    const body = await bodyOf(response);
    return {
      made: Option.getOrThrowWith(Schema.decodeUnknownOption(schema)(body), unreadable),
      deploys: Option.getOrUndefined(readDeploysBeside(body))?.deploys,
    };
  };

const unreadable = () =>
  new HqError({
    kind: "refused",
    code: "unreadable",
    message: "HQ answered in a form this version of Mate does not read.",
  });

const readChangeDetail = decoded(ChangeDetailResponse);
const readComment = decoded(HqChangeComment);
const readChange = decoded(HqChange);
const readMerged = decodedAsked(HqChange);

const readGitCredential = decoded(GitCredential);
const readGitCredentialList = decoded(GitCredentialList);
const readRecipeTier = decoded(RecipeTierResponse);
const readReleases = decoded(ReleaseListResponse);
const readRelease = decodedAsked(Release);
const readDeploys = decoded(WithDeploys);

/** A write HQ holds made, read back for its lost answer: its deploys are the stream's to say. */
const heldAsked = <T>(made: T | undefined): Asked<T> | undefined =>
  made === undefined ? undefined : { made, deploys: undefined };

/** An application's environment, as HQ's paths name it. */
const environmentPath = (appId: string, environment: string) =>
  `/api/apps/${encodeURIComponent(appId)}/environments/${encodeURIComponent(environment)}`;

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
  | { readonly kind: "healthy"; readonly build: string; readonly parts: HqParts }
  | { readonly kind: "unchecked"; readonly build: string; readonly parts: HqParts }
  | { readonly kind: "not-ready"; readonly state: string; readonly official: string }
  | { readonly kind: "unreachable" };

/**
 * How HQ's parts stand while it serves, as its health reports them (`apps/hq/src/health.ts`):
 * `db` its database's answer to a fresh probe, `quarantined` the repositories it withholds until
 * they converge (`<appId>/<repo>`), `backup` its newest set's outcome, `keys` where its key for
 * deploy tokens stands. A part an older Core does not report, or reports in a shape this build
 * cannot read, is absent.
 */
export interface HqParts {
  readonly db?: "up" | "down";
  readonly quarantined: ReadonlyArray<string>;
  readonly backup?: HqBackup;
  readonly keys?: HqKeys;
}

/** What a backup set needed beside what the backup bucket holds (`apps/hq/src/backup.ts`). */
export interface HqBackupUsage {
  readonly usedBytes: number;
  readonly neededBytes: number;
  readonly quotaBytes: number;
}

/**
 * HQ's backup by its newest set (`apps/hq/src/backup.ts` `BackupStatus`): `off` with no bucket,
 * `pending` before a first set, `ok` with the time the newest set was taken (wall ms), `degraded`
 * when that set cost a set the retention targets keep, `failed` with HQ's reason — a quarantined
 * repository's name, or the bucket's usage when it is full.
 */
export type HqBackup =
  | { readonly state: "off" | "pending" }
  | { readonly state: "ok"; readonly takenAt: number }
  | { readonly state: "degraded"; readonly takenAt: number; readonly usage: HqBackupUsage }
  | {
      readonly state: "failed";
      readonly reason: string;
      readonly repo?: string;
      readonly usage?: HqBackupUsage;
    };

/**
 * HQ's key for deploy tokens (`apps/hq/src/deployKeys.ts` `KeysStatus`): none, one that is no key,
 * the key, or the key beside tokens sealed under another.
 */
export type HqKeys = "ok" | "no_secret" | "bad_secret" | "other_secret";

const HQ_KEYS: ReadonlySet<string> = new Set(["ok", "no_secret", "bad_secret", "other_secret"]);

/** A set's id is the time it was taken, ISO without its separators: `20261004T120000.000Z`. */
const SET_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?Z$/u;

function setTakenAt(set: unknown): number | undefined {
  const match = typeof set === "string" ? SET_ID.exec(set) : null;
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second, ms] = match.map(Number);
  return Date.UTC(year!, month! - 1, day!, hour!, minute!, second!, ms ?? 0);
}

function readUsage(backup: Record<string, unknown>): HqBackupUsage | undefined {
  const { usedBytes, neededBytes, quotaBytes } = backup;
  return typeof usedBytes === "number" &&
    typeof neededBytes === "number" &&
    typeof quotaBytes === "number"
    ? { usedBytes, neededBytes, quotaBytes }
    : undefined;
}

function readBackup(raw: unknown): HqBackup | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const backup = raw as Record<string, unknown>;
  switch (backup.state) {
    case "off":
    case "pending":
      return { state: backup.state };
    case "ok": {
      const takenAt = setTakenAt(backup.set);
      return takenAt === undefined ? undefined : { state: "ok", takenAt };
    }
    case "degraded": {
      const takenAt = setTakenAt(backup.set);
      const usage = readUsage(backup);
      return takenAt === undefined || usage === undefined
        ? undefined
        : { state: "degraded", takenAt, usage };
    }
    case "failed": {
      if (typeof backup.reason !== "string") return undefined;
      const usage = readUsage(backup);
      return {
        state: "failed",
        reason: backup.reason,
        ...(typeof backup.repo === "string" ? { repo: backup.repo } : {}),
        ...(usage === undefined ? {} : { usage }),
      };
    }
    default:
      return undefined;
  }
}

/** The repositories HQ withholds, by name: `[{ repo, reason }]` on the wire. */
function readQuarantined(raw: unknown): ReadonlyArray<string> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    const repo =
      typeof entry === "object" && entry !== null ? (entry as { repo?: unknown }).repo : undefined;
    return typeof repo === "string" ? [repo] : [];
  });
}

/**
 * How HQ's parts stand, as its health or its structure stream reports them: a part this build
 * cannot read is absent.
 */
export function readHqParts(body: Record<string, unknown>): HqParts {
  const backup = readBackup(body.backup);
  return {
    ...(body.db === "up" || body.db === "down" ? { db: body.db } : {}),
    quarantined: readQuarantined(body.quarantined),
    ...(backup === undefined ? {} : { backup }),
    ...(typeof body.keys === "string" && HQ_KEYS.has(body.keys)
      ? { keys: body.keys as HqKeys }
      : {}),
  };
}

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
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.state !== "string" || typeof body.official !== "string") {
      return { kind: "unreachable" };
    }
    const build = typeof body.build === "string" ? body.build : "";
    if (response.ok && body.state === "active" && body.official === "ok") {
      return { kind: "healthy", build, parts: readHqParts(body) };
    }
    return response.ok && body.state === "active" && body.official === "unknown"
      ? { kind: "unchecked", build, parts: readHqParts(body) }
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
  /**
   * HQ's session as the account keeps it for this organization and HQ across loads (audit K7):
   * the first call presents the kept one before any door, every session the door opens is kept,
   * and one HQ no longer takes is forgotten. Absent: the session lives in this page only.
   */
  /**
   * Waits until a write may be sent to this HQ, or fails it before anything is sent: the page may
   * read an HQ it has not yet verified official, but writes nothing to it. Absent: at once.
   */
  readonly beforeWrite?: () => Promise<void>;
  readonly kept?: {
    /** The kept session's token; null when none is kept, or it ends too soon to present. */
    readonly read: () => string | null;
    readonly keep: (session: { readonly token: string; readonly expiresAt: string }) => void;
    readonly forget: (token: string) => void;
  };
}): HqApi {
  const origin = input.address.replace(/\/+$/u, "");
  /** The session HQ issued, or the door exchange under way that will issue it. */
  let session: Promise<string> | null = null;

  /** The session the account kept, presented before any door; null when it keeps none. */
  const restore = (): Promise<string> | null => {
    const token = input.kept?.read() ?? null;
    if (token === null) return null;
    session = Promise.resolve(token);
    return session;
  };

  /** HQ no longer takes this session: it is dropped here, and forgotten where it was kept. */
  const drop = (held: Promise<string> | null, token: string) => {
    if (session === held) session = null;
    input.kept?.forget(token);
  };

  /** The sessions the door opened that HQ has not yet taken on any call: none renews. */
  const unproven = new WeakSet<Promise<string>>();

  const enter = () => {
    const entering = input
      .throughDoor(async (token) =>
        json<{ readonly session: string; readonly expiresAt: string }>(
          await send(input.fetch, `${origin}/api/door`, {
            method: "POST",
            body: JSON.stringify({ token }),
            signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
          }),
        ),
      )
      .then((answer) => {
        input.kept?.keep({ token: answer.session, expiresAt: answer.expiresAt });
        return answer.session;
      });
    // A door that refused is not a session: the next call asks again.
    entering.catch(() => {
      if (session === entering) session = null;
    });
    unproven.add(entering);
    session = entering;
    return entering;
  };

  /**
   * A call as the session's holder. A session HQ no longer takes is forgotten and renewed once —
   * another tab's kept one, else through the door — and the call made again; HQ refusing the
   * renewal too, or a session from its door it never took, ends the call with that refusal. A call
   * HQ refused for its session wrote nothing, so a write is made again as safely as a read.
   */
  const authorized = async (
    path: string,
    init: RequestInit = {},
    write = false,
  ): Promise<Response> => {
    if (write) await input.beforeWrite?.();
    let renewed = false;
    for (;;) {
      const held = session ?? restore() ?? enter();
      const token = await held;
      try {
        const response = await send(
          input.fetch,
          `${origin}${path}`,
          { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } },
          write,
        );
        unproven.delete(held);
        return response;
      } catch (cause) {
        if (!(cause instanceof HqError && cause.code === "session_required")) throw cause;
        drop(held, token);
        if (renewed || unproven.has(held)) throw cause;
        renewed = true;
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
    Option.getOrThrowWith(
      Option.fromUndefinedOr(
        hqStructureOf(
          await bodyOf(await authorized("/api/structure", signal === undefined ? {} : { signal })),
        ),
      ),
      unreadable,
    );
  const appOf = async (appId: string) => (await structureOf()).apps.find((app) => app.id === appId);
  // Only a lost release/rollback write answer needs this direct confirmation, never a load.
  const releasesOf = async (appId: string) =>
    (await readReleases(await authorized(releasesPath(appId)))).releases;
  const changeOf = async (
    link: ChangeLink,
    signal?: AbortSignal,
    snapshot: ChangeDetailQuery = {},
  ) => {
    const search = new URLSearchParams(snapshot).toString();
    return readChangeDetail(
      await authorized(
        `${changePath(link)}${search === "" ? "" : `?${search}`}`,
        signal === undefined ? {} : { signal },
      ),
    );
  };
  /** The change as HQ holds it, if it is in `state`. */
  const changeIn = async (link: ChangeLink, state: HqChange["state"]) => {
    const { change } = await changeOf(link);
    return change.state === state ? change : undefined;
  };

  return {
    structure: structureOf,
    openScopeSocket: async (on, signal) => {
      const { ticket } = await json<{ readonly ticket: string }>(
        await authorized("/api/stream-ticket", { method: "POST", signal }),
      );
      /** The session the ticket was minted for. */
      const held = session;
      const token = held === null ? null : await held;
      signal.throwIfAborted();
      const url = `${origin.replace(/^http/u, "ws")}/api/structure/ws?ticket=${encodeURIComponent(ticket)}`;
      return input.openSocket(url, {
        message: on.message,
        close: (code) => {
          if (code === HQ_SESSION_ENDED_CLOSE && held !== null && token !== null) drop(held, token);
          on.close(code);
        },
      });
    },
    // An application has no name of HQ's to ask for before it is made: the one by this name is
    // taken for it.
    recordBirth: async (birth) =>
      json<HqBirth>(
        await authorized("/api/births", { method: "POST", body: JSON.stringify(birth) }, true),
      ),
    holdPress: async (projectId, press) => {
      await authorized(
        `/api/presses/${encodeURIComponent(projectId)}`,
        { method: "PUT", body: JSON.stringify(press) },
        true,
      );
    },
    endPress: async (projectId, owner, finished) => {
      const path = `/api/presses/${encodeURIComponent(projectId)}/${encodeURIComponent(owner)}`;
      await authorized(
        finished ? path : `${path}/stopped`,
        { method: finished ? "DELETE" : "POST" },
        true,
      );
    },
    bindBirth: async (birthId, projectId) => {
      await authorized(
        `/api/births/${encodeURIComponent(birthId)}/project`,
        { method: "PUT", body: JSON.stringify({ projectId }) },
        true,
      );
    },
    createApp: (name) =>
      confirmed(
        async () =>
          json<{ readonly id: string; readonly name: string }>(
            await authorized("/api/apps", { method: "POST", body: JSON.stringify({ name }) }, true),
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
            true,
          ),
        async () =>
          (await appOf(appId))?.projects.some(
            (project) => project.projectId === attach.projectId && project.kind === attach.kind,
          ) === true,
      ),
    keepDeployToken: async (appId, environment, token) => {
      await authorized(
        `${environmentPath(appId, environment)}/deploy-token`,
        { method: "PUT", body: JSON.stringify({ token }) },
        true,
      );
    },
    redeploy: async (appId, environment, deploy) =>
      (
        await readDeploys(
          await authorized(
            `${environmentPath(appId, environment)}/redeploy`,
            { method: "POST", body: JSON.stringify(deploy) },
            true,
          ),
        )
      ).deploys,
    addService: async (appId, environment, service) =>
      (
        await readDeploys(
          await authorized(
            `${environmentPath(appId, environment)}/services`,
            { method: "POST", body: JSON.stringify({ service }) },
            true,
          ),
        )
      ).deploys,
    prepareProjectDeletion: async (projectId) =>
      (
        await json<{ readonly completion: string }>(
          await authorized(`/api/projects/${encodeURIComponent(projectId)}/deletion`, {
            method: "POST",
          }),
        )
      ).completion,
    completeProjectDeletion: async (projectId, completion) => {
      await authorized(
        `/api/projects/${encodeURIComponent(projectId)}/deleted`,
        {
          method: "POST",
          body: JSON.stringify({ completion }),
        },
        true,
      );
    },
    mateKey: async (projectId, signal) =>
      (
        await json<{ readonly keyTokenId: string | null }>(
          await authorized(
            `/api/mates/${encodeURIComponent(projectId)}/key`,
            signal === undefined ? {} : { signal },
          ),
        )
      ).keyTokenId,
    updateMate: async (projectId, change) => {
      await authorized(
        `/api/mates/${encodeURIComponent(projectId)}`,
        { method: "PATCH", body: JSON.stringify(change) },
        true,
      );
    },
    renameApp: (appId, name) =>
      confirmedDone(
        () =>
          authorized(
            `/api/apps/${encodeURIComponent(appId)}`,
            { method: "PATCH", body: JSON.stringify({ name }) },
            true,
          ),
        async () => (await appOf(appId))?.name === name,
      ),
    deleteApp: (appId) =>
      confirmedDone(
        () => authorized(`/api/apps/${encodeURIComponent(appId)}`, { method: "DELETE" }, true),
        async () => (await appOf(appId)) === undefined,
      ),
    moveProject: async (projectId, to) => {
      await authorized(
        `/api/projects/${encodeURIComponent(projectId)}/app`,
        { method: "PUT", body: JSON.stringify(to) },
        true,
      );
    },
    createMate: (mate) =>
      confirmedDone(
        () => authorized("/api/mates", { method: "POST", body: JSON.stringify(mate) }, true),
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
    // A comment has no name of its own: one whose answer was lost stays uncertain here, and the
    // account's operation tells it from HQ's conversation by its author.
    commentOnChange: async (link, body) =>
      readComment(
        await authorized(
          `${changePath(link)}/comments`,
          { method: "POST", body: JSON.stringify({ body }) },
          true,
        ),
      ),
    mergeChange: (link, expectedHead) =>
      confirmed(
        async () =>
          readMerged(
            await authorized(
              `${changePath(link)}/merge`,
              { method: "POST", body: JSON.stringify({ expectedHead }) },
              true,
            ),
          ),
        async () => heldAsked(await changeIn(link, "merged")),
        ["already_merged", "change_not_open"],
      ),
    closeChange: (link) =>
      confirmed(
        async () =>
          readChange(await authorized(`${changePath(link)}/close`, { method: "POST" }, true)),
        () => changeIn(link, "closed"),
        ["change_not_open"],
      ),
    changeAttachment: async (link, signal) =>
      (
        await authorized(attachmentPath(link.appId, link.repo, link.number, link.id), {
          headers: { Accept: RASTER_CONTENT_TYPES.join(", ") },
          ...(signal === undefined ? {} : { signal }),
        })
      ).blob(),
    gitCredentials: async (appId) =>
      (
        await readGitCredentialList(
          await authorized(`/api/apps/${encodeURIComponent(appId)}/git-credentials`),
        )
      ).credentials,
    issueGitCredential: async (appId) =>
      readGitCredential(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/git-credentials`,
          { method: "POST" },
          true,
        ),
      ),
    revokeGitCredential: async (appId, id) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/git-credentials/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        true,
      );
    },
    repositorySource: async (appId, repo, query, signal) =>
      decoded(RepositorySource)(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/source?${new URLSearchParams({ ...query })}`,
          signal === undefined ? {} : { signal },
        ),
      ),
    // A release is named by its tag, which HQ gives no second one: the one HQ holds under it is
    // this one where it tags the same `main` with the same commits.
    release: (appId, request) =>
      confirmed(
        async () =>
          readRelease(
            await authorized(
              releasesPath(appId),
              { method: "POST", body: JSON.stringify(request) },
              true,
            ),
          ),
        async () =>
          heldAsked(
            (await releasesOf(appId)).find(
              (made) =>
                made.tag === request.tag &&
                made.sha === request.groupHead &&
                sameEntries(made.entries, request.entries),
            ),
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
              true,
            ),
          ),
        async () => {
          const [newest] = await releasesOf(appId);
          return heldAsked(
            newest?.rollbackOf === tag && newest.sha === request.groupHead ? newest : undefined,
          );
        },
      ),
    mateRecipe: async (appId, signal) =>
      readRecipeTier(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/recipe/mate`,
          signal === undefined ? {} : { signal },
        ),
      ),
    recordClosedOff: async (projectId) => {
      await authorized(
        `/api/mates/${encodeURIComponent(projectId)}/closed-off`,
        { method: "POST" },
        true,
      );
    },
    recheckKey: async (projectId) => {
      await authorized(
        `/api/mates/${encodeURIComponent(projectId)}/key-check`,
        { method: "POST" },
        true,
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
