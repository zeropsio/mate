// @effect-diagnostics nodeBuiltinImport:off -- a commit's archive comes from git as a Node stream.
/**
 * Deploying an application's stage environments (SPEC §3.2b), where main's broker and each
 * repository's workflow did it (main B). When `main` of one of an application's repositories moves,
 * every stage environment that follows `main` gets the services its stage tier builds from that
 * repository (`tierRuntimes.ts`, main B10/B11): the exact commit's archive, deployed with the tier's
 * setup by the environment's own deploy token, its version named `main <7 hex>` (B15/B16).
 *
 * - **Live is what runs**: a deploy is live only once the service runs the commit, read back from
 *   the version it names (B17); an HTTP service then gets its subdomain, with the same token (E13,
 *   measured 2026-10-02 — HQ's org Read only token may not).
 * - **One queue per environment, the newest wins** (B20): its services one after another, higher
 *   priority first (B19); a commit main moved past while a deploy ran is never deployed.
 * - **A build's own failure is final** (B37): only a person asks for that commit again. HQ's own
 *   refusals — no key (E08), or one that no longer answers or now reaches more than its project
 *   (checked again at every hand-over, `deployTokens.ts`), a Zerops that did not answer, git that
 *   failed — are asked again by the next pass, and a deploy still running after `patience` (20
 *   min) is deployed again (B38).
 * - **Every pass is a catch-up**: at takeover and every 5 min, each environment's wanted commits
 *   against what its services run (B22); `main` moving asks only for the commits with no deploy
 *   yet. Only the leading Core deploys.
 *
 * A deploy's record (`hq_deploy`) is per environment, service and commit: pending, deploying, live
 * or failed — the build's own (`job`) or HQ's (`refused`) — with the platform's version and job.
 * The deploy token never leaves Core: no record, log or error carries it.
 *
 * @module deploys
 */
import type * as NodeStream from "node:stream";

import type { HqGit } from "@t3tools/hq-git";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { noDeployToken, reachesOnly } from "./deployTokens.ts";
import { GitHost } from "./gitHost.ts";
import { Leader, NotLeader } from "./leader.ts";
import { RecipeTiers } from "./recipeTiers.ts";
import { Roles } from "./roles.ts";
import { tierRuntimes } from "./tierRuntimes.ts";
import { sameCommit, versionName, versionSha } from "./versionNames.ts";
import { ZeropsApi, ZeropsDeploy, type ZeropsError, type ZeropsService } from "./zerops/api.ts";

export interface DeploysOptions {
  /** How often every environment is caught up with what it runs (B22); 5 min. */
  readonly catchUpEvery?: Duration.Duration;
  /** How often a running deploy's job is read; 10 s. */
  readonly pollEvery?: Duration.Duration;
  /** How long a running deploy is waited for before it is deployed again (B38); 20 min. */
  readonly patience?: Duration.Duration;
}

