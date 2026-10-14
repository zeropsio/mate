import type { HqGitTargetIntent, HqGitOperationReceipt } from "@t3tools/shared/hqGitTargets";
import { HqDeliveryAnswer } from "@t3tools/shared/hqDeploys";
import { keepGitReceipt, readGitReceipt, type GitRequestRefused } from "./gitTargetReceipts.ts";
// @effect-diagnostics nodeBuiltinImport:off -- a commit's archive comes from git as a Node stream;
// a tier's digest is the system's SHA-256.
/**
 * Deploying an application's stage and production environments (SPEC §3.2b, §3.2d), where main's
 * broker and each repository's workflow did it (main B, C), as explicit jobs (the deploy-jobs
 * design): every deploy is asked for by an event, submitted once, in the request that asked, and
 * ends visibly. Nothing deploys on a timer, and nothing is tried twice.
 *
 * - **Who asks** (`rollouts.ts`): a merge that moved `main` of one of an application's
 *   repositories — every stage environment that follows `main` gets the services its stage tier
 *   builds from it (`tierRuntimes.ts`, main B10/B11) at that commit, named `main <7 hex>`
 *   (B15/B16); a merge into the recipe repository adds, first, the services its tier change added
 *   (main D15, audit D2). A release — every production environment gets each service its
 *   production tier builds at the commit the release lists (C15/C16), named `<tag> <7 hex>`. An
 *   environment added, and a deploy key kept for one, ask for what the environment is wanted at
 *   now: a stage the head of `main`, a production the newest release made since it was attached. A person's Run again asks for
 *   one deploy again, and Add service for one service the tier declares. Nothing else asks.
 * - **The request that asked runs it** (`run`): its rollout planned into jobs once, then each of its
 *   environments' next job submitted where none builds, and it answers where each job stands
 *   (`@t3tools/shared/hqDeploys`). A rollout no request runs — a merge Core landed, a move found
 *   at takeover — is run by the leading Core the same way.
 * - **One job per environment, service and commit**, and none where a job of the commit is under
 *   way or HQ last made the service run it: the answer says so. A job made only to say why HQ will
 *   not submit it is `skipped` — the commit has no `zerops.yaml` carrying the tier's setup (F17,
 *   main #162: a stage's first deploy waits for code), or its build failed there and no person
 *   asked again (B37). A newer job of a service supersedes one still waiting; one HQ submitted runs
 *   to its own end (B20).
 * - **One build at a time per environment**: queued → submitting → building → live | failed |
 *   refused | skipped | superseded, in the order asked, higher priority first (B19); what waits
 *   behind a build is submitted once it ends. A job is submitted once: whatever does not go through
 *   — Zerops not answering, git failing, the service not there, a key missing, dead or widened —
 *   ends it refused at once, in HQ's words, for a person's Run again.
 * - **A build is submitted once** (audit H6): Zerops takes no idempotency key, so the version HQ
 *   makes is recorded before its archive goes up, its upload once it answered — only then is its
 *   build asked for — and its build's process once build-and-deploy answers. A lost answer is
 *   never submitted again: the job stays submitting and HQ reads the version it made. A build is followed by its process, else its version (`follow`): Zerops'
 *   live updates carry terminal states under HQ's org token. After a gap HQ registers again and
 *   reads its original handles. Lost access ends unresolved, with a person acting next.
 * - **Live is what runs**: a deploy is live once the service runs the version HQ made for it (B17),
 *   as HQ recorded it — never what a version's name spells (audit N7). A service running what HQ
 *   last made it run at a commit is live at once, building nothing. An HTTP service created for HQ
 *   to deploy — by the person's client, which said so at the attach, or by HQ's own recipe delta —
 *   gets its subdomain once its first deploy is live, with the same token (E13, measured 2026-10-02
 *   — HQ's org Read only token may not), and on no other (audit R1, D6).
 * - **A tier change adds what it added** (main D15, audit D2): a merge into the recipe repository
 *   gives every environment of a tier whose import file changed a `delta` job carrying the services
 *   declared now and not in the tier as the recipe merge before left it; it imports those the
 *   project lacks, created empty where HQ deploys them (`recipeDeltas.ts`), follows the import's
 *   own processes to their end, and only then asks for their deploys. A service a person deleted is never imported again but by Add service. A changed
 *   declaration of a service the project has is reported, never applied; a service the tier no
 *   longer declares is reported, never deleted. A tier first seen is the one its environments were
 *   made from, and imports nothing (D16).
 * - **Only the leading Core deploys**: at takeover it follows the builds its records hold, ends a
 *   submission whose version it never heard, submits what waits, and plans the rollouts no Core
 *   planned — nothing else.
 *
 * A deploy's job is per environment, service and commit (`hq_deploy_job`); the hostname names it,
 * the service's id says whose it is (audit N6). The deploy token never leaves Core: no record, log
 * or error carries it. It is kept sealed under HQ's key (`deployKeys.ts`) and opened only as a job
 * is submitted or followed.
 *
 * @module deploys
 */
import * as NodeCrypto from "node:crypto";
import type * as NodeStream from "node:stream";

import type { HqGit } from "@t3tools/hq-git";
import {
  type HqDeliveryAnswer as HqDeployAnswer,
  type HqDeliveryOutcome as HqDeployOutcome,
  NO_DEPLOYS,
  zeropsDidNotAnswer,
} from "@t3tools/shared/hqDeploys";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import { REASONS } from "@t3tools/shared/zeropsPermissions";
import { can } from "./permissions.ts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type * as Statement from "effect/sql/Statement";

import {
  makeOperationWatch,
  operationBackoff,
  type OperationError,
  OperationObserver,
  type OperationWatch,
  type OperationSignal,
  type ProcessEvidence,
} from "./operationWatch.ts";
import { makeOperationWire } from "./operationWire.ts";
import { evidenceOf, stepOf, encodeEvidence, encodePhase, operationRecords } from "./operations.ts";
import { DeployKeys } from "./deployKeys.ts";
import {
  deadDeployToken,
  noDeployToken,
  noKeySecret,
  reachesOnly,
  unopenedDeployToken,
  widenedDeployToken,
} from "./deployTokens.ts";
import { GitHost } from "./gitHost.ts";
import { GitPush, gitPushLayer, type PushEvidence, pushEvidenceForWire } from "./gitPush.ts";
import { changesLayer } from "./changes.ts";
import { repoRemotesLayer } from "./repoRemotes.ts";
import { githubProbesLayer } from "./githubProbes.ts";
import { gitTransportLayer } from "./gitTransport.ts";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Leader, type NotLeader } from "./leader.ts";
import { type TierService, deltaImport, deployedByHq, tierServices } from "./recipeDeltas.ts";
import { RecipeTiers } from "./recipeTiers.ts";
import { Releases, tierCommitOf } from "./releases.ts";
import { Roles, decidedFresh } from "./roles.ts";
import { type RolloutCause, Rollouts, rolloutOf } from "./rollouts.ts";
import { tierRuntimes } from "./tierRuntimes.ts";
import { versionName } from "./versionNames.ts";
import {
  ZeropsApi,
  ZeropsDeploy,
  type ZeropsError,
  ZeropsRefused,
  type ZeropsService,
} from "./zerops/api.ts";

export interface DeploysOptions {
  /** A scoped observer; production uses HQ_ORG_TOKEN and HQ_ZEROPS_API. */
  readonly observer?: OperationWatch;
  /** How long a release waits for a part HQ starts before asking its deploy; two minutes. */
  readonly startWait?: Duration.Duration;
  /** External delivery boundary fixtures use the production GitPush with disposable custody. */
  readonly pushLayer?: Layer.Layer<
    GitPush,
    never,
    GitHost | Leader | SqlClient.SqlClient | Roles | DeployKeys
  >;
}

/** A person's ask HQ refused: a code, and the reason (a permission's, or the deploy's own). */
const decodeDeliveryAnswer = Schema.decodeUnknownEffect(HqDeliveryAnswer);

export class DeployRefused extends Schema.TaggedError<DeployRefused>()("DeployRefused", {
  code: Schema.Literals(["forbidden", "environment_not_found", "deploy_not_found", "conflict"]),
  reason: Schema.Literals([
    ...REASONS,
    "environment_not_found",
    "deploy_not_found",
    "deploy_running",
    "deploy_superseded",
    "service_not_declared",
  ]),
}) {}

export class Deploys extends Context.Service<
  Deploys,
  {
    /**
     * The rollout `rolloutId` run now: planned into its jobs once, each of its environments' next
     * job submitted where none builds, and where every job it asked for stands.
     */
    readonly runGitAgain: (
      userId: string,
      requestId: string,
      intent: Extract<HqGitTargetIntent, { readonly kind: "run-git-again" }>,
    ) => Effect.Effect<
      HqGitOperationReceipt,
      DeployRefused | NotLeader | SqlError | ZeropsError | GitRequestRefused
    >;
    readonly gitReceipt: (
      userId: string,
      requestId: string,
      intent: HqGitTargetIntent,
    ) => Effect.Effect<
      HqGitOperationReceipt | null,
      DeployRefused | SqlError | ZeropsError | GitRequestRefused
    >;
    readonly run: (rolloutId: string) => Effect.Effect<HqDeployAnswer, NotLeader | SqlError>;
    /** The rollout `event` wrote, run; nothing where it wrote none. */
    readonly runOf: (event: RolloutCause) => Effect.Effect<HqDeployAnswer, NotLeader | SqlError>;
    /**
     * A person's "Run again" (main B36) of the newest deploy of `service` at `sha` in the
     * application's environment `name`, ended — failed, its build's own failure included, which
     * only a person may ask for again (B37), refused, skipped, or live, where its service runs
     * something else now: by whoever develops the application (`redeploy`). A new job, saying who
     * asked, run.
     */
    readonly redeploy: (
      userId: string,
      appId: string,
      name: string,
      service: string,
      sha: string,
    ) => Effect.Effect<HqDeployAnswer, DeployRefused | NotLeader | SqlError | ZeropsError>;
    /**
     * A person's "Add <service>" (audit D2): a service the environment's tier declares, imported
     * into its project — never by HQ alone once a person deleted it — and deployed; by whoever may
     * Run again. A delta of that one service, run.
     */
    readonly addService: (
      userId: string,
      appId: string,
      name: string,
      service: string,
    ) => Effect.Effect<HqDeployAnswer, DeployRefused | NotLeader | SqlError | ZeropsError>;
    /** Ticks after every change of a job, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
    /** Joins the environment workers already admitted by a completed rollout. */
    readonly drain: Effect.Effect<void>;
    /** Lifecycle and submission share this lock; unresolved writers retain the occupied slot. */
    readonly withEnvironment: <A, E, R>(
      environmentId: string,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | DeployRefused | SqlError, R>;
    readonly writerDrained: (environmentId: string) => Effect.Effect<boolean, SqlError>;
    /** The same open job that blocks worker advancement, including an ended unresolved push. */
    readonly blocker: (
      environmentId: string,
    ) => Effect.Effect<
      | { readonly job: string; readonly state: AnyJob["state"]; readonly label: string | null }
      | undefined,
      SqlError
    >;
    /** PB operation scope: current jobs and their minimal persisted evidence. */
    readonly operations: (appId: string) => ReturnType<typeof operationRecords>;
  }
>()("@t3tools/hq/deploys") {}

/** A commit a service of an environment is wanted at. */
interface Target {
  readonly service: string;
  readonly repo: string;
  readonly sha: string;
  /** What its version is named by: `main`, or the release's tag; none where HQ no longer knows. */
  readonly label: string | null;
  /** Its place among the tier's runtimes: higher priority first (B19). */
  readonly ord: number;
}

/** An environment HQ deploys. */
type Environment = {
  readonly id: string;
  readonly app_id: string;
  readonly name: string;
  readonly tier: "stage" | "production";
  readonly sources: ReadonlyArray<string>;
  readonly created_at: string;
} & (
  | { readonly target: "zerops"; readonly project_id: string; readonly branch: null }
  | { readonly target: "git"; readonly project_id: null; readonly branch: string }
);

type Cause =
  | "merge"
  | "release"
  | "run_again"
  | "add_service"
  | "env_added"
  | "key_kept"
  | "import"
  | "migrated";

/** A rollout as its row holds it. */
interface Rollout {
  readonly environment_id: string | null;
  readonly id: string;
  readonly app_id: string;
  readonly cause: Cause;
  readonly repo: string | null;
  readonly sha: string | null;
  readonly tag: string | null;
  readonly by: string | null;
  readonly planned: boolean;
  readonly created_at: string;
  readonly environment_created_at: string | null;
}

/** A service a rollout asked nothing for, and why (`hq_rollout.left_out`). */
interface LeftOut {
  readonly environment_id: string;
  readonly project_id: string | null;
  readonly service: string;
  readonly sha: string;
  readonly kind?: "push";
  /** The job of the commit under way, where one is. */
  readonly job: string | null;
  readonly reason: string;
}

/** A job not ended, with its environment and what asked for it. */
interface Job {
  readonly environment_id: string;
  readonly id: string;
  readonly rollout_id: string;
  readonly kind: "deploy" | "delta";
  readonly project_id: string;
  readonly app_id: string;
  readonly env_name: string;
  readonly tier: "stage" | "production";
  readonly service: string | null;
  readonly service_id: string | null;
  readonly repo: string | null;
  readonly sha: string | null;
  readonly label: string | null;
  /** A delta's: the services it imports, and its import's processes once Zerops answered it. */
  readonly services: ReadonlyArray<string> | null;
  readonly processes: ReadonlyArray<string> | null;
  readonly state: "queued" | "submitting" | "building";
  readonly app_version_id: string | null;
  readonly process_id: string | null;
  readonly cause: Cause;
  readonly by: string | null;
  /** Whether HQ recorded an answered archive upload before asking for its build. */
  readonly uploaded: boolean;
  /** Whether this job was made after HQ began recording uploads. */
  readonly upload_recorded: boolean;
}

type GitJob = Omit<Job, "kind" | "project_id" | "service" | "repo" | "sha" | "state"> & {
  readonly kind: "push";
  readonly project_id: null;
  readonly service: null;
  readonly repo: string;
  readonly sha: string;
  readonly state: "queued" | "submitting" | "unresolved";
};
type AnyJob = Job | GitJob;
type DeployJob = Job & { readonly service: string; readonly repo: string; readonly sha: string };

/** How a job ended. */
type Stopped = {
  readonly state: "failed" | "refused" | "unresolved" | "skipped";
  readonly reason: string;
};
type Ended = { readonly state: "live"; readonly reason?: string } | Stopped;

const failed = (reason: string): Stopped => ({
  state: "failed",
  reason,
});
const refused = (reason: string): Ended => ({ state: "refused", reason });
const unresolved = (reason: string): Stopped => ({
  state: "unresolved",
  reason: `${reason}; a person must inspect the original handle in Zerops`,
});
const skipped = (reason: string): Ended => ({ state: "skipped", reason });

const IN_FLIGHT: ReadonlySet<string> = new Set(["queued", "submitting", "building"]);

const encodeBlocks = Schema.encodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);
const LeftOutJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      project_id: Schema.NullOr(Schema.String),
      kind: Schema.optionalKey(Schema.Literal("push")),
      environment_id: Schema.String,
      service: Schema.String,
      sha: Schema.String,
      job: Schema.NullOr(Schema.String),
      reason: Schema.String,
    }),
  ),
);
const encodeLeftOut = Schema.encodeSync(LeftOutJson);
const encodeNames = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

