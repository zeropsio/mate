// @effect-diagnostics nodeBuiltinImport:off -- a commit's archive comes from git as a Node stream;
// a tier's digest is the system's SHA-256.
/**
 * Deploying an application's stage and production environments (SPEC §3.2b, §3.2d), where main's
 * broker and each repository's workflow did it (main B, C). When `main` of one of an application's
 * repositories moves, every stage environment that follows `main` gets the services its stage tier
 * builds from that repository (`tierRuntimes.ts`, main B10/B11): the exact commit's archive, deployed
 * with the tier's setup by the environment's own deploy token, its version named `main <7 hex>`
 * (B15/B16). When a release is made, every production environment gets its application's newest
 * approved release by version (`releases.ts`, C15/C16): each service its production tier builds at
 * the commit the release lists, named `<tag> <7 hex>`; a service it does not list is reported, and
 * the rest deploy.
 *
 * - **Live is what runs**: a deploy is live only once the service runs the version HQ made for the
 *   commit (B17), as HQ recorded it — never what a version's name spells (audit N7); an HTTP
 *   service created for HQ to deploy — by the person's client, which said so at the attach, or by
 *   HQ's own recipe delta — gets its subdomain once its first deploy is live, with the same token
 *   (E13, measured 2026-10-02 — HQ's org Read only token may not), and on no other: a later deploy
 *   or a catch-up turns on nothing a person turned off (audit R1, D6).
 * - **One queue per environment, the newest wins** (B20): its services one after another, higher
 *   priority first (B19); a commit main moved past while a deploy ran is never deployed.
 * - **A build's own failure is final** (B37): only a person asks for that commit again. HQ's own
 *   refusals — no key (E08), or one that no longer answers or now reaches more than its project
 *   (checked again at every hand-over, `deployTokens.ts`), a Zerops that did not answer, git that
 *   failed — are asked again by the next pass (B38).
 * - **A build is submitted once** (audit H6): Zerops takes no idempotency key, so the version HQ
 *   makes for a commit is recorded before its archive goes up, and its build's job once
 *   build-and-deploy answers. However long the build takes, and after a lost answer or a restart,
 *   each pass reads that job, else that version, where it stands — never a second version or build
 *   of the commit while the first builds or its fate is unknown. A version still waiting for its
 *   archive was never submitted, and the commit is deployed anew.
 * - **A stage's first deploy waits for code** (F17, main #162): while HQ has recorded no deploy of
 *   a stage's service and main's head has no `zerops.yaml` carrying the tier's setup, nothing is
 *   asked or recorded — the stage reads "Nothing deployed yet" — and the next merge deploys it.
 *   Production moves only on a release, and never waits.
 * - **Every pass is a catch-up**: at takeover and every 5 min, each environment's wanted commits
 *   against what its services run (B22); `main` moving asks only for the commits with no deploy
 *   yet. Only the leading Core deploys.
 * - **A tier that changed adds what it declares** (main D15): before a pass deploys, every
 *   environment of a tier whose import file changed since HQ last saw it gets the services it
 *   lacks, created empty where HQ deploys them (`recipeDeltas.ts`). A changed declaration of a
 *   service the project has is reported, never applied; a service the tier no longer declares is
 *   reported, never deleted. What HQ saw is kept in its database (`hq_recipe_seen`): a tier first
 *   seen is the one its environments were made from and imports nothing, and after a restart the
 *   first pass is a pass like any other — main's broker forgot it, so its first pass only
 *   reported (D16).
 *
 * A deploy's record (`hq_deploy`) is per environment, service and commit: pending, deploying, live
 * or failed — the build's own (`job`) or HQ's (`refused`) — with the platform's version and job.
 * The hostname names it; the service's id says whose it is (audit N6): a record made for a service
 * its hostname no longer names — deleted, another made under the same hostname — starts afresh for
 * the one there now, which a final failure of its predecessor's never holds back.
 * The deploy token never leaves Core: no record, log or error carries it.
 *
 * @module deploys
 */
import * as NodeCrypto from "node:crypto";
import type * as NodeStream from "node:stream";

import type { HqGit } from "@t3tools/hq-git";
import { zeropsDidNotAnswer } from "@t3tools/shared/hqDeploys";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import { REASONS, can } from "@t3tools/shared/zeropsPermissions";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { deadDeployToken, noDeployToken, reachesOnly, widenedDeployToken } from "./deployTokens.ts";
import { GitHost } from "./gitHost.ts";
import { Leader, NotLeader } from "./leader.ts";
import { type TierService, deltaImport, deployedByHq, tierServices } from "./recipeDeltas.ts";
import { RecipeTiers } from "./recipeTiers.ts";
import { Releases } from "./releases.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { tierRuntimes } from "./tierRuntimes.ts";
import { sameCommit, versionName, versionSha } from "./versionNames.ts";
import { ZeropsApi, ZeropsDeploy, type ZeropsError, type ZeropsService } from "./zerops/api.ts";

export interface DeploysOptions {
  /** How often every environment is caught up with what it runs (B22); 5 min. */
  readonly catchUpEvery?: Duration.Duration;
  /** How often a running deploy's job is read; 10 s. */
  readonly pollEvery?: Duration.Duration;
  /** How long one pass watches a running deploy before the next reads it again; 20 min. */
  readonly patience?: Duration.Duration;
}

/** An environment the migration brought, as `Deploys.hold` left each of its services. */
export interface HeldEnvironment {
  readonly projectId: string;
  readonly name: string;
  readonly services: ReadonlyArray<{
    readonly service: string;
    /** The commit it is wanted at. */
    readonly sha: string;
    readonly state: "live" | "held";
    /** What it runs: the commit its version's name spells, else that name. */
    readonly runs: string;
  }>;
}

/** A person's ask HQ refused: a code, and the reason (a permission's, or the deploy's own). */
export class DeployRefused extends Schema.TaggedError<DeployRefused>()("DeployRefused", {
  code: Schema.Literals(["forbidden", "environment_not_found", "deploy_not_found", "conflict"]),
  reason: Schema.Literals([
    ...REASONS,
    "environment_not_found",
    "deploy_not_found",
    "deploy_not_failed",
    "deploy_superseded",
  ]),
}) {}

