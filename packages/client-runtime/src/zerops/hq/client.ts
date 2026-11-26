import { ObserveCredential } from "./observeCredential.ts";
import { ReadAccessRequest, ReadAccessRequests, type ReadAccessOutcome } from "./readAccess.ts";
import { type HqProblem, HqRefusal } from "@t3tools/shared/hqProblems";
import {
  HqRepoStorage,
  type HqRepoCapRequest,
  type KeptGitAnswer,
  type MatePersona,
  type ZeropsUserId,
} from "@t3tools/contracts";
import { HqRemoteRefusal } from "@t3tools/shared/hqGitTargets";
import { HqGitOperationReceipt, type HqGitTargetIntent } from "@t3tools/shared/hqGitTargets";
import { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";
import { PersonaTemplate, type SavePersonaTemplate } from "@t3tools/shared/personaTemplates";
import { HqActivityPage } from "@t3tools/shared/hqActivity";
import {
  HqGithubInstallView,
  HqGithubManifestView,
  HqGithubView,
  type HqGithubInstallRequest,
  type HqGithubManifestRequest,
  HqRepoRemoteCreateViaAppView,
  type HqRepoRemoteCreateViaAppRequest,
  type HqRepoRemoteViaAppRequest,
} from "@t3tools/shared/hqGithub";
import type { FollowRepoUpstreamRequest } from "@t3tools/shared/hqChanges";
import { RASTER_CONTENT_TYPES } from "@t3tools/shared/hqAttachments";
/**
 * HQ's API as the client calls it (`mate-hq spec/protocol.md`), through HQ's door.
 *
 * A person signs in with their Zerops access token and its expiry (`POST /api/door {accessToken,
 * expiresAt, orgId}`, in the body only) and HQ answers a session of its own, which ends no later
 * than that token, which this client sends as `Authorization:
 * Bearer` and renews before it ends with the same request and a current token, keeping its id.
 * Create, an operation's Continue, hand-over and take-over replace also carry the access token for
 * HQ’s Zerops writes.
 * Where the account keeps it (`kept`), a load presents the kept session before any sign-in.
 *
 * Every failure is an {@link HqError}: `unavailable` when HQ could not be reached or does not
 * answer, `refused` when it
 * answered no — with HQ's own code and words — and `uncertain` when a write's answer was lost and
 * what HQ holds, read back at once, does not show it made.
 *
 * @module hq/client
 */
import {
  AppReposGovernance,
  type HqRepoGovernance,
  attachmentPath,
  ChangeMetadataResponse,
  ChangeCommitsResponse,
  ChangeDetailResponse,
  type ChangeDetailQuery,
  HqChange,
  HqChangeComment,
  type AttachmentLink,
  type ChangeLink,
} from "@t3tools/shared/hqChanges";
import { GitCredential, GitCredentialList, type GitCredentialRecord } from "@t3tools/shared/hqGit";
import { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { type HqDeployAnswer, WithDeploys } from "@t3tools/shared/hqDeploys";
import {
  Release,
  ReleaseListResponse,
  ReleaseServicePlan,
  type CreateReleaseRequest,
  type ProductionShape,
  type RollbackRequest,
} from "@t3tools/shared/hqRelease";
import type { HqOffers } from "@t3tools/shared/hqOffers";
import type {
  HqHiddenEnvironment,
  HqNavigationIntake,
  HqNavigationMateTask,
} from "@t3tools/shared/hqStream";
import { HqMergersAnswer, type HqMergers, type HqMergersRequest } from "@t3tools/shared/hqMergers";
import {
  HqOutsideProductionAnswer,
  type HqOutsideProductionRequest,
} from "@t3tools/shared/hqOutsideProduction";
import type { HqOutsideTarget } from "@t3tools/shared/hqEnvironment";
import {
  HqAiKeyView,
  HqChannelView,
  HqDiscordView,
  HqIntakeView,
  HqScheduleView,
  HqAppTasksView,
  HqSlackChannels,
  HqSlackView,
  type HqTaskLimitsRequest,
  HqTaskLimitsView,
  HqWebhookView,
  type HqAppTask,
  type HqAiKeyRequest,
  type HqChannelRequest,
  type HqDiscordConnectRequest,
  type HqIntakeRequest,
  type HqScheduleRequest,
  type HqSlackConnectRequest,
  type HqWebhookRequest,
} from "@t3tools/shared/hqIntake";
import { HqTakeOverList, HqTakeOverReplaced } from "@t3tools/shared/hqTakeOver";
import { HqChatLink } from "@t3tools/shared/hqChatLinks";
import type { OverviewLogins } from "@t3tools/shared/mateLink";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { BirthIntent } from "../birthIntent.ts";
import type { TierProjectVariable } from "../recipeTier.ts";
import {
  GIT_BROWSE_READS,
  gitBrowsePath,
  type GitBrowseBytesRead,
  type GitBrowseParams,
  type GitBrowseRead,
  type GitBrowseValue,
} from "../gitBrowse/reads.ts";
import { fileSize } from "../gitBrowse/blob.ts";
import { heldType } from "../gitBrowse/raw.ts";

import { type FetchImplementation, type ZeropsAccess, type ZeropsAccessAsk } from "../api.ts";
import type { ZeropsIntegrationToken } from "../groupReach.ts";
import type { CanonicalHqEnvironment } from "./environments.ts";
import {
  GIT_BOX_UNAVAILABLE,
  hqDisagreesOn,
  hqRefusalWords,
  MERGE_TOO_LARGE,
  mergeTooLargeWords,
  ZEROPS_NO_CREDENTIAL,
  ZEROPS_UNANSWERED,
} from "./refusals.ts";
import { accessEnded } from "./accessEnded.ts";
import { hqStructureOf } from "./structure.ts";
import { makeChiefCalls, type HqChiefCalls } from "./chief.ts";

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
 * A Mate as HQ reads it: its record, its birth, and — joined from HQ's overview of it, where the
 * reader may observe it (`hqMates.ts`) — its agents' logins.
 */
export interface HqMate extends Partial<HqMateRecord> {
  readonly birthId?: string | null;
  /** The accepted setup import, retained after its browser press ends. */
  readonly importProcessId?: string | undefined;
  readonly signers?: Readonly<Record<string, ZeropsUserId>>;
  /**
   * Who made it — whoever set its record up: a Mate recorded before HQ kept it is null; absent:
   * not read yet.
   */
  readonly madeBy?: string | null | undefined;
  /** Who asked for its stand-up, with its record: nobody is null; absent: not read yet. */
  readonly standupRequestedBy?: string | null | undefined;
  /** Who signed each of its agents' logins in, as its overview says; absent where HQ holds none. */
  readonly logins?: OverviewLogins;
  /** A ready agent outside Mate's sign-in flow, relayed in its overview. */
  readonly runsWithoutSignIn?: boolean;
  /**
   * It takes tasks from outside and runs on the organization's API key, never on a person's
   * sign-in (`HqNavigationMate.automated`); absent: not one.
   */
  readonly automated?: boolean | undefined;
  /** The task an automated Mate is on, or none. */
  readonly task?: HqNavigationMateTask | null | undefined;
  /** Zerops refused its key and HQ dropped it, until a hand-over admits a new one. */
  readonly keyRefused?: true | undefined;
}

/**
 * What the person may do with a thing HQ streams, decided by the verb rule over their live Zerops
 * roles (`@t3tools/shared/zeropsOffers`): of a Mate `observe_mate`, `edit_mate_record`, `detach`;
 * of an environment its deploys and removal, and `finish`. Absent while those roles are not read.
 * Where a Mate may go HQ answers as the move opens.
 */
export interface HqOffered {
  readonly can?: HqOffers;
}

/** HQ's held records, including projects whose removal has not finished at HQ. */
export interface HqAppContents {
  /** The same project, change, release and code repository records that guard Delete. */
  readonly empty: boolean;
  /** By id: still held at HQ, deleting or absent in HQ's Zerops view. */
  readonly deletingProjectIds: ReadonlyArray<string>;
}

/** HQ's structure: the organization's applications, and the Mates HQ holds in none. */
export interface HqStructure {
  /** What the person may do with the organization's applications (`organizationOffers`). */
  readonly can?: HqOffers;
  /**
   * Each placeable project, by id: one in the person's own live Zerops list that HQ holds no row
   * for, with whether they may write its Mate's record (`create_mate_record`), where their roles
   * are read. The client derives it; HQ sends none. Absent until both are read.
   */
  readonly placeable?: Readonly<Record<string, HqOffers>>;
  /** The Mates HQ holds in no application: their name as the client resolves it, and their record. */
  readonly ungrouped: ReadonlyArray<
    {
      readonly projectId: string;
      readonly name?: string | undefined;
      readonly mate: HqMate;
      /** The operation HQ runs on it, as navigation shows it (`HqOperation`). */
      readonly operation?: HqOperation;
      /** What HQ itself offers the reader on it (`set_up_mate`). */
      readonly offers?: ReadonlyArray<string>;
    } & HqOffered
  >;
  readonly apps: ReadonlyArray<{
    readonly problems?: ReadonlyArray<HqProblem> | undefined;
    readonly id: string;
    readonly name: string;
    /**
     * The operation HQ runs on it (`HqOperation`): its deletion with its code (`app_deletion`), or
     * another of its kinds; absent where navigation shows none.
     */
    readonly operation?: HqOperation;
    readonly projects: ReadonlyArray<
      {
        readonly projectId: string;
        readonly name?: string | undefined;
        readonly kind: string;
        readonly mate: HqMate | null | undefined;
        /** The operation HQ runs on it, as navigation shows it (`HqOperation`). */
        readonly operation?: HqOperation;
        /** What HQ itself offers the reader on it (`set_up_mate`). */
        readonly offers?: ReadonlyArray<string>;
      } & HqOffered
    >;
    /** What the person may do with it: its changes, its deploys, its release (`applicationOffers`). */
    readonly can?: HqOffers;
    /** Set up Mate on one of its projects stands in for Add a Mate: no other Mate stands in it. */
    readonly setUpOffered?: true;
    /**
     * Absent while HQ's record of the application is not read whole: projected projects cannot
     * establish emptiness.
     */
    readonly contents?: HqAppContents;
    /**
     * Its stage and production with their deploys (`hq/environments.ts`); absent where HQ sent none
     * this build can read.
     */
    readonly environments?: ReadonlyArray<CanonicalHqEnvironment & HqOffered>;
    /** The Mates on their way into it whose attach has not landed. */
    readonly births?: ReadonlyArray<HqBirth>;
    /**
     * Where its automated Mates take tasks from, and how many wait for one to be free; null:
     * nowhere.
     */
    readonly intake?: HqNavigationIntake | null;
    /**
     * Who merges its changes, where it limits that: the organization's Owner and Admins, and the
     * people it names. Absent: whoever may push merges.
     */
    readonly mergers?: HqMergers;
    /** Its stages and productions Zerops does not list to the person, to ask read access to. */
    readonly hiddenEnvironments?: ReadonlyArray<HqHiddenEnvironment>;
  }>;
}

/**
 * A birth's operation as HQ runs it (`mate-hq spec/protocol.md` S13a): its phase, its failure, and
 * while it waits for its maker the person whose Continue it waits for.
 */
export const HqBirthOperation = Schema.Struct({
  kind: Schema.Literal("birth"),
  phase: Schema.Literals([
    "accepted",
    "access_requested",
    "project_requested",
    "project_created",
    "project_ready",
    "key_requested",
    "import_requested",
    "import_accepted",
    "restart_requested",
  ]),
  at: Schema.String,
  acceptedAt: Schema.String,
  failure: Schema.optionalKey(
    Schema.Struct({
      ...HqOperationFailure.fields,
      step: Schema.Literals([
        "create",
        "watch",
        "access",
        "settings",
        "key",
        "import",
        "restart",
        "zerops",
      ]),
    }),
  ),
  continueBy: Schema.optionalKey(Schema.String),
});

/**
 * An open birth's lifecycle state, HQ's one derivation of it (`mate-hq spec/protocol.md`,
 * Lifecycle states): the client draws it and derives none.
 */
export const HqBirthState = Schema.Literals([
  "running",
  "waiting_for_maker",
  "failed",
  "awaiting_link",
  "awaiting_registration",
]);
export type HqBirthState = typeof HqBirthState.Type;

/**
 * A request a birth's state lets its reader ask HQ for (navigation, `births[].offers`): `continue`
 * its operation, `delete` the birth alone, or `delete_project`, the Mate deletion of its project.
 * An offer is no permission: HQ decides the reader's right again at the press.
 */
export const HqBirthOffer = Schema.Literals(["continue", "delete", "delete_project"]);
export type HqBirthOffer = typeof HqBirthOffer.Type;

/**
 * One thing an adopted birth's attempt may have written to the existing project, which its Delete
 * leaves there (navigation, `births[].left`): the `zcp` service its import asked for, the Mate key
 * it minted (HQ refuses that key from then on), the project's `mate` tag, its isolation settings,
 * the `OWNER` grant it asked for a person, and what enabling the project's own zcp service wrote
 * to it (the Mate key and HQ's address as secrets, `ZCP_MATE_ENABLED`, a restart).
 */
export const HQ_BIRTH_LEFT = [
  "zcp_service",
  "mate_key",
  "mate_tag",
  "isolation",
  "owner_grant",
  "zcp_enabled",
] as const;
export type HqBirthLeft = (typeof HQ_BIRTH_LEFT)[number];

/**
 * The operation HQ shows on a project, an application or a production (`mate-hq spec/protocol.md`
 * navigation, S13c): a Mate's deletion (`mate_deletion`), an application's (`app_deletion`), a
 * production's removal (`production_removal`), a project's move (`project_move`), an application's
 * rename (`app_rename`, S13d) or another kind it runs there, by its `id` (what Continue names), open
 * or stopped with its failure, which names who stopped it and why,
 * and while it waits for its maker the person whose Continue it waits for. An
 * application's rename names the projects of its receipt the person sees, each with its result once
 * it has one (`renamed`, `renamed_since`, `moved`, `gone` or `refused:<Zerops' code>`). Its kind and
 * phase are read as strings: a kind or phase this build does not know never takes its project away.
 */
export const HqOperation = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  phase: Schema.String,
  at: Schema.String,
  acceptedAt: Schema.String,
  failure: Schema.optionalKey(HqOperationFailure),
  continueBy: Schema.optionalKey(Schema.String),
  /** What an application's operation ended at for the person to decide (`release_review`). */
  needs: Schema.optionalKey(Schema.String),
  /** The requests its state lets the person reading ask for (`continue`, `end`, `again`), as HQ decides them. */
  offers: Schema.optionalKey(Schema.Array(Schema.String)),
  projects: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ projectId: Schema.String, result: Schema.optionalKey(Schema.String) }),
    ),
  ),
  /**
   * An application's deletion's parts in the order it runs them (`mate`, each `stage`, each
   * `production`, then `code`), each by its project where it has one, and how it stands:
   * `pending`, `deleting` or `gone`. Read as strings, as `kind` and `phase` are.
   */
  steps: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        part: Schema.String,
        projectId: Schema.optionalKey(Schema.String),
        name: Schema.optionalKey(Schema.String),
        state: Schema.String,
      }),
    ),
  ),
});
export type HqOperation = typeof HqOperation.Type;

