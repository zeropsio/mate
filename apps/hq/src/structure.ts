// @effect-diagnostics nodeBuiltinImport:off -- opaque deletion handles use the existing HQ key and byte encoding.
/**
 * The structure of applications (ADR 0002): applications, the Zerops projects each holds with
 * their kind (`mate`, `devstage`, `stage`, `production`), the Mate record of a Mate's project, and
 * the environment record of a stage's or a production's (`environments.ts`).
 * A `devstage` project is a Mate that also serves as its application's stage (main's "Dev /
 * Stage"): a Mate by its record and its rules, a stage by the one-production rule. HQ is its
 * only writer; every write is fenced by the leader and checks the writer against Zerops, as every
 * write is decided (`roles.ts` `confirmingRefusal`).
 *
 * Who may is `can` (`permissions.ts`), asked with the project's kind as HQ holds
 * it now and, for a write, the org as `Roles.forWrite` holds it, its refusal confirmed fresh. A refusal answers
 * a code and a reason code, and is
 * logged with who asked what.
 *
 * @module structure
 */
import * as NodeBuffer from "node:buffer";

import { type Reason, REASONS } from "@t3tools/shared/zeropsPermissions";
import { type FactsFor, type Targets, type Verb, can } from "./permissions.ts";
import type { MateChanges } from "@t3tools/shared/hqChanges";
import type { HqOffersOf } from "@t3tools/shared/hqOffers";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import type { EnvironmentBirth } from "@t3tools/shared/hqDeploys";
import type { ReleaseRollout } from "@t3tools/shared/hqRelease";
import type { MateState } from "@t3tools/shared/mateLink";
import { type RoleProjectKind, isMateKind } from "@t3tools/shared/zeropsRoles";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import {
  type EnvironmentTier,
  TIER_SOURCES,
  deriveEnvironmentName,
  environmentNameProblem,
} from "./environments.ts";
import { DeployKeys } from "./deployKeys.ts";
import { reachesOnly } from "./deployTokens.ts";
import { heldOf, lockProject } from "./held.ts";
import { environmentBirths } from "./births.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { MateOverviews } from "./mateOverviews.ts";
import {
  type AppVerb,
  type MateVerb,
  type OrgVerb,
  appOffers,
  appTarget,
  environmentOffers,
  mateOffers,
  moveOffers,
  moveTarget,
  orgOffers,
  productionTaken,
  recordOffers,
} from "./offers.ts";
import { Roles, confirmingRefusal, decidedFresh } from "./roles.ts";
import { Rollouts, addRollout } from "./rollouts.ts";
import { ZeropsApi, type ZeropsError } from "./zerops/api.ts";

export class StructureRefused extends Schema.TaggedError<StructureRefused>()("StructureRefused", {
  code: Schema.Literals([
    "forbidden",
    "app_not_found",
    "project_not_found",
    "mate_not_found",
    "environment_not_found",
    "invalid",
    "conflict",
  ]),
  /** Why: a permission's reason (`zeropsPermissions.ts`) or one of the structure's own. */
  reason: Schema.Literals([
    ...REASONS,
    "name_length",
    "face_length",
    "hq_project",
    "mate_record_with_kind",
    "mate_record_missing",
    "mate_record_exists",
    "app_name_taken",
    "app_not_found",
    "app_not_empty",
    "project_still_exists",
    "mate_not_found",
    "placed_or_production_taken",
    "production_taken",
    "held_changed",
    "environment_with_kind",
    "environment_name_missing",
    "environment_name_long",
    "environment_name_invalid",
    "environment_name_taken",
    "environment_not_found",
    "deploy_token_refused",
    "deploy_token_scope",
    "no_key_secret",
    "birth_with_kind",
    "birth_not_found",
    "birth_project_taken",
    "press_owner_length",
    "press_held",
    "press_not_held",
  ]),
}) {}

export interface AttachInput {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  /**
   * A Mate's record. `standUp`: the caller asks for its stand-up, where no birth intent carries
   * the ask (`recordBirth`); recorded in the same write as the record (B3).
   */
  readonly mate?: {
    readonly face: string;
    readonly standUp?: boolean;
    /** Its zcp service, where its project holds one already: one Mate per project (audit D2). */
    readonly serviceId?: string;
  };
  /** A stage's or a production's environment, named as given; else named from its project. */
  readonly environment?: { readonly name: string };
  /** The birth intent a Mate's project was created under (`recordBirth`): its attach closes it. */
  readonly birth?: string;
  /**
   * The person's client created the stage's or production's project for HQ to deploy: its services
   * get their subdomain on their first deploy (`hq_subdomain_intent`, audit R1, D6).
   */
  readonly created?: boolean;
}

/**
 * A Mate's birth intent, recorded before its Zerops project exists: where it goes and with which
 * face. Once its project exists, HQ binds the two by project id (`bindBirth`), so whoever finishes
 * the Mate attaches it so.
 */
export interface BirthIntent {
  readonly projectId?: string;
  readonly id: string;
  /** Its face as its attach records it: empty where it wears its name's tint. */
  readonly face: string;
}

/**
 * A job of an environment, as its record holds it (`deploys.ts`): a deploy of one service at one
 * commit, or a delta importing the services a tier change added; what asked for it, where it
 * stands, and, once it ended, when and why.
 */
export interface JobView {
  readonly id: string;
  readonly kind: "deploy" | "delta";
  /** The service it deploys, by its hostname; none for a delta. */
  readonly service: string | null;
  readonly sha: string | null;
  readonly state:
    | "queued"
    | "submitting"
    | "building"
    | "live"
    | "failed"
    | "refused"
    | "unresolved"
    | "skipped"
    | "superseded";
  /** The event that asked for it (`rollouts.ts`). */
  readonly cause:
    | "merge"
    | "release"
    | "run_again"
    | "add_service"
    | "env_added"
    | "key_kept"
    | "import"
    | "migrated";
  /** What the event names: a merge's head, a release's tag; none else. */
  readonly ref: string | null;
  /** HQ's words for how it ended; none else. */
  readonly reason: string | null;
  /** The platform's version and job it is followed by: its log. */
  readonly appVersionId: string | null;
  readonly processId: string | null;
  /** Who asked for it, where a person did; none while only HQ asked. */
  readonly requestedBy: string | null;
  /** When it was asked for, and when it ended; ISO 8601. */
  readonly at: string;
  readonly endedAt: string | null;
  /** The job that superseded it, where one did. */
  readonly supersededBy: string | null;
}

/** A stage's or a production's environment as a reader of its application sees it. */
export interface EnvironmentView {
  readonly projectId: string;
  readonly tier: "stage" | "production";
  readonly name: string;
  /** The branches it follows: a stage `main`, a production `release`. */
  readonly sources: ReadonlyArray<string>;
  /** Its place among the application's environments, in the order they were declared: from 1. */
  readonly order: number;
  /** Whether HQ holds its deploy token (main E05); the token itself is never answered. */
  readonly keyHeld: boolean;
  /**
   * Whether the token held no longer answers, or reaches more than its project, as HQ's check
   * before a deploy found it (`deploys.ts`): an admin must mint a new one.
   */
  readonly keyInvalid: boolean;
  /**
   * Its newest jobs, newest first — at most {@link JOBS_SHOWN}, and each service's newest live one
   * beside them where it is older.
   */
  readonly jobs: ReadonlyArray<JobView>;
  /**
   * A production's: where its application's newest release stands there, from that release's
   * rollout and its jobs whatever {@link JOBS_SHOWN} lists — ended where it has none of its own;
   * none before a release, and for a stage.
   */
  readonly release: ReleaseRollout | null;
  /** Whether the rollout its attach asked for has ended; none where HQ did not bring it up. */
  readonly birth: EnvironmentBirth | null;
}

/** How many of an environment's newest jobs its view carries. */
export const JOBS_SHOWN = 20;

/** A Mate's state as the structure holds it: its record and its birth; its changes are `changes.ts`'. */
export type MateRecordState = Omit<MateState, keyof MateChanges>;

export interface MateRecord {
  readonly projectId: string;
  readonly face: string;
}

/** A Mate's record as it is set up: the caller may ask for its stand-up in the same write (B3). */
export interface NewMateRecord extends MateRecord {
  readonly standUp?: boolean;
  /** Its zcp service, where its project holds one already: one Mate per project (audit D2). */
  readonly serviceId?: string;
}

/**
 * A Mate as a reader sees it: its record and its birth. What it does goes beside the structure, to
 * whoever may observe it (`stream.ts`, `mateOverviews.ts`).
 */