export class Deploys extends Context.Service<
  Deploys,
  {
    /** Every stage environment's wanted commits against what its services run (B22). */
    readonly catchUp: Effect.Effect<void, NotLeader>;
    /**
     * A person's "Run again" (main B36) of the newest deploy of `service` in the application's
     * environment `name`, failed — its build's own failure included, which only a person may ask
     * for again (B37): by whoever develops the application (`redeploy`). The deploy waits again,
     * says who asked, and its environment's queue takes it now.
     */
    readonly redeploy: (
      userId: string,
      appId: string,
      name: string,
      service: string,
      sha: string,
    ) => Effect.Effect<void, DeployRefused | NotLeader | SqlError | ZeropsError>;
    /** Ticks after every change of a deploy's record, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
    /**
     * Migration only (T13; it goes with T14): the environments of `projectIds` as the import
     * brought them — no key yet, so read with HQ's own `credential`. A service that runs the
     * commit it is wanted at is live; any other is held: its deploy's record is the build's own
     * failure, final until a person's Run (B37), in HQ's words for why. Whatever a keyless pass
     * recorded before is overridden, so a first key deploys nothing nobody asked for.
     */
    readonly hold: (
      projectIds: ReadonlyArray<string>,
      credential: Redacted.Redacted,
    ) => Effect.Effect<ReadonlyArray<HeldEnvironment>, NotLeader | SqlError | ZeropsError>;
    /**
     * Migration only (T13; it goes with T14): every tier of the applications `appIds`' environments
     * seen as it is now, as a tier first seen would be — so the recipe the import rewrote is the
     * baseline, and no pass takes the rewrite for a change to import.
     */
    readonly baseline: (appIds: ReadonlyArray<string>) => Effect.Effect<void, NotLeader | SqlError>;
  }
>()("@t3tools/hq/deploys") {}

/** A commit an environment's service is wanted at. */
interface Target {
  readonly projectId: string;
  readonly envName: string;
  readonly appId: string;
  readonly service: string;
  readonly repo: string;
  readonly sha: string;
  readonly setup: string;
  /** What its version is named by: `main`, or the release's tag. */
  readonly label: string;
}

/** Where a deploy ended, if it ended: live, with the version it runs where HQ learnt it here. */
type Ended =
  | { readonly state: "live"; readonly appVersionId?: string }
  | { readonly state: "failed"; readonly failure: "job" | "refused"; readonly message: string };

const job = (message: string): Ended => ({ state: "failed", failure: "job", message });
const refused = (message: string): Ended => ({ state: "failed", failure: "refused", message });

const encodeBlocks = Schema.encodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

/** A record's words are at most 240 characters (main B27). */
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

/**
 * Whether a service runs `sha` as a version's name spells it: the version it names is the one it
 * runs, and its name spells the commit. Read only where HQ kept no version it made — the import's
 * hold (T13), and a record called live before HQ kept them — never as what HQ's own deploy runs
 * (audit N7).
 */
const spellsRunning = (service: ZeropsService, sha: string) =>
  service.named !== null &&
  service.activeVersionId === service.named.id &&
  sameCommit(versionSha(service.named.name), sha);

/** What a service runs, in a person's words: the commit its version's name spells, else that name. */
const runningOf = (service: ZeropsService | undefined) => {
  if (service === undefined) return "nothing";
  if (service.named === null) return "a version with no name";
  const spelled = versionSha(service.named.name);
  return spelled === "" ? service.named.name : short(spelled);
};