/** A job's words are at most 240 characters (main B27). */
const cut = (message: string) => (message.length <= 240 ? message : `${message.slice(0, 239)}…`);

/** The largest commit archive HQ deploys: it is held whole while it uploads. */
const ARCHIVE_MAX = 512 * 1024 * 1024;
/** The largest `zerops.yaml` HQ reads. */
const YAML_MAX = 1024 * 1024;
/** The names zcli looks for, in its order. */
const YAML_NAMES = ["zerops.yaml", "zerops.yml"] as const;

/** The setups a `zerops.yaml` carries; `undefined` where it does not read as one. */
const setupsOf = (content: string) => {
  const decoded = decodeSetups(content);
  return Exit.isSuccess(decoded) ? decoded.value.zerops.map((entry) => entry.setup) : undefined;
};
const decodeSetups = Schema.decodeUnknownExit(
  fromYaml(Schema.Struct({ zerops: Schema.Array(Schema.Struct({ setup: Schema.String })) })),
);

const short = (sha: string) => sha.slice(0, 7);

/** The statuses a version's build or deploy ends badly in (the SDK's `AppVersionStatusEnum`). */
const VERSION_FAILURES: ReadonlySet<string> = new Set([
  "BUILD_FAILED",
  "BUILD_VALIDATION_FAILED",
  "PREPARING_RUNTIME_FAILED",
  "DEPLOY_FAILED",
  "CANCELLED",
]);

/** How a Zerops failure ends a job: a no to the deploy itself is its failure; any other, refused. */
const zeropsEnd = (envName: string, error: ZeropsError): Ended => {
  if (error._tag === "ZeropsUnavailable") return refused(zeropsDidNotAnswer(error.message));
  switch (error.reason) {
    case "invalid":
      return failed(`Zerops refused the deploy: ${error.code}`);
    case "not_found":
      return refused(`Zerops no longer has what the deploy names: ${error.code}`);
    default:
      return refused(`${envName}'s deploy token was refused: ${error.code}`);
  }
};

/** A Node stream read whole, unless it is larger than `max`. */
const readWhole = (stream: NodeStream.Readable, max: number) =>
  Effect.tryPromise({
    try: async (): Promise<Uint8Array | undefined> => {
      const chunks: Array<Uint8Array> = [];
      let size = 0;
      for await (const chunk of stream) {
        const bytes = chunk as Uint8Array;
        size += bytes.length;
        if (size > max) {
          stream.destroy();
          return undefined;
        }
        chunks.push(bytes);
      }
      const whole = new Uint8Array(size);
      let at = 0;
      for (const bytes of chunks) {
        whole.set(bytes, at);
        at += bytes.length;
      }
      return whole;
    },
    catch: () => "the archive could not be read",
  });

/** The columns a job is read by, with its environment and its rollout. */
const JOB_COLUMNS = `
  j.id::text AS id, j.rollout_id::text AS rollout_id, j.kind, j.environment_id, e.project_id,
  e.app_id::text AS app_id, e.name AS env_name, e.tier, j.service, j.service_id, j.repo, j.sha,
  j.label, j.services, j.processes, j.state, j.app_version_id, j.process_id, r.cause, r.by,
  (j.uploaded_at IS NOT NULL) AS uploaded,
  j.upload_recorded`;
const JOB_FROM = `
  hq_deploy_job j JOIN hq_environment e ON e.id = j.environment_id
  JOIN hq_rollout r ON r.id = j.rollout_id`;

export const deploysLayer = (
  options: DeploysOptions = {},
): Layer.Layer<
  Deploys,
  never,
  | DeployKeys
  | Leader
  | SqlClient.SqlClient
  | GitHost
  | Roles
  | ZeropsApi
  | ZeropsDeploy
  | RecipeTiers
  | Releases
  | Rollouts