export interface MateView {
  readonly birthId?: string;
  readonly signers?: Readonly<Record<string, string>>;
  readonly face: string;
  /**
   * Who made it: whoever set its record up, by their session (`createMate`, `attachProject`) —
   * the person whose sign-in it waits for. Nobody for a Mate recorded before HQ kept it.
   */
  readonly madeBy: string | null;
  /** Who asked for its stand-up, with its record (B3), or nobody. */
  readonly standupRequestedBy: string | null;
  /** Whether its project is closed off, so its runtimes may be imported. */
  readonly closedOff: boolean;
  /**
   * The key it last named reads other projects too (`MateCredentials.keyWider`, ADR 0003's
   * fallout): it needs Finish setup, whose harden takes those grants off. Always said, so a client
   * tells a Core that keeps no such word — older than this field — by its absence.
   */
  readonly keyWider: boolean;
}

/**
 * What the reader may do with a Mate (`offers.ts`), and where it may go: each application by id,
 * and `new`, with the kinds it may take there.
 */
export interface MateOffers {
  readonly can: HqOffersOf<MateVerb>;
  readonly moveTo: Readonly<Record<string, ReadonlyArray<RoleProjectKind>>>;
}

export interface StructureRead {
  /** What the reader may do with the organization's applications (`offers.ts`). */
  readonly can: HqOffersOf<OrgVerb>;
  /**
   * Each project the reader reads that HQ holds nowhere, by id, with whether they may write its
   * Mate's record (`offers.ts`).
   */
  readonly unheld: Readonly<Record<string, HqOffersOf<"create_mate_record">>>;
  /**
   * Each press HQ holds a record of (`holdPress`), by its project, for every project the reader
   * reads: what it makes and into which application, how long its hold runs on from this read —
   * none left where its press stopped or stopped renewing it — and the container import it asked
   * for, once Zerops answered it. A press that finished has none.
   */
  readonly presses: Readonly<Record<string, PressView>>;
  readonly tools?: ReadonlyArray<{ readonly projectId: string; readonly kind: "gitea" }>;
  /** The Mates in no application: their project's name in Zerops, their record and offers. */
  readonly ungrouped: ReadonlyArray<
    {
      readonly projectId: string;
      readonly name: string;
      readonly mate: MateView;
    } & MateOffers
  >;
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    /** HQ's own held records, before the visible projects are filtered against Zerops. */
    readonly contents: {
      readonly empty: boolean;
      /** Projects still held here, deleting or absent in HQ's Zerops view. */
      readonly deletingProjectIds: ReadonlyArray<string>;
    };
    /** Its projects the reader reads; each Mate with what the reader may do with it. */
    readonly projects: ReadonlyArray<
      {
        readonly projectId: string;
        readonly name: string;
        readonly kind: string;
        readonly mate: MateView | null;
      } & Partial<MateOffers>
    >;
    /** What the reader may do with it: its changes, its deploys, its release (`offers.ts`). */
    readonly can: HqOffersOf<AppVerb>;
    /**
     * Its stage and production, in the order they were declared, with their deploys: to whoever
     * reads its changes (`read_change`), as main's commit statuses and `environments.yaml` went to
     * whoever read its repositories. To one who only sees the application, refused with why —
     * never an empty list, which would read as none declared.
     */
    readonly environments:
      | ReadonlyArray<EnvironmentView & { readonly can: HqOffersOf<"keep_deploy_token"> }>
      | { readonly refused: Reason };
    /** The Mates on their way into it whose attach has not landed yet, oldest first. */
    readonly births: ReadonlyArray<BirthIntent>;
  }>;
}

type WriteError = StructureRefused | NotLeader | SqlError | ZeropsError;

export class Structure extends Context.Service<
  Structure,
  {
    readonly createApp: (
      userId: string,
      name: string,
    ) => Effect.Effect<{ readonly id: string; readonly name: string }, WriteError>;
    readonly renameApp: (
      userId: string,
      appId: string,
      name: string,
    ) => Effect.Effect<{ readonly id: string; readonly name: string }, WriteError>;
    /**
     * An application deleted, with what HQ keeps of its recipe repository — only one that holds
     * nothing: no project, no change, no release, no repository but its recipe's (`app_not_empty`).
     * Its repositories on disk are the caller's to remove, after it.
     */
    readonly deleteApp: (userId: string, appId: string) => Effect.Effect<void, WriteError>;
    readonly attachProject: (
      userId: string,
      appId: string,
      input: AttachInput,
    ) => Effect.Effect<void, WriteError>;
    /**
     * Moves a project into an application as `kind`, or out of any (`appId: null`, `kind` aside):
     * a Mate by an owner or admin of its project, into an application they see; an environment
     * by an org owner or admin. A Mate out of any application is listed `ungrouped`.
     */
    readonly moveProject: (
      userId: string,
      projectId: string,
      target: { readonly appId: string | null; readonly kind: AttachInput["kind"] },
    ) => Effect.Effect<
      {
        readonly projectId: string;
        readonly appId: string | null;
        readonly kind: AttachInput["kind"] | null;
      },
      WriteError
    >;
    /**
     * Records a Mate's birth intent, before its project exists: its application and face, and
     * whether the recorder asks for its stand-up, by whoever sees the application. Its attach
     * (`birth`) closes it, the Mate made by whoever recorded it and its stand-up asked by them
     * where they asked, in the same write as its record (B3). The same person's intents a week
     * old, never attached, go with the write.
     */
    readonly recordBirth: (
      userId: string,
      birth: { readonly appId: string; readonly face: string; readonly standUp?: boolean },
    ) => Effect.Effect<BirthIntent, WriteError>;
    /**
     * Keeps who signed in each login of a Mate as the Mate reports it: a login named here takes
     * the new signer, one not named keeps its record.
     */
    readonly recordSigners: (
      projectId: string,
      signers: Readonly<Record<string, string>>,
    ) => Effect.Effect<void, NotLeader | SqlError>;
    readonly bindBirth: (
      userId: string,
      birthId: string,
      projectId: string,
    ) => Effect.Effect<void, WriteError>;
    readonly createMate: (
      userId: string,
      mate: NewMateRecord,
    ) => Effect.Effect<MateRecord, WriteError>;
    /** Changes a Mate's face; its name is its project's, renamed in Zerops (D3). */
    readonly patchMate: (
      userId: string,
      projectId: string,
      patch: { readonly face: string },
    ) => Effect.Effect<MateRecord, WriteError>;
    /**
     * Holds a press for the browser running it (`hq_press`): taken, or renewed by the same press
     * (`owner`), for {@link PRESS_HOLD_MS} from now — what it makes, into which application, and
     * the Zerops process of the container import it asked for once Zerops answered it, kept where
     * a renewal names none. Another press's hold still running refuses it (`press_held`); one that
     * ran out is taken over. A `renew` only extends its own press's live hold — never one that
     * stopped, ran out or finished, so a renewal landing after its press's end changes nothing
     * (`press_not_held`); only a first hold creates. By whoever reads the project (`hold_press`).
     */
    readonly holdPress: (
      userId: string,
      projectId: string,
      press: {
        readonly owner: string;
        readonly kind: PressKind;
        readonly appId?: string;
        readonly importProcessId?: string;
        readonly renew?: boolean;
      },
    ) => Effect.Effect<PressView, WriteError>;
    /**
     * A press's end, by the press that holds it: one that `finished` leaves no record; one that
     * stopped ends its hold now and keeps its record, for its setup to be finished for its kind.
     */
    readonly endPress: (
      userId: string,
      projectId: string,
      press: { readonly owner: string; readonly finished: boolean },
    ) => Effect.Effect<void, WriteError>;
    /**
     * Records that a Mate's project is closed off, as the client that set it up does: the press's
     * close-off step done. By whoever may edit the Mate's record.
     */
    readonly markClosedOff: (
      userId: string,
      projectId: string,
    ) => Effect.Effect<MateRecordState, WriteError>;
    /**
     * A Mate's record changed outside the structure's own writes — HQ's word on its key
     * (`MateCredentials.keyWider`): every reader is told.
     */
    readonly mateTouched: (projectId: string) => Effect.Effect<void>;
    /**
     * Keeps the deploy token of the application's environment `name` (SPEC §3.2b): handed over
     * by whoever may attach its project (`keep_deploy_token`), and kept only once Zerops says it
     * reaches exactly that project, as a Basic user in HQ's org (main E02) — never answered back.
     * The environment's project, whose deploys the key asks for (`rollouts.ts`).
     */
    readonly keepDeployToken: (
      userId: string,
      appId: string,
      name: string,
      token: Redacted.Redacted,
    ) => Effect.Effect<{ readonly projectId: string }, WriteError>;
    /** A Mate's record and birth, when HQ has its record. */
    readonly mateState: (
      projectId: string,
    ) => Effect.Effect<Option.Option<MateRecordState>, SqlError>;
    /** The projects whose Mate state changes, as they change. */
    readonly mateChanges: Stream.Stream<string>;
    readonly read: (userId: string) => Effect.Effect<StructureRead, SqlError | ZeropsError>;
    /**
     * Follows Zerops: what HQ holds of projects it no longer has (missing from the org's list, and
     * refused by id) goes, Mate credentials included; answers how many projects. Nothing moves
     * while Zerops cannot say.
     */
    readonly reconcile: Effect.Effect<number, NotLeader | SqlError | ZeropsError>;
    /** A scoped completion handle, authorized while Zerops still holds the project's roles. */
    readonly prepareProjectDeletion: (
      userId: string,
      projectId: string,
    ) => Effect.Effect<string, WriteError>;
    /** Verifies this one id is gone, then drops its records and publishes the structure. */
    readonly completeProjectDeletion: (
      userId: string,
      projectId: string,
      completion: string,
    ) => Effect.Effect<void, WriteError>;
    /** Ticks after every change of the structure, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
  }
>()("@t3tools/hq/structure") {}

const refuse = (code: StructureRefused["code"], reason: StructureRefused["reason"]) =>
  Effect.fail(new StructureRefused({ code, reason }));

/**
 * How long a press is held from its last renewal (`holdPress`): five minutes. Its press renews it
 * every minute and at each of its steps; a browser throttles a hidden tab's timers to one wake a
 * minute (Chrome's intensive throttling), which this survives several times over. A hold that runs
 * out is a press that stopped — its tab closed.
 */
export const PRESS_HOLD_MS = 300_000;

/** What a press makes: a Mate, or a stage's or a production's environment — its registration's tier. */
export type PressKind = "mate" | "stage" | "production";

/** A press as a reader sees it (`StructureRead.presses`). */
export interface PressView {
  readonly kind: PressKind;
  /** The application its registration places it in; none for a Mate in no application. */
  readonly appId?: string;
  /** How long its hold runs on from the read that said it, ms; 0 where it ran out. */
  readonly heldForMs: number;
  /**
   * When its hold runs out on HQ's own clock (ISO 8601): what a renewal moves, so a stream says it
   * again only then. A reader measures by `heldForMs`, never by its own clock against this.
   */
  readonly until: string;
  /** The Zerops process of the container import its press asked for, once Zerops answered it. */
  readonly importProcessId?: string;
}

/** A press row, its hold measured on HQ's own clock. */
interface PressRow {
  readonly project_id: string;
  readonly kind: PressKind;
  readonly app_id: string | null;
  readonly held_for_ms: number;
  readonly until: string;
  readonly import_process_id: string | null;
}

const pressView = (row: PressRow): PressView => ({
  kind: row.kind,
  ...(row.app_id === null ? {} : { appId: row.app_id }),
  heldForMs: row.held_for_ms,
  until: row.until,
  ...(row.import_process_id === null ? {} : { importProcessId: row.import_process_id }),
});

const fitsName = (name: string) => name.length >= 1 && name.length <= 100;

/** A face as a client records it (`<tint>:<shape>[:named]`), or empty for its name's tint. */
const fitsFace = (face: string) => face.length <= 64;

/** The environment a project of `kind` is: a stage's or a production's, else none. */
const tierOf = (kind: string): EnvironmentTier | undefined =>
  kind === "stage" || kind === "production" ? kind : undefined;

/** An environment's sources as the JSON its insert spreads into a text array. */
const encodeSigners = Schema.encodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);
const encodeSources = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