/** What a Zerops failure means for a deploy: a verdict on the commit, or HQ's own refusal. */
const zeropsEnded = (target: Target, error: ZeropsError): Ended => {
  if (error._tag === "ZeropsUnavailable") return refused(zeropsDidNotAnswer(error.message));
  switch (error.reason) {
    case "invalid":
      return job(`Zerops refused the deploy: ${error.code}`);
    case "not_found":
      return refused(`Zerops no longer has what the deploy names: ${error.code}`);
    default:
      return refused(`${target.envName}'s deploy token was refused: ${error.code}`);
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

export const deploysLayer = (
  options: DeploysOptions = {},
): Layer.Layer<
  Deploys,
  never,
  Leader | SqlClient.SqlClient | GitHost | Roles | ZeropsApi | ZeropsDeploy | RecipeTiers | Releases
> =>
  Layer.effect(
    Deploys,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const sql = yield* SqlClient.SqlClient;
      const gitHost = yield* GitHost;
      const zerops = yield* ZeropsApi;
      const deploy = yield* ZeropsDeploy;
      const recipes = yield* RecipeTiers;
      const roles = yield* Roles;
      const releases = yield* Releases;
      const catchUpEvery = options.catchUpEvery ?? Duration.minutes(5);
      const pollEvery = options.pollEvery ?? Duration.seconds(10);
      const patience = options.patience ?? Duration.minutes(20);
      const ticks = yield* SubscriptionRef.make(0);
      const tick = SubscriptionRef.update(ticks, (n) => n + 1);

      /** The runtimes a tier of the application builds, as its recipe's `main` declares them. */
      const runtimesOf = (appId: string, tier: "stage" | "production") =>
        Effect.gen(function* () {
          const read = yield* recipes.read(appId, tier).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(`${tier} tier unreadable`, { appId, error }),
            ),
            Effect.option,
          );
          if (Option.isNone(read) || read.value.state === "absent") return [];
          const runtimes = tierRuntimes(read.value.importYaml, appId);
          if (!runtimes.ok) {
            yield* Effect.logWarning(`${tier} tier refused`, { appId, problem: runtimes.problem });
            return [];
          }
          return runtimes.runtimes;
        });

      type Wanted = ReadonlyArray<Omit<Target, "projectId" | "envName">>;

      /** A stage's: each runtime at the head of its repository's `main` (B10). */
      const stageWanted = (appId: string): Effect.Effect<Wanted, SqlError> =>
        Effect.gen(function* () {
          const runtimes = yield* runtimesOf(appId, "stage");
          const heads = new Map(
            (yield* sql<{ readonly name: string; readonly main_head: string | null }>`
              SELECT name, main_head FROM hq_repo WHERE app_id::text = ${appId}`).map(
              (row) => [row.name, row.main_head] as const,
            ),
          );
          return runtimes.flatMap((runtime) => {
            const sha = heads.get(runtime.repo);
            return sha === undefined || sha === null
              ? []
              : [
                  {
                    appId,
                    service: runtime.hostname,
                    repo: runtime.repo,
                    sha,
                    setup: runtime.zeropsSetup,
                    label: "main",
                  },
                ];
          });
        });

      /**
       * A production's: each runtime at the commit the newest approved release lists (C16) — none
       * before a release, which is no failure; a runtime it does not list, and a service it lists
       * that production no longer builds, are reported, and the rest deploy.
       */
      const productionWanted = (appId: string): Effect.Effect<Wanted, SqlError> =>
        Effect.gen(function* () {
          const release = yield* releases.newest(appId);
          if (release === undefined) return [];
          const runtimes = yield* runtimesOf(appId, "production");
          const listed = new Map(release.entries.map((entry) => [entry.service, entry.sha]));
          const unlisted = runtimes.filter((runtime) => !listed.has(runtime.hostname));
          if (unlisted.length > 0) {
            yield* Effect.logWarning("production services not in the release", {
              appId,
              release: release.tag,
              services: unlisted.map((runtime) => runtime.hostname),
            });
          }
          const built = new Set(runtimes.map((runtime) => runtime.hostname));
          const gone = release.entries.filter((entry) => !built.has(entry.service));
          if (gone.length > 0) {
            yield* Effect.logWarning("release services production no longer builds", {
              appId,
              release: release.tag,
              services: gone.map((entry) => entry.service),
            });
          }
          return runtimes.flatMap((runtime) => {
            const sha = listed.get(runtime.hostname);
            return sha === undefined
              ? []
              : [
                  {
                    appId,
                    service: runtime.hostname,
                    repo: runtime.repo,
                    sha,
                    setup: runtime.zeropsSetup,
                    label: release.tag,
                  },
                ];
          });
        });

      /** Every environment HQ deploys, and the commit each of its runtimes is wanted at. */
      const wanted = Effect.gen(function* () {
        const environments = yield* sql<{
          readonly project_id: string;
          readonly app_id: string;
          readonly name: string;
          readonly tier: "stage" | "production";
        }>`
          SELECT project_id, app_id::text AS app_id, name, tier FROM hq_environment
          WHERE (tier = 'stage' AND 'main' = ANY (sources))
             OR (tier = 'production' AND 'release' = ANY (sources))
          ORDER BY declared_seq`;
        const byTier = new Map<string, Wanted>();
        for (const environment of environments) {
          const key = `${environment.app_id}/${environment.tier}`;
          if (byTier.has(key)) continue;
          byTier.set(
            key,
            environment.tier === "stage"
              ? yield* stageWanted(environment.app_id)
              : yield* productionWanted(environment.app_id),
          );
        }
        return environments.flatMap((environment) => {
          const targets = byTier.get(`${environment.app_id}/${environment.tier}`) ?? [];
          return targets.length === 0
            ? []
            : [
                {
                  projectId: environment.project_id,
                  name: environment.name,
                  tier: environment.tier,
                  targets: targets.map((target): Target => ({
                    ...target,
                    projectId: environment.project_id,
                    envName: environment.name,
                  })),
                },
              ];
        });
      });

      const recordOf = (target: Target) =>
        Effect.map(
          sql<{
            readonly service_id: string | null;
            readonly state: string;
            readonly failure: string | null;
            readonly app_version_id: string | null;
            readonly process_id: string | null;
          }>`
            SELECT service_id, state, failure, app_version_id, process_id
            FROM hq_deploy
            WHERE project_id = ${target.projectId} AND service = ${target.service}
              AND sha = ${target.sha}`,
          (rows) => rows[0],
        );

      /**
       * The record of `target` now `state`: written by the leader, told to the structure. `over`
       * says what record it may replace, judged in the write itself, so a record written between a
       * read and this write is never lost: `any`; `none`, a first record only; `unsettled`, neither
       * a live one, a build's own failure (a hold's, B37), nor a build HQ submitted, whose fate HQ
       * reads (audit H6). What it does not replace stays, untold. A deploying write says its build's
       * job as far as it is known: none until build-and-deploy answered.
       * `serviceId` is the service it is now for, where the write says it (audit N6).
       */
      const record = (
        target: Target,
        row:
          | { readonly state: "pending" }
          | {
              readonly state: "deploying";
              readonly appVersionId: string;
              /** Its build's job, once build-and-deploy answered. */
              readonly processId?: string;
            }
          | Ended,
        over: "any" | "none" | "unsettled" = "any",
        serviceId?: string,
      ) =>
        Effect.flatMap(
          leader.write(sql`
            INSERT INTO hq_deploy (project_id, service, sha, repo, state, failure, message,
              app_version_id, process_id, service_id)
            VALUES (${target.projectId}, ${target.service}, ${target.sha}, ${target.repo},
              ${row.state}, ${row.state === "failed" ? row.failure : null},
              ${row.state === "failed" ? cut(row.message) : null},
              ${row.state === "deploying" || row.state === "live" ? (row.appVersionId ?? null) : null},
              ${row.state === "deploying" ? (row.processId ?? null) : null}, ${serviceId ?? null})
            ON CONFLICT (project_id, service, sha) ${
              over === "none"
                ? sql`DO NOTHING`
                : sql`DO UPDATE SET
              state = EXCLUDED.state, failure = EXCLUDED.failure, message = EXCLUDED.message,
              app_version_id = COALESCE(EXCLUDED.app_version_id, hq_deploy.app_version_id),
              process_id = CASE WHEN EXCLUDED.state = 'deploying' THEN EXCLUDED.process_id
                ELSE COALESCE(EXCLUDED.process_id, hq_deploy.process_id) END,
              service_id = COALESCE(EXCLUDED.service_id, hq_deploy.service_id),
              updated_at = now()
              ${
                over === "unsettled"
                  ? sql`WHERE hq_deploy.state NOT IN ('live', 'deploying')
                      AND hq_deploy.failure IS DISTINCT FROM 'job'`
                  : sql``
              }`
            }
            RETURNING 1`),
          // Told only when it wrote.
          (written) => (written.length > 0 ? tick : Effect.void),
        );

      /**
       * Whether `service` runs `target`'s commit: the version it runs is one HQ made for that service
       * from that repository's commit, as HQ recorded it (audit N6, N7) — never what a version's name
       * spells.
       */
      const runsTarget = (target: Target, service: ZeropsService) =>
        service.activeVersionId === null
          ? Effect.succeed(false)
          : Effect.map(
              sql<{ readonly repo: string; readonly sha: string }>`
                SELECT repo, sha FROM hq_deploy
                WHERE project_id = ${target.projectId} AND service_id = ${service.id}
                  AND app_version_id = ${service.activeVersionId}`,
              (rows) => rows.some((row) => row.repo === target.repo && row.sha === target.sha),
            );

      const tokenOf = (projectId: string) =>
        Effect.map(
          sql<{ readonly token: string }>`
            SELECT token FROM hq_deploy_token WHERE project_id = ${projectId}`,
          (rows) => (rows[0] === undefined ? undefined : Redacted.make(rows[0].token)),
        );

      /**
       * After HQ's own verified deploy: an HTTP service's subdomain, which never fails the deploy
       * (B17). Never on a catch-up of a service that already runs its commit (audit R1).
       */
      const openSubdomain = (service: ZeropsService, token: Redacted.Redacted) =>
        service.http && !service.subdomainAccess
          ? deploy
              .enableSubdomainAccess(service.id)(token)
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("subdomain access not turned on", {
                    service: service.name,
                    error,
                  }),
                ),
                Effect.asVoid,
              )
          : Effect.void;

      /**
       * Whether HQ turns `target`'s subdomain on as its deploy goes live: its service was created
       * for HQ to deploy (`hq_subdomain_intent`: its project's attach said so, or HQ's recipe delta
       * imported it), and this is its first deploy HQ sees live (audit R1, D6).
       */
      const intendedFor = (target: Target) =>
        Effect.map(
          sql`
            SELECT 1 FROM hq_subdomain_intent
            WHERE project_id = ${target.projectId}
              AND (service IS NULL OR service = ${target.service})
              AND NOT EXISTS (
                SELECT 1 FROM hq_deploy
                WHERE project_id = ${target.projectId} AND service = ${target.service}
                  AND state = 'live' AND sha <> ${target.sha}
              )`,
          (rows) => rows.length > 0,
        );

      /**
       * HQ's own deploy of `target`, live: its subdomain turned on where it was intended, and its
       * service's intent spent. A project's own row stays, for each of its services is first
       * deployed once. Never fails the deploy.
       */
      const openIfIntended = (target: Target, service: ZeropsService, token: Redacted.Redacted) =>
        Effect.gen(function* () {
          if (!(yield* intendedFor(target))) return;
          yield* openSubdomain(service, token);
          yield* leader.write(sql`
            DELETE FROM hq_subdomain_intent
            WHERE project_id = ${target.projectId} AND service = ${target.service}`);
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("subdomain intent not read", { service: service.name, error }),
          ),
        );

      /**
       * The deploy of `versionId`, the version HQ made for `target`, as Zerops says it stands (audit
       * H6): read by its build's job where HQ heard it, else by the version itself, until it ends or
       * `patience` passes. Live once the service runs the version; the build's own failure; never
       * submitted, where its version still waits for its archive; or — still running, or not to be
       * read now — nothing yet: the next pass reads again, and never submits it again meanwhile.
       */
      const watch = (
        target: Target,
        token: Redacted.Redacted,
        serviceId: string,
        versionId: string,
        processId: string | null,
      ): Effect.Effect<Ended | "unsubmitted" | undefined> => {
        /** Where it stands once its build ended well: what the service runs. */
        const landed = Effect.gen(function* () {
          const service = yield* zerops.service(serviceId)(token);
          if (service.activeVersionId === versionId) {
            yield* openIfIntended(target, service, token);
            return { state: "live" } as const;
          }
          // Its build is the last one started, and not yet what the service runs.
          if (service.named?.id === versionId) return undefined;
          const other =
            service.named !== null && service.named.id === service.activeVersionId
              ? `"${service.named.name}"`
              : "another version";
          return job(`the deploy finished, but ${target.service} runs ${other}`);
        });
        /** Where it stands by its version's own status. */
        const byVersion = Effect.gen(function* () {
          const { status } = yield* deploy.appVersion(versionId)(token);
          if (status === "UPLOADING") return "unsubmitted" as const;
          if (status === "ACTIVE" || status === "BACKUP") return yield* landed;
          if (VERSION_FAILURES.has(status)) return job(`failed: the version is ${status}`);
          return undefined;
        });
        const byJob = (id: string) =>
          Effect.gen(function* () {
            const process = yield* deploy.process(id)(token);
            if (process.status === "FAILED" || process.status === "CANCELED") {
              return job(`failed: ${process.failure ?? "the build failed"}`);
            }
            if (process.status !== "FINISHED") return undefined;
            return yield* landed;
          }).pipe(
            // A job Zerops no longer keeps says nothing: its version does.
            Effect.catchIf(
              (error) => error._tag === "ZeropsRefused" && error.reason === "not_found",
              () => byVersion,
            ),
          );
        const once = (processId === null ? byVersion : byJob(processId)).pipe(
          // A version Zerops no longer has was never built: HQ's own refusal, asked again.
          Effect.catchIf(
            (error) =>
              error._tag === "ZeropsRefused" &&
              error.reason === "not_found" &&
              error.operation === "appVersion",
            (error) => Effect.succeed(zeropsEnded(target, error)),
          ),
          // What cannot be read now says nothing of the build: it is read again, never submitted.
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("a deploy's build not read", {
                environment: target.envName,
                service: target.service,
                error,
              }),
              undefined,
            ),
          ),
        );
        const untilEnded = Effect.gen(function* () {
          for (;;) {
            const ended = yield* once;
            if (ended !== undefined) return ended;
            yield* Effect.sleep(pollEvery);
          }
        });
        return untilEnded.pipe(Effect.timeoutOption(patience), Effect.map(Option.getOrUndefined));
      };

      /** The commit's `zerops.yaml` under the first name zcli looks for, as read; none without one. */
      const zeropsYamlOf = (git: HqGit, target: Target) =>
        Effect.gen(function* () {
          const repo = { appId: target.appId, id: target.repo };
          const root = yield* git.tree(repo, target.sha, "");
          const name = YAML_NAMES.find((candidate) =>
            root.items.some((entry) => entry.path === candidate && entry.type === "blob"),
          );
          if (name === undefined) return undefined;
          return { name, read: yield* git.file(repo, target.sha, name, YAML_MAX) };
        });

      /** The archive and `zerops.yaml` of the commit, or why the commit cannot deploy. */
      const commitOf = (git: HqGit, target: Target) =>
        Effect.gen(function* () {
          const yaml = yield* zeropsYamlOf(git, target);
          if (yaml === undefined) {
            return job(`${target.repo} has no zerops.yaml at ${short(target.sha)}`);
          }
          const { name, read } = yaml;
          if (read.truncated) {
            return job(`${name} of ${target.repo} at ${short(target.sha)} is larger than 1 MiB`);
          }
          const archive = yield* Effect.flatMap(
            git.archive({ appId: target.appId, id: target.repo }, target.sha),
            (stream) => readWhole(stream, ARCHIVE_MAX),
          );
          if (archive === undefined) {
            return job(
              `the archive of ${target.repo} at ${short(target.sha)} is larger than 512 MiB`,
            );
          }
          return { zeropsYaml: read.content.toString("utf8"), archive };
        });

      /**
       * Whether a stage's first deploy waits for main (F17, main #162): HQ has recorded no deploy
       * of the service there, and `target`'s commit has no `zerops.yaml` carrying the tier's setup,
       * so the next merge deploys it. A `zerops.yaml` HQ cannot read deploys: what is wrong with it
       * is Zerops' to say. Once a deploy was recorded there, a commit with none is its own failure.
       */
      const waitsForMain = (target: Target) =>
        Effect.gen(function* () {
          const deployed = yield* sql`
            SELECT 1 FROM hq_deploy
            WHERE project_id = ${target.projectId} AND service = ${target.service} LIMIT 1`;
          if (deployed.length > 0) return false;
          const git = yield* gitHost.git;
          const yaml = yield* zeropsYamlOf(git, target);
          if (yaml === undefined) return true;
          const setups = setupsOf(yaml.read.content.toString("utf8"));
          return setups !== undefined && !setups.includes(target.setup);
        }).pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));

      /** A refusal of HQ's own on `target`, unless it is live or its build's own failure stands. */
      const refuseUnsettled = (target: Target, ended: Ended) => record(target, ended, "unsettled");

      /**
       * The environment's key, checked as each pass hands its deploys over: none, one that no longer
       * answers or now reaches more than its project — marked invalid, logged once, for an admin
       * must mint a new one — or one HQ may deploy with. A Zerops that does not answer says nothing
       * of the key.
       */
      const keyOf = (projectId: string, envName: string) =>
        Effect.gen(function* () {
          const token = yield* tokenOf(projectId);
          if (token === undefined) return refused(noDeployToken(envName));
          const checked = yield* Effect.gen(function* () {
            const own = yield* zerops.ownToken(token).pipe(
              Effect.map(Option.some),
              Effect.catchTag("ZeropsRefused", () => Effect.succeed(Option.none())),
            );
            if (Option.isNone(own)) return deadDeployToken(envName);
            const { orgId } = yield* roles.view;
            return reachesOnly(own.value, orgId, projectId)
              ? undefined
              : widenedDeployToken(envName);
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed(
                refused(
                  error._tag === "ZeropsUnavailable"
                    ? zeropsDidNotAnswer(error.message)
                    : `HQ could not read its org: ${error.code}`,
                ),
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
       * What changed tiers added, imported into their environments (main D15), before a pass
       * deploys: per application and tier, its import file against what HQ last saw of it. What it
       * saw moves on only once every environment of the tier has what the tier declares.
       */
      const recipeDeltas = Effect.gen(function* () {
        const environments = yield* sql<{
          readonly project_id: string;
          readonly app_id: string;
          readonly tier: "stage" | "production";
          readonly name: string;
        }>`
          SELECT project_id, app_id::text AS app_id, tier, name FROM hq_environment
          ORDER BY declared_seq`;
        const groups = new Map<string, Array<(typeof environments)[number]>>();
        for (const environment of environments) {
          const key = `${environment.app_id}/${environment.tier}`;
          groups.set(key, [...(groups.get(key) ?? []), environment]);
        }
        for (const group of groups.values()) {
          const { app_id: appId, tier } = group[0]!;
          const read = yield* recipes.read(appId, tier).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("tier unreadable", { appId, tier, error }),
            ),
            Effect.option,
          );
          if (Option.isNone(read) || read.value.state === "absent") continue;
          const declared = tierServices(read.value.importYaml);
          if (!declared.ok) {
            yield* Effect.logWarning("tier refused", { appId, tier, problem: declared.problem });
            continue;
          }
          const digest = digestOf(read.value.importYaml);
          const [seen] = yield* sql<{
            readonly digest: string;
            readonly blocks: Readonly<Record<string, string>>;
          }>`
            SELECT digest, blocks FROM hq_recipe_seen
            WHERE app_id::text = ${appId} AND tier = ${tier}`;
          if (seen?.digest === digest) continue;
          let everywhere = true;
          for (const environment of group) {
            const done = yield* deltaOf(
              environment.project_id,
              environment.name,
              declared.services,
              seen,
            );
            if (!done) everywhere = false;
          }
          if (!everywhere) continue;
          yield* see(appId, tier, digest, declared.services);
        }
      });

      /** A tier's import file as HQ compares it with what it last saw. */
      const digestOf = (importYaml: string) =>
        NodeCrypto.createHash("sha256").update(importYaml).digest("hex");

      /** What HQ saw of a tier now `digest`, declaring `services`. */
      const see = (
        appId: string,
        tier: "stage" | "production",
        digest: string,
        services: ReadonlyArray<TierService>,
      ) =>
        leader.write(sql`
          INSERT INTO hq_recipe_seen (app_id, tier, digest, blocks)
          VALUES (${appId}::uuid, ${tier}, ${digest},
            ${encodeBlocks(Object.fromEntries(services.map((service) => [service.hostname, service.block])))}::jsonb)
          ON CONFLICT (app_id, tier) DO UPDATE SET
            digest = EXCLUDED.digest, blocks = EXCLUDED.blocks, seen_at = now()`);

      /**
       * One environment against its tier: the services it lacks imported — none where HQ sees the
       * tier for the first time — and what a delta never does reported. Whether it has them now.
       */
      const deltaOf = (
        projectId: string,
        envName: string,
        declared: ReadonlyArray<TierService>,
        seen: { readonly blocks: Readonly<Record<string, string>> } | undefined,
      ) =>
        Effect.gen(function* () {
          const key = yield* keyOf(projectId, envName);
          if (!("token" in key)) {
            yield* Effect.logWarning("recipe delta waits", {
              environment: envName,
              why: "message" in key ? key.message : key.state,
            });
            return false;
          }
          const present = new Set(
            (yield* zerops.services(projectId)(key.token))
              .filter((service) => !service.isSystem)
              .map((service) => service.name),
          );
          const hostnames = new Set(declared.map((service) => service.hostname));
          for (const name of present) {
            if (!hostnames.has(name)) {
              yield* Effect.logWarning(
                `${envName}: ${name} is in the project and no longer in the recipe; HQ never deletes a service`,
              );
            }
          }
          for (const service of declared) {
            const was = seen?.blocks[service.hostname];
            if (present.has(service.hostname) && was !== undefined && was !== service.block) {
              yield* Effect.logWarning(
                `${envName}: the recipe for ${service.hostname} changed — scaling and shape are reported, never applied to a service that exists`,
              );
            }
          }
          const missing = declared.filter((service) => !present.has(service.hostname));
          if (missing.length === 0) return true;
          if (seen === undefined) {
            yield* Effect.logWarning(
              `${envName}: the recipe declares ${missing.map((service) => service.hostname).join(", ")}, which the project does not have (reported, not imported: HQ sees this tier for the first time)`,
            );
            return true;
          }
          yield* deploy.importServices(projectId, deltaImport(missing))(key.token);
          // What HQ created to deploy gets its subdomain on its first deploy (audit R1, D6).
          const deployed = missing.filter((service) => deployedByHq(service.declaration));
          if (deployed.length > 0) {
            yield* leader.write(
              Effect.forEach(
                deployed,
                (service) => sql`
                  INSERT INTO hq_subdomain_intent (project_id, service)
                  VALUES (${projectId}, ${service.hostname})
                  ON CONFLICT DO NOTHING`,
                { discard: true },
              ),
            );
          }
          yield* Effect.logInfo("a recipe delta was imported", {
            environment: envName,
            services: missing.map((service) => service.hostname),
          });
          return true;
        }).pipe(
          Effect.catchTags({
            ZeropsRefused: (error) =>
              Effect.as(
                Effect.logWarning("recipe delta not imported", { environment: envName, error }),
                false,
              ),
            ZeropsUnavailable: (error) =>
              Effect.as(
                Effect.logWarning("recipe delta not imported", { environment: envName, error }),
                false,
              ),
          }),
        );

      /**
       * The record of `target` as the service its hostname names now holds it (audit N6): one with
       * no service yet — a pass's pending, or one from before HQ kept them — is that service's; one
       * made for another service, gone, starts afresh for this one, pending, still saying who asked
       * for the commit there.
       */
      const heldBy = (target: Target, service: ZeropsService) =>
        Effect.gen(function* () {
          const existing = yield* recordOf(target);
          if (existing === undefined || existing.service_id === service.id) return existing;
          yield* leader.write(
            existing.service_id === null
              ? sql`
                  UPDATE hq_deploy SET service_id = ${service.id}
                  WHERE project_id = ${target.projectId} AND service = ${target.service}
                    AND sha = ${target.sha} AND service_id IS NULL`
              : sql`
                  UPDATE hq_deploy
                  SET service_id = ${service.id}, state = 'pending', failure = NULL,
                      message = NULL, app_version_id = NULL, process_id = NULL,
                      updated_at = now()
                  WHERE project_id = ${target.projectId} AND service = ${target.service}
                    AND sha = ${target.sha} AND service_id = ${existing.service_id}`,
          );
          if (existing.service_id !== null) yield* tick;
          return yield* recordOf(target);
        });

      /** One service of an environment brought to `target.sha` with its key, as far as it goes now. */
      const deployOne = (target: Target, token: Redacted.Redacted) =>
        Effect.gen(function* () {
          // Which service the hostname names now: a record is its service's (audit N6).
          const read = yield* zerops
            .services(target.projectId)(token)
            .pipe(
              Effect.map((services) => ({
                service: services.find((candidate) => candidate.name === target.service),
              })),
              Effect.catchTags({
                ZeropsRefused: (error) => Effect.succeed({ ended: zeropsEnded(target, error) }),
                ZeropsUnavailable: (error) => Effect.succeed({ ended: zeropsEnded(target, error) }),
              }),
            );
          // What HQ could not read says nothing of a deploy settled or submitted (B37, audit H6).
          if ("ended" in read) return yield* refuseUnsettled(target, read.ended);
          const service = read.service;
          if (service === undefined) {
            // A build's own failure is final (B37).
            const before = yield* recordOf(target);
            if (before?.state === "failed" && before.failure === "job") return;
            yield* record(
              target,
              refused(`the environment's project has no service ${target.service}`),
            );
            return;
          }
          const ended = yield* Effect.gen(function* () {
            const existing = yield* heldBy(target, service);
            // A build's own failure is final (B37).
            if (existing?.state === "failed" && existing.failure === "job") return undefined;
            // A record called live before HQ kept the version a service runs takes over the
            // version its name spells as HQ named it, once (audit N7).
            if (
              existing?.state === "live" &&
              existing.app_version_id === null &&
              service.activeVersionId !== null &&
              spellsRunning(service, target.sha)
            ) {
              yield* leader.write(sql`
                UPDATE hq_deploy SET app_version_id = ${service.activeVersionId}
                WHERE project_id = ${target.projectId} AND service = ${target.service}
                  AND sha = ${target.sha} AND app_version_id IS NULL`);
            }
            if (yield* runsTarget(target, service)) {
              // Only HQ's own deploy, landed after its watch let go, opens the subdomain here: a
              // catch-up of a service that runs its commit turns on nothing a person turned off
              // (audit R1, D6).
              if (existing?.state === "deploying") yield* openIfIntended(target, service, token);
              return existing?.state === "live" ? undefined : ({ state: "live" } as const);
            }
            // A build HQ submitted is read where it stands, never submitted again (audit H6) —
            // unless its version still waits for its archive: never submitted at all.
            if (existing?.state === "deploying" && existing.app_version_id !== null) {
              const where = yield* watch(
                target,
                token,
                service.id,
                existing.app_version_id,
                existing.process_id,
              );
              if (where !== "unsubmitted") return where;
            }
            const git = yield* gitHost.git;
            const commit = yield* commitOf(git, target);
            if ("state" in commit) return commit;
            // A commit main moved past is never deployed (B20): its pending record goes.
            yield* leader.write(sql`
              DELETE FROM hq_deploy
              WHERE project_id = ${target.projectId} AND service = ${target.service}
                AND sha <> ${target.sha} AND state = 'pending'`);
            yield* tick;
            const version = yield* deploy.createAppVersion(
              service.id,
              versionName(target.label, target.sha),
            )(token);
            // Kept before anything is submitted with it: whatever answer is lost from here on,
            // the next pass reads this version instead of making another (audit H6).
            yield* record(target, { state: "deploying", appVersionId: version.id });
            const started = yield* Effect.andThen(
              deploy.upload(version.id, commit.archive)(token),
              deploy.buildAndDeploy(version.id, commit.zeropsYaml, target.setup)(token),
            ).pipe(
              Effect.map(Option.some),
              Effect.catchTag("ZeropsUnavailable", (error) =>
                Effect.as(
                  Effect.logWarning("a deploy's submission went unanswered", {
                    environment: target.envName,
                    service: target.service,
                    error,
                  }),
                  Option.none(),
                ),
              ),
            );
            if (Option.isNone(started)) return undefined;
            yield* record(target, {
              state: "deploying",
              appVersionId: version.id,
              processId: started.value.processId,
            });
            const where = yield* watch(
              target,
              token,
              service.id,
              version.id,
              started.value.processId,
            );
            return where === "unsubmitted" ? undefined : where;
          }).pipe(
            Effect.catchTags({
              ZeropsRefused: (error) => Effect.succeed(zeropsEnded(target, error)),
              ZeropsUnavailable: (error) => Effect.succeed(zeropsEnded(target, error)),
              GitError: (error) => Effect.succeed(refused(`git: ${error.message}`)),
            }),
            Effect.catchIf(
              (error): error is string => typeof error === "string",
              (message) => Effect.succeed(refused(message)),
            ),
          );
          if (ended !== undefined) yield* record(target, ended);
        });

      /**
       * The pass of the Core that leads now — every environment's commits, those with no deploy yet
       * recorded pending (a stage's first deploy waiting for main left out), then queued (B20): `all`
       * queues every environment (a catch-up), else only those with a commit new to them (main
       * moved).
       */
      const leading = yield* Ref.make<
        Option.Option<(all: boolean, only?: string) => Effect.Effect<void>>
      >(Option.none());

      /** What leads now: each environment's queue, one worker each while it has work. */
      const lead = Effect.gen(function* () {
        const queues = new Map<
          string,
          { name: string; targets: ReadonlyArray<Target>; version: number; working: boolean }
        >();
        const work = (projectId: string): Effect.Effect<void> =>
          Effect.gen(function* () {
            for (;;) {
              const queue = queues.get(projectId);
              if (queue === undefined) return;
              const { name, targets, version } = queue;
              const key = yield* keyOf(projectId, name).pipe(
                Effect.catch((error) =>
                  Effect.as(Effect.logWarning("deploy key not checked", error), undefined),
                ),
              );
              for (const target of targets) {
                if (queue.version !== version || key === undefined) break;
                yield* (
                  "token" in key ? deployOne(target, key.token) : refuseUnsettled(target, key)
                ).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("deploy not recorded", {
                      environment: target.envName,
                      service: target.service,
                      error,
                    }),
                  ),
                );
              }
              if (queue.version === version) {
                queue.working = false;
                return;
              }
            }
          });
        const scope = yield* Effect.scope;
        const enqueue = (projectId: string, name: string, targets: ReadonlyArray<Target>) =>
          Effect.gen(function* () {
            const queue = queues.get(projectId) ?? { name, targets, version: 0, working: false };
            queue.name = name;
            queue.targets = targets;
            queue.version += 1;
            queues.set(projectId, queue);
            if (!queue.working) {
              queue.working = true;
              yield* Effect.forkIn(work(projectId), scope);
            }
          });
        const pass = (all: boolean, only?: string) =>
          Effect.gen(function* () {
            // A new service exists before anything is deployed to it.
            if (only === undefined) {
              yield* recipeDeltas.pipe(
                Effect.catch((error) => Effect.logWarning("recipe deltas failed", error)),
              );
            }
            for (const { projectId, name, tier, targets } of yield* wanted) {
              if (only !== undefined && projectId !== only) continue;
              let fresh = false;
              const ready: Array<Target> = [];
              for (const target of targets) {
                if ((yield* recordOf(target)) === undefined) {
                  if (tier === "stage" && (yield* waitsForMain(target))) continue;
                  fresh = true;
                  // A hold written since the read stands.
                  yield* record(target, { state: "pending" }, "none");
                }
                ready.push(target);
              }
              if (all || fresh) yield* enqueue(projectId, name, ready);
            }
          }).pipe(Effect.catch((error) => Effect.logWarning("deploy pass failed", error)));
        yield* Effect.acquireRelease(Ref.set(leading, Option.some(pass)), () =>
          Ref.set(leading, Option.none()),
        );
        // At takeover and every `catchUpEvery` a catch-up (B22); as main moves, its new commits; as
        // a release is made, a catch-up, for a rollback's commits may each have a record already.
        yield* Stream.mergeAll(
          [
            Stream.tick(catchUpEvery).pipe(Stream.map(() => true)),
            gitHost.recorded.pipe(Stream.map(() => false)),
            releases.changes.pipe(
              Stream.drop(1),
              Stream.map(() => true),
            ),
          ],
          { concurrency: "unbounded" },
        ).pipe(Stream.runForEach((all) => pass(all)));
      });

      yield* Effect.forkScoped(
        leader.changes.pipe(
          Stream.switchMap((status) =>
            status.state === "active" ? Stream.fromEffect(Effect.scoped(lead)) : Stream.empty,
          ),
          Stream.runDrain,
        ),
      );

      const baseline: Deploys["Service"]["baseline"] = (appIds) =>
        Effect.gen(function* () {
          const tiers = yield* sql<{
            readonly app_id: string;
            readonly tier: "stage" | "production";
          }>`
            SELECT DISTINCT app_id::text AS app_id, tier FROM hq_environment
            WHERE ${sql.in("app_id", appIds)}`;
          for (const { app_id: appId, tier } of tiers) {
            const read = yield* recipes.read(appId, tier).pipe(Effect.option);
            if (Option.isNone(read) || read.value.state === "absent") continue;
            const declared = tierServices(read.value.importYaml);
            if (!declared.ok) continue;
            yield* see(appId, tier, digestOf(read.value.importYaml), declared.services);
          }
        });

      const hold: Deploys["Service"]["hold"] = (projectIds, credential) =>
        Effect.gen(function* () {
          const held: Array<HeldEnvironment> = [];
          for (const { projectId, name, targets } of yield* wanted) {
            if (!projectIds.includes(projectId)) continue;
            const services = yield* zerops.services(projectId)(credential);
            const states: Array<HeldEnvironment["services"][number]> = [];
            for (const target of targets) {
              const service = services.find((candidate) => candidate.name === target.service);
              const now = runningOf(service);
              // Kept as the version HQ knows it runs, so no pass deploys it again (audit N7).
              const running =
                service !== undefined && spellsRunning(service, target.sha)
                  ? service.activeVersionId
                  : null;
              const live = running !== null;
              yield* record(
                target,
                running !== null
                  ? { state: "live", appVersionId: running }
                  : job(
                      `Held at migration: ${target.service} runs ${now}; Run brings it to ${short(target.sha)}.`,
                    ),
                "any",
                service?.id,
              );
              states.push({
                service: target.service,
                sha: target.sha,
                state: live ? "live" : "held",
                runs: now,
              });
            }
            held.push({ projectId, name, services: states });
          }
          return held;
        });

      return Deploys.of({
        baseline,
        hold,
        catchUp: Effect.flatMap(Ref.get(leading), (pass) =>
          Option.isSome(pass)
            ? pass.value(true)
            : Effect.fail(new NotLeader({ reason: "standby" })),
        ),
        changes: SubscriptionRef.changes(ticks),
        redeploy: (userId, appId, name, service, sha) =>
          confirmingRefusal(
            Effect.gen(function* () {
              const view = yield* roles.forWrite;
              const person = { kind: "person", userId } as const;
              const projectIds = (yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`).map(
                (row) => row.project_id,
              );
              const refuse = (code: DeployRefused["code"], reason: DeployRefused["reason"]) =>
                Effect.andThen(
                  Effect.logInfo("redeploy refused", { userId, appId, name, service, reason }),
                  Effect.fail(new DeployRefused({ code, reason })),
                );
              // Whether the application has an environment of that name is told only to whoever
              // sees it.
              const seen = can(person, "read_app", { projectIds }, view);
              if (!seen.allow) return yield* refuse("forbidden", seen.reason);
              const [environment] = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_environment
              WHERE app_id::text = ${appId} AND name = ${name}`;
              if (environment === undefined) {
                return yield* refuse("environment_not_found", "environment_not_found");
              }
              const may = can(person, "redeploy", { projectIds }, view);
              if (!may.allow) return yield* refuse("forbidden", may.reason);
              const [deployed] = yield* sql<{ readonly state: string; readonly newest: boolean }>`
              SELECT state, created_at = (
                SELECT max(created_at) FROM hq_deploy
                WHERE project_id = ${environment.project_id} AND service = ${service}
              ) AS newest
              FROM hq_deploy
              WHERE project_id = ${environment.project_id} AND service = ${service}
                AND sha = ${sha}`;
              if (deployed === undefined)
                return yield* refuse("deploy_not_found", "deploy_not_found");
              if (!deployed.newest) return yield* refuse("conflict", "deploy_superseded");
              const asked = yield* leader.write(sql`
              UPDATE hq_deploy
              SET state = 'pending', failure = NULL, message = NULL, requested_by = ${userId},
                  updated_at = now()
              WHERE project_id = ${environment.project_id} AND service = ${service}
                AND sha = ${sha} AND state = 'failed'
              RETURNING 1`);
              if (asked.length === 0) return yield* refuse("conflict", "deploy_not_failed");
              yield* tick;
              const pass = yield* Ref.get(leading);
              if (Option.isSome(pass)) yield* pass.value(true, environment.project_id);
            }),
          ),
      });
    }),
  );