/** Where a project stands, or is moved to: an application (`null`: none) and its kind there. */
export interface HqPlacementSide {
  readonly appId: string | null;
  readonly kind: RoleProjectKind;
}

/**
 * The reviewed effect an approval carries (`mate-hq spec/protocol.md` S19b), which HQ carries out
 * as its `proposal_effect` operation: a service's start, stop or restart; a domain routed to a
 * service's port; the services a release plan creates, imported into production (`hostnames`,
 * each once, and `planHash`, the hash of the plan the person read); access changes, one per
 * person, each with the operation id the client chose; or a message to the named Mate's project,
 * which HQ's mailbox delivers.
 */
export type HqProposalEffect =
  | {
      readonly kind: "service.restart" | "service.start" | "service.stop";
      readonly serviceId: string;
    }
  | {
      readonly kind: "domain.add";
      readonly serviceId: string;
      readonly domains: ReadonlyArray<string>;
      readonly port: number;
    }
  | {
      readonly kind: "service.create";
      readonly hostnames: ReadonlyArray<string>;
      readonly planHash: string;
    }
  | { readonly kind: "access.set"; readonly changes: ReadonlyArray<HqStartedAccessChange> }
  | {
      readonly kind: "mate.message" | "chief.message";
      readonly toProjectId: string;
      readonly words: string;
    };

/**
 * An approval's start: its operation's `id` (made by the client; for `access.set` one of its
 * changes' ids), the proposal's own project (the conversation's) and the reviewed effect.
 */
export interface HqProposalApproval {
  readonly id: string;
  readonly projectId: string;
  readonly effect: HqProposalEffect;
}

/**
 * A project's move as HQ starts it (`POST /api/projects/{projectId}/move`, S13d): from the
 * placement the person reviewed (`from`) to `to`, into a new application named `newApp` where `to`
 * names none; `id` the operation's, made by the client.
 */
export interface HqProjectMoveStart {
  readonly id: string;
  readonly from: HqPlacementSide;
  readonly to: HqPlacementSide;
  readonly newApp?: { readonly name: string };
}

/**
 * A stage or a production added to an application (`POST /api/apps/:appId/environments`, S13d),
 * which HQ runs as its `environment` operation on the person's token: a new project (`create`, its
 * services from `recipe`, a Zerops import YAML) or an existing unattached one (`projectId`). `id`
 * is the operation's, made by the client; the same id with the same body is answered again.
 */
export interface HqEnvironmentStart {
  readonly id: string;
  readonly tier: "stage" | "production";
  readonly projectId?: string;
  readonly create?: {
    readonly name: string;
    readonly location?: string;
    readonly corePackage?: string;
    /** Who reaches the project beyond their organization role, as births' `userRoles`. */
    readonly access: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>;
    readonly recipe?: string;
  };
  readonly environment?: { readonly name: string };
}

/**
 * *Put it live* (`POST /api/apps/:appId/put-live`, S13d), which HQ runs as its `put_live` operation
 * on the person's token: the application's production made from `production`, then its first
 * release of `release`, creating only the services the person `approves`. Where the release
 * creates anything else, or reads a value production's vault lacks, the operation ends with
 * `needs: "release_review"`. `id` as {@link HqEnvironmentStart}'s.
 */
export interface HqPutLiveStart {
  readonly id: string;
  readonly production: NonNullable<HqEnvironmentStart["create"]>;
  readonly release: {
    readonly tag: string;
    readonly groupHead: string;
    readonly entries: ReadonlyArray<{ readonly service: string; readonly sha: string }>;
    readonly shape?: ProductionShape;
  };
  /** The services the pressed sheet named, by hostname. */
  readonly approves: ReadonlyArray<string>;
}

/** What a start on an application says while another of its operations runs there. */
const ENVIRONMENT_IN_FLIGHT = "Another setup on this application is running.";

/**
 * A birth's start (`POST /api/births`), which HQ runs as its operation: a new project in a new
 * application (`app`) or in one that stands (`appId`), or a Mate on a project that exists
 * (`projectId`; with `appId` too, an adoption into that application).
 */
export type HqCreateBirth = {
  readonly id: string;
  readonly face: string;
  readonly intent: BirthIntent;
  /** The persona its stand-up runs with; HQ keeps it only with a stand-up ask. */
  readonly standupPersona?: MatePersona;
  /** Its recipe's tier as converted for a Mate's import: present exactly with a tier recipe. */
  readonly tier?: {
    readonly yaml: string;
    readonly variables?: ReadonlyArray<TierProjectVariable>;
  };
} & (
  | {
      readonly app: { readonly name: string };
      readonly appId?: never;
      readonly projectId?: never;
      readonly owner?: never;
    }
  | {
      readonly appId: string;
      readonly app?: never;
      readonly projectId?: never;
      readonly owner?: never;
    }
  | {
      readonly projectId: string;
      readonly appId?: string;
      readonly app?: never;
      /** The person (`clientUserId`) its operation grants `OWNER` on the project, first. */
      readonly owner?: string;
    }
);

/** An organisation role and its rights, as a `role` change or an invitation sets them. */
export interface HqAccessMembership {
  readonly roleCode: string;
  readonly canCreateProjects: boolean;
  readonly canViewFinances: boolean;
  readonly canEditFinances: boolean;
}

/**
 * One person's access change as its start asks it (`mate-hq spec/protocol.md` S13a), which HQ runs
 * as an operation of kind `access`: the person by Zerops user id (an invitation by its address, a
 * read-access grant by its request) and the variant's own fields. A grant's `roleCode: null`
 * takes the project's role away.
 */
export type HqAccessChange =
  | {
      readonly kind: "projects";
      readonly userId: string;
      readonly set: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string | null }>;
    }
  | {
      readonly kind: "app";
      readonly userId: string;
      readonly appId: string;
      readonly level: "work" | "look" | "withdraw";
    }
  | { readonly kind: "role"; readonly userId: string; readonly membership: HqAccessMembership }
  | { readonly kind: "remove"; readonly userId: string }
  | {
      readonly kind: "resend";
      readonly userId: string;
      readonly names?: { readonly firstName: string; readonly lastName: string };
    }
  | {
      readonly kind: "invite";
      readonly email: string;
      readonly membership?: HqAccessMembership;
      readonly names?: { readonly firstName: string; readonly lastName: string };
      readonly grants?: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>;
    }
  | { readonly kind: "readAccess"; readonly requestId: string };

/** A change of a start with the operation id this client chose for it. */
export interface HqStartedAccessChange {
  readonly id: string;
  readonly change: HqAccessChange;
}

/** HQ's answer to a start: one operation per change, by the id its start chose. */
const HqStartedAccessChanges = Schema.Struct({
  operations: Schema.Array(Schema.Struct({ id: Schema.String })),
});

/**
 * A Mate's birth intent at HQ: where it goes and with which face, bound to its Zerops project once
 * created or adopted, until its Mate links.
 */
export interface HqBirth {
  readonly operation: typeof HqBirthOperation.Type;
  readonly state: HqBirthState;
  readonly offers: ReadonlyArray<HqBirthOffer>;
  readonly projectId?: string | null;
  readonly importProcessId?: string;
  readonly id: string;
  /** Its face as its attach records it: empty where it wears its name's tint. */
  readonly face: string;
  /** The person who opened the birth, and the plan HQ retained for it. */
  readonly madeBy?: string;
  readonly chief?: boolean;
  readonly chiefRegistered?: boolean;
  readonly adopted?: boolean;
  /** An adopted birth's `HqBirthLeft`s as HQ sends them; one this build does not know is read past. */
  readonly left?: ReadonlyArray<string>;
  readonly intent?: Readonly<Record<string, unknown>>;
  /** HQ's last refusal of a hello of the birth's key; absent while HQ refused none. */
  readonly linkRefusal?: HqLinkRefusal;
}

/**
 * Why HQ refused the hello of a birth's Mate (`key_refused`, `key_too_wide`, `key_not_sensitive`,
 * `not_a_mate`; a code this build does not know is kept as sent), and when: UTC, ISO 8601.
 */
export interface HqLinkRefusal {
  readonly code: string;
  readonly at: string;
}

/** HQ's answer to `POST /api/births`: the birth intent it recorded, by id, and its face. */
const HqRecordedBirth = Schema.Struct({ id: Schema.String, face: Schema.String });
export type HqRecordedBirth = typeof HqRecordedBirth.Type;