/** An environment's row, as a takeover keeps it (main D13). */
interface EnvironmentRow {
  readonly project_id: string;
  readonly tier: string;
  readonly name: string;
  readonly sources: ReadonlyArray<string>;
  readonly declared_seq: string;
}

/** `can`'s answer, enforced: a refusal is logged with who asked what, and answered by its reason. */
const allowed = <V extends Verb>(
  userId: string,
  verb: V,
  target: Targets[V],
  facts: FactsFor<V>,
) => {
  const decision = can({ kind: "person", userId }, verb, target, facts);
  if (decision.allow) return Effect.void;
  const reason: Reason = decision.reason;
  return Effect.andThen(
    Effect.logInfo("structure refused", {
      userId,
      verb,
      target,
      reason,
      freshness: facts.freshness,
    }),
    refuse(reason === "project_gone" ? "project_not_found" : "forbidden", reason),
  );
};

const isUniqueViolation = (error: { readonly _tag: string }) =>
  error._tag === "SqlError" && (error as SqlError).reason._tag === "UniqueViolation";

/** A unique constraint the write ran into is a conflict with what is already there. */
const conflictOnUnique = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
  reason: StructureRefused["reason"],
) =>
  effect.pipe(
    Effect.catchIf(
      (error: E) => isUniqueViolation(error),
      () => refuse("conflict", reason),
    ),
  );

export const structureLayer = (options: {
  readonly hqProjectId: string;
  /** How often the leader reconciles with Zerops (SPEC §4); 60 s. */
  readonly reconcileEvery?: Duration.Duration;
}): Layer.Layer<
  Structure,
  never,
  DeployKeys | Leader | MateOverviews | Roles | Rollouts | SqlClient.SqlClient | ZeropsApi