export class Deploys extends Context.Service<
  Deploys,
  {
    /** Every stage environment's wanted commits against what its services run (B22). */
    readonly catchUp: Effect.Effect<void, NotLeader>;
    /** Ticks after every change of a deploy's record, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
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
}

/** Where a deploy ended, if it ended. */
type Ended =
  | { readonly state: "live" }
  | { readonly state: "failed"; readonly failure: "job" | "refused"; readonly message: string };

const job = (message: string): Ended => ({ state: "failed", failure: "job", message });
const refused = (message: string): Ended => ({ state: "failed", failure: "refused", message });

/** A record's words are at most 240 characters (main B27). */
const cut = (message: string) => (message.length <= 240 ? message : `${message.slice(0, 239)}…`);

/** The largest commit archive HQ deploys: it is held whole while it uploads. */
const ARCHIVE_MAX = 512 * 1024 * 1024;
/** The largest `zerops.yaml` HQ reads. */
const YAML_MAX = 1024 * 1024;
/** The names zcli looks for, in its order. */
const YAML_NAMES = ["zerops.yaml", "zerops.yml"] as const;

const short = (sha: string) => sha.slice(0, 7);

/** Whether the service runs `sha`: the version it names is the one it runs, and spells it (B17). */
const runs = (service: ZeropsService, sha: string) =>
  service.named !== null &&
  service.activeVersionId === service.named.id &&
  sameCommit(versionSha(service.named.name), sha);

/** What a Zerops failure means for a deploy: a verdict on the commit, or HQ's own refusal. */
const zeropsEnded = (target: Target, error: ZeropsError): Ended => {
  if (error._tag === "ZeropsUnavailable") return refused(`Zerops did not answer: ${error.message}`);
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
  Leader | SqlClient.SqlClient | GitHost | Roles | ZeropsApi | ZeropsDeploy | RecipeTiers
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
      const catchUpEvery = options.catchUpEvery ?? Duration.minutes(5);
      const pollEvery = options.pollEvery ?? Duration.seconds(10);
      const patience = options.patience ?? Duration.minutes(20);
      const patienceSeconds = Duration.toSeconds(patience);
      const ticks = yield* SubscriptionRef.make(0);
      const tick = SubscriptionRef.update(ticks, (n) => n + 1);

      /** Every stage environment following `main`, and the commit each of its runtimes is wanted at. */
      const wanted = Effect.gen(function* () {
        const environments = yield* sql<{
          readonly project_id: string;
          readonly app_id: string;
          readonly name: string;
        }>`
          SELECT project_id, app_id::text AS app_id, name FROM hq_environment
          WHERE tier = 'stage' AND 'main' = ANY (sources)
          ORDER BY declared_seq`;
        const byApp = new Map<string, ReadonlyArray<Omit<Target, "projectId" | "envName">>>();
        for (const appId of new Set(environments.map((row) => row.app_id))) {
          const tier = yield* recipes.read(appId, "stage").pipe(
            Effect.tapError((error) =>
              Effect.logWarning("stage tier unreadable", { appId, error }),
            ),
            Effect.option,
          );
          if (Option.isNone(tier) || tier.value.state === "absent") continue;
          const read = tierRuntimes(tier.value.importYaml, appId);
          if (!read.ok) {
            yield* Effect.logWarning("stage tier refused", { appId, problem: read.problem });
            continue;
          }
          const heads = new Map(
            (yield* sql<{ readonly name: string; readonly main_head: string | null }>`
              SELECT name, main_head FROM hq_repo WHERE app_id::text = ${appId}`).map(
              (row) => [row.name, row.main_head] as const,
            ),
          );
          byApp.set(
            appId,
            read.runtimes.flatMap((runtime) => {
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
                    },
                  ];
            }),
          );
        }
        return environments.flatMap((environment) => {
          const targets = byApp.get(environment.app_id) ?? [];
          return targets.length === 0
            ? []
            : [
                {
                  projectId: environment.project_id,
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
            readonly state: string;
            readonly failure: string | null;
            readonly process_id: string | null;
            readonly fresh: boolean;
          }>`
            SELECT state, failure, process_id,
                   COALESCE(started_at > now() - make_interval(secs => ${patienceSeconds}), false)
                     AS fresh
            FROM hq_deploy
            WHERE project_id = ${target.projectId} AND service = ${target.service}
              AND sha = ${target.sha}`,
          (rows) => rows[0],
        );

      /** The record of `target` now `state`: written by the leader, told to the structure. */
      const record = (
        target: Target,
        row:
          | { readonly state: "pending" }
          | {
              readonly state: "deploying";
              readonly appVersionId: string;
              readonly processId: string;
            }
          | Ended,
      ) =>
        Effect.andThen(
          leader.write(sql`
            INSERT INTO hq_deploy (project_id, service, sha, repo, state, failure, message,
              app_version_id, process_id, started_at)
            VALUES (${target.projectId}, ${target.service}, ${target.sha}, ${target.repo},
              ${row.state}, ${row.state === "failed" ? row.failure : null},
              ${row.state === "failed" ? cut(row.message) : null},
              ${row.state === "deploying" ? row.appVersionId : null},
              ${row.state === "deploying" ? row.processId : null},
              ${row.state === "deploying" ? sql`now()` : null})
            ON CONFLICT (project_id, service, sha) DO UPDATE SET
              state = EXCLUDED.state, failure = EXCLUDED.failure, message = EXCLUDED.message,
              app_version_id = COALESCE(EXCLUDED.app_version_id, hq_deploy.app_version_id),
              process_id = COALESCE(EXCLUDED.process_id, hq_deploy.process_id),
              started_at = COALESCE(EXCLUDED.started_at, hq_deploy.started_at),
              updated_at = now()`),
          tick,
        );

      const tokenOf = (projectId: string) =>
        Effect.map(
          sql<{ readonly token: string }>`
            SELECT token FROM hq_deploy_token WHERE project_id = ${projectId}`,
          (rows) => (rows[0] === undefined ? undefined : Redacted.make(rows[0].token)),
        );

      /** After a verified deploy: an HTTP service's subdomain, which never fails the deploy (B17). */
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
       * A running deploy's job, read until it ends or `patience` passes, then what the service runs:
       * live, the build's own failure, or — still running — nothing yet (the next pass decides).
       */
      const watch = (
        target: Target,
        token: Redacted.Redacted,
        serviceId: string,
        processId: string,
      ): Effect.Effect<Ended | undefined, ZeropsError> => {
        const once: Effect.Effect<Ended | undefined, ZeropsError> = Effect.gen(function* () {
          const process = yield* deploy.process(processId)(token);
          if (process.status === "FAILED" || process.status === "CANCELED") {
            return job(`failed: ${process.failure ?? "the build failed"}`);
          }
          if (process.status !== "FINISHED") return undefined;
          const service = yield* zerops.service(serviceId)(token);
          if (runs(service, target.sha)) {
            yield* openSubdomain(service, token);
            return { state: "live" };
          }
          const named = service.named === null ? "" : versionSha(service.named.name);
          if (sameCommit(named, target.sha)) return undefined;
          return job(`the deploy finished, but ${target.service} runs "${named}"`);
        });
        const untilEnded = Effect.gen(function* () {
          for (;;) {
            const ended = yield* once;
            if (ended !== undefined) return ended;
            yield* Effect.sleep(pollEvery);
          }
        });
        return untilEnded.pipe(Effect.timeoutOption(patience), Effect.map(Option.getOrUndefined));
      };

      /** The archive and `zerops.yaml` of the commit, or why the commit cannot deploy. */
      const commitOf = (git: HqGit, target: Target) =>
        Effect.gen(function* () {
          const repo = { appId: target.appId, id: target.repo };
          const root = yield* git.tree(repo, target.sha, "");
          const name = YAML_NAMES.find((candidate) =>
            root.items.some((entry) => entry.path === candidate && entry.type === "blob"),
          );
          if (name === undefined) {
            return job(`${target.repo} has no zerops.yaml at ${short(target.sha)}`);
          }
          const yaml = yield* git.file(repo, target.sha, name, YAML_MAX);
          if (yaml.truncated) {
            return job(`${name} of ${target.repo} at ${short(target.sha)} is larger than 1 MiB`);
          }
          const archive = yield* Effect.flatMap(git.archive(repo, target.sha), (stream) =>
            readWhole(stream, ARCHIVE_MAX),
          );
          if (archive === undefined) {
            return job(
              `the archive of ${target.repo} at ${short(target.sha)} is larger than 512 MiB`,
            );
          }
          return { zeropsYaml: yaml.content.toString("utf8"), archive };
        });

      /** One service of an environment brought to `target.sha`, as far as it goes now. */
      const deployOne = (target: Target) =>
        Effect.gen(function* () {
          const existing = yield* recordOf(target);
          // A build's own failure is final (B37).
          if (existing?.state === "failed" && existing.failure === "job") return;
          const token = yield* tokenOf(target.projectId);
          if (token === undefined) {
            return yield* record(target, refused(noDeployToken(target.envName)));
          }
          const ended = yield* Effect.gen(function* () {
            // Checked again at every hand-over: a key that no longer answers, or now reaches more
            // than its project, is no key.
            const own = yield* zerops.ownToken(token).pipe(Effect.option);
            const { orgId } = yield* roles.view;
            if (Option.isNone(own) || !reachesOnly(own.value, orgId, target.projectId)) {
              return refused(noDeployToken(target.envName));
            }
            const services = yield* zerops.services(target.projectId)(token);
            const service = services.find((candidate) => candidate.name === target.service);
            if (service === undefined) {
              return refused(`the environment's project has no service ${target.service}`);
            }
            if (runs(service, target.sha)) {
              yield* openSubdomain(service, token);
              return existing?.state === "live" ? undefined : ({ state: "live" } as const);
            }
            if (existing?.state === "deploying" && existing.fresh && existing.process_id !== null) {
              return yield* watch(target, token, service.id, existing.process_id);
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
              versionName("main", target.sha),
            )(token);
            yield* deploy.upload(version.id, commit.archive)(token);
            const started = yield* deploy.buildAndDeploy(
              version.id,
              commit.zeropsYaml,
              target.setup,
            )(token);
            yield* record(target, {
              state: "deploying",
              appVersionId: version.id,
              processId: started.processId,
            });
            return yield* watch(target, token, service.id, started.processId);
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
       * recorded pending, then queued (B20): `all` queues every environment (a catch-up), else only
       * those with a commit new to them (main moved).
       */
      const leading = yield* Ref.make<Option.Option<(all: boolean) => Effect.Effect<void>>>(
        Option.none(),
      );

      /** What leads now: each environment's queue, one worker each while it has work. */
      const lead = Effect.gen(function* () {
        const queues = new Map<
          string,
          { targets: ReadonlyArray<Target>; version: number; working: boolean }
        >();
        const work = (projectId: string): Effect.Effect<void> =>
          Effect.gen(function* () {
            for (;;) {
              const queue = queues.get(projectId);
              if (queue === undefined) return;
              const { targets, version } = queue;
              for (const target of targets) {
                if (queue.version !== version) break;
                yield* deployOne(target).pipe(
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
        const enqueue = (projectId: string, targets: ReadonlyArray<Target>) =>
          Effect.gen(function* () {
            const queue = queues.get(projectId) ?? { targets, version: 0, working: false };
            queue.targets = targets;
            queue.version += 1;
            queues.set(projectId, queue);
            if (!queue.working) {
              queue.working = true;
              yield* Effect.forkIn(work(projectId), scope);
            }
          });
        const pass = (all: boolean) =>
          Effect.gen(function* () {
            for (const { projectId, targets } of yield* wanted) {
              let fresh = false;
              for (const target of targets) {
                if ((yield* recordOf(target)) === undefined) {
                  fresh = true;
                  yield* record(target, { state: "pending" });
                }
              }
              if (all || fresh) yield* enqueue(projectId, targets);
            }
          }).pipe(Effect.catch((error) => Effect.logWarning("deploy pass failed", error)));
        yield* Effect.acquireRelease(Ref.set(leading, Option.some(pass)), () =>
          Ref.set(leading, Option.none()),
        );
        // At takeover and every `catchUpEvery` a catch-up (B22); as main moves, its new commits.
        yield* Stream.merge(
          Stream.tick(catchUpEvery).pipe(Stream.map(() => true)),
          gitHost.recorded.pipe(Stream.map(() => false)),
        ).pipe(Stream.runForEach(pass));
      });

      yield* Effect.forkScoped(
        leader.changes.pipe(
          Stream.switchMap((status) =>
            status.state === "active" ? Stream.fromEffect(Effect.scoped(lead)) : Stream.empty,
          ),
          Stream.runDrain,
        ),
      );

      return Deploys.of({
        catchUp: Effect.flatMap(Ref.get(leading), (pass) =>
          Option.isSome(pass)
            ? pass.value(true)
            : Effect.fail(new NotLeader({ reason: "standby" })),
        ),
        changes: SubscriptionRef.changes(ticks),
      });
    }),
  );
