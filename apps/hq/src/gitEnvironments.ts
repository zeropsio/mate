import { HqGitEnvironmentRefusalReason } from "@t3tools/shared/hqGitTargets";
import type { HqGitTargetIntent } from "@t3tools/shared/hqGitTargets";
import { keepGitReceipt, keepGitReceiptAtCommit, readGitReceipt } from "./gitTargetReceipts.ts";
/** Structure's Git lifecycle: no project, no external deletion, and no delivery executor. */
import type {
  AddGitEnvironmentRequest,
  HqGitAdoption,
  PreviewGitEnvironmentRequest,
} from "@t3tools/shared/hqChanges";
import {
  AddGitEnvironmentRequest as AddRequest,
  PreviewGitEnvironmentRequest as PreviewRequest,
} from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { Deploys } from "./deploys.ts";
import { environmentNameProblem } from "@t3tools/shared/hqEnvironment";
import { GitHost, holdingRepo } from "./gitHost.ts";
import { Leader } from "./leader.ts";
import { can } from "./permissions.ts";
import { recordedBeyondMain } from "./reconcile.ts";
import { gitEnvironmentRemovalOffer } from "./offers.ts";
import { Remotes } from "./repoRemotes.ts";
import { Roles, decidedFresh } from "./roles.ts";
import { Rollouts } from "./rollouts.ts";

export class GitEnvironmentRefused extends Schema.TaggedError<GitEnvironmentRefused>()(
  "GitEnvironmentRefused",
  {
    reason: HqGitEnvironmentRefusalReason,
  },
) {}

const decodePreview = Schema.decodeEffect(PreviewRequest);
const decodeAdd = Schema.decodeEffect(AddRequest);