> =>
  Layer.effect(
    Structure,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const roles = yield* Roles;
      const overviews = yield* MateOverviews;
      const zerops = yield* ZeropsApi;
      const keys = yield* DeployKeys;
      const rollouts = yield* Rollouts;
      const sql = yield* SqlClient.SqlClient;
      /** Shared by the streamed answer and Delete's guard; `a` is the application's row. */
      const appHeld = sql`
        EXISTS (SELECT 1 FROM hq_app_project WHERE app_id = a.id)
        OR EXISTS (SELECT 1 FROM hq_change WHERE app_id = a.id)
        OR EXISTS (SELECT 1 FROM hq_release WHERE app_id = a.id)
        OR EXISTS (SELECT 1 FROM hq_repo WHERE app_id = a.id AND name <> ${RECIPE_REPO})`;
      const version = yield* SubscriptionRef.make(0);
      const changed = SubscriptionRef.update(version, (tick) => tick + 1);
      /** After a write that added an environment or kept its key: its deploys are asked for. */
      const changedAsking = Effect.andThen(changed, rollouts.wake);
      const mateChanged = yield* PubSub.unbounded<string>();
      /**
       * A Mate's record and birth, named as its project is in Zerops, as HQ's view of the org has
       * it — unnamed while that view cannot be read.
       */
      const stateOf = (projectId: string) =>
        Effect.zipWith(
          sql<{
            readonly face: string;
            readonly standup_requested_by: string | null;
            readonly closed_off: boolean;
            readonly signers: Readonly<Record<string, string>>;
          }>`
            SELECT face, standup_requested_by, closed_off_at IS NOT NULL AS closed_off, signers
            FROM hq_mate WHERE project_id = ${projectId}`,
          Effect.orElseSucceed(
            Effect.map(
              roles.view,
              (view) => view.projects.find((project) => project.id === projectId)?.name ?? "",
            ),
            () => "",
          ),
          (rows, name) =>
            Option.map(Option.fromNullishOr(rows[0]), (row): MateRecordState => ({
              projectId,
              name,
              face: row.face,
              standupRequestedBy: row.standup_requested_by,
              closedOff: row.closed_off,
              ...(Object.keys(row.signers).length === 0 ? {} : { signers: row.signers }),
            })),
        );

      /** The projects of `projectIds` Zerops refuses by id; any other failure is no answer. */
      const goneOf = (projectIds: ReadonlyArray<string>) =>
        Effect.map(
          Effect.forEach(projectIds, (projectId) =>
            Effect.map(roles.exists(projectId), (exists) => (exists ? [] : [projectId])),
          ),
          (found) => found.flat(),
        );
      /**
       * In a fenced write: what HQ holds of the projects `gone` goes — their rows, their Mate
       * records first, their Mates' challenges, their presses' records, and their Mate credentials
       * are revoked (`mateCredentials.ts`).
       */
      const dropRows = (gone: ReadonlyArray<string>) =>
        gone.length === 0
          ? Effect.void
          : Effect.all([
              sql`DELETE FROM hq_mate WHERE ${sql.in("project_id", gone)}`,
              sql`DELETE FROM hq_app_project WHERE ${sql.in("project_id", gone)}`,
              sql`DELETE FROM hq_mate_challenge WHERE ${sql.in("project_id", gone)}`,
              sql`DELETE FROM hq_press WHERE ${sql.in("project_id", gone)}`,
              sql`
                UPDATE hq_mate_credential SET revoked_at = now()
                WHERE ${sql.in("project_id", gone)} AND revoked_at IS NULL`,
            ]);

      /** The environments of `projectIds`, read before their projects' rows go. */
      const environmentRows = (projectIds: ReadonlyArray<string>) =>
        projectIds.length === 0
          ? Effect.succeed([])
          : sql<EnvironmentRow>`
              SELECT project_id, tier, name, sources, declared_seq::text AS declared_seq
              FROM hq_environment WHERE ${sql.in("project_id", projectIds)}
              ORDER BY declared_seq`;
      /**
       * In a fenced write, the application locked: the environment of a project now placed in it as
       * `tier`. It takes over `replaced` — an environment of the tier whose project Zerops no longer
       * has (main D13) — with its name, its sources and its place in the order; else it is named as
       * asked, or from its project's name in Zerops (main D10), and declared last. It asks for what
       * it is wanted at (`rollouts.ts`).
       */
      const recordEnvironment = (environment: {
        readonly projectId: string;
        readonly appId: string;
        readonly tier: EnvironmentTier;
        readonly userId: string;
        readonly name: string | undefined;
        readonly projectName: string;
        readonly replaced: EnvironmentRow | undefined;
      }) =>
        Effect.gen(function* () {
          const taken = (yield* sql<{ readonly name: string }>`
            SELECT name FROM hq_environment WHERE app_id::text = ${environment.appId}`).map(
            (row) => row.name,
          );
          const name =
            environment.name ??
            environment.replaced?.name ??
            deriveEnvironmentName(environment.projectName, environment.tier, taken);
          if (name === undefined || taken.includes(name)) {
            return yield* refuse("conflict", "environment_name_taken");
          }
          const sources = encodeSources(
            environment.replaced?.sources ?? TIER_SOURCES[environment.tier],
          );
          const declared = environment.replaced?.declared_seq ?? null;
          yield* sql`
            INSERT INTO hq_environment (project_id, app_id, tier, name, sources, declared_seq,
              created_by, release_floor)
            VALUES (${environment.projectId}, ${environment.appId}::uuid, ${environment.tier},
              ${name}, ARRAY(SELECT jsonb_array_elements_text(${sources}::jsonb)),
              COALESCE(${declared}::bigint, nextval(pg_get_serial_sequence('hq_environment',
                'declared_seq'))),
              ${environment.userId},
              ${environment.tier === "production" ? sql`now()` : null})`;
          yield* addRollout(sql, {
            cause: "env_added",
            projectId: environment.projectId,
            by: environment.userId,
          });
        });

      // Over the org as recently read, never forcing a fresh read (the lead, 2026-10-03: forcing
      // one every minute read KRLS's member and project lists for nothing).
      const reconcile = Effect.gen(function* () {
        const listed = new Set((yield* roles.recent).projects.map((project) => project.id));
        const rows = yield* sql<{ readonly project_id: string }>`
          SELECT project_id FROM hq_app_project
          UNION SELECT project_id FROM hq_mate
          UNION SELECT project_id FROM hq_mate_challenge
          UNION SELECT project_id FROM hq_mate_credential WHERE revoked_at IS NULL
          UNION SELECT project_id FROM hq_press`;
        const gone = yield* goneOf(
          rows.map((row) => row.project_id).filter((projectId) => !listed.has(projectId)),
        );
        if (gone.length === 0) return 0;
        yield* leader.write(dropRows(gone));
        yield* overviews.forget(gone);
        yield* changed;
        return gone.length;
      });
      if (options.reconcileEvery !== undefined) {
        const every = options.reconcileEvery;
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.andThen(
              Effect.sleep(every),
              Effect.gen(function* () {
                if ((yield* leader.status).state !== "active") return;
                yield* reconcile.pipe(
                  Effect.catch((error) => Effect.logWarning("structure reconcile failed", error)),
                );
              }),
            ),
          ),
        );
      }

      /** A write's method that can be undone, decided as `confirmingRefusal` decides one (F22). */
      const confirmed =
        <Args extends ReadonlyArray<unknown>, A, E, R>(
          method: (...args: Args) => Effect.Effect<A, E, R>,
        ) =>
        (...args: Args) =>
          confirmingRefusal(method(...args));
      /** A write's method that cannot be undone, decided over roles read for it alone. */
      const fresh =
        <Args extends ReadonlyArray<unknown>, A, E, R>(
          method: (...args: Args) => Effect.Effect<A, E, R>,
        ) =>
        (...args: Args) =>
          decidedFresh(method(...args));

      return Structure.of({
        reconcile,
        prepareProjectDeletion: fresh((userId, projectId) =>
          Effect.gen(function* () {
            const view = yield* roles.forWrite;
            yield* allowed(
              userId,
              "edit_mate_record",
              { projectId, held: yield* heldOf(sql, projectId) },
              view,
            );
            if (projectId === options.hqProjectId) return yield* refuse("invalid", "hq_project");
            // The handle grants only removal after Zerops confirms absence; no platform roles are copied.
            const sealed = keys.seal(`project-deletion:${projectId}`, Redacted.make(userId));
            if (sealed === undefined) return yield* refuse("invalid", "no_key_secret");
            return `${sealed.keyId}.${NodeBuffer.Buffer.from(sealed.sealed).toString("base64url")}`;
          }),
        ),
        completeProjectDeletion: fresh((userId, projectId, completion) =>
          Effect.gen(function* () {
            const view = yield* roles.forWrite;
            if (
              !view.members.some((member) => member.userId === userId && member.status === "ACTIVE")
            )
              return yield* refuse("forbidden", "not_active_member");
            const [keyId, bytes, extra] = completion.split(".");
            const authorized =
              keyId !== undefined && bytes !== undefined && extra === undefined
                ? keys.open(`project-deletion:${projectId}`, {
                    keyId,
                    sealed: NodeBuffer.Buffer.from(bytes, "base64url"),
                  })
                : undefined;
            if (authorized === undefined || Redacted.value(authorized) !== userId)
              return yield* refuse("forbidden", "not_project_admin");
            if (projectId === options.hqProjectId) return yield* refuse("invalid", "hq_project");
            const gone = yield* goneOf([projectId]);
            if (gone.length === 0) return yield* refuse("conflict", "project_still_exists");
            yield* leader.write(
              Effect.gen(function* () {
                yield* lockProject(sql, projectId);
                yield* dropRows(gone);
              }),
            );
            yield* overviews.forget(gone);
            yield* changed;
          }),
        ),
        changes: SubscriptionRef.changes(version),
        mateChanges: Stream.fromPubSub(mateChanged),
        mateState: stateOf,
        keepDeployToken: fresh((userId, appId, name, token) =>
          Effect.gen(function* () {
            const view = yield* roles.forWrite;
            // Whether the application has an environment of that name is told only to whoever sees
            // the application.
            const appProjects = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`;
            yield* allowed(userId, "read_app", appTarget(appProjects), view);
            const named = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_environment
              WHERE app_id::text = ${appId} AND name = ${name}`;
            const projectId = named[0]?.project_id;
            if (projectId === undefined) {
              return yield* refuse("environment_not_found", "environment_not_found");
            }
            yield* allowed(userId, "keep_deploy_token", { projectId }, view);
            // Kept only sealed, under HQ's key: without one HQ keeps none (`deployKeys.ts`).
            const sealed = keys.seal(projectId, token);
            if (sealed === undefined) return yield* refuse("conflict", "no_key_secret");
            const own = yield* zerops
              .ownToken(token)
              .pipe(
                Effect.catchTag("ZeropsRefused", () => refuse("invalid", "deploy_token_refused")),
              );
            if (!reachesOnly(own, view.orgId, projectId)) {
              return yield* refuse("invalid", "deploy_token_scope");
            }
            const kept = yield* leader.write(
              Effect.gen(function* () {
                yield* lockProject(sql, projectId);
                const kept = yield* sql`
                  INSERT INTO hq_deploy_token (project_id, key_id, sealed, kept_by)
                  SELECT project_id, ${sealed.keyId}, ${sealed.sealed}, ${userId}
                  FROM hq_environment
                  WHERE project_id = ${projectId} AND app_id::text = ${appId} AND name = ${name}
                  ON CONFLICT (project_id)
                  DO UPDATE SET key_id = EXCLUDED.key_id, sealed = EXCLUDED.sealed,
                    kept_by = EXCLUDED.kept_by, kept_at = now(), invalid_since = NULL
                  RETURNING 1`;
                // A key kept asks for what the environment is wanted at (`rollouts.ts`).
                if (kept.length > 0) {
                  yield* addRollout(sql, { cause: "key_kept", projectId, by: userId });
                }
                return kept;
              }),
            );
            if (kept.length === 0) {
              return yield* refuse("environment_not_found", "environment_not_found");
            }
            yield* changedAsking;
            return { projectId };
          }),
        ),
        recordSigners: (projectId, signers) =>
          Effect.gen(function* () {
            if (Object.keys(signers).length === 0) return;
            const kept = yield* leader.write(sql`
              UPDATE hq_mate SET signers = signers || ${encodeSigners(signers)}::jsonb
              WHERE project_id = ${projectId}
                AND signers || ${encodeSigners(signers)}::jsonb IS DISTINCT FROM signers
              RETURNING 1`);
            if (kept.length === 0) return;
            yield* changed;
            yield* PubSub.publish(mateChanged, projectId);
          }),
        mateTouched: (projectId) =>
          Effect.andThen(changed, PubSub.publish(mateChanged, projectId)).pipe(Effect.asVoid),
        // A project Zerops made seconds ago may not be in the recent view yet: a refusal of its
        // facts is confirmed over a fresh read, as every write's is (F22).
        holdPress: confirmed((userId, projectId, press) =>
          Effect.gen(function* () {
            if (press.owner.length < 1 || press.owner.length > 100)
              return yield* refuse("invalid", "press_owner_length");
            yield* allowed(userId, "hold_press", { projectId }, yield* roles.forWrite);
            const importProcessId = press.importProcessId ?? null;
            const appId = press.appId ?? null;
            const rows = yield* leader.write(
              Effect.gen(function* () {
                if (appId !== null) {
                  const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
                  if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
                }
                if (press.renew === true) {
                  return yield* sql<PressRow>`
              UPDATE hq_press SET
                kind = ${press.kind}, app_id = ${appId}::uuid, held_by = ${userId},
                until = now() + ${`${PRESS_HOLD_MS} milliseconds`}::interval,
                import_process_id = COALESCE(${importProcessId}, import_process_id)
              WHERE project_id = ${projectId} AND owner = ${press.owner} AND until > now()
              RETURNING project_id, kind, app_id::text AS app_id, import_process_id,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (until - now())) * 1000))::int AS held_for_ms,
                to_char(until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS until`;
                }
                return yield* sql<PressRow>`
              INSERT INTO hq_press (project_id, kind, app_id, owner, held_by, until, import_process_id)
              VALUES (${projectId}, ${press.kind}, ${appId}::uuid, ${press.owner}, ${userId},
                now() + ${`${PRESS_HOLD_MS} milliseconds`}::interval, ${importProcessId})
              ON CONFLICT (project_id) DO UPDATE SET
                kind = EXCLUDED.kind, app_id = EXCLUDED.app_id,
                owner = EXCLUDED.owner, held_by = EXCLUDED.held_by, until = EXCLUDED.until,
                import_process_id = COALESCE(
                  EXCLUDED.import_process_id,
                  CASE WHEN hq_press.owner = EXCLUDED.owner
                    THEN hq_press.import_process_id END)
              WHERE hq_press.owner = EXCLUDED.owner OR hq_press.until <= now()
              RETURNING project_id, kind, app_id::text AS app_id, import_process_id,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (until - now())) * 1000))::int AS held_for_ms,
                to_char(until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS until`;
              }),
            );
            const held = rows[0];
            if (held === undefined)
              return yield* refuse(
                "conflict",
                press.renew === true ? "press_not_held" : "press_held",
              );
            yield* changed;
            return pressView(held);
          }),
        ),
        endPress: confirmed((userId, projectId, press) =>
          Effect.gen(function* () {
            yield* allowed(userId, "hold_press", { projectId }, yield* roles.forWrite);
            const ended = yield* leader.write(
              press.finished
                ? sql`
                    DELETE FROM hq_press WHERE project_id = ${projectId} AND owner = ${press.owner}
                    RETURNING 1`
                : sql`
                    UPDATE hq_press SET until = LEAST(until, now())
                    WHERE project_id = ${projectId} AND owner = ${press.owner}
                    RETURNING 1`,
            );
            if (ended.length > 0) yield* changed;
          }),
        ),
        markClosedOff: confirmed((userId, projectId) =>
          Effect.gen(function* () {
            const view = yield* roles.forWrite;
            const marked = yield* leader.write(
              Effect.gen(function* () {
                const held = yield* heldOf(sql, projectId);
                yield* allowed(userId, "edit_mate_record", { projectId, held }, view);
                return yield* sql`
                  UPDATE hq_mate SET closed_off_at = COALESCE(closed_off_at, now())
                  WHERE project_id = ${projectId} RETURNING 1`;
              }),
            );
            if (marked.length === 0) return yield* refuse("mate_not_found", "mate_not_found");
            yield* changed;
            yield* PubSub.publish(mateChanged, projectId);
            const state = yield* stateOf(projectId);
            if (Option.isNone(state)) return yield* refuse("mate_not_found", "mate_not_found");
            return state.value;
          }),
        ),
        createApp: confirmed((userId, rawName) =>
          Effect.gen(function* () {
            const name = rawName.trim();
            if (!fitsName(name)) return yield* refuse("invalid", "name_length");
            yield* allowed(userId, "create_app", null, yield* roles.forWrite);
            const rows = yield* conflictOnUnique(
              leader.write(sql<{ readonly id: string; readonly name: string }>`
                INSERT INTO hq_app (name, created_by) VALUES (${name}, ${userId})
                RETURNING id::text AS id, name`),
              "app_name_taken",
            );
            yield* changed;
            // `INSERT … RETURNING` answers the row it inserted, or fails.
            return rows[0]!;
          }),
        ),

        renameApp: confirmed((userId, appId, rawName) =>
          Effect.gen(function* () {
            const name = rawName.trim();
            if (!fitsName(name)) return yield* refuse("invalid", "name_length");
            yield* allowed(userId, "rename_app", null, yield* roles.forWrite);
            const rows = yield* conflictOnUnique(
              leader.write(sql<{ readonly id: string; readonly name: string }>`
                UPDATE hq_app SET name = ${name} WHERE id::text = ${appId}
                RETURNING id::text AS id, name`),
              "app_name_taken",
            );
            if (rows[0] === undefined) return yield* refuse("app_not_found", "app_not_found");
            yield* changed;
            // Its Mates' states name it.
            const mates = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project
              WHERE app_id::text = ${appId} AND kind IN ('mate', 'devstage')`;
            yield* PubSub.publishAll(
              mateChanged,
              mates.map((row) => row.project_id),
            );
            return rows[0];
          }),
        ),

        deleteApp: fresh((userId, appId) =>
          Effect.gen(function* () {
            yield* allowed(userId, "delete_app", null, yield* roles.forWrite);
            yield* leader.write(
              Effect.gen(function* () {
                // Locked against an attach, which takes the row's weaker lock: whichever comes
                // second sees what the first left — a project, or no application.
                const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId} FOR UPDATE`;
                if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
                const held = yield* sql<{ readonly held: boolean }>`
                  SELECT ${appHeld} AS held FROM hq_app a WHERE a.id::text = ${appId}`;
                if (held[0]?.held !== false) return yield* refuse("conflict", "app_not_empty");
                yield* sql`DELETE FROM hq_recipe_seen WHERE app_id::text = ${appId}`;
                yield* sql`DELETE FROM hq_git_event WHERE app_id::text = ${appId}`;
                yield* sql`DELETE FROM hq_repo WHERE app_id::text = ${appId}`;
                yield* sql`DELETE FROM hq_app WHERE id::text = ${appId}`;
              }),
            );
            yield* changed;
          }),
        ),

        // A Mate attached can be moved out again; an environment attached is deployed to, which
        // cannot be taken back.
        attachProject: (userId, appId, input) =>
          (tierOf(input.kind) === undefined ? confirmingRefusal : decidedFresh)(
            Effect.gen(function* () {
              if (isMateKind(input.kind) !== (input.mate !== undefined)) {
                return yield* refuse("invalid", "mate_record_with_kind");
              }
              if (input.birth !== undefined && !isMateKind(input.kind)) {
                return yield* refuse("invalid", "birth_with_kind");
              }
              if (input.mate !== undefined && !fitsFace(input.mate.face)) {
                return yield* refuse("invalid", "face_length");
              }
              const tier = tierOf(input.kind);
              if (input.environment !== undefined) {
                if (tier === undefined) return yield* refuse("invalid", "environment_with_kind");
                const problem = environmentNameProblem(input.environment.name);
                if (problem !== undefined) return yield* refuse("invalid", problem);
              }
              if (input.projectId === options.hqProjectId) {
                return yield* refuse("invalid", "hq_project");
              }
              const view = yield* roles.forWrite;
              /**
               * `can`'s answer on the application's projects and the project's kind as they stand:
               * whether the application has its project of this kind already counts too — a
               * devstage is its stage, and a project Zerops no longer has holds no place.
               */
              const decided = Effect.gen(function* () {
                const appProjects = yield* sql<{
                  readonly project_id: string;
                  readonly kind: string;
                }>`SELECT project_id, kind FROM hq_app_project WHERE app_id::text = ${appId}`;
                const sameKind = (kind: string) =>
                  kind === input.kind || (input.kind === "stage" && kind === "devstage");
                yield* allowed(
                  userId,
                  "attach",
                  {
                    projectId: input.projectId,
                    held: yield* heldOf(sql, input.projectId),
                    to: input.kind,
                    appProjectIds: appProjects.map((row) => row.project_id),
                    slotTaken: appProjects.some(
                      (row) =>
                        sameKind(row.kind) &&
                        view.projects.some((project) => project.id === row.project_id),
                    ),
                  },
                  view,
                );
              });
              // Decided first on the structure as it stands, so a refusal spends nothing of Zerops;
              // then again in the write, under the application's lock.
              yield* decided;
              // What this write would conflict with or take over — the project in any application,
              // the application's environments of its tier. A row whose project Zerops no longer has
              // (asked by its id) stops counting and goes with this write, its environment taken
              // over; one Zerops cannot answer for refuses it.
              const holders = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project
              WHERE project_id = ${input.projectId}
                 OR (${tier ?? null}::text IS NOT NULL AND kind = ${input.kind}
                     AND app_id::text = ${appId})`;
              const gone = yield* goneOf(holders.map((row) => row.project_id));
              yield* conflictOnUnique(
                leader.write(
                  Effect.gen(function* () {
                    // The project, then the application's row, locked: attaches of one project, or
                    // into one application, are decided one after another, each on what the one
                    // before left — two never take one place. The row lock lets a reference to the
                    // application pass.
                    yield* lockProject(sql, input.projectId);
                    const apps = yield* sql`
                    SELECT 1 FROM hq_app WHERE id::text = ${appId} FOR NO KEY UPDATE`;
                    yield* decided;
                    if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
                    const replaced = (yield* environmentRows(gone)).find(
                      (row) => row.tier === tier,
                    );
                    yield* dropRows(gone);
                    yield* sql`
                    INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
                    VALUES (${input.projectId}, ${appId}::uuid, ${input.kind}, ${userId})`;
                    if (tier !== undefined) {
                      // Registered: a stage's or a production's press is over, whoever finished it.
                      yield* sql`
                        DELETE FROM hq_press
                        WHERE project_id = ${input.projectId} AND kind <> 'mate'`;
                      yield* recordEnvironment({
                        projectId: input.projectId,
                        appId,
                        tier,
                        userId,
                        name: input.environment?.name,
                        projectName:
                          view.projects.find((project) => project.id === input.projectId)?.name ??
                          "",
                        replaced,
                      });
                      if (input.created === true) {
                        yield* sql`
                        INSERT INTO hq_subdomain_intent (project_id) VALUES (${input.projectId})
                        ON CONFLICT DO NOTHING`;
                      }
                    }
                    // A Mate set up already keeps its record: changing its face is its admin's
                    // (`edit_mate_record`), not an attacher's. One born under an intent was made by
                    // whoever started its birth, whose sign-in it waits for, whoever finishes it, and
                    // asked for its stand-up by them where they asked: the record and its ask are one
                    // write (B3). One with no intent carries its own ask.
                    if (input.mate !== undefined) {
                      yield* sql`
                      INSERT INTO hq_mate (project_id, face, made_by, standup_requested_by, service_id, birth_id)
                      SELECT ${input.projectId}, ${input.mate.face},
                        COALESCE(intent.made_by, ${userId}),
                        CASE
                          WHEN intent.made_by IS NOT NULL THEN
                            CASE WHEN intent.standup THEN intent.made_by END
                          WHEN ${input.mate.standUp === true} THEN ${userId}
                        END,
                        ${input.mate.serviceId ?? null}, intent.id
                      FROM (SELECT 1) AS one
                      LEFT JOIN hq_birth_intent AS intent
                        ON intent.id::text = ${input.birth ?? null} AND intent.app_id::text = ${appId}
                      ON CONFLICT (project_id) DO NOTHING`;
                    }
                    // The intent it was born under is done with, as its application's.
                    if (input.birth !== undefined) {
                      yield* sql`
                      DELETE FROM hq_birth_intent
                      WHERE id::text = ${input.birth} AND app_id::text = ${appId}`;
                    }
                  }),
                ),
                "placed_or_production_taken",
              );
              yield* changedAsking;
              yield* PubSub.publish(mateChanged, input.projectId);
            }),
          ),

        moveProject: fresh((userId, projectId, { appId, kind }) =>
          Effect.gen(function* () {
            if (projectId === options.hqProjectId) {
              return yield* refuse("invalid", "hq_project");
            }
            const view = yield* roles.forWrite;
            // The kind is read and decided on in the write that changes it, and the change lands
            // only on the row still of that kind: a writer's change in between makes a conflict.
            if (appId === null) {
              const removed = yield* leader.write(
                Effect.gen(function* () {
                  yield* lockProject(sql, projectId);
                  const held = yield* heldOf(sql, projectId);
                  yield* allowed(userId, "detach", { projectId, held }, view);
                  return yield* sql`
                    DELETE FROM hq_app_project
                    WHERE project_id = ${projectId} AND kind = ${held}
                    RETURNING 1`;
                }),
              );
              if (removed.length > 0) {
                yield* changed;
                yield* PubSub.publish(mateChanged, projectId);
              }
              return { projectId, appId, kind: null };
            }
            const target = yield* sql<{ readonly project_id: string; readonly kind: string }>`
              SELECT project_id, kind FROM hq_app_project WHERE app_id::text = ${appId}`;
            // A production Zerops still has holds the place, as its offer says (`moveTo`).
            if (productionTaken(projectId, kind, target, view)) {
              return yield* refuse("conflict", "production_taken");
            }
            // The application's environments of the tier, if gone from Zerops, make room as on
            // attach, the first one's environment taken over.
            const tier = tierOf(kind);
            const holders = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project
              WHERE ${tier ?? null}::text IS NOT NULL AND kind = ${kind}
                AND app_id::text = ${appId} AND project_id <> ${projectId}`;
            const gone = yield* goneOf(holders.map((row) => row.project_id));
            yield* conflictOnUnique(
              leader.write(
                Effect.gen(function* () {
                  yield* lockProject(sql, projectId);
                  const held = yield* heldOf(sql, projectId);
                  yield* allowed(userId, "move", moveTarget(projectId, held, kind, target), view);
                  if (isMateKind(kind)) {
                    const mates = yield* sql`SELECT 1 FROM hq_mate WHERE project_id = ${projectId}`;
                    if (mates.length === 0) {
                      return yield* refuse("invalid", "mate_record_missing");
                    }
                  }
                  const apps = yield* sql`
                    SELECT 1 FROM hq_app WHERE id::text = ${appId} FOR NO KEY UPDATE`;
                  if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
                  // Its environment stays only where the project stays: moved anywhere else, it
                  // is recorded anew there.
                  const stays = yield* sql`
                    SELECT 1 FROM hq_app_project
                    WHERE project_id = ${projectId} AND app_id::text = ${appId} AND kind = ${kind}`;
                  if (stays.length === 0) {
                    yield* sql`DELETE FROM hq_environment WHERE project_id = ${projectId}`;
                  }
                  const replaced = (yield* environmentRows(gone)).find((row) => row.tier === tier);
                  yield* dropRows(gone);
                  const placed = yield* sql`
                    INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
                    VALUES (${projectId}, ${appId}::uuid, ${kind}, ${userId})
                    ON CONFLICT (project_id)
                    DO UPDATE SET app_id = EXCLUDED.app_id, kind = EXCLUDED.kind
                    WHERE hq_app_project.kind = ${held}
                    RETURNING 1`;
                  if (placed.length === 0) return yield* refuse("conflict", "held_changed");
                  if (tier !== undefined && stays.length === 0) {
                    yield* recordEnvironment({
                      projectId,
                      appId,
                      tier,
                      userId,
                      name: undefined,
                      projectName:
                        view.projects.find((project) => project.id === projectId)?.name ?? "",
                      replaced,
                    });
                  }
                }),
              ),
              "production_taken",
            );
            yield* changedAsking;
            yield* PubSub.publish(mateChanged, projectId);
            return { projectId, appId, kind };
          }),
        ),

        recordBirth: confirmed((userId, birth) =>
          Effect.gen(function* () {
            if (!fitsFace(birth.face)) return yield* refuse("invalid", "face_length");
            const view = yield* roles.forWrite;
            const rows = yield* leader.write(
              Effect.gen(function* () {
                // Locked as an attach locks it: a delete of the application waits, or went first.
                const apps = yield* sql`
                  SELECT 1 FROM hq_app WHERE id::text = ${birth.appId} FOR NO KEY UPDATE`;
                if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
                const appProjects = yield* sql<{ readonly project_id: string }>`
                  SELECT project_id FROM hq_app_project WHERE app_id::text = ${birth.appId}`;
                yield* allowed(
                  userId,
                  "read_app",
                  { projectIds: appProjects.map((row) => row.project_id) },
                  view,
                );
                // Theirs a week old never got its attach: it goes with this one's write.
                yield* sql`
                  DELETE FROM hq_birth_intent
                  WHERE made_by = ${userId} AND project_id IS NULL AND created_at < now() - interval '7 days'`;
                return yield* sql<{ readonly id: string }>`
                  INSERT INTO hq_birth_intent (app_id, face, made_by, standup)
                  VALUES (${birth.appId}::uuid, ${birth.face}, ${userId},
                    ${birth.standUp === true})
                  RETURNING id::text AS id`;
              }),
            );
            yield* changed;
            return { id: rows[0]!.id, face: birth.face };
          }),
        ),

        bindBirth: confirmed((userId, birthId, projectId) =>
          Effect.gen(function* () {
            const view = yield* roles.forWrite;
            yield* leader.write(
              Effect.gen(function* () {
                const births = yield* sql<{
                  readonly app_id: string;
                  readonly project_id: string | null;
                }>`
                SELECT app_id::text AS app_id, project_id FROM hq_birth_intent
                WHERE id::text = ${birthId} AND (made_by = ${userId} OR project_id = ${projectId}) FOR UPDATE`;
                const birth = births[0];
                if (birth === undefined) return yield* refuse("invalid", "birth_not_found");
                if (birth.project_id !== null && birth.project_id !== projectId)
                  return yield* refuse("conflict", "birth_project_taken");
                const projects = yield* sql<{ readonly project_id: string }>`
                SELECT project_id FROM hq_app_project WHERE app_id::text = ${birth.app_id}`;
                yield* allowed(
                  userId,
                  "attach",
                  {
                    projectId,
                    held: yield* heldOf(sql, projectId),
                    to: "mate",
                    appProjectIds: projects.map((row) => row.project_id),
                    slotTaken: false,
                  },
                  view,
                );
                yield* sql`UPDATE hq_birth_intent SET project_id = ${projectId} WHERE id::text = ${birthId}`;
              }),
            );
            yield* changed;
          }),
        ),

        createMate: confirmed((userId, mate) =>
          Effect.gen(function* () {
            if (mate.face.length < 1 || !fitsFace(mate.face)) {
              return yield* refuse("invalid", "face_length");
            }
            if (mate.projectId === options.hqProjectId) {
              return yield* refuse("invalid", "hq_project");
            }
            const view = yield* roles.forWrite;
            yield* conflictOnUnique(
              leader.write(
                Effect.gen(function* () {
                  // Held as decided until this write ends: a placement of the project waits.
                  yield* lockProject(sql, mate.projectId);
                  const held = yield* heldOf(sql, mate.projectId);
                  yield* allowed(
                    userId,
                    "create_mate_record",
                    { projectId: mate.projectId, held },
                    view,
                  );
                  yield* sql`
                    INSERT INTO hq_mate (project_id, face, made_by, standup_requested_by, service_id)
                    VALUES (${mate.projectId}, ${mate.face}, ${userId},
                      ${mate.standUp === true ? userId : null}, ${mate.serviceId ?? null})`;
                }),
              ),
              "mate_record_exists",
            );
            yield* changed;
            yield* PubSub.publish(mateChanged, mate.projectId);
            return { projectId: mate.projectId, face: mate.face };
          }),
        ),

        patchMate: confirmed((userId, projectId, patch) =>
          Effect.gen(function* () {
            if (!fitsFace(patch.face)) return yield* refuse("invalid", "face_length");
            const view = yield* roles.forWrite;
            const rows = yield* leader.write(
              Effect.gen(function* () {
                const held = yield* heldOf(sql, projectId);
                yield* allowed(userId, "edit_mate_record", { projectId, held }, view);
                return yield* sql<{ readonly face: string }>`
                  UPDATE hq_mate SET face = ${patch.face} WHERE project_id = ${projectId}
                  RETURNING face`;
              }),
            );
            if (rows[0] === undefined) return yield* refuse("mate_not_found", "mate_not_found");
            yield* changed;
            yield* PubSub.publish(mateChanged, projectId);
            return { projectId, ...rows[0] };
          }),
        ),

        read: (userId) =>
          Effect.gen(function* () {
            const view = yield* roles.view;
            const apps = yield* sql<{
              readonly id: string;
              readonly name: string;
              readonly empty: boolean;
            }>`
              SELECT a.id::text AS id, a.name, NOT (${appHeld}) AS empty FROM hq_app a ORDER BY a.seq`;
            const births = yield* sql<BirthIntent & { readonly app_id: string }>`
              SELECT id::text AS id, app_id::text AS app_id, face, project_id AS "projectId"
              FROM hq_birth_intent ORDER BY seq`;
            const rows = yield* sql<{
              readonly project_id: string;
              readonly app_id: string;
              readonly kind: string;
              readonly mate: MateView | null;
            }>`
              SELECT p.project_id, p.app_id::text AS app_id, p.kind,
                     CASE WHEN m.project_id IS NULL THEN NULL ELSE jsonb_build_object(
                       'face', m.face, 'madeBy', m.made_by,
                       'standupRequestedBy', m.standup_requested_by,
                       'closedOff', m.closed_off_at IS NOT NULL,
                       'keyWider', m.key_wider_token_id IS NOT NULL) || CASE WHEN m.birth_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('birthId', m.birth_id::text) END || CASE WHEN m.signers = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('signers', m.signers) END END AS mate
              FROM hq_app_project p LEFT JOIN hq_mate m USING (project_id)
              ORDER BY p.seq`;
            const alone = yield* sql<{
              readonly project_id: string;
              readonly mate: MateView;
            }>`
              SELECT m.project_id, jsonb_build_object(
                       'face', m.face, 'madeBy', m.made_by,
                       'standupRequestedBy', m.standup_requested_by,
                       'closedOff', m.closed_off_at IS NOT NULL,
                       'keyWider', m.key_wider_token_id IS NOT NULL) || CASE WHEN m.birth_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('birthId', m.birth_id::text) END || CASE WHEN m.signers = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('signers', m.signers) END AS mate
              FROM hq_mate m
              WHERE NOT EXISTS (SELECT 1 FROM hq_app_project p WHERE p.project_id = m.project_id)
              ORDER BY m.seq`;
            const presses = yield* sql<PressRow>`
              SELECT project_id, kind, app_id::text AS app_id, import_process_id,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (until - now())) * 1000))::int AS held_for_ms,
                to_char(until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS until
              FROM hq_press ORDER BY project_id`;
            const tools = yield* sql<{ readonly projectId: string; readonly kind: "gitea" }>`
              SELECT project_id AS "projectId", kind FROM hq_tool ORDER BY project_id`;
            const environments = yield* sql<{
              readonly project_id: string;
              readonly app_id: string;
              readonly tier: "stage" | "production";
              readonly name: string;
              readonly sources: ReadonlyArray<string>;
              readonly order: number;
              readonly key_held: boolean;
              readonly key_invalid: boolean;
            }>`
              SELECT e.project_id, e.app_id::text AS app_id, e.tier, e.name, e.sources,
                     (rank() OVER (PARTITION BY e.app_id ORDER BY e.declared_seq))::int AS "order",
                     t.project_id IS NOT NULL AS key_held,
                     t.invalid_since IS NOT NULL AS key_invalid
              FROM hq_environment e LEFT JOIN hq_deploy_token t USING (project_id)
              ORDER BY e.declared_seq`;
            const iso = (column: string) =>
              `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
            const jobs = yield* sql<{
              readonly project_id: string;
              readonly id: string;
              readonly kind: JobView["kind"];
              readonly service: string | null;
              readonly sha: string | null;
              readonly state: JobView["state"];
              readonly cause: JobView["cause"];
              readonly ref: string | null;
              readonly reason: string | null;
              readonly app_version_id: string | null;
              readonly process_id: string | null;
              readonly requested_by: string | null;
              readonly at: string;
              readonly ended_at: string | null;
              readonly superseded_by: string | null;
            }>`
              WITH ranked AS (
                SELECT j.*,
                       row_number() OVER (PARTITION BY j.project_id ORDER BY j.id DESC) AS place,
                       row_number() OVER (
                         PARTITION BY j.project_id, j.service, j.state = 'live'
                         ORDER BY j.ended_at DESC NULLS LAST, j.id DESC
                       ) AS live_place
                FROM hq_deploy_job j
              )
              SELECT j.project_id, j.id::text AS id, j.kind, j.service, j.sha, j.state, r.cause,
                     CASE r.cause WHEN 'merge' THEN r.sha WHEN 'release' THEN r.tag END AS ref,
                     j.reason,
                     j.app_version_id, j.process_id, j.requested_by,
                     ${sql.literal(iso("j.created_at"))} AS at,
                     ${sql.literal(iso("j.ended_at"))} AS ended_at,
                     j.superseded_by::text AS superseded_by
              FROM ranked j JOIN hq_rollout r ON r.id = j.rollout_id
              WHERE j.place <= ${JOBS_SHOWN}
                 OR (j.kind = 'deploy' AND j.state = 'live' AND j.live_place = 1)
              ORDER BY j.project_id, j.id DESC`;
            // Each production's newest release, as its rollout stands there: ended once every job
            // it asked for there ended, and every job of a commit it left out as under way there.
            // Each production's newest release by version made since its release floor, as its rollout stands there: ended once
            // every job it asked for there ended, and every job of a commit it left out as under way
            // there; landed where each of those went live and its plan said nothing it could not do.
            // A release with no rollout of its own — made before rollouts were, recorded from git,
            // or a snapshot — deploys nothing more: ended as it was made.
            const rollouts = yield* sql<{
              readonly project_id: string;
              readonly id: string | null;
              readonly tag: string;
              readonly planned: boolean;
              readonly ended: boolean;
              readonly ended_at: string | null;
              readonly landed: boolean;
              readonly left_out: ReleaseRollout["leftOut"];
            }>`
              WITH newest AS (
                SELECT DISTINCT ON (e.project_id) e.project_id, h.app_id, h.tag, h.released_at
                FROM hq_environment e
                JOIN hq_release h ON h.app_id = e.app_id AND h.state = 'approved'
                  AND (e.release_floor IS NULL OR h.released_at >= e.release_floor)
                WHERE e.tier = 'production'
                ORDER BY e.project_id,
                  string_to_array(substr(h.tag, 2), '.')::numeric[] DESC
              ),
              rollout AS (
                SELECT DISTINCT ON (r.app_id, r.tag)
                  r.app_id, r.tag, r.id, r.planned_at, r.note, r.left_out
                FROM hq_rollout r
                WHERE r.cause = 'release' AND EXISTS (
                  SELECT 1 FROM newest n WHERE n.app_id = r.app_id AND n.tag = r.tag)
                ORDER BY r.app_id, r.tag, r.id DESC
              ),
              left_out AS (
                SELECT r.id AS rollout_id, l.project_id, l.service, l.sha, l.job, l.reason
                FROM rollout r,
                     jsonb_to_recordset(r.left_out)
                       AS l(project_id text, service text, sha text, job text, reason text)
              ),
              ends AS (
                SELECT j.rollout_id, j.project_id, j.state, j.ended_at
                FROM hq_deploy_job j JOIN rollout r ON r.id = j.rollout_id
                UNION ALL
                SELECT l.rollout_id, l.project_id, j.state, j.ended_at
                FROM left_out l JOIN hq_deploy_job j ON j.id = l.job::bigint
              ),
              standing AS (
                SELECT e.project_id, n.tag, n.released_at, r.id, r.planned_at, r.note,
                       r.id IS NULL OR (r.planned_at IS NOT NULL AND NOT EXISTS (
                         SELECT 1 FROM ends x
                         WHERE x.rollout_id = r.id AND x.project_id = e.project_id
                           AND x.ended_at IS NULL)) AS ended,
                       r.id IS NOT NULL AND r.planned_at IS NOT NULL AND r.note IS NULL
                         AND NOT EXISTS (
                           SELECT 1 FROM ends x
                           WHERE x.rollout_id = r.id AND x.project_id = e.project_id
                             AND x.state <> 'live') AS landed,
                       (SELECT max(x.ended_at) FROM ends x
                        WHERE x.rollout_id = r.id AND x.project_id = e.project_id) AS last_ended
                FROM newest n
                JOIN hq_environment e ON e.project_id = n.project_id
                LEFT JOIN rollout r ON r.app_id = n.app_id AND r.tag = n.tag
              )
              SELECT s.project_id, s.id::text AS id, s.tag,
                     s.id IS NULL OR s.planned_at IS NOT NULL AS planned,
                     s.ended, s.landed,
                     CASE WHEN s.ended
                       THEN ${sql.literal(
                         iso("COALESCE(GREATEST(s.planned_at, s.last_ended), s.released_at)"),
                       )} END
                       AS ended_at,
                     COALESCE((
                       SELECT jsonb_agg(jsonb_build_object('service', l.service, 'sha', l.sha,
                                'job', l.job, 'reason', l.reason))
                       FROM left_out l
                       WHERE l.rollout_id = s.id AND l.project_id = s.project_id
                     ), '[]'::jsonb) AS left_out
              FROM standing s`;
            const releaseOf = (projectId: string): ReleaseRollout | null => {
              const row = rollouts.find((rollout) => rollout.project_id === projectId);
              return row === undefined
                ? null
                : {
                    id: row.id,
                    tag: row.tag,
                    planned: row.planned,
                    ended: row.ended,
                    endedAt: row.ended_at,
                    landed: row.landed,
                    leftOut: row.left_out,
                  };
            };
            const born = yield* environmentBirths(sql);
            const birthOf = (projectId: string): EnvironmentBirth | null =>
              born.get(projectId) ?? null;
            const environmentView = (row: (typeof environments)[number]): EnvironmentView => ({
              projectId: row.project_id,
              tier: row.tier,
              name: row.name,
              sources: row.sources,
              order: row.order,
              keyHeld: row.key_held,
              keyInvalid: row.key_invalid,
              jobs: jobs
                .filter((job) => job.project_id === row.project_id)
                .map((job): JobView => ({
                  id: job.id,
                  kind: job.kind,
                  service: job.service,
                  sha: job.sha,
                  state: job.state,
                  cause: job.cause,
                  ref: job.ref,
                  reason: job.reason,
                  appVersionId: job.app_version_id,
                  processId: job.process_id,
                  requestedBy: job.requested_by,
                  at: job.at,
                  endedAt: job.ended_at,
                  supersededBy: job.superseded_by,
                })),
              release: releaseOf(row.project_id),
              birth: birthOf(row.project_id),
            });
            const names = new Map(view.projects.map((project) => [project.id, project.name]));
            const projects = new Map(view.projects.map((project) => [project.id, project]));
            const person = { kind: "person", userId } as const;
            const reads = (projectId: string) =>
              can(person, "read_project", { projectId }, view).allow;
            const visible = rows.filter((row) => reads(row.project_id));
            const placed = apps.map((app) => ({
              id: app.id,
              projects: rows.filter((row) => row.app_id === app.id),
            }));
            /** What the reader may do with a Mate held as `held`, and where it may go. */
            const mateCan = (projectId: string, held: string, recorded: boolean) => ({
              can: mateOffers(userId, projectId, held, view),
              moveTo: moveOffers(userId, { projectId, held, recorded }, placed, view),
            });
            const held = new Set([
              options.hqProjectId,
              ...rows.map((row) => row.project_id),
              ...alone.map((row) => row.project_id),
            ]);
            return {
              can: orgOffers(userId, view),
              unheld: Object.fromEntries(
                view.projects
                  .filter((project) => !held.has(project.id) && reads(project.id))
                  .map((project) => [project.id, recordOffers(userId, project.id, view)]),
              ),
              presses: Object.fromEntries(
                presses
                  .filter((row) => reads(row.project_id))
                  .map((row) => [row.project_id, pressView(row)]),
              ),
              ...(tools.length === 0
                ? {}
                : { tools: tools.filter((tool) => reads(tool.projectId)) }),
              ungrouped: alone
                .filter((row) => reads(row.project_id))
                .map((row) => ({
                  projectId: row.project_id,
                  name: names.get(row.project_id) ?? "",
                  mate: row.mate,
                  ...mateCan(row.project_id, "mate", true),
                })),
              apps: apps
                .map((app) => {
                  const held = rows.filter((row) => row.app_id === app.id);
                  const can = appOffers(userId, held, view);
                  return {
                    id: app.id,
                    name: app.name,
                    can,
                    contents: {
                      // The app row and the project rows are separate reads: a project attached
                      // between them is in `rows`, so the app is held whatever its row said.
                      empty: app.empty && !rows.some((row) => row.app_id === app.id),
                      deletingProjectIds: rows
                        .filter(
                          (row) =>
                            row.app_id === app.id &&
                            (projects.get(row.project_id) === undefined ||
                              projects.get(row.project_id)?.status === "DELETING" ||
                              projects.get(row.project_id)?.status === "DELETED"),
                        )
                        .map((row) => row.project_id),
                    },
                    projects: visible
                      .filter((row) => row.app_id === app.id)
                      .map((row) => ({
                        projectId: row.project_id,
                        name: names.get(row.project_id) ?? "",
                        kind: row.kind,
                        mate: row.mate,
                        ...(isMateKind(row.kind)
                          ? mateCan(row.project_id, row.kind, row.mate !== null)
                          : {}),
                      })),
                    environments: can.read_change.allow
                      ? environments
                          .filter((row) => row.app_id === app.id)
                          .map((row) => ({
                            ...environmentView(row),
                            can: environmentOffers(userId, row.project_id, view),
                          }))
                      : { refused: can.read_change.reason },
                    births: births
                      .filter((row) => row.app_id === app.id)
                      .map(({ id, face, projectId }) => ({
                        id,
                        face,
                        ...(projectId == null ? {} : { projectId }),
                      })),
                  };
                })
                .filter(
                  (app) =>
                    can(
                      person,
                      "read_app",
                      { projectIds: app.projects.map((project) => project.projectId) },
                      view,
                    ).allow,
                ),
            };
          }),
      });
    }),
  );