> =>
  Layer.effect(
    Deploys,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const sql = yield* SqlClient.SqlClient;
      const gitHost = yield* GitHost;
      const gitPush = yield* GitPush;
      const zerops = yield* ZeropsApi;
      const deploy = yield* ZeropsDeploy;
      const recipes = yield* RecipeTiers;
      const roles = yield* Roles;
      const releases = yield* Releases;
      const keys = yield* DeployKeys;
      const rollouts = yield* Rollouts;
      const credential = yield* Config.option(Config.Redacted("HQ_ORG_TOKEN")).pipe(Effect.orDie);
      const baseUrl = yield* Config.String("HQ_ZEROPS_API").pipe(
        Config.withDefault("https://api.app-prg1.zerops.io/api/rest/public"),
        Effect.orDie,
      );
      const supplied = yield* Effect.serviceOption(OperationObserver);
      const observer: OperationWatch =
        options.observer ??
        Option.getOrUndefined(supplied) ??
        (Option.isSome(credential)
          ? makeOperationWatch(makeOperationWire({ baseUrl, credential: credential.value }))
          : {
              watch: () =>
                Stream.fail(
                  new ZeropsRefused({
                    operation: "observation",
                    reason: "unauthorized",
                    status: 401,
                    code: "hq_org_credential_missing",
                  }),
                ),
            });
      const startWait = options.startWait ?? Duration.minutes(2);
      const ticks = yield* SubscriptionRef.make(0);
      const tick = SubscriptionRef.update(ticks, (n) => n + 1);
      /** A list of names as a column of them holds it. */
      const textArray = (names: ReadonlyArray<string>) =>
        sql`ARRAY(SELECT jsonb_array_elements_text(${encodeNames(names)}::jsonb))`;

      /**
       * The runtimes a tier of the application builds, as its recipe's `main` declares them, or the
       * recipe commit `at` (a release's tag) — with every service it names.
       */
      const runtimesOf = (appId: string, tier: "stage" | "production", at?: string) =>
        Effect.gen(function* () {
          const read = yield* recipes.read(appId, tier, at).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(`${tier} tier unreadable`, { appId, error }),
            ),
            Effect.option,
          );
          const none = { runtimes: [], named: undefined };
          if (Option.isNone(read) || read.value.state === "absent") {
            return { ...none, note: `the ${tier} tier could not be read` };
          }
          const runtimes = tierRuntimes(read.value.importYaml, appId);
          if (!runtimes.ok) {
            yield* Effect.logWarning(`${tier} tier refused`, { appId, problem: runtimes.problem });
            return { ...none, note: `the ${tier} tier was refused: ${runtimes.problem}` };
          }
          const services = tierServices(read.value.importYaml);
          return {
            runtimes: runtimes.runtimes,
            named: services.ok
              ? new Set(services.services.map((service) => service.hostname))
              : undefined,
            note: undefined,
          };
        });

      /**
       * Each runtime's setup in a tier, as the deploy of `label` reads it: a production's from the
       * tier its release was tagged with (MODEL §9/10), a stage's from `main`.
       */
      const tierSetupsOf = (appId: string, tier: "stage" | "production", label: string | null) =>
        Effect.gen(function* () {
          const at =
            tier === "production" && label !== null
              ? yield* tierCommitOf(sql, appId, label)
              : undefined;
          return new Map(
            (yield* runtimesOf(appId, tier, at)).runtimes.map(
              (runtime) => [runtime.hostname, runtime.zeropsSetup] as const,
            ),
          );
        });

      /**
       * A stage's: each runtime at the head of its repository's `main` (B10) — only those built
       * from `merged.repo` at the commit merged there, where a merge is named: its rollout is
       * written before HQ records `main` moving.
       */
      const stageWanted = (
        appId: string,
        merged?: { readonly repo: string; readonly sha: string },
      ) =>
        Effect.gen(function* () {
          const { runtimes, note } = yield* runtimesOf(appId, "stage");
          const heads = new Map(
            (yield* sql<{ readonly name: string; readonly main_head: string | null }>`
              SELECT name, main_head FROM hq_repo WHERE app_id::text = ${appId}`).map(
              (row) => [row.name, row.main_head] as const,
            ),
          );
          const targets = runtimes.flatMap((runtime, ord): ReadonlyArray<Target> => {
            if (merged !== undefined && runtime.repo !== merged.repo) return [];
            const sha = merged?.sha ?? heads.get(runtime.repo);
            return sha === undefined || sha === null
              ? []
              : [{ service: runtime.hostname, repo: runtime.repo, sha, label: "main", ord }];
          });
          return { targets, note };
        });

      /**
       * A production's: each runtime of the tier the release `tag` was tagged with (MODEL §9/10) at
       * the commit it lists (C16), else the newest approved release's — only of a release made since
       * the production's release floor, where it has one (set when an attach or a replacement
       * creates it), so attaching one deploys nothing: none before a release, which is no failure; a
       * runtime it does not list, and a service it lists its tier does not build, are reported, and
       * the rest deploy. With what its tier names, for `tierLifecycle`.
       */
      const productionWanted = (environment: Environment, tag?: string) =>
        Effect.gen(function* () {
          const appId = environment.app_id;
          const release =
            tag === undefined
              ? yield* releases.newest(appId, environment.id)
              : yield* releaseOf(environment, tag);
          if (release === undefined) return { targets: [], note: undefined };
          const { runtimes, named, note } = yield* runtimesOf(
            appId,
            "production",
            yield* tierCommitOf(sql, appId, release.tag),
          );
          const listed = new Map(release.entries.map((entry) => [entry.service, entry.sha]));
          const unlisted = runtimes.filter((runtime) => !listed.has(runtime.hostname));
          const built = new Set(runtimes.map((runtime) => runtime.hostname));
          const gone = release.entries.filter((entry) => !built.has(entry.service));
          const notes = [
            note,
            unlisted.length > 0
              ? `${release.tag} lists no ${unlisted.map((runtime) => runtime.hostname).join(", ")}`
              : undefined,
            gone.length > 0
              ? `${release.tag}'s tier builds no ${gone.map((entry) => entry.service).join(", ")}`
              : undefined,
          ].filter((line): line is string => line !== undefined);
          const targets = runtimes.flatMap((runtime, ord): ReadonlyArray<Target> => {
            const sha = listed.get(runtime.hostname);
            return sha === undefined
              ? []
              : [{ service: runtime.hostname, repo: runtime.repo, sha, label: release.tag, ord }];
          });
          return {
            targets,
            note: notes.length === 0 ? undefined : notes.join("; "),
            tier:
              named === undefined
                ? undefined
                : { tag: release.tag, rollbackOf: release.rollbackOf, named },
          };
        });

      /**
       * The release `tag` of the production's application, as its row holds it, if made since the
       * production's release floor, where it has one; none where it is not one.
       */
      const releaseOf = (environment: Environment, tag: string) =>
        Effect.map(
          sql<{
            readonly tag: string;
            readonly entries: ReadonlyArray<{ readonly service: string; readonly sha: string }>;
            readonly rollbackOf: string | null;
          }>`
            SELECT tag, entries, rollback_of AS "rollbackOf" FROM hq_release
            WHERE app_id::text = ${environment.app_id} AND tag = ${tag} AND (
              SELECT release_floor IS NULL OR released_at >= release_floor
              FROM hq_environment WHERE id = ${environment.id})`,
          (rows) => rows[0],
        );

      const detail = (error: ZeropsError) =>
        error._tag === "ZeropsUnavailable"
          ? zeropsDidNotAnswer(error.message)
          : `Zerops refused: ${error.code}`;

      /**
       * A stage brought to its recipe's tier change (MODEL §9/8), with its environment's token, in
       * the write that plans the merge: each service the tier `dropped` is stopped, never deleted,
       * and HQ keeps that it stopped it; one HQ stopped that the tier `declared` again is started.
       * What HQ could not do, as notes.
       */
      const stageTierChange = (
        environment: Environment,
        declared: ReadonlySet<string>,
        dropped: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          const notes: Array<string> = [];
          const projectId = environment.project_id;
          if (projectId === null) return notes;
          const stoppedByHq = new Map(
            (yield* sql<{ readonly service_id: string; readonly service: string }>`
              SELECT service_id, service FROM hq_tier_stop
              WHERE environment_id = ${environment.id}`).map(
              (row) => [row.service_id, row.service] as const,
            ),
          );
          const back = [...stoppedByHq.values()].filter((service) => declared.has(service));
          if (dropped.length === 0 && back.length === 0) return notes;
          const key = yield* keyOf(projectId, environment.name);
          if (!("token" in key)) {
            if (dropped.length > 0)
              notes.push(`HQ could not stop ${dropped.join(", ")}: ${key.reason}`);
            return notes;
          }
          const read = yield* zerops.services(projectId)(key.token).pipe(Effect.result);
          if (read._tag === "Failure") {
            if (dropped.length > 0) {
              notes.push(`HQ could not stop ${dropped.join(", ")}: ${detail(read.failure)}`);
            }
            return notes;
          }
          for (const service of read.success) {
            if (service.isSystem) continue;
            if (dropped.includes(service.name) && service.status === "ACTIVE") {
              const stop = yield* deploy.stopService(service.id)(key.token).pipe(Effect.result);
              if (stop._tag === "Failure") {
                notes.push(`HQ could not stop ${service.name}: ${detail(stop.failure)}`);
                continue;
              }
              yield* sql`
                INSERT INTO hq_tier_stop (environment_id, service_id, service, rollback_to)
                VALUES (${environment.id}, ${service.id}, ${service.name}, NULL)
                ON CONFLICT DO NOTHING`;
            } else if (declared.has(service.name) && stoppedByHq.has(service.id)) {
              if (service.status === "STOPPED") {
                const start = yield* deploy.startService(service.id)(key.token).pipe(Effect.result);
                if (start._tag === "Failure") {
                  notes.push(`HQ could not start ${service.name}: ${detail(start.failure)}`);
                  continue;
                }
              }
              yield* sql`
                DELETE FROM hq_tier_stop
                WHERE environment_id = ${environment.id} AND service_id = ${service.id}`;
            }
          }
          return notes;
        });

      /**
       * A production brought to what its release's tier names (MODEL §9/8, §9/10), with its
       * environment's token, in the write that plans its release, so one plan acts: a part of the
       * application — a service one of its releases listed — the tier does not name is stopped,
       * never deleted (deleting a service is a person's act), and HQ keeps that it stopped it; a
       * stopped service `targets` deploys to is started first, and its start waited for, only where
       * HQ stopped it — never one a person stopped. Where nothing is dropped and HQ stopped nothing,
       * it asks Zerops nothing. One the project lacks (`gone`) is its deploy's to report. Each
       * stopped part's line, and what HQ started or could not do.
       */
      const tierLifecycle = (
        environment: Environment,
        tier: {
          readonly tag: string;
          readonly rollbackOf: string | null;
          readonly named: ReadonlySet<string>;
        },
        targets: ReadonlyArray<Target>,
      ) =>
        Effect.gen(function* () {
          const notes: Array<string> = [];
          const left: Array<LeftOut> = [];
          const gone = new Set<string>();
          const projectId = environment.project_id;
          if (projectId === null) return { notes, left, gone };
          const parts = yield* sql<{ readonly service: string }>`
            SELECT DISTINCT entry->>'service' AS service
            FROM hq_release, jsonb_array_elements(entries) AS entry
            WHERE app_id::text = ${environment.app_id} AND state = 'approved' AND target = 'zerops'`;
          const dropped = parts
            .map((part) => part.service)
            .filter((service) => !tier.named.has(service));
          const stoppedByHq = new Set(
            (yield* sql<{ readonly service_id: string }>`
              SELECT service_id FROM hq_tier_stop WHERE environment_id = ${environment.id}`).map(
              (row) => row.service_id,
            ),
          );
          if (dropped.length === 0 && stoppedByHq.size === 0) return { notes, left, gone };
          const listed = new Set(targets.map((target) => target.service));
          const undeclared = `the tier of ${tier.tag} does not declare it`;
          const key = yield* keyOf(projectId, environment.name);
          if (!("token" in key)) {
            if (dropped.length > 0) {
              notes.push(`HQ could not stop ${dropped.join(", ")}: ${key.reason}`);
            }
            return { notes, left, gone };
          }
          const read = yield* zerops.services(projectId)(key.token).pipe(Effect.result);
          if (read._tag === "Failure") {
            yield* Effect.logWarning("production services unread", {
              environment: environment.name,
              error: read.failure,
            });
            if (dropped.length > 0) {
              notes.push(`HQ could not stop ${dropped.join(", ")}: ${detail(read.failure)}`);
            }
            return { notes, left, gone };
          }
          // HQ's stop holds until the service runs again or is gone: a person took it back.
          const held = read.success
            .filter((service) => stoppedByHq.has(service.id) && service.status !== "ACTIVE")
            .map((service) => service.id);
          yield* sql`
            DELETE FROM hq_tier_stop
            WHERE environment_id = ${environment.id} AND NOT (service_id = ANY(${textArray(held)}))`;
          const started: Array<string> = [];
          const present = new Set(read.success.map((service) => service.name));
          for (const service of listed) if (!present.has(service)) gone.add(service);
          for (const service of read.success) {
            if (service.isSystem) continue;
            if (dropped.includes(service.name)) {
              if (service.status !== "ACTIVE" && service.status !== "STOPPED") continue;
              const stop =
                service.status === "ACTIVE"
                  ? yield* deploy.stopService(service.id)(key.token).pipe(Effect.result)
                  : undefined;
              // Why it stands is the newest release's word: a rollback's stop, a later tier's drop.
              if (stop?._tag === "Success" || held.includes(service.id)) {
                yield* sql`
                  INSERT INTO hq_tier_stop (environment_id, service_id, service, rollback_to)
                  VALUES (${environment.id}, ${service.id}, ${service.name}, ${tier.rollbackOf})
                  ON CONFLICT (environment_id, service_id) DO UPDATE
                  SET service = EXCLUDED.service, rollback_to = EXCLUDED.rollback_to`;
              }
              const [ran] = yield* sql<{ readonly sha: string }>`
                SELECT sha FROM hq_deploy_job
                WHERE environment_id = ${environment.id} AND kind = 'deploy'
                  AND service = ${service.name} AND state = 'live'
                ORDER BY ended_at DESC, id DESC LIMIT 1`;
              left.push({
                environment_id: environment.id,
                project_id: projectId,
                service: service.name,
                sha: ran?.sha ?? "",
                job: null,
                reason:
                  stop?._tag === "Failure"
                    ? `${undeclared}; HQ could not stop it: ${detail(stop.failure)}`
                    : tier.rollbackOf === null
                      ? `stopped: ${undeclared}`
                      : `stopped by rollback to ${tier.rollbackOf}: ${undeclared}`,
              });
            } else if (
              listed.has(service.name) &&
              service.status === "STOPPED" &&
              held.includes(service.id)
            ) {
              const start = yield* deploy.startService(service.id)(key.token).pipe(Effect.result);
              if (start._tag === "Failure") {
                notes.push(`HQ could not start ${service.name}: ${detail(start.failure)}`);
                continue;
              }
              yield* sql`
                DELETE FROM hq_tier_stop
                WHERE environment_id = ${environment.id} AND service_id = ${service.id}`;
              const up = yield* startedBy(projectId, start.success.processId);
              if (up === undefined) started.push(service.name);
              else notes.push(`HQ started ${service.name}, but ${up}; its deploy was asked anyway`);
            }
          }
          if (started.length > 0) notes.push(`${tier.tag} started ${started.join(", ")}`);
          return { notes, left, gone };
        });

      /**
       * A service's start, its process followed to its end for at most `startWait`, so its deploy is
       * asked of a running service: none where it finished, else what kept it.
       */
      const startedBy = (projectId: string, processId: string) =>
        observer.watch({ projectId, processIds: [processId], versionId: null }).pipe(
          Stream.map((signal) =>
            signal.phase === "live"
              ? signal.processes.find((row) => row.id === processId)
              : undefined,
          ),
          Stream.filter(
            (process): process is ProcessEvidence =>
              process !== undefined &&
              ["FINISHED", "FAILED", "CANCELED", "CANCELLED"].includes(process.status),
          ),
          Stream.runHead,
          Effect.timeoutOption(startWait),
          Effect.map((ended) => {
            const process = Option.getOrUndefined(Option.flatten(ended));
            if (process === undefined)
              return `it had not come up after ${Duration.format(startWait)}`;
            return process.status === "FINISHED"
              ? undefined
              : `its start failed: ${process.error?.message ?? process.error?.code ?? "Zerops gave no reason"}`;
          }),
          Effect.catch((error) =>
            Effect.succeed(
              `HQ could not follow its start: ${error._tag === "ZeropsRefused" ? error.code : error.message}`,
            ),
          ),
        );

      /** What an environment is wanted at now: a stage main's heads, a production its release. */
      const wantedOf = (environment: Environment) =>
        environment.target === "git"
          ? gitWanted(environment)
          : environment.tier === "stage"
            ? environment.sources.includes("main")
              ? stageWanted(environment.app_id)
              : Effect.succeed({ targets: [], note: undefined })
            : productionWanted(environment);

      /** Git targets read frozen release entries or repository heads, never a Zerops recipe. */
      const gitWanted = (
        environment: Environment,
        tag?: string,
        merged?: { repo: string; sha: string },
      ) =>
        Effect.gen(function* () {
          if (environment.tier === "stage") {
            const rows = yield* sql<{ readonly name: string; readonly main_head: string | null }>`
              SELECT name, main_head FROM hq_repo WHERE app_id::text=${environment.app_id}
                AND name<>${RECIPE_REPO} AND (${merged?.repo ?? null}::text IS NULL OR name=${merged?.repo ?? null}) ORDER BY name`;
            return {
              targets: rows.flatMap((row, ord): Target[] => {
                const sha = merged?.sha ?? row.main_head;
                return sha === null
                  ? []
                  : [{ service: row.name, repo: row.name, sha, label: "main", ord }];
              }),
              note: undefined,
            };
          }
          const [release] = yield* sql<{
            readonly tag: string;
            readonly entries: ReadonlyArray<{ service: string; sha: string }>;
          }>`
            SELECT r.tag,r.entries FROM hq_release r JOIN hq_environment e ON e.id=${environment.id}
            WHERE r.app_id::text=${environment.app_id} AND r.target='git' AND r.state='approved'
              AND r.environment_id=e.id AND r.environment_created_at=e.created_at
              AND (e.release_floor IS NULL OR r.released_at>=e.release_floor)
              AND (${tag ?? null}::text IS NULL OR r.tag=${tag ?? null})
            ORDER BY r.released_at DESC,r.tag DESC LIMIT 1`;
          return {
            targets:
              release?.entries.map((entry, ord) => ({
                service: entry.service,
                repo: entry.service,
                sha: entry.sha,
                label: release.tag,
                ord,
              })) ?? [],
            note: undefined,
          };
        });

      const makePushJob = (
        rolloutId: string,
        environment: Environment,
        target: Target,
        by: string | null,
      ) =>
        Effect.gen(function* () {
          const exists = yield* sql`SELECT id FROM hq_environment WHERE id=${environment.id}
            AND created_at=${environment.created_at}::timestamptz AND target='git' FOR UPDATE`;
          if (exists.length === 0) return;
          const [remote] =
            yield* sql`SELECT repo FROM hq_repo_remote WHERE app_id::text=${environment.app_id} AND repo=${target.repo}`;
          const [made] = yield* sql<{ readonly id: string }>`INSERT INTO hq_deploy_job
            (rollout_id,kind,environment_id,repo,sha,label,ord,state,reason,requested_by,ended_at)
            VALUES (${rolloutId}::bigint,'push',${environment.id},${target.repo},${target.sha},${target.label},${target.ord},
              ${remote === undefined ? "refused" : "queued"},${remote === undefined ? `No connected remote for ${target.repo}` : null},${by},
              ${sql.literal(remote === undefined ? "now()" : "NULL")}) RETURNING id::text`;
          yield* sql`UPDATE hq_deploy_job SET state='superseded',superseded_by=${made!.id}::bigint,
            reason=${`superseded by ${short(target.sha)}`},ended_at=now(),updated_at=now()
            WHERE environment_id=${environment.id} AND kind='push' AND repo=${target.repo}
              AND state='queued' AND id<>${made!.id}::bigint`;
        });

      /** The environments of `where`, in the order they were declared. */
      const environmentsOf = (
        where: { readonly appId: string } | { readonly environmentId: string },
      ) =>
        "appId" in where
          ? sql<Environment>`
              SELECT id, project_id, app_id::text AS app_id, name, tier, sources, target, branch, created_at::text FROM hq_environment
              WHERE app_id::text = ${where.appId} ORDER BY declared_seq`
          : sql<Environment>`
              SELECT id, project_id, app_id::text AS app_id, name, tier, sources, target, branch, created_at::text FROM hq_environment
              WHERE id = ${where.environmentId}`;

      /** The commit's `zerops.yaml` under the first name zcli looks for, as read; none without one. */
      const zeropsYamlOf = (git: HqGit, appId: string, repo: string, sha: string) =>
        Effect.gen(function* () {
          const at = { appId, id: repo };
          const root = yield* git.tree(at, sha, "");
          const name = YAML_NAMES.find((candidate) =>
            root.items.some((entry) => entry.path === candidate && entry.type === "blob"),
          );
          if (name === undefined) return undefined;
          return { name, read: yield* git.file(at, sha, name, YAML_MAX) };
        });

      /**
       * Why `target`'s commit cannot deploy with the tier's `setup` (F17, main #162): it has no
       * `zerops.yaml`, or one that carries no such setup; none where it can, or where git cannot
       * say now — submitting it says. A `zerops.yaml` HQ cannot read deploys: what is wrong with it
       * is Zerops' to say.
       */
      const codeProblem = (appId: string, target: Target, setup: string | undefined) =>
        Effect.gen(function* () {
          const git = yield* gitHost.git;
          const yaml = yield* zeropsYamlOf(git, appId, target.repo, target.sha);
          if (yaml === undefined) {
            return `${target.repo} has no zerops.yaml at ${short(target.sha)}`;
          }
          const setups = setupsOf(yaml.read.content.toString("utf8"));
          return setups !== undefined && setup !== undefined && !setups.includes(setup)
            ? `${target.repo}'s ${yaml.name} at ${short(target.sha)} has no setup ${setup}`
            : undefined;
        }).pipe(Effect.catchTags({ GitError: () => Effect.succeed(undefined) }));

      /**
       * In a leader's write: the job `target` asks for in `projectId` — `skipped`, saying why, where
       * its commit cannot deploy (`skip`) or its build failed there and neither a release nor a
       * person asks again (B37) — superseding what of the service still waits; or none, and why,
       * where a job of the commit is under way or HQ last made the service run it, unless the
       * project no longer has it (`gone`): its job reports that.
       */
      const makeJob = (
        rolloutId: string,
        environment: { readonly id: string; readonly project_id: string },
        target: Target,
        cause: Cause,
        by: string | null,
        skip: string | undefined,
        gone = false,
      ) =>
        Effect.gen(function* () {
          const projectId = environment.project_id;
          const environmentId = environment.id;
          const left = (job: string | null, reason: string): { readonly left: LeftOut } => ({
            left: {
              environment_id: environment.id,
              project_id: environment.project_id,
              service: target.service,
              sha: target.sha,
              job,
              reason,
            },
          });
          const [newest] = yield* sql<{
            readonly id: string;
            readonly state: string;
            readonly ended: string | null;
          }>`
            SELECT id::text AS id, state,
              to_char(ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') AS ended
            FROM hq_deploy_job
            WHERE environment_id = ${environmentId} AND kind = 'deploy' AND service = ${target.service}
              AND sha = ${target.sha}
            ORDER BY id DESC LIMIT 1`;
          if (newest !== undefined && IN_FLIGHT.has(newest.state)) {
            return left(newest.id, `a job of ${short(target.sha)} is under way`);
          }
          const [running] = yield* sql<{ readonly repo: string; readonly sha: string }>`
            SELECT repo, sha FROM hq_deploy_job
            WHERE environment_id = ${environmentId} AND kind = 'deploy' AND service = ${target.service}
              AND state = 'live'
            ORDER BY ended_at DESC, id DESC LIMIT 1`;
          if (
            cause !== "run_again" &&
            !gone &&
            running !== undefined &&
            running.repo === target.repo &&
            running.sha === target.sha
          ) {
            return left(null, `${target.service} already runs ${short(target.sha)}`);
          }
          const why =
            skip ??
            (newest?.state === "failed" && cause !== "release" && cause !== "run_again"
              ? `its deploy failed at ${newest.ended ?? "an unknown time"}; Run again to retry`
              : undefined);
          const [made] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_deploy_job (rollout_id, kind, environment_id, project_id, service, repo, sha, label, ord,
              state, reason, requested_by, ended_at)
            VALUES (${rolloutId}::bigint, 'deploy', ${environmentId}, ${projectId}, ${target.service}, ${target.repo},
              ${target.sha}, ${target.label}, ${target.ord},
              ${why === undefined ? "queued" : "skipped"}, ${why === undefined ? null : cut(why)},
              ${by}, ${sql.literal(why === undefined ? "NULL" : "now()")})
            RETURNING id::text AS id`;
          if (why === undefined) {
            yield* sql`
              UPDATE hq_deploy_job
              SET state = 'superseded', superseded_by = ${made!.id}::bigint,
                  reason = ${`superseded by ${short(target.sha)}`}, ended_at = now(),
                  updated_at = now(),
                  evidence = CASE WHEN evidence->>'phase' = 'waiting-for-build' THEN
                    evidence || jsonb_build_object('phase', 'closed', 'nextActor', 'none',
                      'nextAction', ${`Superseded by ${short(target.sha)}`}::text)
                    ELSE evidence END
              WHERE environment_id = ${environmentId} AND kind = 'deploy' AND service = ${target.service}
                AND (state = 'queued' OR (state = 'submitting' AND process_id IS NULL
                  AND ended_at IS NULL AND evidence->>'phase' = 'waiting-for-build'))
                AND id <> ${made!.id}::bigint`;
          }
          return { job: made!.id };
        });

      /** A tier's import file as HQ compares it with what it last saw. */
      const digestOf = (importYaml: string) =>
        NodeCrypto.createHash("sha256").update(importYaml).digest("hex");

      /** In a write: what HQ saw of a tier now `digest`, declaring `services`. */
      const seen = (
        appId: string,
        tier: "stage" | "production",
        digest: string,
        services: ReadonlyArray<TierService>,
      ) => sql`
        INSERT INTO hq_recipe_seen (app_id, tier, digest, blocks)
        VALUES (${appId}::uuid, ${tier}, ${digest},
          ${encodeBlocks(Object.fromEntries(services.map((service) => [service.hostname, service.block])))}::jsonb)
        ON CONFLICT (app_id, tier) DO UPDATE SET
          digest = EXCLUDED.digest, blocks = EXCLUDED.blocks, seen_at = now()`;

      /** What HQ last saw of a tier; none before it saw any. */
      const seenOf = (appId: string, tier: "stage" | "production") =>
        Effect.map(
          sql<{ readonly digest: string; readonly blocks: Readonly<Record<string, string>> }>`
            SELECT digest, blocks FROM hq_recipe_seen
            WHERE app_id::text = ${appId} AND tier = ${tier}`,
          (rows) => rows[0],
        );

      /** A tier's import file now, its services declared; none where it is absent or refused. */
      const declaredOf = (appId: string, tier: "stage" | "production") =>
        Effect.gen(function* () {
          const read = yield* recipes.read(appId, tier).pipe(Effect.option);
          if (Option.isNone(read) || read.value.state === "absent") return undefined;
          const declared = tierServices(read.value.importYaml);
          if (!declared.ok) {
            yield* Effect.logWarning("tier refused", { appId, tier, problem: declared.problem });
            return undefined;
          }
          return { digest: digestOf(read.value.importYaml), services: declared.services };
        });

      /**
       * A rollout planned into its jobs, once: what its event asks for, in one write with the mark
       * that it was planned — a rollout another planned meanwhile is left as it is — and what it
       * left out, and why.
       */
      const plan = (rollout: Rollout) =>
        Effect.gen(function* () {
          if (rollout.planned) return;
          const notes: Array<string> = [];
          /** The jobs `targets` asks for in `environment`, each with why it cannot deploy. */
          const asked: Array<{
            readonly environment: Environment;
            readonly targets: ReadonlyArray<{ readonly target: Target; readonly skip?: string }>;
          }> = [];
          const ask = (environment: Environment, targets: ReadonlyArray<Target>) =>
            Effect.gen(function* () {
              if (environment.target === "git") {
                asked.push({ environment, targets: targets.map((target) => ({ target })) });
                return;
              }
              const setups = yield* tierSetupsOf(
                environment.app_id,
                environment.tier,
                targets[0]?.label ?? null,
              );
              const checked: Array<{ readonly target: Target; readonly skip?: string }> = [];
              for (const target of targets) {
                const skip = yield* codeProblem(
                  environment.app_id,
                  target,
                  setups.get(target.service),
                );
                checked.push(skip === undefined ? { target } : { target, skip });
              }
              asked.push({ environment, targets: checked });
            });
          /** The productions a release brings to its tier, in the write (`tierLifecycle`). */
          const lifecycles: Array<{
            readonly environment: Environment;
            readonly tier: {
              readonly tag: string;
              readonly rollbackOf: string | null;
              readonly named: ReadonlySet<string>;
            };
            readonly targets: ReadonlyArray<Target>;
          }> = [];
          /** Each tier a recipe merge changed: what it added, and what HQ sees of it now. */
          const tiers: Array<{
            readonly tier: "stage" | "production";
            readonly digest: string;
            readonly services: ReadonlyArray<TierService>;
            readonly added: ReadonlyArray<string>;
            readonly dropped: ReadonlyArray<string>;
            readonly environments: ReadonlyArray<Environment>;
          }> = [];
          switch (rollout.cause) {
            case "merge": {
              const environments = yield* environmentsOf({ appId: rollout.app_id });
              if (rollout.repo === RECIPE_REPO) {
                for (const tier of ["stage", "production"] as const) {
                  const declared = yield* declaredOf(rollout.app_id, tier);
                  if (declared === undefined) continue;
                  const was = yield* seenOf(rollout.app_id, tier);
                  if (was !== undefined && was.digest === declared.digest) continue;
                  // A tier first seen is the baseline (D16): it adds nothing.
                  const dropped: Array<string> = [];
                  const added =
                    was === undefined
                      ? []
                      : declared.services
                          .filter((service) => was.blocks[service.hostname] === undefined)
                          .map((service) => service.hostname);
                  if (was !== undefined) {
                    for (const service of declared.services) {
                      const block = was.blocks[service.hostname];
                      if (block !== undefined && block !== service.block) {
                        notes.push(
                          `the ${tier} recipe for ${service.hostname} changed: reported, never applied to a service that exists`,
                        );
                      }
                    }
                    const declaredNow = new Set(
                      declared.services.map((service) => service.hostname),
                    );
                    for (const hostname of Object.keys(was.blocks)) {
                      if (!declaredNow.has(hostname)) {
                        dropped.push(hostname);
                        notes.push(
                          `the ${tier} tier no longer declares ${hostname}: HQ never deletes a service`,
                        );
                      }
                    }
                  }
                  tiers.push({
                    tier,
                    digest: declared.digest,
                    services: declared.services,
                    added,
                    dropped,
                    environments: environments.filter(
                      (environment) => environment.target === "zerops" && environment.tier === tier,
                    ),
                  });
                }
                break;
              }
              const stages = environments.filter(
                (environment) =>
                  environment.tier === "stage" && environment.sources.includes("main"),
              );
              if (stages.length === 0) break;
              const wanted = stages.some((environment) => environment.target === "zerops")
                ? yield* stageWanted(
                    rollout.app_id,
                    rollout.repo === null || rollout.sha === null
                      ? undefined
                      : { repo: rollout.repo, sha: rollout.sha },
                  )
                : { targets: [], note: undefined };
              if (wanted.note !== undefined) notes.push(wanted.note);
              for (const environment of stages) {
                if (environment.target === "git") {
                  if (
                    rollout.created_at <= environment.created_at ||
                    rollout.repo === null ||
                    rollout.sha === null
                  )
                    continue;
                  yield* ask(
                    environment,
                    (yield* gitWanted(environment, undefined, {
                      repo: rollout.repo,
                      sha: rollout.sha,
                    })).targets,
                  );
                } else yield* ask(environment, wanted.targets);
              }
              break;
            }
            case "release": {
              for (const environment of yield* environmentsOf({ appId: rollout.app_id })) {
                if (environment.tier !== "production") continue;
                if (
                  rollout.environment_id !== null &&
                  (rollout.environment_id !== environment.id ||
                    rollout.environment_created_at !== environment.created_at)
                )
                  continue;
                if (environment.target === "git") {
                  const wanted = yield* gitWanted(environment, rollout.tag ?? undefined);
                  yield* ask(environment, wanted.targets);
                  continue;
                }
                const wanted = yield* productionWanted(environment, rollout.tag ?? undefined);
                if (wanted.note !== undefined) notes.push(wanted.note);
                if (wanted.tier === undefined) {
                  yield* ask(environment, wanted.targets);
                  continue;
                }
                lifecycles.push({ environment, tier: wanted.tier, targets: wanted.targets });
                yield* ask(environment, wanted.targets);
              }
              break;
            }
            case "env_added":
            case "key_kept": {
              for (const environment of yield* environmentsOf({
                environmentId: rollout.environment_id ?? "",
              })) {
                if (
                  rollout.environment_created_at !== null &&
                  rollout.environment_created_at !== environment.created_at
                )
                  continue;
                if (environment.target === "git" && rollout.cause === "env_added") continue;
                const wanted = yield* wantedOf(environment);
                const targets =
                  environment.target === "git" && rollout.repo !== null
                    ? wanted.targets.filter((target) => target.repo === rollout.repo)
                    : wanted.targets;
                if (wanted.note !== undefined) notes.push(wanted.note);
                yield* ask(environment, targets);
              }
              break;
            }
            case "run_again":
            case "add_service":
            case "import":
            case "migrated":
              break;
          }
          const made = yield* leader.write(
            Effect.gen(function* () {
              const [row] = yield* sql<{ readonly planned: boolean }>`
                SELECT planned_at IS NOT NULL AS planned FROM hq_rollout
                WHERE id = ${rollout.id}::bigint FOR UPDATE`;
              // Another planned it meanwhile: its plan stands, and says what it left out.
              if (row === undefined || row.planned) return undefined;
              const leftOut: Array<LeftOut> = [];
              /** Services each production's project no longer has, whose deploys report it (C16). */
              const gone = new Map<string, ReadonlySet<string>>();
              for (const { environment, tier, targets } of lifecycles) {
                const brought = yield* tierLifecycle(environment, tier, targets);
                notes.push(...brought.notes);
                leftOut.push(...brought.left);
                gone.set(environment.id, brought.gone);
              }
              let count = 0;
              for (const tier of tiers) {
                yield* seen(rollout.app_id, tier.tier, tier.digest, tier.services);
                if (tier.tier === "stage") {
                  const declared = new Set(tier.services.map((service) => service.hostname));
                  for (const environment of tier.environments) {
                    notes.push(...(yield* stageTierChange(environment, declared, tier.dropped)));
                  }
                }
                if (tier.added.length === 0) continue;
                for (const environment of tier.environments) {
                  if (environment.target !== "zerops") continue;
                  yield* sql`
                    INSERT INTO hq_deploy_job (rollout_id, kind, environment_id, project_id, sha, services, ord,
                      state)
                    VALUES (${rollout.id}::bigint, 'delta', ${environment.id}, ${environment.project_id},
                      ${rollout.sha}, ${textArray(tier.added)}, -1, 'queued')`;
                  count += 1;
                }
              }
              for (const { environment, targets } of asked) {
                for (const { target, skip } of targets) {
                  if (environment.target === "git") {
                    yield* makePushJob(rollout.id, environment, target, rollout.by);
                    count += 1;
                    continue;
                  }
                  const by = rollout.cause === "release" ? rollout.by : null;
                  const job = yield* makeJob(
                    rollout.id,
                    environment,
                    target,
                    rollout.cause,
                    by,
                    skip,
                    gone.get(environment.id)?.has(target.service),
                  );
                  if ("left" in job) leftOut.push(job.left);
                  else count += 1;
                }
              }
              const note = notes.join("; ");
              yield* sql`
                UPDATE hq_rollout
                SET planned_at = now(), note = ${note === "" ? null : note.slice(0, 480)},
                    left_out = ${encodeLeftOut(leftOut)}::jsonb
                WHERE id = ${rollout.id}::bigint`;
              return count;
            }),
          );
          if (made === undefined) return;
          if (made > 0) yield* tick;
          if (notes.length > 0) {
            yield* Effect.logInfo("a rollout left something out", {
              rollout: rollout.id,
              cause: rollout.cause,
              note: notes.join("; "),
            });
          }
        });

      /** The environment's key as it is kept, sealed: none where none is kept. */
      const keptOf = (projectId: string) =>
        Effect.map(
          sql<{ readonly key_id: string | null; readonly sealed: Uint8Array }>`
            SELECT key_id, sealed FROM hq_deploy_token WHERE project_id = ${projectId}`,
          (rows) => rows[0],
        );

      /**
       * The environment's key, opened under HQ's and checked: none, HQ holding no key to open it
       * with, one that does not open under HQ's — HQ's own state, neither marked nor fixed by a new
       * one — one that no longer answers or now reaches more than its project — marked invalid,
       * logged once, for an admin must mint a new one — or a Zerops that did not answer: each
       * refuses the job, saying why; or one HQ may deploy with.
       */
      const keyOf = (projectId: string, envName: string) =>
        Effect.gen(function* () {
          if (keys.state !== "ok") return refused(noKeySecret(envName));
          const kept = yield* keptOf(projectId);
          if (kept === undefined) return refused(noDeployToken(envName));
          const token = keys.open(projectId, { keyId: kept.key_id ?? "", sealed: kept.sealed });
          if (token === undefined) {
            yield* Effect.logWarning("deploy token does not open under HQ's key", {
              environment: envName,
              project: projectId,
            });
            return refused(unopenedDeployToken(envName));
          }
          const checked = yield* Effect.gen(function* () {
            const own = yield* zerops
              .ownToken(token)
              .pipe(
                Effect.map(Option.some),
                Effect.catchTags({ ZeropsRefused: () => Effect.succeed(Option.none()) }),
              );
            if (Option.isNone(own)) return deadDeployToken(envName);
            const { orgId } = yield* roles.view;
            return reachesOnly(own.value, orgId, projectId)
              ? undefined
              : widenedDeployToken(envName);
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed(
                error._tag === "ZeropsUnavailable"
                  ? refused(zeropsDidNotAnswer(error.message))
                  : refused(`HQ could not read its org: ${error.code}`),
              ),
            ),
          );
          if (typeof checked === "object") return checked;
          const marked = yield* leader.write(
            checked === undefined
              ? sql`
                  UPDATE hq_deploy_token SET invalid_since = NULL
                  WHERE project_id = ${projectId} AND invalid_since IS NOT NULL RETURNING 1`
              : sql`
                  UPDATE hq_deploy_token SET invalid_since = now()
                  WHERE project_id = ${projectId} AND invalid_since IS NULL RETURNING 1`,
          );
          if (marked.length > 0) {
            yield* tick;
            if (checked !== undefined) {
              yield* Effect.logWarning("deploy token no longer usable", {
                environment: envName,
                project: projectId,
                why: checked,
              });
            }
          }
          return checked === undefined ? { token } : refused(checked);
        });

      /**
       * Whether `service` runs `job`'s commit: the version it runs is one HQ made for that service
       * from that repository's commit, as HQ recorded it (audit N6, N7) — never what a version's name
       * spells.
       */
      const runsJob = (job: DeployJob, service: ZeropsService) =>
        service.activeVersionId === null
          ? Effect.succeed(false)
          : Effect.map(
              sql<{ readonly repo: string; readonly sha: string }>`
                SELECT repo, sha FROM hq_deploy_job
                WHERE environment_id = ${job.environment_id} AND service_id = ${service.id}
                  AND app_version_id = ${service.activeVersionId}`,
              (rows) => rows.some((row) => row.repo === job.repo && row.sha === job.sha),
            );

      /**
       * After HQ's own verified deploy: an HTTP service's subdomain, its process followed to its
       * end through the same scoped observation — none where it came on or was on already, else why
       * it did not, in HQ's words. A platform refusal is noted on the verified deploy; an unobservable step ends unresolved.
       */
      const openSubdomain = (job: Job, service: ZeropsService, token: Redacted.Redacted) =>
        (job.processes ?? []).length === 0 && (!service.http || service.subdomainAccess)
          ? Effect.succeed(undefined)
          : Effect.gen(function* () {
              let processId = job.processes?.[0];
              if (processId === undefined) {
                processId = (yield* deploy.enableSubdomainAccess(service.id)(token)).processId;
                // The accepted side effect survives a gap even before its registration succeeds.
                yield* update(job, sql`processes = ${textArray([processId])}`);
              }
              const ended = yield* observed(job, [processId], null, (signal) =>
                Effect.sync(() => {
                  const process = signal.processes.find((row) => row.id === processId);
                  if (process?.status === "FINISHED") return { state: "on" } as const;
                  if (
                    process !== undefined &&
                    ["FAILED", "CANCELED", "CANCELLED"].includes(process.status)
                  )
                    return failed(
                      process.error?.message ?? process.error?.code ?? "Zerops gave no reason",
                    );
                  return undefined;
                }),
              );
              return ended.state === "on"
                ? undefined
                : {
                    reason: `its subdomain was not turned on: ${ended.reason}`,
                    unresolved: ended.state === "unresolved",
                  };
            }).pipe(
              Effect.catch((error) =>
                Effect.succeed({
                  reason: `its subdomain could not be verified: ${error._tag === "ZeropsRefused" ? error.code : error.message}`,
                  unresolved: error._tag === "ZeropsUnavailable",
                }),
              ),
            );

      /**
       * HQ's own deploy of `job`, live: its subdomain turned on where it was intended — its service
       * created for HQ to deploy (`hq_subdomain_intent`: its project's attach said so, or HQ's
       * recipe delta imported it), and this its first deploy HQ sees live (audit R1, D6) — and its
       * service's intent spent. None where it came on or was not intended, else why it did not.
       * Never fails the deploy.
       */
      const openIfIntended = (job: Job, service: ZeropsService, token: Redacted.Redacted) =>
        Effect.gen(function* () {
          const intended = yield* sql`
            SELECT 1 FROM hq_subdomain_intent
            WHERE project_id = ${job.project_id}
              AND (service IS NULL OR service = ${job.service})
              AND NOT EXISTS (
                SELECT 1 FROM hq_deploy_job
                WHERE environment_id = ${job.environment_id} AND service = ${job.service}
                  AND state = 'live' AND sha <> ${job.sha}
              )`;
          if (intended.length === 0) return undefined;
          const why = yield* openSubdomain(job, service, token);
          yield* leader.write(sql`
            DELETE FROM hq_subdomain_intent
            WHERE project_id = ${job.project_id} AND service = ${job.service}`);
          return why;
        }).pipe(
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("subdomain intent not read", { service: service.name, error }),
              undefined,
            ),
          ),
        );

      /** Persist only the evidence of the accepted operation, never a platform inventory. */
      const record = (job: Job, signal: OperationSignal) => {
        const discovered =
          job.kind === "deploy" && job.process_id === null && signal.phase === "live"
            ? (signal.processes.find((process) => process.appVersion?.id === job.app_version_id)
                ?.id ?? null)
            : null;
        const waiting =
          signal.phase === "live" &&
          job.kind === "deploy" &&
          job.process_id === null &&
          signal.processes.length === 0 &&
          signal.version?.status === "UPLOADING" &&
          (job.uploaded || !job.upload_recorded);
        const evidence = waiting
          ? {
              ...evidenceOf(signal),
              phase: "waiting-for-build",
              nextActor: "person" as const,
              nextAction:
                "Inspect the original version in Zerops; use Run again if no build started",
            }
          : evidenceOf(signal);
        const step = encodeEvidence(stepOf(signal));
        const patch = signal.phase === "live" ? encodeEvidence(evidence) : encodePhase(evidence);
        return leader
          .write(sql`
          UPDATE hq_deploy_job SET
            process_id = coalesce(process_id, ${discovered}),
            state = CASE WHEN ${discovered}::text IS NOT NULL THEN 'building' ELSE state END,
            evidence = coalesce(evidence, '{"processes":[],"version":null}'::jsonb) || ${patch}::jsonb,
            steps = CASE WHEN ${signal.phase === "live"} AND
              (steps->-1->'processes', steps->-1->'version') IS DISTINCT FROM
              (${step}::jsonb->'processes', ${step}::jsonb->'version')
              THEN steps || jsonb_build_array(${step}::jsonb) ELSE steps END,
            updated_at = now()
          WHERE id = ${job.id}::bigint AND ended_at IS NULL
            AND evidence IS DISTINCT FROM (coalesce(evidence, '{"processes":[],"version":null}'::jsonb) || ${patch}::jsonb)
          RETURNING 1`)
          .pipe(Effect.flatMap((rows) => (rows.length === 0 ? Effect.void : tick)));
      };

      /** Current owner state at registration, then only relevant pushes; loss re-registers. */
      const observed = <A>(
        job: Job,
        processIds: ReadonlyArray<string>,
        versionId: string | null,
        read: (
          signal: OperationSignal,
        ) => Effect.Effect<A | undefined, OperationError | SqlError | NotLeader>,
      ): Effect.Effect<A | Stopped, SqlError | NotLeader> => {
        let retries = 0;
        const attempt = (): Effect.Effect<A | Stopped, SqlError | NotLeader> =>
          observer.watch({ projectId: job.project_id, processIds, versionId }).pipe(
            Stream.mapEffect((signal) =>
              record(job, signal).pipe(
                Effect.andThen(signal.phase === "live" ? read(signal) : Effect.succeed(undefined)),
              ),
            ),
            Stream.interruptWhen(
              SubscriptionRef.changes(ticks).pipe(
                Stream.mapEffect(
                  () =>
                    sql`SELECT 1 FROM hq_deploy_job WHERE id = ${job.id}::bigint AND ended_at IS NOT NULL`,
                ),
                Stream.filter((rows) => rows.length !== 0),
                Stream.take(1),
                Stream.runDrain,
              ),
            ),
            Stream.filter((answer): answer is A => answer !== undefined),
            Stream.take(1),
            Stream.runHead,
            Effect.map((answer) =>
              Option.isSome(answer)
                ? answer.value
                : unresolved("HQ can no longer observe the operation"),
            ),
            Effect.catch((error) =>
              error._tag === "ZeropsRefused"
                ? Effect.succeed(unresolved(`HQ cannot follow the operation: ${error.code}`))
                : error._tag === "ZeropsUnavailable"
                  ? record(job, { phase: "recovering", processes: [], version: null }).pipe(
                      Effect.andThen(operationBackoff(retries++, error.retryAfterMs)),
                      Effect.andThen(Effect.suspend(attempt)),
                    )
                  : Effect.fail(error),
            ),
          );
        return attempt();
      };

      /** Success belongs to the terminal process; active service/version is verified separately. */
      const follow = (
        job: Job,
        token: Redacted.Redacted,
        serviceId: string,
        versionId: string,
        processId: string | null,
      ) =>
        observed(job, processId === null ? [] : [processId], versionId, (signal) =>
          Effect.gen(function* () {
            const process =
              processId === null
                ? signal.processes.find((row) => row.appVersion?.id === versionId)
                : signal.processes.find((row) => row.id === processId);
            if (process !== undefined) {
              if (["FAILED", "CANCELED", "CANCELLED"].includes(process.status))
                return failed(
                  `failed: ${process.error?.message ?? process.error?.code ?? "the build failed"}`,
                );
              if (process.status !== "FINISHED") return undefined;
            } else {
              const status =
                signal.version?.status ?? (yield* deploy.appVersion(versionId)(token)).status;
              if (VERSION_FAILURES.has(status)) return failed(`failed: the version is ${status}`);
              if (status === "UPLOADING" && job.upload_recorded && !job.uploaded)
                return unresolved("HQ's archive upload went unanswered; no build was asked for");
              if (status !== "ACTIVE" && status !== "BACKUP") return undefined;
            }
            const service = yield* zerops.service(serviceId)(token);
            // Version and process updates may arrive before the service's REST projection catches up.
            const active =
              signal.version?.id === versionId &&
              signal.version.status === "ACTIVE" &&
              service.named?.id === versionId;
            if (service.activeVersionId !== versionId && service.named?.id === versionId && !active)
              return undefined;
            if (service.activeVersionId !== versionId && !active)
              return unresolved(
                "The process finished but the expected running version is not verified",
              );
            yield* leader.write(
              sql`UPDATE hq_deploy_job SET verified_version_id = ${versionId} WHERE id = ${job.id}::bigint`,
            );
            return { state: "live", service } as const;
          }),
        );

      /** The archive and `zerops.yaml` of the commit, or why HQ will not submit the commit. */
      const commitOf = (git: HqGit, job: DeployJob) =>
        Effect.gen(function* () {
          const yaml = yield* zeropsYamlOf(git, job.app_id, job.repo, job.sha);
          if (yaml === undefined) {
            return skipped(`${job.repo} has no zerops.yaml at ${short(job.sha)}`);
          }
          const { name, read } = yaml;
          if (read.truncated) {
            return skipped(`${name} of ${job.repo} at ${short(job.sha)} is larger than 1 MiB`);
          }
          const archive = yield* Effect.flatMap(
            git.archive({ appId: job.app_id, id: job.repo }, job.sha),
            (stream) => readWhole(stream, ARCHIVE_MAX),
          );
          if (archive === undefined) {
            return skipped(
              `the archive of ${job.repo} at ${short(job.sha)} is larger than 512 MiB`,
            );
          }
          return { zeropsYaml: read.content.toString("utf8"), archive };
        });

      /** A job's record, moved on: in its own write, told to the structure. */
      const update = (job: Job, set: Statement.Fragment) =>
        Effect.andThen(
          leader.write(sql`
            UPDATE hq_deploy_job SET ${set}, updated_at = now()
            WHERE id = ${job.id}::bigint AND ended_at IS NULL`),
          tick,
        );

      /** A job ended `ended`. */
      const end = (job: Job, ended: Ended) =>
        update(
          job,
          sql`state = ${ended.state}, ended_at = now(),
            reason = ${ended.reason === undefined ? null : cut(ended.reason)},
            evidence = coalesce(evidence, '{"processes":[],"version":null}'::jsonb) ||
              jsonb_build_object('phase', 'closed', 'nextActor', ${ended.state === "unresolved" ? "person" : "none"}::text,
                'nextAction', ${ended.state === "unresolved" ? "Inspect the original handles in Zerops; Run again is a new explicit operation" : "Operation ended"}::text)`,
        );

      /**
       * A deploy job submitted, once: the key checked, the service read — one that runs what HQ
       * last made it run there is live at once — the commit read, and then its version made and
       * recorded before anything is submitted with it, its archive uploaded and the upload
       * recorded, its build asked for, the build's process recorded. Whatever does not go through ends the job; an answer
       * lost after the version was made leaves it submitting, for its version tells (`follow`).
       */
      const submitDeploy = (job: DeployJob) =>
        Effect.gen(function* () {
          const key = yield* keyOf(job.project_id, job.env_name);
          if (!("token" in key)) return yield* end(job, key);
          const token = key.token;
          const ended = yield* Effect.gen(function* () {
            const service = (yield* zerops.services(job.project_id)(token)).find(
              (candidate) => candidate.name === job.service,
            );
            if (service === undefined) {
              return refused(`the environment's project has no service ${job.service}`);
            }
            yield* update(job, sql`service_id = ${service.id}`);
            if (yield* runsJob(job, service)) {
              yield* update(job, sql`verified_version_id = ${service.activeVersionId}`);
              return { state: "live", reason: `${job.service} already runs it` } as const;
            }
            const git = yield* gitHost.git;
            const commit = yield* commitOf(git, job);
            if ("state" in commit) return commit;
            const setup =
              (yield* tierSetupsOf(job.app_id, job.tier, job.label)).get(job.service) ??
              job.service;
            const label = job.label ?? (job.tier === "stage" ? "main" : "release");
            yield* update(job, sql`state = 'submitting', submitted_at = now()`);
            const version = yield* deploy
              .createAppVersion(
                service.id,
                versionName(label, job.sha),
              )(token)
              .pipe(
                Effect.catchTags({
                  ZeropsUnavailable: (error) => Effect.succeed({ lost: error.message }),
                }),
              );
            // Unanswered, no version is known: HQ makes no other.
            if ("lost" in version)
              return unresolved(
                "Zerops did not answer version creation; HQ has no handle to follow",
              );
            // Kept before anything is submitted with it: whatever answer is lost from here on,
            // HQ reads this version instead of making another (audit H6).
            yield* update(job, sql`app_version_id = ${version.id}`);
            const started = yield* deploy
              .upload(
                version.id,
                commit.archive,
              )(token)
              .pipe(
                // Its upload answered: from here on its build is asked for.
                Effect.andThen(update(job, sql`uploaded_at = now()`)),
                Effect.andThen(deploy.buildAndDeploy(version.id, commit.zeropsYaml, setup)(token)),
                Effect.map(Option.some),
                Effect.catchTags({
                  ZeropsUnavailable: (error) =>
                    Effect.as(
                      Effect.logWarning("a deploy's submission went unanswered", {
                        environment: job.env_name,
                        service: job.service,
                        error,
                      }),
                      Option.none(),
                    ),
                }),
              );
            if (Option.isSome(started)) {
              yield* update(job, sql`state = 'building', process_id = ${started.value.processId}`);
            }
            return undefined;
          }).pipe(
            Effect.catchTags({
              ZeropsRefused: (error) => Effect.succeed(zeropsEnd(job.env_name, error)),
              ZeropsUnavailable: (error) => Effect.succeed(zeropsEnd(job.env_name, error)),
              GitError: (error) => Effect.succeed(refused(`git: ${error.message}`)),
            }),
            Effect.catchIf(
              (error): error is string => typeof error === "string",
              (message) => Effect.succeed(refused(message)),
            ),
          );
          if (ended !== undefined) yield* end(job, ended);
        });

      /**
       * A delta job submitted (main D15, audit D2): the services it carries that the environment's
       * tier still declares and its project lacks, imported — created empty where HQ deploys them,
       * their subdomain intended — and the import's processes recorded: the handles it is followed
       * by (`followImport`), its services' deploys asked for once it ended. An answer lost leaves it
       * submitting, for the project's listing tells.
       */
      const runDelta = (job: Job) =>
        Effect.gen(function* () {
          const key = yield* keyOf(job.project_id, job.env_name);
          if (!("token" in key)) return yield* end(job, key);
          const declared = yield* declaredOf(job.app_id, job.tier);
          if (declared === undefined) {
            return yield* end(job, refused(`the ${job.tier} tier could not be read`));
          }
          const carried = job.services ?? [];
          const ended = yield* Effect.gen(function* () {
            const asked = declared.services.filter((service) => carried.includes(service.hostname));
            if (asked.length === 0) {
              return skipped(`the ${job.tier} tier no longer declares ${carried.join(", ")}`);
            }
            const present = new Set(
              (yield* zerops.services(job.project_id)(key.token))
                .filter((service) => !service.isSystem)
                .map((service) => service.name),
            );
            const missing = asked.filter((service) => !present.has(service.hostname));
            if (missing.length === 0) {
              return skipped(
                `the project has ${asked.map((service) => service.hostname).join(", ")} already`,
              );
            }
            const imported = missing.map((service) => service.hostname);
            yield* leader.write(
              Effect.gen(function* () {
                // What HQ creates to deploy gets its subdomain on its first deploy (audit R1, D6).
                for (const service of missing) {
                  if (!deployedByHq(service.declaration)) continue;
                  yield* sql`
                    INSERT INTO hq_subdomain_intent (project_id, service)
                    VALUES (${job.project_id}, ${service.hostname})
                    ON CONFLICT DO NOTHING`;
                }
                yield* sql`
                  UPDATE hq_deploy_job
                  SET state = 'submitting', submitted_at = now(), services = ${textArray(imported)},
                      updated_at = now()
                  WHERE id = ${job.id}::bigint AND ended_at IS NULL`;
              }),
            );
            yield* tick;
            const answered = yield* deploy
              .importServices(
                job.project_id,
                deltaImport(missing),
              )(key.token)
              .pipe(
                Effect.map(Option.some),
                Effect.catchTags({
                  ZeropsUnavailable: (error) =>
                    Effect.as(
                      Effect.logWarning("a delta's import went unanswered", {
                        environment: job.env_name,
                        error,
                      }),
                      Option.none(),
                    ),
                }),
              );
            if (Option.isSome(answered)) {
              const processes = answered.value.services.flatMap((service) => service.processes);
              yield* update(job, sql`state = 'building', processes = ${textArray(processes)}`);
            }
            yield* Effect.logInfo("a recipe delta's import was asked", {
              environment: job.env_name,
              services: imported,
            });
            return undefined;
          }).pipe(
            Effect.catchTags({
              ZeropsRefused: (error) => Effect.succeed(zeropsEnd(job.env_name, error)),
              ZeropsUnavailable: (error) => Effect.succeed(zeropsEnd(job.env_name, error)),
            }),
          );
          if (ended !== undefined) yield* end(job, ended);
        });

      /** Import handles decide the result; a lost handle ends unresolved, never inferred from a clock. */
      const followImport = (job: Job) =>
        Effect.gen(function* () {
          const key = yield* keyOf(job.project_id, job.env_name);
          if (!("token" in key))
            return yield* end(job, unresolved(key.reason ?? "The deploy credential is gone"));
          const services = job.services ?? [];
          const named = services.join(", ");
          if ((job.processes ?? []).length === 0)
            return yield* end(job, unresolved("HQ did not receive the import's process handles"));
          const ended = yield* observed(job, job.processes ?? [], null, (signal) =>
            Effect.sync(() => {
              for (const id of job.processes ?? []) {
                const process = signal.processes.find((row) => row.id === id);
                if (
                  process !== undefined &&
                  ["FAILED", "CANCELED", "CANCELLED"].includes(process.status)
                )
                  return failed(
                    `the import of ${named} failed: ${process.error?.message ?? process.error?.code ?? "Zerops gave no reason"}`,
                  );
                if (process?.status !== "FINISHED") return undefined;
              }
              return { state: "imported" } as const;
            }),
          );
          if (ended.state !== "imported") return yield* end(job, ended);
          const [environment] = yield* environmentsOf({ environmentId: job.environment_id });
          const wanted = environment === undefined ? { targets: [] } : yield* wantedOf(environment);
          const setups = yield* tierSetupsOf(
            job.app_id,
            job.tier,
            wanted.targets[0]?.label ?? null,
          );
          const deploys: Array<{ readonly target: Target; readonly skip?: string }> = [];
          for (const target of wanted.targets) {
            if (!services.includes(target.service)) continue;
            const skip = yield* codeProblem(job.app_id, target, setups.get(target.service));
            deploys.push(skip === undefined ? { target } : { target, skip });
          }
          yield* leader.write(
            Effect.gen(function* () {
              for (const { target, skip } of deploys) {
                yield* makeJob(
                  job.rollout_id,
                  { id: job.environment_id, project_id: job.project_id },
                  target,
                  job.cause,
                  job.by,
                  skip,
                );
              }
            }),
          );
          yield* end(job, { state: "live", reason: `added ${named}` });
        });

      /** An environment's job not ended: the one in flight first, then in the order asked. */
      const openJob = (projectId: string) =>
        Effect.map(
          sql<AnyJob>`
            SELECT ${sql.literal(JOB_COLUMNS)} FROM ${sql.literal(JOB_FROM)}
            WHERE j.environment_id = ${projectId} AND (j.ended_at IS NULL OR (j.kind='push' AND j.state='unresolved'))
            ORDER BY (j.state <> 'queued') DESC, j.rollout_id, j.ord, j.id
            LIMIT 1`,
          (rows) => rows[0],
        );

      /** Each environment's submissions, one at a time. */
      const submitting = new Map<string, Semaphore.Semaphore>();
      const lockOf = (projectId: string) =>
        Effect.sync(() => {
          const held = submitting.get(projectId);
          if (held !== undefined) return held;
          const made = Semaphore.makeUnsafe(1);
          submitting.set(projectId, made);
          return made;
        });

      /**
       * An environment moved on as far as it goes now, under its submission lock: while it builds
       * nothing, its next job submitted. A submission whose version HQ never heard, met here, is no
       * longer being made — HQ stopped before Zerops answered — and ends unresolved.
       */
      const advance = (projectId: string) =>
        Effect.flatMap(lockOf(projectId), (lock) =>
          Semaphore.withPermit(
            lock,
            Effect.gen(function* () {
              for (;;) {
                const job = yield* openJob(projectId);
                if (job === undefined || job.state === "building") return;
                if (job.kind === "push") {
                  if (job.state === "unresolved") return;
                  yield* gitPush.run(job, tick);
                  yield* tick;
                  continue;
                }
                // A submission without its original handle cannot be followed after takeover.
                if (job.state === "submitting") {
                  if (job.kind === "deploy" && job.app_version_id === null) {
                    yield* end(job, unresolved("HQ restarted before Zerops answered"));
                    continue;
                  }
                  return;
                }
                yield* job.kind === "delta" ? runDelta(job) : submitDeploy(job as DeployJob);
              }
            }),
          ),
        );

      /** A build HQ submitted, followed to its end (`follow`), and its end recorded. */
      const followBuild = (job: Job) =>
        Effect.gen(function* () {
          const key = yield* keyOf(job.project_id, job.env_name);
          if (!("token" in key))
            return yield* end(job, unresolved(key.reason ?? "The deploy credential is gone"));
          if (job.service_id === null || job.app_version_id === null) {
            return yield* end(job, unresolved("HQ restarted before Zerops answered"));
          }
          const followed = yield* follow(
            job,
            key.token,
            job.service_id,
            job.app_version_id,
            job.process_id,
          );
          if (followed.state !== "live") return yield* end(job, followed);
          const subdomain = yield* openIfIntended(job, followed.service, key.token);
          yield* end(
            job,
            subdomain === undefined
              ? { state: "live" }
              : subdomain.unresolved
                ? unresolved(subdomain.reason)
                : { state: "live", reason: subdomain.reason },
          );
        });

      /** The leading Core's scope, where each environment's worker runs; none while it leads not. */
      const leading = yield* Ref.make<Scope.Scope | undefined>(undefined);
      const registry = yield* Semaphore.make(1);
      const workers = new Map<string, Fiber.Fiber<void>>();

      /**
       * An environment's worker: it follows what the environment builds, and submits what waits
       * once that ends, until nothing is left.
       */
      const work = (projectId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          for (;;) {
            yield* advance(projectId);
            const job = yield* openJob(projectId);
            if (job?.kind === "push" && job.state === "unresolved") {
              yield* Semaphore.withPermit(
                registry,
                Effect.sync(() => workers.delete(projectId)),
              );
              return;
            }
            if (job !== undefined && job.kind !== "push" && job.state !== "queued") {
              yield* job.kind === "delta" ? followImport(job) : followBuild(job);
              continue;
            }
            const done = yield* Semaphore.withPermit(
              registry,
              Effect.gen(function* () {
                if ((yield* openJob(projectId)) !== undefined) return false;
                workers.delete(projectId);
                return true;
              }),
            );
            if (done) return;
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.andThen(
              Effect.logWarning("an environment's deploys stopped", {
                project: projectId,
                error,
              }),
              Semaphore.withPermit(
                registry,
                Effect.sync(() => workers.delete(projectId)),
              ),
            ),
          ),
        );

      /** The environment's worker, started where none runs, while this Core leads. */
      const worked = (projectId: string) =>
        Semaphore.withPermit(
          registry,
          Effect.gen(function* () {
            const scope = yield* Ref.get(leading);
            if (scope === undefined || workers.has(projectId)) return;
            const worker = yield* Effect.forkIn(work(projectId), scope);
            workers.set(projectId, worker);
          }),
        );

      /** A rollout as its row holds it; none where there is none. */
      const rolloutRow = (rolloutId: string) =>
        Effect.map(
          sql<Rollout>`
            SELECT id::text AS id, app_id::text AS app_id, cause, repo, sha, tag, environment_id, by,
              planned_at IS NOT NULL AS planned, created_at::text, environment_created_at::text
            FROM hq_rollout WHERE id = ${rolloutId}::bigint`,
          (rows) => rows[0],
        );

      /** Where every job a rollout asked for stands, and what it left out. */
      const answerOf = (rolloutId: string) =>
        Effect.gen(function* () {
          const [rollout] = yield* sql<{
            readonly note: string | null;
            readonly left_out: ReadonlyArray<LeftOut>;
          }>`
            SELECT note, left_out FROM hq_rollout WHERE id = ${rolloutId}::bigint`;
          if (rollout === undefined) return NO_DEPLOYS;
          const jobs = yield* sql<{
            readonly id: string;
            readonly kind: HqDeployOutcome["kind"];
            readonly environment: string;
            readonly service: string | null;
            readonly sha: string | null;
            readonly state: HqDeployOutcome["state"];
            readonly process_id: string | null;
            readonly evidence: NonNullable<HqDeployOutcome["evidence"]> | PushEvidence | null;
            readonly app_version_id: string | null;
            readonly verified_version_id: string | null;
            readonly steps: ReadonlyArray<unknown>;
            readonly behind: string | null;
            readonly reason: string | null;
          }>`
            SELECT j.id::text AS id, j.kind, e.name AS environment, CASE WHEN j.kind='push' THEN j.repo ELSE j.service END AS service, j.sha, j.state,
              j.process_id, j.reason, j.evidence, j.app_version_id, j.verified_version_id, j.steps,
              CASE WHEN j.state = 'queued' THEN (
                SELECT o.id::text FROM hq_deploy_job o
                WHERE o.environment_id = j.environment_id AND o.ended_at IS NULL AND o.id <> j.id
                  AND (o.state <> 'queued' OR (o.rollout_id, o.ord, o.id) < (j.rollout_id, j.ord, j.id))
                ORDER BY (o.state <> 'queued') DESC, o.rollout_id, o.ord, o.id
                LIMIT 1
              ) END AS behind
            FROM hq_deploy_job j JOIN hq_environment e ON e.id = j.environment_id
            WHERE j.rollout_id = ${rolloutId}::bigint
            ORDER BY j.id`;
          const names = new Map(
            (yield* sql<{ readonly id: string; readonly name: string }>`
              SELECT id, name FROM hq_environment`).map((row) => [row.id, row.name] as const),
          );
          const jobsAsked: Array<HqDeployOutcome> = [
            ...jobs.map(
              (job) =>
                ({
                  environment: job.environment,
                  kind: job.kind,
                  service: job.service,
                  sha: job.sha,
                  job: job.id,
                  state: job.state,
                  processId: job.process_id,
                  evidence:
                    job.kind === "push" && job.evidence !== null && "remote" in job.evidence
                      ? pushEvidenceForWire(job.evidence)
                      : job.evidence,
                  appVersionId: job.app_version_id,
                  verifiedVersionId: job.verified_version_id,
                  steps:
                    job.kind === "push"
                      ? job.steps.map((step) => pushEvidenceForWire(step as PushEvidence))
                      : job.steps,
                  behind: job.behind,
                  reason: job.reason,
                }) as HqDeployOutcome,
            ),
            ...rollout.left_out.map((left) => ({
              environment: names.get(left.environment_id) ?? left.environment_id,
              kind: "deploy" as const,
              service: left.service,
              // A part stopped before HQ ever made it run anything names no commit.
              sha: left.sha === "" ? null : left.sha,
              job: left.job,
              state: "skipped" as const,
              processId: null,
              behind: null,
              reason: left.reason,
            })),
          ];
          return { jobs: jobsAsked, note: rollout.note };
        });

      const run: Deploys["Service"]["run"] = (rolloutId) =>
        Effect.gen(function* () {
          const rollout = yield* rolloutRow(rolloutId);
          if (rollout === undefined) return NO_DEPLOYS;
          yield* plan(rollout);
          const projects = yield* sql<{ readonly environment_id: string; readonly git: boolean }>`
            SELECT environment_id,bool_or(kind='push') AS git FROM hq_deploy_job
            WHERE rollout_id = ${rolloutId}::bigint AND ended_at IS NULL GROUP BY environment_id`;
          yield* Effect.forEach(
            projects,
            ({ environment_id: environmentId, git }) =>
              git
                ? worked(environmentId)
                : Effect.andThen(advance(environmentId), worked(environmentId)),
            { concurrency: "unbounded", discard: true },
          );
          return yield* answerOf(rolloutId);
        });

      /** What leads now: the rollouts no request ran, and a worker per environment with jobs open. */
      const lead = Effect.gen(function* () {
        yield* Ref.set(leading, yield* Effect.scope);
        yield* Effect.addFinalizer(() =>
          Effect.andThen(
            Ref.set(leading, undefined),
            Semaphore.withPermit(
              registry,
              Effect.sync(() => workers.clear()),
            ),
          ),
        );
        const dispatch = Effect.gen(function* () {
          const unplanned = yield* sql<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_rollout WHERE planned_at IS NULL ORDER BY id`;
          for (const { id } of unplanned) {
            yield* run(id).pipe(
              Effect.catch((error) =>
                Effect.logWarning("a rollout could not be run", { rollout: id, error }),
              ),
            );
          }
          const open = yield* sql<{ readonly environment_id: string }>`
            SELECT DISTINCT environment_id FROM hq_deploy_job WHERE ended_at IS NULL`;
          for (const { environment_id: environmentId } of open) yield* worked(environmentId);
        }).pipe(Effect.catch((error) => Effect.logWarning("deploy dispatch failed", error)));
        // At takeover, after every event's write, and once git opens (planning reads it): what the
        // table holds, and nothing else.
        yield* Stream.merge(rollouts.woken, gitHost.recorded).pipe(
          Stream.runForEach(() => dispatch),
        );
      });

      yield* Effect.forkScoped(
        leader.changes.pipe(
          Stream.switchMap((status) =>
            status.state === "active" ? Stream.fromEffect(Effect.scoped(lead)) : Stream.empty,
          ),
          Stream.runDrain,
        ),
      );

      /**
       * A person's ask in the application's environment `name`, refused unless they may Run again
       * there (`redeploy`): the environment's project.
       */
      const personsEnvironment = (
        userId: string,
        appId: string,
        name: string,
        log: Readonly<Record<string, string>>,
      ) =>
        Effect.gen(function* () {
          const view = yield* roles.forWrite;
          const person = { kind: "person", userId } as const;
          const projectIds = (yield* sql<{ readonly project_id: string }>`
            SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`).map(
            (row) => row.project_id,
          );
          // Whether the application has an environment of that name is told only to whoever
          // sees it.
          const seenApp = can(person, "read_app", { projectIds }, view);
          if (!seenApp.allow) return yield* refuse("forbidden", seenApp.reason, log);
          const [environment] = yield* sql<Environment>`
            SELECT id,project_id,app_id::text AS app_id,tier,target,name,sources,branch,created_at::text
            FROM hq_environment WHERE app_id::text=${appId} AND name=${name}`;
          if (environment === undefined) {
            return yield* refuse("environment_not_found", "environment_not_found", log);
          }
          const may = can(
            person,
            "redeploy",
            { projectIds, projectId: environment.project_id },
            view,
          );
          if (!may.allow) return yield* refuse("forbidden", may.reason, log);
          return environment;
        });

      const refuse = (
        code: DeployRefused["code"],
        reason: DeployRefused["reason"],
        log: Readonly<Record<string, string>>,
      ) =>
        Effect.andThen(
          Effect.logInfo("a person's deploy refused", { ...log, reason }),
          Effect.fail(new DeployRefused({ code, reason })),
        );

      const queueGitAgain = (
        userId: string,
        environment: Environment,
        repo: string,
        expectedSha?: string,
      ) =>
        Effect.gen(function* () {
          const log = { userId, appId: environment.app_id, name: environment.name, service: repo };
          const lock = yield* lockOf(environment.id);
          return yield* Semaphore.withPermit(
            lock,
            leader.write(
              Effect.gen(function* () {
                const wanted = yield* wantedOf(environment);
                const target = wanted.targets.find((target) => target.repo === repo);
                if (target === undefined)
                  return yield* refuse("deploy_not_found", "deploy_not_found", log);
                if (expectedSha !== undefined && target.sha !== expectedSha)
                  return yield* refuse("conflict", "deploy_superseded", log);
                const blocked =
                  yield* sql`SELECT id FROM hq_deploy_job WHERE environment_id=${environment.id} AND kind='push' AND state IN ('submitting','unresolved') LIMIT 1`;
                if (blocked.length > 0) return yield* refuse("conflict", "deploy_running", log);
                const [made] = yield* sql<{ readonly id: string }>`INSERT INTO hq_rollout
            (app_id,cause,environment_id,environment_created_at,repo,sha,by,planned_at)
            VALUES (${environment.app_id}::uuid,'run_again',${environment.id},${environment.created_at}::timestamptz,${target.repo},${target.sha},${userId},now()) RETURNING id::text`;
                yield* makePushJob(made!.id, environment, target, userId);
                return made!.id;
              }),
            ),
          );
        });
      const gitEnvironment = Effect.fnUntraced(function* (
        userId: string,
        intent: HqGitTargetIntent,
      ) {
        const view = yield* roles.forWrite;
        const log = { userId, appId: intent.appId };
        if (view.orgId !== intent.orgId) return yield* refuse("forbidden", "app_not_seen", log);
        if (!("environmentId" in intent))
          return yield* refuse("environment_not_found", "environment_not_found", log);
        const [row] = yield* sql<{
          readonly name: string;
        }>`SELECT name FROM hq_environment WHERE id=${intent.environmentId} AND app_id::text=${intent.appId} AND target='git'`;
        if (!row) return yield* refuse("environment_not_found", "environment_not_found", log);
        return yield* personsEnvironment(userId, intent.appId, row.name, log);
      });
      return Deploys.of({
        gitReceipt: (userId, requestId, intent) =>
          decidedFresh(
            Effect.gen(function* () {
              yield* gitEnvironment(userId, intent);
              return yield* readGitReceipt(sql, userId, requestId, intent);
            }),
          ),
        runGitAgain: (userId, requestId, intent) =>
          decidedFresh(
            Effect.gen(function* () {
              const environment = yield* gitEnvironment(userId, intent);
              const receipt = yield* keepGitReceipt(
                sql,
                leader,
                userId,
                requestId,
                intent,
                Effect.gen(function* () {
                  const rollout = yield* queueGitAgain(userId, environment, intent.repo);
                  return yield* decodeDeliveryAnswer(yield* answerOf(rollout)).pipe(Effect.orDie);
                }),
                true,
              );
              yield* tick;
              yield* worked(environment.id);
              return receipt;
            }),
          ),
        operations: (appId) => operationRecords(sql, appId),
        blocker: (environmentId) =>
          Effect.map(openJob(environmentId), (job) =>
            job === undefined ? undefined : { job: job.id, state: job.state, label: job.label },
          ),
        withEnvironment: (environmentId, effect) =>
          Semaphore.withPermit(
            registry,
            Effect.gen(function* () {
              const [pending] = yield* sql<{
                readonly state: string;
                readonly recovery: boolean;
                readonly drained: boolean;
              }>`
            SELECT state,evidence->>'phase'='recovering' AS recovery,
              coalesce((evidence->>'writerDrained')::boolean,false) AS drained
            FROM hq_deploy_job WHERE environment_id=${environmentId} AND kind='push'
              AND state IN ('submitting','unresolved') ORDER BY id LIMIT 1`;
              if (
                pending !== undefined &&
                (!pending.drained || (pending.state === "submitting" && !pending.recovery))
              )
                return yield* new DeployRefused({ code: "conflict", reason: "deploy_running" });
              const worker = workers.get(environmentId);
              if (worker !== undefined && pending?.recovery) {
                yield* Fiber.interrupt(worker);
                workers.delete(environmentId);
              }
              const lock = yield* lockOf(environmentId);
              return yield* Semaphore.withPermit(lock, effect);
            }),
          ),
        writerDrained: (environmentId) =>
          Effect.map(
            sql<{ readonly blocked: boolean }>`SELECT EXISTS (
          SELECT 1 FROM hq_deploy_job WHERE environment_id=${environmentId} AND kind='push'
            AND state IN ('submitting','unresolved') AND coalesce((evidence->>'writerDrained')::boolean,false)=false) AS blocked`,
            ([row]) => !row!.blocked,
          ),
        run,
        runOf: (event) =>
          event.cause === "key_kept" && "appId" in event
            ? Effect.gen(function* () {
                const rows = yield* sql<{
                  readonly id: string;
                }>`SELECT DISTINCT ON (environment_id) id::text
              FROM hq_rollout WHERE app_id::text=${event.appId} AND cause='key_kept' AND repo=${event.repo} AND by=${event.by}
              ORDER BY environment_id,id DESC`;
                const answers = yield* Effect.forEach(rows, ({ id }) => run(id));
                const notes = answers.flatMap((answer) =>
                  answer.note === null ? [] : [answer.note],
                );
                return {
                  jobs: answers.flatMap((answer) => answer.jobs),
                  note: notes.length === 0 ? null : notes.join("; "),
                };
              })
            : Effect.flatMap(rolloutOf(sql, event), (id) =>
                id === undefined ? Effect.succeed(NO_DEPLOYS) : run(id),
              ),
        changes: SubscriptionRef.changes(ticks),
        drain: Effect.suspend(() =>
          Effect.forEach([...workers.values()], Fiber.join, { discard: true }),
        ).pipe(Effect.repeat({ until: () => workers.size === 0 })),
        // A deploy cannot be taken back: each is asked over roles read for it alone.
        redeploy: (userId, appId, name, service, sha) =>
          decidedFresh(
            Effect.gen(function* () {
              const log = { userId, appId, name, service };
              const environment = yield* personsEnvironment(userId, appId, name, log);
              if (environment.target === "git") {
                const rollout = yield* queueGitAgain(userId, environment, service, sha);
                yield* tick;
                return yield* run(rollout);
              }
              const asked = yield* leader.write(
                Effect.gen(function* () {
                  const [repeated] = yield* sql<{
                    readonly id: string;
                    readonly state: string;
                    readonly repo: string;
                    readonly label: string | null;
                    readonly ord: number;
                    readonly newest: boolean;
                    readonly waiting: boolean;
                  }>`
                    SELECT id::text AS id, state, repo, label, ord,
                      coalesce(evidence->>'phase' = 'waiting-for-build' AND process_id IS NULL AND ended_at IS NULL, false) AS waiting,
                      id = (
                      SELECT max(id) FROM hq_deploy_job
                      WHERE environment_id = ${environment.id} AND kind = 'deploy'
                        AND service = ${service}
                    ) AS newest
                    FROM hq_deploy_job
                    WHERE environment_id = ${environment.id} AND kind = 'deploy'
                      AND service = ${service} AND sha = ${sha}
                    ORDER BY id DESC LIMIT 1`;
                  if (repeated === undefined) return { refused: "deploy_not_found" } as const;
                  if (!repeated.newest) return { refused: "deploy_superseded" } as const;
                  if (IN_FLIGHT.has(repeated.state) && !repeated.waiting)
                    return { refused: "deploy_running" } as const;
                  if (repeated.waiting) {
                    const superseded = yield* sql`
                      UPDATE hq_deploy_job
                      SET state = 'superseded', ended_at = now(), updated_at = now(),
                        reason = 'A person explicitly asked Run again while waiting for Zerops to start the build',
                        evidence = evidence || jsonb_build_object('phase', 'closed',
                          'nextActor', 'none', 'nextAction', 'Superseded by explicit Run again')
                      WHERE id = ${repeated.id}::bigint AND process_id IS NULL AND ended_at IS NULL
                        AND evidence->>'phase' = 'waiting-for-build'
                      RETURNING id`;
                    if (superseded.length === 0) return { refused: "deploy_running" } as const;
                  }
                  const [rollout] = yield* sql<{ readonly id: string }>`
                    INSERT INTO hq_rollout (app_id, cause, environment_id, project_id, service, sha, by, planned_at)
                    VALUES (${appId}::uuid, 'run_again', ${environment.id}, ${environment.project_id}, ${service},
                      ${sha}, ${userId}, now())
                    RETURNING id::text AS id`;
                  yield* makeJob(
                    rollout!.id,
                    { id: environment.id, project_id: environment.project_id },
                    {
                      service,
                      repo: repeated.repo,
                      sha,
                      label: repeated.label,
                      ord: repeated.ord,
                    },
                    "run_again",
                    userId,
                    undefined,
                  );
                  return { rollout: rollout!.id } as const;
                }),
              );
              if ("refused" in asked) {
                return yield* refuse(
                  asked.refused === "deploy_not_found" ? "deploy_not_found" : "conflict",
                  asked.refused,
                  log,
                );
              }
              yield* tick;
              return yield* run(asked.rollout);
            }),
          ),
        addService: (userId, appId, name, service) =>
          decidedFresh(
            Effect.gen(function* () {
              const log = { userId, appId, name, service };
              const environment = yield* personsEnvironment(userId, appId, name, log);
              if (environment.target === "git")
                return yield* refuse("conflict", "service_not_declared", log);
              const declared = yield* declaredOf(appId, environment.tier);
              if (
                declared === undefined ||
                !declared.services.some((candidate) => candidate.hostname === service)
              ) {
                return yield* refuse("conflict", "service_not_declared", log);
              }
              const rollout = yield* leader.write(
                Effect.gen(function* () {
                  const [made] = yield* sql<{ readonly id: string }>`
                    INSERT INTO hq_rollout (app_id, cause, environment_id, project_id, service, by, planned_at)
                    VALUES (${appId}::uuid, 'add_service', ${environment.id}, ${environment.project_id}, ${service},
                      ${userId}, now())
                    RETURNING id::text AS id`;
                  yield* sql`
                    INSERT INTO hq_deploy_job (rollout_id, kind, environment_id, project_id, services, ord, state,
                      requested_by)
                    VALUES (${made!.id}::bigint, 'delta', ${environment.id}, ${environment.project_id},
                      ${textArray([service])}, -1, 'queued', ${userId})`;
                  return made!.id;
                }),
              );
              yield* tick;
              return yield* run(rollout);
            }),
          ),
      });
    }),
  ).pipe(
    Layer.provide(
      options.pushLayer ??
        gitPushLayer.pipe(
          Layer.provide(
            repoRemotesLayer.pipe(
              Layer.provide(changesLayer),
              Layer.provide(
                githubProbesLayer.pipe(
                  Layer.provide(
                    gitTransportLayer.pipe(Layer.provide(NodeHttpClient.layerNodeHttp)),
                  ),
                ),
              ),
            ),
          ),
        ),
    ),
  );