export const makeGitEnvironments = (changed: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const roles = yield* Roles;
    const rollouts = yield* Rollouts;
    const refuse = (reason: GitEnvironmentRefused["reason"]) =>
      new GitEnvironmentRefused({ reason });
    const allowed = Effect.fnUntraced(function* (
      userId: string,
      appId: string,
      adopting: boolean,
      tier: "stage" | "production" = "stage",
    ) {
      const view = yield* roles.forWrite;
      const projects = yield* sql<{
        readonly project_id: string;
      }>`SELECT project_id FROM hq_app_project WHERE app_id::text=${appId}`;
      const decision = adopting
        ? can(
            { kind: "person", userId },
            "add_git_environment",
            { projectIds: projects.map((p) => p.project_id) },
            view,
          )
        : gitEnvironmentRemovalOffer(userId, projects, view, tier);
      if (!decision.allow) return yield* refuse("forbidden");
      const app = yield* sql`SELECT 1 FROM hq_app WHERE id::text=${appId}`;
      if (app.length === 0) return yield* refuse("app_not_found");
    });
    const repositories = (appId: string) => sql<{ readonly name: string }>`
    SELECT r.name FROM hq_repo r JOIN hq_repo_remote m ON m.app_id=r.app_id AND m.repo=r.name
    WHERE r.app_id::text=${appId} AND r.name<>${RECIPE_REPO} ORDER BY r.name`;
    const reviewedRepositories = Effect.fnUntraced(function* (
      appId: string,
      adoption: ReadonlyArray<HqGitAdoption>,
    ) {
      const repos = yield* repositories(appId);
      if (
        repos.length !== adoption.length ||
        repos.some((r) => !adoption.some((a) => a.repo === r.name))
      )
        return yield* refuse("review_stale");
      return repos;
    });
    const inspect = Effect.fnUntraced(function* (appId: string, repo: string, branch: string) {
      const git = yield* (yield* GitHost).git;
      const remotes = yield* Remotes;
      const source = yield* remotes.forUse({ appId, repo }, branch);
      const preview = yield* git.previewAdoption(
        { appId, id: repo },
        { url: source.remote.url, token: source.token, branch },
      );
      const review: HqGitAdoption = {
        repo,
        remote: { url: source.remote.url, repositoryId: source.remote.hostRepoId },
        branch,
        mainHead: preview.main,
        remoteHead: preview.remoteTip,
        changedFiles: preview.changedFiles,
        seed: preview.seed,
        ...(source.branchRules === undefined ? {} : { branchRules: source.branchRules }),
        ...(yield* remotes.ciAccess(source.remote.url, source.token, branch)),
      };
      return { git, source, preview, review };
    });
    const sameReview = (a: HqGitAdoption, b: HqGitAdoption) =>
      a.repo === b.repo &&
      a.remote.url === b.remote.url &&
      a.remote.repositoryId === b.remote.repositoryId &&
      a.branch === b.branch &&
      a.mainHead === b.mainHead &&
      a.remoteHead === b.remoteHead &&
      a.changedFiles === b.changedFiles &&
      a.seed === b.seed;
    const vacant = Effect.fnUntraced(function* (appId: string, input: AddGitEnvironmentRequest) {
      const rows = yield* sql<{
        readonly tier: string;
        readonly name: string;
        readonly branch: string | null;
      }>`
      SELECT tier,name,branch FROM hq_environment WHERE app_id::text=${appId}`;
      if (input.tier === "production" && rows.some((r) => r.tier === "production"))
        return yield* refuse("production_taken");
      if (rows.some((r) => r.branch === input.target.branch)) return yield* refuse("branch_taken");
      if (rows.some((r) => r.name === input.name)) return yield* refuse("environment_name_taken");
    });
    const appLocked = <A, E, R>(appId: string, effect: Effect.Effect<A, E, R>) =>
      leader.write(
        Effect.gen(function* () {
          const app = yield* sql`SELECT 1 FROM hq_app WHERE id::text=${appId} FOR NO KEY UPDATE`;
          if (app.length === 0) return yield* refuse("app_not_found");
          return yield* effect;
        }),
      );
    const lifecycle = {
      previewGitEnvironment: (
        userId: string,
        appId: string,
        request: PreviewGitEnvironmentRequest,
      ) =>
        decidedFresh(
          Effect.gen(function* () {
            const input = yield* decodePreview(request);
            yield* allowed(userId, appId, true);
            const repos = yield* repositories(appId);
            if (repos.length === 0) return yield* refuse("no_repositories");
            return yield* Effect.forEach(repos, ({ name }) =>
              holdingRepo(
                { appId, id: name },
                Effect.map(inspect(appId, name, input.target.branch), ({ review }) => review),
              ).pipe(
                Effect.provideService(Leader, leader),
                Effect.provideService(SqlClient.SqlClient, sql),
              ),
            );
          }),
        ),
      /** `kept` commits with the attachment: a request's receipt (`keepGitReceiptAtCommit`). */
      addGitEnvironment: (
        userId: string,
        appId: string,
        request: AddGitEnvironmentRequest,
        kept: Effect.Effect<void, SqlError> = Effect.void,
      ) =>
        decidedFresh(
          Effect.gen(function* () {
            const input = yield* decodeAdd(request);
            const problem = environmentNameProblem(input.name);
            if (problem !== undefined) return yield* refuse(problem);
            yield* allowed(userId, appId, true);
            const host = yield* GitHost;
            // Lock the complete reviewed roster in stable order; validate every tip before moving any main.
            const acceptedHeads = yield* appLocked(
              appId,
              Effect.gen(function* () {
                yield* vacant(appId, input);
                const repos = yield* reviewedRepositories(appId, input.adoption);
                const inspected = yield* Effect.forEach(repos, ({ name }) =>
                  holdingRepo({ appId, id: name }, inspect(appId, name, input.target.branch)).pipe(
                    Effect.provideService(Leader, leader),
                    Effect.provideService(SqlClient.SqlClient, sql),
                  ),
                );
                if (
                  inspected.some(
                    (result) =>
                      !sameReview(
                        result.review,
                        input.adoption.find((a) => a.repo === result.review.repo)!,
                      ),
                  )
                )
                  return yield* refuse("review_stale");
                const heads: Array<{ readonly repo: string; readonly sha: string }> = [];
                for (const result of inspected) {
                  const repo = { appId, id: result.review.repo };
                  const outcome = yield* result.git.acceptAdoption(
                    repo,
                    {
                      url: result.source.remote.url,
                      token: result.source.token,
                      branch: input.target.branch,
                    },
                    result.preview,
                    { name: "HQ", email: "hq@hq.invalid" },
                    result.preview.seed &&
                      (yield* recordedBeyondMain(sql, repo, result.preview.main)),
                  );
                  if (outcome.kind === "stale") return yield* refuse("review_stale");
                  heads.push({
                    repo: result.review.repo,
                    sha: outcome.kind === "adopted" ? outcome.sha : result.preview.main,
                  });
                }
                return heads;
              }),
            );
            // Git's event receipt writes adoption's merge rollout before the attachment floor.
            yield* Stream.runHead(
              Stream.filterEffect(host.recorded, () =>
                Effect.gen(function* () {
                  const heads = yield* sql<{
                    readonly name: string;
                    readonly main_head: string | null;
                  }>`SELECT name,main_head FROM hq_repo WHERE app_id::text=${appId}`;
                  return acceptedHeads.every((move) =>
                    heads.some((head) => head.name === move.repo && head.main_head === move.sha),
                  );
                }),
              ),
            ).pipe(Effect.timeout(Duration.seconds(10)));
            const attachment = yield* appLocked(
              appId,
              Effect.gen(function* () {
                yield* allowed(userId, appId, false);
                yield* vacant(appId, input);
                yield* reviewedRepositories(appId, input.adoption);
                // Receipt waits release the repo locks; re-read the reviewed destination before attaching.
                const inspected = yield* Effect.forEach(input.adoption, (review) =>
                  holdingRepo(
                    { appId, id: review.repo },
                    inspect(appId, review.repo, input.target.branch),
                  ).pipe(
                    Effect.provideService(Leader, leader),
                    Effect.provideService(SqlClient.SqlClient, sql),
                  ),
                );
                if (
                  inspected.some(({ review }, i) => {
                    const expected = input.adoption[i]!;
                    const main =
                      acceptedHeads.find((move) => move.repo === expected.repo)?.sha ??
                      expected.mainHead;
                    return (
                      review.mainHead !== main ||
                      review.remoteHead !== expected.remoteHead ||
                      review.remote.url !== expected.remote.url ||
                      review.remote.repositoryId !== expected.remote.repositoryId
                    );
                  })
                )
                  return yield* refuse("review_stale");
                const [row] = yield* sql<{ readonly id: string; readonly createdAt: string }>`
            INSERT INTO hq_environment(id,target,app_id,tier,name,sources,branch,delivery,created_by,created_at,release_floor)
            VALUES (gen_random_uuid()::text,'git',${appId}::uuid,${input.tier},${input.name},
              ${input.tier === "stage" ? "{main}" : "{release}"}::text[],${input.target.branch},'direct',${userId},clock_timestamp(),
              CASE WHEN ${input.tier}='production' THEN clock_timestamp() ELSE NULL END)
            RETURNING id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"`;
                yield* sql`INSERT INTO hq_rollout(app_id,cause,environment_id,environment_created_at,by)
            SELECT app_id,'env_added',id,created_at,${userId} FROM hq_environment WHERE id=${row!.id}`;
                yield* kept;
                return { environmentId: row!.id, createdAt: row!.createdAt, target: input.target };
              }),
            );
            yield* changed;
            yield* rollouts.wake;
            return attachment;
          }),
        ),
      removeGitEnvironment: (
        userId: string,
        appId: string,
        environmentId: string,
        confirmation: { readonly loseUnresolvedHistory?: boolean } = {},
      ) =>
        decidedFresh(
          Effect.gen(function* () {
            yield* allowed(userId, appId, false);
            const deploys = yield* Deploys;
            yield* deploys.withEnvironment(
              environmentId,
              appLocked(
                appId,
                Effect.gen(function* () {
                  const rows = yield* sql<{
                    readonly tier: "stage" | "production";
                  }>`SELECT tier FROM hq_environment WHERE id=${environmentId} AND app_id::text=${appId} AND target='git' FOR UPDATE`;
                  if (rows.length === 0) return yield* refuse("environment_not_found");
                  yield* allowed(userId, appId, false, rows[0]!.tier);
                  const blocker = yield* deploys.blocker(environmentId);
                  if (
                    blocker?.state === "unresolved" &&
                    confirmation.loseUnresolvedHistory !== true
                  )
                    return yield* refuse("history_loss_confirmation_required");
                  yield* sql`DELETE FROM hq_environment WHERE id=${environmentId}`;
                }),
              ),
            );
            yield* changed;
          }),
        ),
    };
    const authorizeRequest = (userId: string, intent: HqGitTargetIntent) =>
      Effect.gen(function* () {
        const facts = yield* roles.forWrite;
        if (facts.orgId !== intent.orgId) return yield* refuse("forbidden");
        yield* allowed(userId, intent.appId, intent.kind !== "remove-git-environment");
      });
    return {
      ...lifecycle,
      gitTargetWrite: (
        userId: string,
        requestId: string,
        intent: Extract<
          HqGitTargetIntent,
          {
            readonly kind:
              | "preview-git-environment"
              | "add-git-environment"
              | "remove-git-environment";
          }
        >,
      ) =>
        decidedFresh(
          Effect.gen(function* () {
            yield* authorizeRequest(userId, intent);
            if (intent.kind === "add-git-environment") {
              const receipt = yield* keepGitReceiptAtCommit(
                sql,
                userId,
                requestId,
                intent,
                (kept) => lifecycle.addGitEnvironment(userId, intent.appId, intent.request, kept),
              );
              yield* changed;
              return receipt;
            }
            const receipt = yield* keepGitReceipt(
              sql,
              leader,
              userId,
              requestId,
              intent,
              Effect.gen(function* () {
                switch (intent.kind) {
                  case "preview-git-environment":
                    return yield* lifecycle.previewGitEnvironment(
                      userId,
                      intent.appId,
                      intent.request,
                    );
                  case "remove-git-environment":
                    yield* lifecycle.removeGitEnvironment(
                      userId,
                      intent.appId,
                      intent.environmentId,
                      intent.loseUnresolvedHistory === true ? { loseUnresolvedHistory: true } : {},
                    );
                    return undefined;
                }
              }),
            );
            yield* changed;
            return receipt;
          }),
        ),
      gitTargetReceipt: (userId: string, requestId: string, intent: HqGitTargetIntent) =>
        decidedFresh(
          Effect.gen(function* () {
            yield* authorizeRequest(userId, intent);
            return yield* readGitReceipt(sql, userId, requestId, intent);
          }),
        ),
    };
  });
export type GitEnvironments = Effect.Success<ReturnType<typeof makeGitEnvironments>>;