export class HqError extends Error {
  /**
   * `unavailable` when HQ could not be reached or is not serving; `refused` when it answered no;
   * `uncertain` when a write was sent and its answer lost — HQ may have made it.
   */
  readonly kind: "unavailable" | "refused" | "uncertain";
  /** HQ's code (`forbidden`, `conflict`, …), or `network`. */
  readonly code: string;
  /** HQ's reason code beside it, where it named one (`tag_taken`, `change_not_open`, …). */
  readonly reason: string | undefined;
  readonly box: string | undefined;
  readonly status: number | undefined;
  readonly problems: ReadonlyArray<HqProblem> | undefined;
  constructor(input: {
    readonly kind: HqError["kind"];
    readonly code: string;
    readonly reason?: string | undefined;
    readonly box?: string | undefined;
    readonly status?: number | undefined;
    readonly message: string;
    readonly problems?: ReadonlyArray<HqProblem> | undefined;
  }) {
    super(input.message);
    this.name = "HqError";
    this.kind = input.kind;
    this.code = input.code;
    this.reason = input.reason;
    this.box = input.box;
    this.status = input.status;
    this.problems = input.problems;
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

/**
 * What HQ hands for a Mate's socket: the ticket, its life in seconds, the origin to open and
 * `grantSeconds`, how long a connection opened or extended with it may stay open (a positive
 * integer).
 */
export interface HqMateTicket {
  readonly ticket: string;
  readonly expiresIn: number;
  readonly origin: string;
  readonly grantSeconds: number;
}

export interface RepoGovernanceEntry {
  readonly name: string;
  readonly url: string;
  readonly synced: boolean;
  readonly governance: HqRepoGovernance | null;
}

export type WebFailureKind = "descriptor-unreachable" | "identity-failed" | "opening-deadline";

export interface HqApi {
  readonly gitTargetWrite: (
    requestId: string,
    intent: HqGitTargetIntent,
    candidate?: string,
  ) => Promise<HqGitOperationReceipt>;
  readonly gitTargetReceipt: (
    requestId: string,
    intent: HqGitTargetIntent,
  ) => Promise<HqGitOperationReceipt | null>;
  /** The reader's Chief registered for, or moved to, `projectId` (`chief.ts`). */
  readonly setChief: HqChiefCalls["setChief"];
  /** Every decision HQ holds of the proposals named (`chief.ts`). */
  readonly proposalDecisions: HqChiefCalls["proposalDecisions"];
  /** One proposal's decision, then once how an approval ended (`chief.ts`). */
  readonly decideProposal: HqChiefCalls["decideProposal"];
  /** Records that the person was shown a hidden value (`chief.ts`). */
  readonly recordReveal: HqChiefCalls["recordReveal"];
  readonly autoUpdatePolicy: (signal?: AbortSignal) => Promise<HqAutoUpdatePolicy>;
  readonly setAutoUpdatePolicy: (enabled: boolean) => Promise<HqAutoUpdatePolicy>;
  /**
   * `PUT /api/persona-templates/{id}`, the id the client made: the template as saved, at its new
   * revision. A write over a revision HQ no longer holds is refused (`revision_conflict`).
   */
  readonly savePersonaTemplate: (
    id: string,
    template: SavePersonaTemplate,
  ) => Promise<PersonaTemplate>;
  /** `DELETE /api/persona-templates/{id}?revision=N`: done also where HQ holds it no more. */
  readonly deletePersonaTemplate: (id: string, revision: number) => Promise<void>;
  readonly structure: (signal?: AbortSignal) => Promise<HqStructure>;
  /**
   * A ticket to open the Mate of `projectId`'s socket with (`POST /api/mates/:projectId/ticket`):
   * the connection's first frame is `{ticket}`, sent to `origin`. A Mate's connection is one per
   * tab, and every reconnect asks again. With `extend` the ticket extends an open connection
   * instead (body `{"extend":true}`), presented through the Mate's `zerops.grant.extend`.
   */
  readonly mateTicket: (
    projectId: string,
    signal?: AbortSignal,
    options?: { readonly extend: true },
  ) => Promise<HqMateTicket>;
  /**
   * One segment of HQ's scope stream (`@t3tools/shared/hqStream`): a socket opened with a fresh
   * ticket for the session, telling `on` once it is open, of every text message and of its close
   * code. A socket HQ closed for its session (`4401`) forgets that session first, so the next
   * segment's ticket enters the door again.
   */
  readonly openScopeSocket: (
    on: Parameters<OpenHqSocket>[1],
    signal: AbortSignal,
  ) => Promise<HqSocket>;
  /** A Mate's face, as HQ records it (`PATCH /api/mates/{projectId}`). */
  readonly updateMate: (projectId: string, change: { readonly face: string }) => Promise<void>;
  /** One use of the person's session to open the support console. */
  readonly supportExchange: () => Promise<{ readonly exchange: string }>;
  readonly webFailure: (report: {
    readonly projectId: string;
    readonly kind: WebFailureKind;
  }) => Promise<void>;
  /** Answers the removed project’s Git question (`POST /api/apps/{id}/kept-git`). */
  readonly answerKeptGit: (appId: string, answer: KeptGitAnswer["answer"]) => Promise<void>;
  readonly createBirth: (
    birth: HqCreateBirth,
  ) => Promise<HqRecordedBirth & { readonly appId: string }>;
  /**
   * Gives an operation waiting for its maker the current access token (`POST
   * /api/operations/{id}/continue`); HQ queues its job again from the phase it recorded.
   */
  readonly continueOperation: (id: string) => Promise<void>;
  /**
   * Ends an application's operation that waits for a maker who cannot continue it (`POST
   * /api/operations/{id}/end`), an organisation Owner's or Admin's: HQ frees the application and
   * deletes nothing, so a project the operation made stays.
   */
  readonly endOperation: (id: string) => Promise<void>;
  /**
   * Starts a Mate's deletion with the person's access token (`POST
   * /api/projects/{projectId}/deletion`): HQ deletes its project and releases its records; `id` is
   * the operation's, made by the client, and the same id with the same body is answered again.
   * `keptGit: "keep"` answers HQ's question whether to keep its application's Git.
   */
  readonly startMateDeletion: (
    projectId: string,
    start: { readonly id: string; readonly keptGit?: "keep" },
  ) => Promise<void>;
  /**
   * Starts a failed Mate's restart with the person's access token (`POST
   * /api/projects/{projectId}/restart`, S13d): HQ stops its container, waits for the stop to end
   * and starts it, as its `mate_restart` operation. `id` as `startMateDeletion`'s.
   */
  readonly startMateRestart: (projectId: string, start: { readonly id: string }) => Promise<void>;
  /**
   * Starts a production's removal with the person's access token (`POST
   * /api/apps/{appId}/productions/{projectId}/removal`): HQ retires its deploy token and lets go of
   * it, deleting its project too where `deleteProject` (the fate the person reviewed); `id` as
   * `startMateDeletion`'s.
   */
  readonly startProductionRemoval: (
    appId: string,
    projectId: string,
    start: { readonly id: string; readonly deleteProject: boolean },
  ) => Promise<void>;
  /**
   * Starts an application's deletion with its code with the person's access token (`POST
   * /api/apps/{appId}/deletion`): HQ deletes its last Mate's project first where `mate` names it,
   * then each of `stages` (the stage projects the person reviewed) and each of `productions` (the
   * production projects the person confirmed) from Zerops, then the application with its code; it
   * refuses a list that differs from its own (`held_changed`) and a Mate it holds that `mate` does
   * not name (`app_has_mate`). `id` as `startMateDeletion`'s.
   */
  readonly startAppDeletion: (
    appId: string,
    start: {
      readonly id: string;
      readonly stages: ReadonlyArray<string>;
      readonly mate?: string;
      readonly productions?: ReadonlyArray<string>;
      readonly names?: Readonly<Record<string, string>>;
    },
  ) => Promise<void>;
  /** Starts a stage's or a production's addition to the application (`HqEnvironmentStart`). */
  readonly startEnvironment: (appId: string, start: HqEnvironmentStart) => Promise<void>;
  /**
   * Starts setting up or renewing an attached environment's deploy key (`POST
   * /api/apps/:appId/environments/:name/deploy-key`, S13d), which HQ runs as its `deploy_key`
   * operation on the person's token; `id` as {@link HqEnvironmentStart}'s.
   */
  readonly startDeployKey: (
    appId: string,
    name: string,
    start: { readonly id: string },
  ) => Promise<void>;
  /** Starts the application's *Put it live* (`HqPutLiveStart`). */
  readonly startPutLive: (appId: string, start: HqPutLiveStart) => Promise<void>;
  /**
   * Starts a project's move with the person's access token (`POST
   * /api/projects/{projectId}/move`): HQ places it (in a new application where `newApp` names one)
   * in the start's write, then renames it in Zerops after its application; it refuses a placement
   * that differs from `from` (`held_changed`). `id` as `startMateDeletion`'s.
   */
  readonly startProjectMove: (projectId: string, start: HqProjectMoveStart) => Promise<void>;
  /**
   * Starts an application's rename with the person's access token (`POST
   * /api/apps/{appId}/rename`): HQ renames it in the start's write, then each of its projects in
   * Zerops after it. `id` as `startMateDeletion`'s.
   */
  readonly startAppRename: (
    appId: string,
    start: { readonly id: string; readonly name: string },
  ) => Promise<void>;
  /**
   * Starts access changes, one operation per person, on the current access token (`POST
   * /api/access-changes`); the same ids with the same changes answer the operations again.
   */
  /**
   * Approves a proposal whose effect HQ carries out (`POST /api/proposals/{id}/approval`, S19b):
   * HQ writes the decision and starts its operation in one write, and records how it ended itself.
   * A Zerops effect carries the person's access token; a message carries none. HQ holding another
   * decision is its `409 conflict/decided`.
   */
  readonly approveProposal: (proposalId: string, approval: HqProposalApproval) => Promise<void>;
  readonly startAccessChanges: (
    changes: ReadonlyArray<HqStartedAccessChange>,
  ) => Promise<{ readonly operations: ReadonlyArray<{ readonly id: string }> }>;
  /**
   * Deletes the maker's access change that failed or waits for their token (`DELETE
   * /api/access-changes/{id}`); one still running is refused (`operation_running`).
   */
  readonly deleteAccessChange: (id: string) => Promise<void>;
  /** Deletes an unbound birth; HQ rechecks the person's current role. */
  readonly deleteBirth: (birthId: string) => Promise<void>;
  /**
   * Hands a Mate over to `ownerUserId` (`POST /api/mates/:projectId/hand-over`): HQ moves its
   * project's `OWNER` override and replaces its key, with the person's own access token. A stop part
   * way is HQ's `409 handover_unfinished`, its words naming the phase; asking again finishes it.
   */
  readonly handOver: (projectId: string, ownerUserId: string) => Promise<void>;
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
  /**
   * Points the application's automated Mates at a GitHub repository's issues carrying a label
   * (`PUT /api/apps/:appId/intake`): the webhook HQ made, or the URL and secret to paste, the
   * secret shown this once.
   */
  readonly setIntake: (appId: string, request: HqIntakeRequest) => Promise<HqIntakeView>;
  /** Stops the application's automated Mates taking tasks (`DELETE /api/apps/:appId/intake`). */
  readonly stopIntake: (appId: string) => Promise<void>;
  /** The organization's API keys, by provider, as set or not, never their values. */
  readonly aiKeys: () => Promise<ReadonlyArray<HqAiKeyView>>;
  /** A page of the organization's activity, newest first, before the entry `before` names (`GET /api/activity`). */
  readonly activity: (before: string | null) => Promise<HqActivityPage>;
  /** Keeps the organization's key for a provider, sealed (`PUT /api/org/ai-keys/:provider`). */
  readonly setAiKey: (provider: string, value: string) => Promise<HqAiKeyView>;
  /** Forgets the organization's key for a provider (`DELETE /api/org/ai-keys/:provider`). */
  readonly removeAiKey: (provider: string) => Promise<void>;
  /**
   * The integration tokens a member minted that keep Zerops refusing their removal, as HQ picks
   * them for an Owner or Admin out of `list`, the organization's integration tokens as Zerops
   * listed them to that person (`POST /api/members/:userId/take-over`).
   */
  readonly takeOverList: (
    userId: string,
    list: ReadonlyArray<ZeropsIntegrationToken>,
  ) => Promise<HqTakeOverList>;
  /**
   * Replaces one of them with a token minted with the person's own access token, then deletes it
   * (`POST /api/members/:userId/take-over/:tokenId`); a Mate's key goes to `ownerUserId` when given.
   */
  readonly takeOver: (
    userId: string,
    tokenId: string,
    ownerUserId: string | undefined,
  ) => Promise<HqTakeOverReplaced>;
  /**
   * Takes a chat account link HQ said to the person's Slack or Discord account: that account is
   * theirs in the organization from now on (`POST /api/chat-links`).
   */
  readonly takeChatLink: (code: string) => Promise<HqChatLink>;
  /** Whether the organization's Slack app is connected, and to which workspace (`GET /api/org/slack`). */
  readonly slack: () => Promise<HqSlackView>;
  /** The manifest the organization's Slack app is made from (`GET /api/org/slack/manifest`). */
  readonly slackManifest: () => Promise<unknown>;
  /**
   * Connects the organization's Slack app by its bot token and signing secret, both sealed; once
   * connected, either alone replaces the one HQ holds.
   */
  readonly connectSlack: (request: HqSlackConnectRequest) => Promise<HqSlackView>;
  /** The channels the organization's Slack bot is in (`GET /api/org/slack/channels`). */
  readonly slackChannels: () => Promise<HqSlackChannels>;
  readonly disconnectSlack: () => Promise<void>;
  /** The organization's Discord application, its interactions URL and allowlist (`GET /api/org/discord`). */
  readonly discord: () => Promise<HqDiscordView>;
  /** Connects the organization's Discord application; its bot token is sealed. */
  readonly connectDiscord: (request: HqDiscordConnectRequest) => Promise<HqDiscordView>;
  readonly disconnectDiscord: () => Promise<void>;
  /**
   * The channel an application takes tasks from on Slack or Discord (`GET
   * /api/apps/:appId/{slack,discord}`), `null` for none.
   */
  readonly appChannel: (
    appId: string,
    source: "slack" | "discord",
  ) => Promise<HqChannelView | null>;
  readonly setAppChannel: (
    appId: string,
    source: "slack" | "discord",
    request: HqChannelRequest,
  ) => Promise<HqChannelView>;
  readonly stopAppChannel: (appId: string, source: "slack" | "discord") => Promise<void>;
  /** An application's signed webhooks, never their secrets (`GET /api/apps/:appId/webhooks`). */
  readonly webhooks: (appId: string) => Promise<ReadonlyArray<HqWebhookView>>;
  /** Makes a signed webhook: its answer carries the secret, this once. */
  readonly makeWebhook: (appId: string, request: HqWebhookRequest) => Promise<HqWebhookView>;
  readonly deleteWebhook: (appId: string, webhookId: string) => Promise<void>;
  /** An application's schedules (`GET /api/apps/:appId/schedules`). */
  readonly schedules: (appId: string) => Promise<ReadonlyArray<HqScheduleView>>;
  readonly makeSchedule: (appId: string, request: HqScheduleRequest) => Promise<HqScheduleView>;
  readonly deleteSchedule: (appId: string, scheduleId: string) => Promise<void>;
  /**
   * An application's tasks: queued, at work, and the latest that ended (`GET
   * /api/apps/:appId/tasks`).
   */
  readonly appTasks: (appId: string) => Promise<ReadonlyArray<HqAppTask>>;
  /** Stops one of them (`POST /api/apps/:appId/tasks/:taskId/stop`). */
  readonly stopAppTask: (appId: string, taskId: string) => Promise<void>;
  /** The organization's limits on each task (`GET /api/org/task-limits`). */
  readonly taskLimits: () => Promise<HqTaskLimitsView>;
  readonly setTaskLimits: (limits: HqTaskLimitsRequest) => Promise<HqTaskLimitsView>;
  /** The organization's GitHub apps, never their keys (`GET /api/org/github`). */
  readonly github: () => Promise<HqGithubView>;
  /**
   * The manifest GitHub makes another of the organization's apps from (`POST
   * /api/org/github/manifest`): the browser posts it to `postUrl` as a form, and GitHub's page
   * takes over. It never replaces an app the organization holds.
   */
  readonly githubManifest: (request: HqGithubManifestRequest) => Promise<HqGithubManifestView>;
  /**
   * HQ forgets one of the organization's GitHub apps and its installations (`DELETE
   * /api/org/github/apps/:appId`); it stays on GitHub.
   */
  readonly githubForget: (githubAppId: number) => Promise<void>;
  /**
   * GitHub's page installing one of the organization's apps on another account or more
   * repositories, with a one-time state, so what is installed from it comes back accepted and
   * added by the caller (`POST /api/org/github/apps/:appId/install`).
   */
  readonly githubInstall: (
    githubAppId: number,
    request: HqGithubInstallRequest,
  ) => Promise<HqGithubInstallView>;
  /** HQ acts on a waiting installation's repositories (`POST …/installations/:id/accept`). */
  readonly githubAcceptInstallation: (installationId: number) => Promise<void>;
  /** GitHub suspends an installation of the app (`POST …/installations/:id/suspend`). */
  readonly githubSuspendInstallation: (installationId: number) => Promise<void>;
  /** GitHub resumes an installation the app suspended (`POST …/installations/:id/resume`). */
  readonly githubResumeInstallation: (installationId: number) => Promise<void>;
  /**
   * A repository mirrors to one an organization's GitHub app is installed on, with no token, through
   * the app `githubAppId` names (`PUT /api/apps/:appId/repos/:repo/remote/app`).
   */
  readonly repoRemoteViaApp: (
    appId: string,
    repo: string,
    request: HqRepoRemoteViaAppRequest,
  ) => Promise<void>;
  /**
   * HQ creates an empty private repository on an installation's account through its app, then
   * connects the code repository to it as {@link HqApi.repoRemoteViaApp} does
   * (`POST /api/apps/:appId/repos/:repo/remote/app/new`); answers its `owner/name`.
   */
  readonly repoRemoteCreateViaApp: (
    appId: string,
    repo: string,
    request: HqRepoRemoteCreateViaAppRequest,
  ) => Promise<HqRepoRemoteCreateViaAppView>;
  /**
   * A repository's code kept in HQ while it follows a GitHub repository, with no token
   * (`PUT /api/apps/:appId/repos/:repo/upstream`).
   */
  readonly followRepoUpstream: (
    appId: string,
    repo: string,
    request: FollowRepoUpstreamRequest,
  ) => Promise<void>;
  /** Its Mates no longer fetch the followed GitHub repository (`DELETE …/upstream`). */
  readonly unfollowRepoUpstream: (appId: string, repo: string) => Promise<void>;
  /** The repository and its code are deleted from Mate (`DELETE /api/apps/:appId/repos/:repo`). */
  readonly deleteRepo: (appId: string, repo: string) => Promise<void>;
  /**
   * A repository's Git storage cap set, in whole GiB (`PUT /api/apps/:appId/repos/:repo/storage`):
   * HQ's answer is its storage as it stands after.
   */
  readonly setRepoCap: (appId: string, repo: string, capGiB: number) => Promise<HqRepoStorage>;
  /**
   * Who merges the application's changes (`PUT /api/apps/:appId/mergers`): the organization's Owner
   * and Admins and these people, or — `null` — whoever may push. HQ's answer is the limit as it
   * stands after; `null` where there is none.
   */
  readonly setMergers: (
    appId: string,
    people: ReadonlyArray<string> | null,
  ) => Promise<HqMergers | null>;
  /**
   * Says the application's production is deployed outside Mate
   * (`PUT /api/apps/:appId/outside-production`), at `address` or at none given; `null` lifts it.
   * HQ's answer is the outside production's environment target after; `null` where none stands.
   */
  readonly setOutsideProduction: (
    appId: string,
    outside: { readonly address: string | null } | null,
  ) => Promise<HqOutsideTarget | null>;
  /** The person's active Git password metadata; passwords are returned only on issue. */
  /** Reads metadata only; provisioning records authority separately. */
  readonly observeCredential: (projectId: string) => Promise<ObserveCredential>;
  readonly appRepoGovernance: (appId: string) => Promise<ReadonlyArray<RepoGovernanceEntry>>;
  /** The organization's open read access requests: every one to an Admin or Owner, else their own. */
  readonly readAccessRequests: () => Promise<ReadonlyArray<ReadAccessRequest>>;
  /** Asks for read access to an environment; asking again answers the request still open. */
  readonly askReadAccess: (projectId: string) => Promise<ReadAccessRequest>;
  /** An Admin or Owner closes an open request; HQ writes nothing at Zerops. */
  readonly closeReadAccess: (id: string, outcome: ReadAccessOutcome) => Promise<void>;
  /**
   * Binds the verified person establishing the native ZCP key; no hash reconnects an existing Mate.
   * HQ answers the observe metadata as it stands after it (mate-hq spec/protocol.md §S16c).
   */
  readonly establishZcpAuthorization: (
    projectId: string,
    context: { readonly keyHash?: string },
  ) => Promise<ObserveCredential>;
  readonly gitCredentials: (appId: string) => Promise<ReadonlyArray<GitCredentialRecord>>;
  readonly issueGitCredential: (appId: string) => Promise<GitCredential>;
  readonly revokeGitCredential: (appId: string, id: string) => Promise<void>;
  /** One of the Git browser's reads (`zerops/gitBrowse/reads.ts`), after the person's read rule. */
  readonly gitBrowse: <R extends GitBrowseRead>(
    read: R,
    appId: string,
    repo: string,
    params: GitBrowseParams<R>,
    signal?: AbortSignal,
  ) => Promise<GitBrowseValue<R>>;
  /**
   * The bytes of a read that answers bytes (`raw`, `archive`), held as an image, plain text or
   * an octet stream whatever HQ sends, so opening them runs nothing. Past the read's `limit` the
   * read stops, refused `too_large`.
   */
  readonly gitBrowseBytes: <R extends GitBrowseBytesRead>(
    read: R,
    appId: string,
    repo: string,
    params: GitBrowseParams<R>,
    signal?: AbortSignal,
  ) => Promise<Blob>;
  /** Reads database metadata without opening Git. */
  readonly changeMetadata: (
    link: ChangeLink,
    signal?: AbortSignal,
  ) => Promise<ChangeMetadataResponse>;
  /** Reads explicitly requested commit history without file patches. */
  readonly changeCommits: (
    link: ChangeLink,
    signal?: AbortSignal,
    snapshot?: ChangeDetailQuery,
  ) => Promise<ChangeCommitsResponse>;
  /**
   * Reads whether the change merges as HQ judges it now, at the displayed head and main: no file or
   * commit is read.
   */
  readonly changeVerdict: (
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
  readonly closeChange: (link: ChangeLink, expectedHead: string | null) => Promise<HqChange>;
  /**
   * Hands an open change whose Mate is gone to the application's Mate `mateProjectId`, as the
   * person; its branch stays, that Mate's from then on.
   */
  readonly handChange: (link: ChangeLink, mateProjectId: string) => Promise<HqChange>;
  /**
   * Asks the people who merge the change's application to merge it, as a person its limit on who
   * merges holds (`POST …/changes/:repo/:n/merge-ask`): HQ answers the change carrying its
   * `mergeAsk`, the first one kept where it was asked already.
   */
  readonly askMerge: (link: ChangeLink) => Promise<HqChange>;
  /**
   * Takes an ask to merge back (`DELETE …/changes/:repo/:n/merge-ask`), as whoever asked or
   * whoever merges: HQ answers the change without it, as it is where nothing was asked.
   */
  readonly takeBackMergeAsk: (link: ChangeLink) => Promise<HqChange>;
  /** A picture of a change, read as the person (`attachmentPath`). */
  readonly changeAttachment: (link: AttachmentLink, signal?: AbortSignal) => Promise<Blob>;
  /**
   * The Mate tier, as the person (`GET /api/apps/:appId/recipe/mate`): read on demand only where
   * HQ's stream does not carry it — a Core from before it did, or one that could not read it —
   * or while the stream is down.
   */
  readonly mateRecipe: (appId: string, signal?: AbortSignal) => Promise<RecipeTierResponse>;
  /** A release made in HQ as the person, of what its offer showed; HQ tags and deploys it. */
  readonly reviewRelease: (
    appId: string,
    request: CreateReleaseRequest,
    signal?: AbortSignal,
  ) => Promise<ReleaseServicePlan>;
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

/** Opens `url`, telling `on` once it is open, of every text message, and of the close, with its code. */
export type OpenHqSocket = (
  url: string,
  on: {
    readonly open: () => void;
    readonly message: (data: string) => void;
    readonly close: (code: number) => void;
  },
) => HqSocket;

/** HQ closed a scope socket because its session ended (`hqStreamCloseFailure`). */
const HQ_SESSION_ENDED_CLOSE = 4401;

/** How long a read waits for HQ's answer: the bound on every screen's *Reading…*. */
const CALL_TIMEOUT_MS = 20_000;
/** A read HQ left unanswered past {@link CALL_TIMEOUT_MS}. */
const HQ_TAKING_LONG = "HQ is taking long to answer.";
/**
 * How long the door and every write wait for HQ's answer. HQ reads the org from Zerops for each,
 * which took tens of seconds on a slow Zerops (measured 2026-10-03): a door given up at 20 s threw
 * HQ's answer away, and the next caller minted another throwaway for a door queued behind the
 * first; a release given up at 20 s told the person "HQ could not be reached." of a release under
 * way (F22).
 */
const WRITE_TIMEOUT_MS = 45_000;

/** A session is renewed once it is this close to its end. */
const RENEW_BEFORE_MS = 15 * 60_000;

interface DoorAnswer {
  readonly session: string;
  readonly expiresAt: string;
}

/**
 * A lost answer can mean the write landed. Keep an uncertain receipt rather than repeat it
 * without checking what HQ accepted.
 */
export const HQ_WRITE_UNCERTAIN =
  "HQ could not confirm whether this finished. Check the project before trying again.";

const uncertain = () =>
  new HqError({ kind: "uncertain", code: "uncertain", message: HQ_WRITE_UNCERTAIN });

/** HQ's refusal as its body says it, and the body as JSON; a body that is not HQ's names none. */
function said(text: string): { readonly refusal: HqRefusal | undefined; readonly body: unknown } {
  try {
    const body: unknown = JSON.parse(text);
    return { refusal: Option.getOrUndefined(decodeRefusal(body)), body };
  } catch {
    return { refusal: undefined, body: undefined };
  }
}

/** HQ's code for a write refused because Zerops did not answer its roles: nothing was written. */
const WROTE_NOTHING_ZEROPS = "zerops_unanswered";

const isRemoteRefusal = Schema.is(HqRemoteRefusal);
const decodeRefusal = Schema.decodeUnknownOption(HqRefusal);

/** What a call asked, where HQ's refusal of it has words of its own. */
interface CallAsk {
  /** A Git target's setup (`/api/git-targets/…`). */
  readonly gitSetup: boolean;
  /** A change's merge (`POST …/changes/:repo/:n/merge`). */
  readonly merge: boolean;
}

const askOf = (url: string, init: RequestInit): CallAsk => {
  const path = new URL(url).pathname;
  return {
    gitSetup: path.startsWith("/api/git-targets/"),
    merge: init.method === "POST" && /\/changes\/[^/]+\/[^/]+\/merge$/u.test(path),
  };
};

async function errorOf(response: Response, { gitSetup, merge }: CallAsk): Promise<HqError> {
  const { refusal, body } = said(await response.text());
  const problems = refusal?.problems;
  const code = refusal?.code ?? `http_${response.status}`;
  // ProbeRefused owns the host-specific remedy; other refusals keep the client's wording.
  const probeMessage =
    code === "git_probe_refused"
      ? refusal?.message !== undefined && refusal.message.trim().length > 0
        ? refusal.message
        : "Mate could not verify repository access; check the repository address and token settings, then try again."
      : undefined;
  if (response.status >= 500 || response.status === 429) {
    const box = refusal?.box;
    return new HqError({
      kind: "unavailable",
      code,
      box,
      problems,
      status: response.status,
      message:
        probeMessage ??
        (code === WROTE_NOTHING_ZEROPS
          ? ZEROPS_UNANSWERED
          : code === "zerops_unavailable" && refusal?.reason === "no_credential"
            ? ZEROPS_NO_CREDENTIAL
            : code === "repo_unavailable" && box !== undefined
              ? GIT_BOX_UNAVAILABLE
              : "HQ is not answering right now."),
    });
  }
  const reason = refusal?.reason;
  // GitHub refused what HQ asked it for the person (resuming an installation its account
  // suspended): its own words say why.
  const githubSaid =
    reason === "github_unavailable" &&
    refusal?.message !== undefined &&
    refusal.message.trim().length > 0
      ? `GitHub refused: ${refusal.message.trim()}`
      : undefined;
  // A merge HQ refused for a file above its limit: one sentence the person hands to their Mate.
  const tooLarge =
    merge && code === MERGE_TOO_LARGE
      ? mergeTooLargeWords(refusal?.limit, refusal?.size)
      : undefined;
  return new HqError({
    kind: "refused",
    code,
    reason,
    problems,
    status: response.status,
    message:
      probeMessage ??
      githubSaid ??
      tooLarge ??
      hqRefusalWords({
        code,
        reason,
        ...(refusal?.phase !== undefined ? { phase: refusal.phase } : {}),
        ...(refusal?.finishRole !== undefined ? { finishRole: refusal.finishRole } : {}),
        gitSetup,
        ...(isRemoteRefusal(body) ? { remote: body } : {}),
        ...(refusal?.zerops !== undefined ? { zerops: refusal.zerops } : {}),
      }),
  });
}

/**
 * HQ's answer as the call's outcome. A write HQ failed on its way (`5xx`) may have landed — but
 * a `503` writes nothing (mate-hq spec/protocol.md), so HQ is simply not answering right now.
 */
async function answered(response: Response, write: boolean, ask: CallAsk): Promise<Response> {
  if (response.ok) return response;
  const error = await errorOf(response, ask);
  if (write && response.status >= 500 && response.status !== 503) {
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
  } catch (cause) {
    if (write) throw uncertain();
    // A read past its deadline is HQ taking long, not HQ gone: a screen still reading says so
    // with its Try again, while the data layer's retry keeps asking.
    const late = cause instanceof DOMException && cause.name === "TimeoutError";
    throw new HqError({
      kind: "unavailable",
      code: "network",
      message: late ? HQ_TAKING_LONG : "HQ could not be reached.",
    });
  }
  return answered(response, write, askOf(url, init));
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/**
 * An answer read through the contract's schema (`@t3tools/shared/hqChanges`): one this version of
 * Mate cannot read is refused, never drawn in part.
 */
const decoded =
  <S extends Schema.Decoder<unknown>>(schema: S, what: string) =>
  async (response: Response): Promise<S["Type"]> =>
    Option.getOrThrowWith(
      Schema.decodeUnknownOption(schema)(await bodyOf(response, what)),
      unreadable(what),
    );

const bodyOf = async (response: Response, what: string): Promise<unknown> => {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw unreadable(what)();
  }
};

/**
 * {@link decoded} for a write that asked for deploys: what it made, and the deploys beside it —
 * none where this version of Mate cannot read them, for HQ's stream brings their jobs.
 */
const readDeploysBeside = Schema.decodeUnknownOption(WithDeploys);

const decodedAsked =
  <S extends Schema.Decoder<unknown>>(schema: S, what: string) =>
  async (response: Response): Promise<Asked<S["Type"]>> => {
    const body = await bodyOf(response, what);
    return {
      made: Option.getOrThrowWith(Schema.decodeUnknownOption(schema)(body), unreadable(what)),
      deploys: Option.getOrUndefined(readDeploysBeside(body))?.deploys,
    };
  };

/** What the organization's structure is called where HQ's answer to it does not decode. */
const STRUCTURE = "the organization's projects";

/** An answer HQ gave about `what` in a shape this Mate does not decode: a version mismatch. */
const unreadable = (what: string) => () =>
  new HqError({ kind: "refused", code: "unreadable", message: hqDisagreesOn(what) });

const readChangeMetadata = decoded(ChangeMetadataResponse, "a change's record");
const HqSupportExchange = Schema.Struct({ exchange: Schema.String });
const readSupportExchange = decoded(HqSupportExchange, "a support exchange");
const readChangeCommits = decoded(ChangeCommitsResponse, "a change's commits");
const readChangeVerdict = decoded(ChangeDetailResponse, "a change's review");
const readIntakeView = decoded(HqIntakeView, "GitHub issues as tasks");
const readAiKeys = decoded(Schema.Array(HqAiKeyView), "the organization's AI keys");
const readActivity = decoded(HqActivityPage, "the organization's activity");
const readAiKey = decoded(HqAiKeyView, "an AI key");
const readTakeOverList = decoded(HqTakeOverList, "a member's tokens to take over");
const readTakeOverReplaced = decoded(HqTakeOverReplaced, "a token's take-over");
const readChatLink = decoded(HqChatLink, "a chat account link");
const readSlack = decoded(HqSlackView, "the Slack app");
const readSlackChannels = decoded(HqSlackChannels, "the Slack app's channels");
const readDiscord = decoded(HqDiscordView, "the Discord application");
const readChannel = decoded(HqChannelView, "a project's channel");
const readAppChannel = decoded(Schema.NullOr(HqChannelView), "a project's channel");
const readWebhook = decoded(HqWebhookView, "a webhook");
/** HQ answers an application's lists wrapped: `{ webhooks }`, `{ schedules }`. */
const readWebhooks = decoded(
  Schema.Struct({ webhooks: Schema.Array(HqWebhookView) }),
  "a project's webhooks",
);
const readSchedule = decoded(HqScheduleView, "a schedule");
const readSchedules = decoded(
  Schema.Struct({ schedules: Schema.Array(HqScheduleView) }),
  "a project's schedules",
);
const readAppTasks = decoded(HqAppTasksView, "a project's tasks");
const readTaskLimits = decoded(HqTaskLimitsView, "the limits per task");
const readCreatedBirth = decoded(
  Schema.Struct({ ...HqRecordedBirth.fields, appId: Schema.String }),
  "a new project’s birth",
);
const readStartedAccessChanges = decoded(HqStartedAccessChanges, "a start of access changes");
const readGithub = decoded(HqGithubView, "the organization's GitHub apps");
const readGithubManifest = decoded(HqGithubManifestView, "a GitHub app's manifest");
const readGithubInstall = decoded(HqGithubInstallView, "a GitHub app's install link");
const readCreatedRemote = decoded(
  HqRepoRemoteCreateViaAppView,
  "a repository HQ created on GitHub",
);
const readComment = decoded(HqChangeComment, "a change's comment");
const readChange = decoded(HqChange, "a change");
const readMerged = decodedAsked(HqChange, "a merged change");

const readGitCredential = decoded(GitCredential, "a Git password");
const readGitCredentialList = decoded(GitCredentialList, "Git passwords");
const readRecipeTier = decoded(RecipeTierResponse, "a recipe's tier");
const readReleases = decoded(ReleaseListResponse, "an application's releases");
const readRelease = decodedAsked(Release, "a release");
const readDeploys = decoded(WithDeploys, "deploys");

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
 * How HQ's parts stand while it serves, as its health reports them (`mate-hq spec/protocol.md` § Health):
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

/** What a backup set needed beside what the backup bucket holds. */
export interface HqBackupUsage {
  readonly usedBytes: number;
  readonly neededBytes: number;
  readonly quotaBytes: number;
}

/**
 * HQ's backup by its newest set: `off` with no bucket,
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
 * HQ's key for deploy tokens (`mate-hq spec/protocol.md` § Health, `keys`): none, one that is no key,
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

/** A browse read's address; what HQ refuses as invalid is refused here, as HQ words it, unsent. */
const browsePathOrRefuse = <R extends GitBrowseRead>(
  read: R,
  appId: string,
  repo: string,
  params: GitBrowseParams<R>,
) => {
  const path = gitBrowsePath(read, appId, repo, params);
  if (path === null)
    throw new HqError({
      kind: "refused",
      code: "invalid",
      status: 400,
      message: hqRefusalWords({ code: "invalid", reason: undefined }),
    });
  return path;
};

const DOOR_BUILD_KEY = "clientBuild";

function doorBuildOf(raw: string | undefined): string | undefined {
  const build = raw?.trim();
  return build !== undefined && /^[A-Za-z0-9._+-]{1,64}$/u.test(build) ? build : undefined;
}

export function makeHqApi(input: {
  /** HQ's origin, as its anchor or the build's configuration names it. */
  readonly address: string;
  readonly fetch: FetchImplementation;
  /**
   * The person's Zerops access token and its expiry. `refused`, the token HQ answered `401
   * zerops_person_required` to, asks Zerops for a new one first unless a renewal has already
   * replaced it, which a sign-in does once; HQ reads the token once at sign-in and at each renewal
   * and keeps nothing of it. `operationAtMs`, an operation's press, asks for a token that outlives
   * the session's next renewal: the operation runs on it after the request ends.
   */
  readonly accessToken: (ask?: ZeropsAccessAsk) => Promise<ZeropsAccess>;
  /** The organisation this client signs in to. */
  readonly orgId: string;
  /** The build this client names itself by to HQ's door; none: the door is told none. */
  readonly [DOOR_BUILD_KEY]?: string;
  /** The instant, for a session's renewal and an operation's press; the wall clock where absent. */
  readonly now?: () => number;
  readonly openSocket: OpenHqSocket;
  /**
   * A stream the page opened for this organization's HQ before this client existed (a reload's
   * boot entry): the first `openScopeSocket` takes it in place of a ticket and a socket, if it
   * was opened with the session this client holds.
   */
  readonly openedAhead?: {
    readonly take: (session: string, on: Parameters<OpenHqSocket>[1]) => Promise<HqSocket | null>;
    /** Closes it untaken; nothing once it was asked for. */
    readonly release: () => void;
  };
  /** Captured account and HQ; checked immediately before each protected fetch. */
  readonly isCurrent?: () => boolean;
  /** HQ's session as the account keeps it for this organization and HQ across loads. */
  readonly kept?: {
    /** The kept session; null when none is kept, or it ends too soon to present. */
    readonly read: () => { readonly token: string; readonly expiresAtMs: number } | null;
    readonly keep: (session: { readonly token: string; readonly expiresAt: string }) => void;
    readonly forget: (token: string) => void;
  };
}): HqApi {
  const origin = input.address.replace(/\/+$/u, "");
  const build = doorBuildOf(input[DOOR_BUILD_KEY]);
  /** The stream opened ahead, until the first open has asked for it. */
  let openedAhead = input.openedAhead;
  /** The session HQ issued, or the door exchange under way that will issue it. */
  let session: Promise<string> | null = null;

  /** When the session in hand ends; null where it is not known. */
  let expiresAtMs: number | null = null;
  const now = input.now ?? Date.now;

  /** The session the account kept, presented before any sign-in; null when it keeps none. */
  const restore = (): Promise<string> | null => {
    const kept = input.kept?.read() ?? null;
    if (kept === null) return null;
    expiresAtMs = kept.expiresAtMs;
    session = Promise.resolve(kept.token);
    return session;
  };

  /** HQ no longer takes this session: it is dropped here, and forgotten where it was kept. */
  const drop = (held: Promise<string> | null, token: string) => {
    if (session === held) {
      session = null;
      expiresAtMs = null;
    }
    input.kept?.forget(token);
  };

  /** The sessions sign-in opened that HQ has not yet taken on any call: none renews. */
  const unproven = new WeakSet<Promise<string>>();

  /**
   * `POST /api/door` with the person's access token; with a session as its bearer it renews that
   * session, which keeps its id.
   */
  const enterDoor = async (renewing?: string): Promise<DoorAnswer> => {
    const attempt = async (access: ZeropsAccess) =>
      json<DoorAnswer>(
        await send(input.fetch, `${origin}/api/door`, {
          method: "POST",
          ...(renewing === undefined ? {} : { headers: { Authorization: `Bearer ${renewing}` } }),
          body: JSON.stringify({
            accessToken: access.token,
            expiresAt: access.expiresAt,
            orgId: input.orgId,
            ...(build === undefined ? {} : { [DOOR_BUILD_KEY]: build }),
          }),
          signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
        }),
      );
    const access = await input.accessToken();
    try {
      return await attempt(access);
    } catch (cause) {
      if (!(cause instanceof HqError && cause.code === "zerops_person_required")) throw cause;
      return attempt(await input.accessToken({ refused: access.token }));
    }
  };

  const remember = (answer: DoorAnswer) => {
    const ends = Date.parse(answer.expiresAt);
    expiresAtMs = Number.isFinite(ends) ? ends : null;
    input.kept?.keep({ token: answer.session, expiresAt: answer.expiresAt });
  };

  const enter = () => {
    const entering = enterDoor().then((answer) => {
      remember(answer);
      return answer.session;
    });
    // A sign-in that refused is not a session: the next call asks again.
    entering.catch(() => {
      if (session === entering) session = null;
    });
    unproven.add(entering);
    session = entering;
    return entering;
  };

  /** The renewal under way, shared by the calls that meet it. */
  let renewal: Promise<void> | null = null;

  /**
   * Renews the session silently: the same request with a current access token and the session as
   * its bearer, which keeps the session's id. A renewal that fails leaves the session as it was;
   * its own end is met by the call that finds it ended.
   */
  const renew = async (token: string): Promise<void> => {
    renewal ??= enterDoor(token)
      .then(remember, () => undefined)
      .finally(() => {
        renewal = null;
      });
    await renewal;
  };

  /** Renews a session close to its end. */
  const renewIfDue = async (token: string): Promise<void> => {
    if (expiresAtMs === null || now() < expiresAtMs - RENEW_BEFORE_MS) return;
    await renew(token);
  };

  /**
   * A call as the session's holder. A session HQ no longer takes is forgotten and renewed once —
   * another tab's kept one, else through the door — and the call made again; HQ refusing the
   * renewal too, or a session from its door it never took, ends the call with that refusal. A call
   * HQ refused for its session wrote nothing, so a write is made again as safely as a read. A
   * best-effort report uses only an existing session and never renews or replays the call.
   */
  const authorized = async (
    path: string,
    init: RequestInit = {},
    write = false,
    browse = false,
    sessionPolicy: "normal" | "no-retry" | "existing-once" = "normal",
  ): Promise<Response> => {
    let renewed = false;
    for (;;) {
      const held = session ?? restore() ?? (sessionPolicy === "existing-once" ? null : enter());
      if (held === null)
        throw new HqError({ kind: "refused", code: "no_session", message: "HQ has no session." });
      const token = await held;
      if (sessionPolicy !== "existing-once" && !unproven.has(held)) await renewIfDue(token);
      try {
        // The HQ session alone: Git browsing names it in its own header.
        const headers: Record<string, string> = browse
          ? { "X-HQ-Session": token }
          : { Authorization: `Bearer ${token}` };
        if ((write || browse) && input.isCurrent?.() === false)
          throw new HqError({
            kind: "refused",
            code: "account_changed",
            message: "This Zerops sign-in or its HQ has changed.",
          });
        const response = await send(
          input.fetch,
          `${origin}${path}`,
          { ...init, headers: { ...init.headers, ...headers } },
          write,
        );
        unproven.delete(held);
        return response;
      } catch (cause) {
        if (sessionPolicy === "existing-once") throw cause;
        if (!(cause instanceof HqError && accessEnded(cause) === "session-ended")) throw cause;
        drop(held, token);
        if (sessionPolicy === "no-retry" || renewed || unproven.has(held)) throw cause;
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

  /**
   * Create, Continue, an access change's start and a deletion, removal, move or rename start need a token that
   * outlives the session's next renewal, and its expiry: the operation runs on it after the request
   * ends. Hand-over and take-over finish within the request and carry just the current token.
   */
  const withAccess = async <T extends object>(body: T, needsExpiry = false) => {
    const access = await input.accessToken(needsExpiry ? { operationAtMs: now() } : undefined);
    return {
      ...body,
      accessToken: access.token,
      ...(needsExpiry ? { expiresAt: access.expiresAt } : {}),
    };
  };

  /**
   * Starts an operation HQ runs on the person's token: HQ's refusal that one already runs on its
   * target (`operation_in_flight`), that it took no Zerops person from the token, or that what was
   * reviewed differs from what it holds (`held_changed`), each said in the person's words, HQ's
   * codes kept.
   */
  const startOperation = async (
    path: string,
    start: object,
    words: {
      readonly signIn: string;
      readonly inFlight: string;
      readonly heldChanged?: string;
      /** The words of a refusal only this start meets, by HQ's reason. */
      readonly refused?: Readonly<Record<string, string>>;
    },
    /** A start HQ runs without a Zerops call carries no token (an approved message). */
    carriesAccess = true,
  ) => {
    try {
      await authorized(
        path,
        {
          method: "POST",
          body: JSON.stringify(carriesAccess ? await withAccess(start, true) : start),
        },
        true,
      );
    } catch (cause) {
      if (!(cause instanceof HqError)) throw cause;
      const said =
        cause.reason === "operation_in_flight"
          ? words.inFlight
          : cause.reason === "held_changed"
            ? words.heldChanged
            : cause.code === "zerops_person_required"
              ? words.signIn
              : cause.reason === undefined
                ? undefined
                : words.refused?.[cause.reason];
      if (said === undefined) throw cause;
      throw new HqError({
        kind: cause.kind,
        code: cause.code,
        reason: cause.reason,
        status: cause.status,
        message: said,
      });
    }
  };

  const structureOf = async (signal?: AbortSignal) =>
    Option.getOrThrowWith(
      Option.fromUndefinedOr(
        hqStructureOf(
          await bodyOf(
            await authorized("/api/structure", signal === undefined ? {} : { signal }),
            STRUCTURE,
          ),
        ),
      ),
      unreadable(STRUCTURE),
    );
  // Only a lost release/rollback write answer needs this direct confirmation, never a load.
  const releasesOf = async (appId: string) =>
    (await readReleases(await authorized(releasesPath(appId)))).releases;
  /** The change as HQ holds it, if it is in `state`; its record, never its diff. */
  const changeIn = async (link: ChangeLink, state: HqChange["state"]) => {
    const { change } = await readChangeMetadata(await authorized(`${changePath(link)}/metadata`));
    return change.state === state ? change : undefined;
  };

  return {
    ...makeChiefCalls({ authorized, decoded }),
    structure: structureOf,
    mateTicket: async (projectId, signal, options) =>
      json<HqMateTicket>(
        await authorized(`/api/mates/${encodeURIComponent(projectId)}/ticket`, {
          method: "POST",
          ...(signal === undefined ? {} : { signal }),
          ...(options?.extend === true ? { body: JSON.stringify({ extend: true }) } : {}),
        }),
      ),
    openScopeSocket: async (on, signal) => {
      /** A socket's events, for the session its ticket was minted for. */
      const heard = (held: Promise<string> | null, token: string | null) => ({
        open: on.open,
        message: on.message,
        close: (code: number) => {
          if (code === HQ_SESSION_ENDED_CLOSE && held !== null && token !== null) drop(held, token);
          on.close(code);
        },
      });
      const ahead = openedAhead;
      openedAhead = undefined;
      if (ahead !== undefined) {
        let taken: HqSocket | null = null;
        try {
          const kept = session ?? restore();
          const token = kept === null ? null : await kept;
          // Opened with this very session before the client existed: its ticket is spent and its
          // socket open or opening. Another session, or one that came to nothing, and this open asks.
          if (kept !== null && token !== null) taken = await ahead.take(token, heard(kept, token));
        } finally {
          // Nobody else asks for it: with no session kept, the account changed or the door
          // failing, it is closed now, not left signed in and unowned until it gives up.
          if (taken === null) ahead.release();
        }
        if (taken !== null && signal.aborted) taken.close();
        signal.throwIfAborted();
        if (taken !== null) return taken;
      }
      const { ticket } = await json<{ readonly ticket: string }>(
        await authorized("/api/stream-ticket", { method: "POST", signal }),
      );
      /** The session the ticket was minted for. */
      const held = session;
      const token = held === null ? null : await held;
      signal.throwIfAborted();
      const url = `${origin.replace(/^http/u, "ws")}/api/structure/ws?ticket=${encodeURIComponent(ticket)}`;
      return input.openSocket(url, heard(held, token));
    },
    createBirth: async (birth) =>
      readCreatedBirth(
        await authorized(
          "/api/births",
          { method: "POST", body: JSON.stringify(await withAccess(birth, true)) },
          true,
        ),
      ),
    continueOperation: async (id) => {
      const signIn = "Sign in with your Zerops account to continue.";
      try {
        await authorized(
          `/api/operations/${encodeURIComponent(id)}/continue`,
          { method: "POST", body: JSON.stringify(await withAccess({}, true)) },
          true,
        );
      } catch (cause) {
        // HQ took no Zerops person from the token it was given: the person signs in again.
        if (!(cause instanceof HqError && cause.code === "zerops_person_required")) throw cause;
        throw new HqError({
          kind: cause.kind,
          code: cause.code,
          reason: cause.reason,
          status: cause.status,
          message: signIn,
        });
      }
    },
    endOperation: async (id) => {
      await authorized(
        `/api/operations/${encodeURIComponent(id)}/end`,
        { method: "POST", body: JSON.stringify({}) },
        true,
      );
    },
    startMateDeletion: (projectId, start) =>
      startOperation(`/api/projects/${encodeURIComponent(projectId)}/deletion`, start, {
        signIn: "Sign in with your Zerops account to delete this Mate.",
        inFlight: "This Mate is already being deleted.",
      }),
    approveProposal: (proposalId, approval) =>
      startOperation(
        `/api/proposals/${encodeURIComponent(proposalId)}/approval`,
        approval,
        {
          signIn: "Sign in with your Zerops account to approve this.",
          inFlight: "Another change on this project is running. Approve this once it ends.",
          refused: {
            service_not_planned: "Production changed since this was read, so nothing was created.",
          },
        },
        approval.effect.kind !== "mate.message" && approval.effect.kind !== "chief.message",
      ),
    startMateRestart: (projectId, start) =>
      startOperation(`/api/projects/${encodeURIComponent(projectId)}/restart`, start, {
        signIn: "Sign in with your Zerops account to restart this Mate.",
        inFlight: "HQ is still finishing its last change to this Mate. Restart it once that ends.",
      }),
    startProductionRemoval: (appId, projectId, start) =>
      startOperation(
        `/api/apps/${encodeURIComponent(appId)}/productions/${encodeURIComponent(projectId)}/removal`,
        start,
        {
          signIn: "Sign in with your Zerops account to remove this production.",
          inFlight: "This production is already being removed.",
        },
      ),
    startAppDeletion: (appId, start) =>
      startOperation(`/api/apps/${encodeURIComponent(appId)}/deletion`, start, {
        signIn: "Sign in with your Zerops account to delete this project.",
        inFlight: "This project is already being deleted.",
        heldChanged:
          "Its Stages changed since you reviewed them. Review what goes now, then press Delete.",
      }),
    startEnvironment: (appId, start) =>
      startOperation(`/api/apps/${encodeURIComponent(appId)}/environments`, start, {
        signIn: "Sign in with your Zerops account to set this up.",
        inFlight: ENVIRONMENT_IN_FLIGHT,
      }),
    startDeployKey: (appId, name, start) =>
      startOperation(
        `/api/apps/${encodeURIComponent(appId)}/environments/${encodeURIComponent(name)}/deploy-key`,
        start,
        {
          signIn: "Sign in with your Zerops account to set up its deploy key.",
          inFlight: ENVIRONMENT_IN_FLIGHT,
        },
      ),
    startPutLive: (appId, start) =>
      startOperation(`/api/apps/${encodeURIComponent(appId)}/put-live`, start, {
        signIn: "Sign in with your Zerops account to put it live.",
        inFlight: ENVIRONMENT_IN_FLIGHT,
        refused: { production_exists: "This project has a production already." },
      }),
    startProjectMove: (projectId, start) =>
      startOperation(`/api/projects/${encodeURIComponent(projectId)}/move`, start, {
        signIn: "Sign in with your Zerops account to move this.",
        inFlight: "HQ is still finishing its last change here. Move it once that ends.",
        heldChanged:
          "It was moved elsewhere since you opened this. Close this and open Move again to see where it is now.",
        refused: {
          production_effect_approval_required:
            "A project becomes a production only through an approved release, never by a move.",
        },
      }),
    startAppRename: (appId, start) =>
      startOperation(`/api/apps/${encodeURIComponent(appId)}/rename`, start, {
        signIn: "Sign in with your Zerops account to rename this project.",
        inFlight:
          "HQ is still finishing its last change to this project. Rename it once that ends.",
      }),
    startAccessChanges: async (changes) =>
      readStartedAccessChanges(
        await authorized(
          "/api/access-changes",
          { method: "POST", body: JSON.stringify(await withAccess({ changes }, true)) },
          true,
        ),
      ),
    deleteAccessChange: async (id) => {
      await authorized(`/api/access-changes/${encodeURIComponent(id)}`, { method: "DELETE" }, true);
    },
    deleteBirth: async (birthId) => {
      await authorized(
        `/api/births/${encodeURIComponent(birthId)}`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    handOver: async (projectId, ownerUserId) => {
      await authorized(
        `/api/mates/${encodeURIComponent(projectId)}/hand-over`,
        { method: "POST", body: JSON.stringify(await withAccess({ ownerUserId })) },
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
    autoUpdatePolicy: async (signal) =>
      decoded(
        HqAutoUpdatePolicy,
        "automatic Mate updates",
      )(await authorized("/api/auto-update", signal === undefined ? {} : { signal })),
    savePersonaTemplate: async (id, template) => {
      try {
        return await decoded(
          PersonaTemplate,
          "a persona template",
        )(
          await authorized(
            `/api/persona-templates/${encodeURIComponent(id)}`,
            { method: "PUT", body: JSON.stringify(template) },
            true,
          ),
        );
      } catch (cause) {
        // An answer this version cannot read still followed a write HQ made.
        if (cause instanceof HqError && cause.code === "unreadable") throw uncertain();
        throw cause;
      }
    },
    deletePersonaTemplate: async (id, revision) => {
      await authorized(
        `/api/persona-templates/${encodeURIComponent(id)}?revision=${revision}`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    setAutoUpdatePolicy: async (enabled) => {
      // Neither a matching boolean nor a later revision identifies a lost PUT as ours.
      try {
        return await decoded(
          HqAutoUpdatePolicy,
          "automatic Mate updates",
        )(
          await authorized(
            "/api/auto-update",
            { method: "PUT", body: JSON.stringify({ enabled }) },
            true,
          ),
        );
      } catch (cause) {
        if (cause instanceof HqError && cause.code === "unreadable") throw uncertain();
        throw cause;
      }
    },
    gitTargetWrite: async (requestId, intent, candidate) =>
      decoded(
        HqGitOperationReceipt,
        "a Git operation",
      )(
        await authorized(
          `/api/git-targets/${encodeURIComponent(requestId)}`,
          {
            method: "POST",
            body: JSON.stringify({ intent, ...(candidate === undefined ? {} : { candidate }) }),
          },
          true,
        ),
      ),
    gitTargetReceipt: async (requestId, intent) =>
      (
        await decoded(
          Schema.Struct({ receipt: Schema.NullOr(HqGitOperationReceipt) }),
          "a Git operation",
        )(
          await authorized(`/api/git-targets/${encodeURIComponent(requestId)}/receipt`, {
            method: "POST",
            body: JSON.stringify({ intent }),
          }),
        )
      ).receipt,
    updateMate: async (projectId, change) => {
      await authorized(
        `/api/mates/${encodeURIComponent(projectId)}`,
        { method: "PATCH", body: JSON.stringify(change) },
        true,
      );
    },
    // A session refusal is the page's answer; never ask for a second exchange.
    supportExchange: async () =>
      readSupportExchange(
        await authorized(
          "/api/operator-support/exchanges",
          { method: "POST" },
          true,
          false,
          "no-retry",
        ),
      ),
    webFailure: async (report) => {
      await authorized(
        "/api/web-failure",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: report.projectId,
            kind: report.kind,
            ...(build === undefined ? {} : { build }),
          }),
        },
        true,
        false,
        "existing-once",
      );
    },
    answerKeptGit: async (appId, answer) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/kept-git`,
        { method: "POST", body: JSON.stringify({ answer }) },
        true,
      );
    },
    changeMetadata: async (link, signal) =>
      readChangeMetadata(
        await authorized(`${changePath(link)}/metadata`, signal === undefined ? {} : { signal }),
      ),
    changeCommits: async (link, signal, snapshot = {}) => {
      const search = new URLSearchParams(snapshot).toString();
      return readChangeCommits(
        await authorized(
          `${changePath(link)}/commits${search === "" ? "" : `?${search}`}`,
          signal === undefined ? {} : { signal },
        ),
      );
    },
    changeVerdict: async (link, signal, snapshot = {}) => {
      const search = new URLSearchParams(snapshot).toString();
      return readChangeVerdict(
        await authorized(
          `${changePath(link)}${search === "" ? "" : `?${search}`}`,
          signal === undefined ? {} : { signal },
        ),
      );
    },
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
    closeChange: (link, expectedHead) =>
      confirmed(
        async () =>
          readChange(
            await authorized(
              `${changePath(link)}/close`,
              { method: "POST", body: JSON.stringify({ expectedHead }) },
              true,
            ),
          ),
        () => changeIn(link, "closed"),
        ["change_not_open"],
      ),
    askMerge: (link) =>
      confirmed(
        async () =>
          readChange(
            await authorized(
              `${changePath(link)}/merge-ask`,
              { method: "POST", body: JSON.stringify({}) },
              true,
            ),
          ),
        async () => {
          const held = await changeIn(link, "open");
          return held?.mergeAsk === undefined ? undefined : held;
        },
      ),
    takeBackMergeAsk: (link) =>
      confirmed(
        async () =>
          readChange(
            await authorized(
              `${changePath(link)}/merge-ask`,
              { method: "DELETE", body: JSON.stringify({}) },
              true,
            ),
          ),
        async () => {
          const held = await changeIn(link, "open");
          return held?.mergeAsk === undefined ? held : undefined;
        },
      ),
    handChange: (link, mateProjectId) =>
      confirmed(
        async () =>
          readChange(
            await authorized(
              `${changePath(link)}/hand`,
              { method: "POST", body: JSON.stringify({ mateProjectId }) },
              true,
            ),
          ),
        async () => {
          const held = await changeIn(link, "open");
          return held?.mateProjectId === mateProjectId ? held : undefined;
        },
      ),
    changeAttachment: async (link, signal) =>
      (
        await authorized(attachmentPath(link.appId, link.repo, link.number, link.id), {
          headers: { Accept: RASTER_CONTENT_TYPES.join(", ") },
          ...(signal === undefined ? {} : { signal }),
        })
      ).blob(),
    setIntake: async (appId, request) =>
      readIntakeView(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/intake`,
          { method: "PUT", body: JSON.stringify(request) },
          true,
        ),
      ),
    stopIntake: async (appId) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/intake`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    aiKeys: async () => readAiKeys(await authorized("/api/org/ai-keys")),
    activity: async (before) =>
      readActivity(
        await authorized(
          before === null ? "/api/activity" : `/api/activity?before=${encodeURIComponent(before)}`,
        ),
      ),
    setAiKey: async (provider, value) =>
      readAiKey(
        await authorized(
          `/api/org/ai-keys/${encodeURIComponent(provider)}`,
          {
            method: "PUT",
            body: JSON.stringify({ value } satisfies HqAiKeyRequest),
          },
          true,
        ),
      ),
    removeAiKey: async (provider) => {
      await authorized(
        `/api/org/ai-keys/${encodeURIComponent(provider)}`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    takeOverList: async (userId, list) =>
      readTakeOverList(
        await authorized(`/api/members/${encodeURIComponent(userId)}/take-over`, {
          method: "POST",
          body: JSON.stringify({ list }),
        }),
      ),
    takeOver: async (userId, tokenId, ownerUserId) =>
      readTakeOverReplaced(
        await authorized(
          `/api/members/${encodeURIComponent(userId)}/take-over/${encodeURIComponent(tokenId)}`,
          {
            method: "POST",
            body: JSON.stringify(
              await withAccess(ownerUserId === undefined ? {} : { ownerUserId }),
            ),
          },
          true,
        ),
      ),
    takeChatLink: async (code) => {
      try {
        return readChatLink(
          await authorized(
            "/api/chat-links",
            { method: "POST", body: JSON.stringify({ code }) },
            true,
          ),
        );
      } catch (cause) {
        // An answer this version cannot read still followed a link HQ made.
        if (cause instanceof HqError && cause.code === "unreadable") throw uncertain();
        throw cause;
      }
    },
    slack: async () => readSlack(await authorized("/api/org/slack")),
    slackManifest: async () =>
      bodyOf(await authorized("/api/org/slack/manifest"), "the Slack app's manifest"),
    connectSlack: async (request) =>
      readSlack(
        await authorized(
          "/api/org/slack",
          {
            method: "PUT",
            body: JSON.stringify(request satisfies HqSlackConnectRequest),
          },
          true,
        ),
      ),
    disconnectSlack: async () => {
      await authorized("/api/org/slack", { method: "DELETE", body: JSON.stringify({}) }, true);
    },
    slackChannels: async () => readSlackChannels(await authorized("/api/org/slack/channels")),
    discord: async () => readDiscord(await authorized("/api/org/discord")),
    connectDiscord: async (request) =>
      readDiscord(
        await authorized(
          "/api/org/discord",
          {
            method: "PUT",
            body: JSON.stringify(request satisfies HqDiscordConnectRequest),
          },
          true,
        ),
      ),
    disconnectDiscord: async () => {
      await authorized("/api/org/discord", { method: "DELETE", body: JSON.stringify({}) }, true);
    },
    appChannel: async (appId, source) =>
      readAppChannel(await authorized(`/api/apps/${encodeURIComponent(appId)}/${source}`)),
    setAppChannel: async (appId, source, request) =>
      readChannel(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/${source}`,
          {
            method: "PUT",
            body: JSON.stringify(request satisfies HqChannelRequest),
          },
          true,
        ),
      ),
    stopAppChannel: async (appId, source) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/${source}`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    webhooks: async (appId) =>
      (await readWebhooks(await authorized(`/api/apps/${encodeURIComponent(appId)}/webhooks`)))
        .webhooks,
    makeWebhook: async (appId, request) =>
      readWebhook(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/webhooks`,
          {
            method: "POST",
            body: JSON.stringify(request satisfies HqWebhookRequest),
          },
          true,
        ),
      ),
    deleteWebhook: async (appId, webhookId) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/webhooks/${encodeURIComponent(webhookId)}`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    schedules: async (appId) =>
      (await readSchedules(await authorized(`/api/apps/${encodeURIComponent(appId)}/schedules`)))
        .schedules,
    makeSchedule: async (appId, request) =>
      readSchedule(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/schedules`,
          {
            method: "POST",
            body: JSON.stringify(request satisfies HqScheduleRequest),
          },
          true,
        ),
      ),
    deleteSchedule: async (appId, scheduleId) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/schedules/${encodeURIComponent(scheduleId)}`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    appTasks: async (appId) =>
      (await readAppTasks(await authorized(`/api/apps/${encodeURIComponent(appId)}/tasks`))).tasks,
    stopAppTask: async (appId, taskId) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/tasks/${encodeURIComponent(taskId)}/stop`,
        { method: "POST", body: JSON.stringify({}) },
        true,
      );
    },
    taskLimits: async () => readTaskLimits(await authorized("/api/org/task-limits")),
    setTaskLimits: async (limits) =>
      readTaskLimits(
        await authorized(
          "/api/org/task-limits",
          {
            method: "PUT",
            body: JSON.stringify(limits satisfies HqTaskLimitsRequest),
          },
          true,
        ),
      ),
    github: async () => readGithub(await authorized("/api/org/github")),
    githubManifest: async (request) =>
      readGithubManifest(
        await authorized(
          "/api/org/github/manifest",
          {
            method: "POST",
            body: JSON.stringify(request satisfies HqGithubManifestRequest),
          },
          true,
        ),
      ),
    githubForget: async (githubAppId) => {
      await authorized(
        `/api/org/github/apps/${String(githubAppId)}`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    githubInstall: async (githubAppId, request) =>
      readGithubInstall(
        await authorized(
          `/api/org/github/apps/${String(githubAppId)}/install`,
          {
            method: "POST",
            body: JSON.stringify(request satisfies HqGithubInstallRequest),
          },
          true,
        ),
      ),
    githubAcceptInstallation: async (installationId) => {
      await authorized(
        `/api/org/github/installations/${String(installationId)}/accept`,
        { method: "POST", body: JSON.stringify({}) },
        true,
      );
    },
    githubSuspendInstallation: async (installationId) => {
      await authorized(
        `/api/org/github/installations/${String(installationId)}/suspend`,
        { method: "POST", body: JSON.stringify({}) },
        true,
      );
    },
    githubResumeInstallation: async (installationId) => {
      await authorized(
        `/api/org/github/installations/${String(installationId)}/resume`,
        { method: "POST", body: JSON.stringify({}) },
        true,
      );
    },
    repoRemoteViaApp: async (appId, repo, request) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/remote/app`,
        {
          method: "PUT",
          body: JSON.stringify(request satisfies HqRepoRemoteViaAppRequest),
        },
        true,
      );
    },
    repoRemoteCreateViaApp: async (appId, repo, request) =>
      readCreatedRemote(
        await authorized(
          `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/remote/app/new`,
          {
            method: "POST",
            body: JSON.stringify(request satisfies HqRepoRemoteCreateViaAppRequest),
          },
          true,
        ),
      ),
    followRepoUpstream: async (appId, repo, request) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/upstream`,
        {
          method: "PUT",
          body: JSON.stringify(request satisfies FollowRepoUpstreamRequest),
        },
        true,
      );
    },
    unfollowRepoUpstream: async (appId, repo) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/upstream`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    deleteRepo: async (appId, repo) => {
      await authorized(
        `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}`,
        { method: "DELETE", body: JSON.stringify({}) },
        true,
      );
    },
    setRepoCap: async (appId, repo, capGiB) => {
      const response = await authorized(
        `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/storage`,
        {
          method: "PUT",
          body: JSON.stringify({ capGiB } satisfies HqRepoCapRequest),
        },
        true,
      );
      // HQ took it: an answer this build cannot read leaves where the cap stands unknown.
      try {
        return await decoded(HqRepoStorage, "a repository's storage")(response);
      } catch {
        throw uncertain();
      }
    },
    setMergers: async (appId, people) => {
      const response = await authorized(
        `/api/apps/${encodeURIComponent(appId)}/mergers`,
        {
          method: "PUT",
          body: JSON.stringify({ people } satisfies HqMergersRequest),
        },
        true,
      );
      // HQ took it: an answer this build cannot read leaves who merges unknown.
      try {
        return (await decoded(HqMergersAnswer, "who can merge")(response)).mergers;
      } catch {
        throw uncertain();
      }
    },
    setOutsideProduction: async (appId, outside) => {
      const request: HqOutsideProductionRequest =
        outside === null ? { outside: false } : { outside: true, address: outside.address };
      const response = await authorized(
        `/api/apps/${encodeURIComponent(appId)}/outside-production`,
        { method: "PUT", body: JSON.stringify(request) },
        true,
      );
      // HQ took it: an answer this build cannot read leaves how production stands unknown.
      try {
        return (await decoded(HqOutsideProductionAnswer, "where production is deployed")(response))
          .outside;
      } catch {
        throw uncertain();
      }
    },
    observeCredential: async (projectId) =>
      decoded(
        ObserveCredential,
        "observe authorization",
      )(await authorized(`/api/mates/${encodeURIComponent(projectId)}/observe-credential`)),
    appRepoGovernance: async (appId) => {
      const path = `/api/apps/${encodeURIComponent(appId)}/repos`;
      const entries: RepoGovernanceEntry[] = [];
      let after: string | undefined;
      do {
        const query = after === undefined ? "" : `?after=${encodeURIComponent(after)}`;
        const page = await decoded(
          AppReposGovernance,
          "repository rules",
        )(await authorized(path + query));
        for (const { name, remote, mirror } of page.repos) {
          if (remote?.via === "app")
            entries.push({
              name,
              url: remote.url,
              synced: mirror?.syncedAt != null,
              governance: remote.governance ?? null,
            });
        }
        after = page.next;
      } while (after !== undefined);
      return entries;
    },
    readAccessRequests: async () =>
      (
        await decoded(
          ReadAccessRequests,
          "read access requests",
        )(await authorized("/api/read-access-requests"))
      ).requests,
    askReadAccess: async (projectId) =>
      decoded(
        ReadAccessRequest,
        "read access request",
      )(
        await authorized(
          "/api/read-access-requests",
          { method: "POST", body: JSON.stringify({ projectId }) },
          true,
        ),
      ),
    closeReadAccess: async (id, outcome) => {
      await authorized(
        `/api/read-access-requests/${encodeURIComponent(id)}/close`,
        { method: "POST", body: JSON.stringify({ outcome }) },
        true,
      );
    },
    establishZcpAuthorization: async (projectId, context) =>
      decoded(
        ObserveCredential,
        "observe authorization",
      )(
        await authorized(
          `/api/mates/${encodeURIComponent(projectId)}/zcp-authorization`,
          {
            method: "POST",
            body: JSON.stringify(context.keyHash === undefined ? {} : { keyHash: context.keyHash }),
          },
          true,
        ),
      ),
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
          { method: "POST", body: JSON.stringify({}) },
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
    gitBrowse: async <R extends GitBrowseRead>(
      read: R,
      appId: string,
      repo: string,
      params: GitBrowseParams<R>,
      signal?: AbortSignal,
    ) =>
      decoded(
        GIT_BROWSE_READS[read].value as Schema.Decoder<GitBrowseValue<R>>,
        "a repository's code",
      )(
        await authorized(
          browsePathOrRefuse(read, appId, repo, params),
          signal === undefined ? {} : { signal },
          false,
          // A read at its own path is HQ's structure, signed in as any person's read.
          !("path" in GIT_BROWSE_READS[read]),
        ),
      ),
    gitBrowseBytes: async (read, appId, repo, params, signal) => {
      // @effect-diagnostics-next-line globalDate:off -- plain promises: a byte read's age against HQ's deadline.
      const asked = Date.now();
      const response = await authorized(
        browsePathOrRefuse(read, appId, repo, params),
        signal === undefined ? {} : { signal },
        false,
        true,
      );
      const { limit, deadline }: { readonly limit: number; readonly deadline?: number } =
        GIT_BROWSE_READS[read].bytes;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      try {
        for (;;) {
          const next = await reader?.read();
          if (next === undefined || next.done) break;
          size += next.value.byteLength;
          if (size > limit) {
            // Nothing past the limit is read: letting the body go stops HQ's stream with it.
            void reader?.cancel().catch(() => {});
            throw new HqError({
              kind: "refused",
              code: "too_large",
              status: 413,
              message: `It is larger than ${fileSize(limit)}. Clone the repository instead.`,
            });
          }
          chunks.push(next.value);
        }
      } catch (error) {
        if (error instanceof HqError) throw error;
        // HQ cuts a read at its deadline; a cut past it is that answer, never HQ out of reach.
        // @effect-diagnostics-next-line globalDate:off -- plain promises: a byte read's age against HQ's deadline.
        if (deadline !== undefined && Date.now() - asked >= deadline)
          throw new HqError({
            kind: "refused",
            code: "too_slow",
            message: `It took more than ${String(deadline / 60_000)} minutes. Clone the repository instead.`,
          });
        // Cut on its way, like a call that never arrived.
        throw new HqError({
          kind: "unavailable",
          code: "network",
          message: "HQ could not be reached.",
        });
      }
      return new Blob(chunks, { type: heldType(response.headers.get("content-type")) });
    },
    // A release is named by its tag, which HQ gives no second one: the one HQ holds under it is
    // this one where it tags the same `main` with the same commits.
    reviewRelease: async (appId, request, signal) =>
      decoded(
        ReleaseServicePlan,
        "a release's plan",
      )(
        await authorized(`${releasesPath(appId)}/review`, {
          ...(signal === undefined ? {} : { signal }),
          method: "POST",
          body: JSON.stringify(request),
        }),
      ),
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
  };
}
