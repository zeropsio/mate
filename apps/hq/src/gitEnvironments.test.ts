import { HqEnvironmentId } from "@t3tools/contracts";
// @effect-diagnostics nodeBuiltinImport:off -- owned temporary bare repositories and real Postgres.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { deriveEnvironmentName } from "@t3tools/shared/hqEnvironment";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { testKey } from "../test/harness/deployKeys.ts";
import { memoryStore } from "../test/harness/overviews.ts";
import { fakeOperationWatch } from "../test/harness/operationWatch.ts";
import { emptyWorld, fakeZeropsApi, fakeZeropsDeploy } from "../test/harness/zeropsFake.ts";
import { Deploys, deploysLayer } from "./deploys.ts";
import { readEnvironmentSource } from "./environmentNavigation.ts";
import { appOffers } from "./offers.ts";
import { deployKeysLayer } from "./deployKeys.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { gitPushLayer } from "./gitPush.ts";
import { MateOverviews, makeMateOverviews } from "./mateOverviews.ts";
import { RecipeTiers } from "./recipeTiers.ts";
import { releasesLayer } from "./releases.ts";
import { Remotes, RemoteRefused, type RemoteRecord } from "./repoRemotes.ts";
import { Roles, type OrgView } from "./roles.ts";
import { rolloutsLayer } from "./rollouts.ts";
import { Structure, structureLayer } from "./structure.ts";
import { ZeropsApi, ZeropsDeploy } from "./zerops/api.ts";
import { githubAuthAbsentLayer } from "./githubAuth.ts";

const author = { name: "HQ", email: "hq@hq.invalid" };
const gitAt = (dir: string, args: string[], input = "") =>
  NodeChildProcess.execFileSync("git", ["-C", dir, ...args], {
    input,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    },
  }).trim();
const reason = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.match(effect, {
    onSuccess: () => "ok",
    onFailure: (e) =>
      typeof e === "object" && e !== null && "reason" in e ? String(e.reason) : "failed",
  });
/** An application with one repository, `web`, whose main is one commit of `files`. */
const fixtureWith = (files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createMigratedDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-git-lifecycle-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const world = emptyWorld();
    const state = { role: "OWNER", projectRole: undefined as string | undefined, refused: false };
    const view = Effect.sync(
      () =>
        ({
          orgId: "ORG",
          freshness: "fresh",
          members: [
            {
              kind: "person",
              userId: "owner",
              clientUserId: "owner",
              name: "Owner",
              roleCode: state.role,
              status: "ACTIVE",
              canCreateProjects: true,
            },
          ],
          projects: ["P_MATE", "P_PROD"].map((id) => ({
            id,
            orgId: "ORG",
            name: "Mate",
            status: "ACTIVE",
            tags: [],
            publicZone: "fixture.invalid",
            userRoles:
              state.projectRole === undefined
                ? []
                : [{ clientUserId: "owner", roleCode: state.projectRole }],
          })),
        }) satisfies OrgView,
    );
    const roles = Layer.succeed(Roles, {
      view: Effect.map(view, (v) => ({ ...v, freshness: "cached" as const })),
      forWrite: view,
      recent: Effect.map(view, (v) => ({ ...v, freshness: "cached" as const })),
      readSince: () => Effect.die("HQ's door is outside this fixture"),
      exists: () => Effect.succeed(true),
      answeredAt: Effect.undefined,
      views: Stream.never,
    });
    const remoteRows = new Map<string, RemoteRecord>();
    const remotes = Remotes.of({
      changes: Stream.empty,
      listRepos: () => Effect.die("Repository reads are outside this fixture"),
      mateRepos: () => Effect.die("Repository reads are outside this fixture"),
      follow: () => Effect.die("Followed repositories are outside this fixture"),
      unfollow: () => Effect.die("Stopped follows are outside this fixture"),
      mateCredential: () => Effect.die("Repository reads are outside this fixture"),
      write: () => Effect.die("Remote writes are outside this fixture"),
      tokenOf: () => Effect.die("Remote tokens are outside this fixture"),
      connectViaApp: () => Effect.die("Remotes through the GitHub app are outside this fixture"),
      receipt: () => Effect.succeed(null),
      get: (ref) => Effect.sync(() => remoteRows.get(ref.repo)),
      connect: () => Effect.die("not used"),
      updateAddress: () => Effect.die("not used"),
      disconnect: () => Effect.die("external disconnect is forbidden"),
      invalidate: () => Effect.void,
      ciAccess: () => Effect.succeed({}),
      forUse: (ref) =>
        Effect.suspend(() =>
          state.refused
            ? Effect.fail(new RemoteRefused({ reason: "credential_invalid" }))
            : Effect.succeed({
                remote: remoteRows.get(ref.repo)!,
                token: Redacted.make("fixture"),
              }),
        ),
    });
    const context = yield* Layer.build(
      Layer.mergeAll(
        structureLayer({ hqProjectId: "HQ", credential: Option.none() }),
        deploysLayer({
          observer: fakeOperationWatch(world),
          pushLayer: gitPushLayer.pipe(Layer.provide(Layer.succeed(Remotes, remotes))),
        }).pipe(Layer.provideMerge(releasesLayer)),
      ).pipe(
        Layer.provide(deployKeysLayer(testKey())),
        Layer.provide(githubAuthAbsentLayer),
        Layer.provideMerge(gitHostLayer({ rootDir: NodePath.join(root, "hq") })),
        Layer.provideMerge(rolloutsLayer),
        Layer.provideMerge(activeCoreLayer(url)),
        Layer.provide(roles),
        Layer.provide(Layer.effect(MateOverviews, makeMateOverviews(memoryStore().store))),
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(world))),
        Layer.provide(Layer.succeed(ZeropsDeploy, fakeZeropsDeploy(world))),
        Layer.provide(
          Layer.succeed(RecipeTiers, {
            read: () => Effect.succeed({ state: "absent", mainHead: null }),
          }),
        ),
        Layer.provideMerge(Layer.succeed(Remotes, remotes)),
      ),
    );
    yield* untilActive.pipe(Effect.provide(context));
    const sql = Context.get(context, SqlClient.SqlClient);
    const structure = Context.get(context, Structure);
    const host = Context.get(context, GitHost);
    const deploys = Context.get(context, Deploys);
    const git = yield* host.opened(Duration.seconds(10));
    const app = yield* structure.createApp("owner", "Shop");
    yield* sql`INSERT INTO hq_app_project(project_id,app_id,kind,created_by) VALUES ('P_MATE',${app.id}::uuid,'mate','owner')`;
    const remoteDir = NodePath.join(root, "remote.git");
    gitAt(root, ["init", "--bare", remoteDir]);
    const blob = gitAt(remoteDir, ["hash-object", "-w", "--stdin"], "remote");
    const tree = gitAt(remoteDir, ["mktree"], `100644 blob ${blob}\tremote\n`);
    const remoteTip = gitAt(remoteDir, ["commit-tree", tree, "-m", "Remote"]);
    gitAt(remoteDir, ["update-ref", "refs/heads/main", remoteTip]);
    const repo = { appId: app.id, id: "web" };
    yield* sql`INSERT INTO hq_repo(app_id,name,created_by) VALUES (${app.id}::uuid,'web','owner')`;
    yield* git.create(repo);
    const dir = NodePath.join(root, "hq", app.id, "web.git");
    gitAt(dir, ["config", `url.file://${remoteDir}.insteadOf`, "https://fixture.invalid/web.git"]);
    gitAt(dir, ["config", "protocol.file.allow", "always"]);
    const made = yield* git.commitFiles(repo, "refs/heads/main", {
      files,
      message: "Initial",
      expectedHead: null,
      author,
    });
    if (!("sha" in made)) throw new Error("initial commit refused");
    yield* Stream.runHead(
      Stream.filterEffect(host.recorded, () =>
        Effect.map(
          sql<{
            readonly main_head: string;
          }>`SELECT main_head FROM hq_repo WHERE app_id::text=${app.id} AND name='web'`,
          ([row]) => row?.main_head === made.sha,
        ),
      ),
    ).pipe(Effect.timeout(Duration.seconds(10)));
    const remote = {
      appId: app.id,
      repo: "web",
      url: "https://fixture.invalid/web.git",
      urlKey: "fixture.invalid/web",
      host: "other",
      hostRepoId: null,
      keptBy: "owner",
      keptAt: "2026-10-13 12:00:00+00",
      invalidSince: null,
      expiresAt: null,
      expiryLabel: "Expiry not reported",
      credentialState: "kept",
    } satisfies RemoteRecord;
    remoteRows.set("web", remote);
    yield* sql`INSERT INTO hq_repo_remote(app_id,repo,url,url_key,host,sealed,key_id,kept_by,kept_at)
    VALUES (${app.id}::uuid,'web',${remote.url},${remote.urlKey},'other',decode('01','hex'),'fixture','owner',now())`;
    const target = { kind: "git", branch: "main", delivery: "direct" } as const;
    const preview = () =>
      structure.previewGitEnvironment("owner", app.id, { target }).pipe(Effect.provide(context));
    const add = (tier: "stage" | "production", name: string = tier, branch = "main") =>
      Effect.gen(function* () {
        const target = { kind: "git", branch, delivery: "direct" } as const;
        const adoption = yield* structure.previewGitEnvironment("owner", app.id, { target });
        return yield* structure.addGitEnvironment("owner", app.id, {
          tier,
          name,
          target,
          adoption,
        });
      }).pipe(Effect.provide(context));
    const remove = (id: string, confirm = false) =>
      structure
        .removeGitEnvironment("owner", app.id, id, { loseUnresolvedHistory: confirm })
        .pipe(Effect.provide(context));
    const settled = Effect.gen(function* () {
      for (const row of yield* sql<{
        readonly id: string;
      }>`SELECT id::text FROM hq_rollout WHERE planned_at IS NULL ORDER BY id`)
        yield* deploys.run(row.id);
      yield* deploys.drain;
    });
    const job = (id: string, jobState: "submitting" | "unresolved", drained: boolean) => sql`
    INSERT INTO hq_deploy_job(rollout_id,environment_id,kind,repo,sha,state,ended_at,evidence,ord)
    SELECT id,${id},'push','web',${made.sha},${jobState},CASE WHEN ${jobState}='unresolved' THEN now() ELSE NULL END,
      jsonb_build_object('phase','recovering','writerDrained',${drained}),0 FROM hq_rollout WHERE environment_id=${id} LIMIT 1`;
    return {
      sql,
      structure,
      host,
      git,
      deploys,
      app,
      repo,
      dir,
      remoteDir,
      remoteTip,
      main: made.sha,
      target,
      preview,
      add,
      remove,
      settled,
      job,
      state,
      remoteRows,
      context,
      view,
    };
  });
const fixture = fixtureWith({ local: "local" });

describe("Structure Git environments", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("Removing Git production requires the same application access as creating it.", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const production = yield* f.add("production");
        const stage = yield* f.add("stage", "stage", "stage");
        f.state.projectRole = "READ_ONLY";
        const source = yield* readEnvironmentSource(f.sql);
        const environments = source.forApp("owner", f.app.id, yield* f.view, { allow: true });
        if ("refused" in environments) throw new Error("Fixture application must be visible");
        assert.deepStrictEqual(
          environments.map((environment) => [
            environment.tier,
            "remove_git_environment" in environment.can
              ? environment.can.remove_git_environment
              : undefined,
          ]),
          [
            ["production", { allow: false, reason: "not_app_developer" }],
            ["stage", { allow: true }],
          ],
        );
        assert.strictEqual(yield* reason(f.remove(production.environmentId)), "forbidden");
        assert.deepStrictEqual(
          yield* f.sql`SELECT tier FROM hq_environment WHERE id=${production.environmentId}`,
          [{ tier: "production" }],
        );
        assert.strictEqual(yield* reason(f.remove(stage.environmentId)), "ok");
        f.state.projectRole = "BASIC_USER";
        assert.strictEqual(yield* reason(f.remove(production.environmentId)), "ok");
        assert.deepStrictEqual(yield* f.sql`SELECT tier FROM hq_environment`, []);
      }),
    );
    it.effect("Removing Git production immediately offers a new production environment.", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const production = yield* f.add("production");
        const receipt = yield* f.structure
          .gitTargetWrite("owner", "remove-production", {
            kind: "remove-git-environment",
            orgId: "ORG",
            hqProjectId: "HQ",
            appId: f.app.id,
            environmentId: HqEnvironmentId.make(production.environmentId),
          })
          .pipe(Effect.provide(f.context));
        assert.strictEqual(receipt.outcome.kind, "succeeded");
        const source = yield* readEnvironmentSource(f.sql);
        const facts = yield* f.view;
        assert.deepStrictEqual(source.forApp("owner", f.app.id, facts, { allow: true }), []);
        assert.deepStrictEqual(
          appOffers(
            "owner",
            [{ project_id: "P_MATE", kind: "mate" }],
            facts,
            source.slotsForApp(f.app.id),
          ).add_production,
          { allow: true },
        );
      }),
    );
    it.effect(
      "A requested production that adopts the remote's history is added and answered.",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const adoption = yield* f.preview();
          const request = () =>
            f.structure
              .gitTargetWrite("owner", "add-production", {
                kind: "add-git-environment",
                orgId: "ORG",
                hqProjectId: "HQ",
                appId: f.app.id,
                request: { tier: "production", name: "production", target: f.target, adoption },
              })
              .pipe(Effect.provide(f.context));
          const receipt = yield* request();
          assert.strictEqual(receipt.outcome.kind, "succeeded");
          // A lost answer asked again is the original receipt, never a second attachment.
          assert.deepStrictEqual(yield* request(), receipt);
          assert.deepStrictEqual(yield* f.sql`SELECT tier,branch FROM hq_environment`, [
            { tier: "production", branch: "main" },
          ]);
          const [head] = yield* f.sql<{
            readonly main_head: string;
          }>`SELECT main_head FROM hq_repo WHERE app_id::text=${f.app.id} AND name='web'`;
          assert.deepStrictEqual(
            gitAt(f.dir, ["rev-list", "--parents", "-n", "1", head!.main_head]).split(" ").slice(1),
            [f.main, f.remoteTip],
          );
        }),
    );
    it.effect.each([
      {
        project: "mate-rig-e2e-c - production",
        branch: "mate-prod-e2e-20261014",
        expected: "mate-rig-e2e-c-production",
      },
      {
        project: "ACME.Web App - production",
        branch: "release-2026",
        expected: "acme-web-app-production",
      },
      { project: "123 Shop - production", branch: "123-release", expected: "shop-production" },
      { project: "9 - production", branch: "release", expected: "production" },
      { project: "A".repeat(80), branch: "release", expected: "a".repeat(63) },
    ])(
      "HQ accepts the generated Git production name for $project on $branch",
      ({ project, branch, expected }) =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const name = deriveEnvironmentName(project, "production", []);
          assert.strictEqual(name, expected);
          const attachment = yield* f.add("production", name, branch);
          const [stored] = yield* f.sql<{
            readonly name: string;
          }>`SELECT name FROM hq_environment WHERE id=${attachment.environmentId}`;
          assert.strictEqual(stored?.name, expected);
        }),
    );

    it.effect("HQ accepts a generated name unique among the application's environments", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.add("stage", "shop-stage", "main");
        const taken = yield* f.sql<{
          readonly name: string;
        }>`SELECT name FROM hq_environment WHERE app_id=${f.app.id}::uuid`;
        const name = deriveEnvironmentName(
          "Shop - stage",
          "stage",
          taken.map((row) => row.name),
        );
        assert.strictEqual(name, "shop-stage-2");
        const attachment = yield* f.add("stage", name, "another-stage");
        const [stored] = yield* f.sql<{
          readonly name: string;
        }>`SELECT name FROM hq_environment WHERE id=${attachment.environmentId}`;
        assert.strictEqual(stored?.name, "shop-stage-2");
      }),
    );

    it.effect(
      "Git Run again chooses current wanted code and returns the original queued receipt without replay",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const attachment = yield* f.add("stage");
          yield* f.settled;
          const intent = {
            kind: "run-git-again",
            orgId: "ORG",
            hqProjectId: "HQ",
            appId: f.app.id,
            environmentId: HqEnvironmentId.make(attachment.environmentId),
            repo: "web",
          } as const;
          const [wanted] = yield* f.sql<{
            readonly main_head: string;
          }>`SELECT main_head FROM hq_repo WHERE app_id=${f.app.id}::uuid AND name='web'`;
          const receipt = yield* f.deploys.runGitAgain("owner", "run-original", intent);
          assert.strictEqual(receipt.requestId, "run-original");
          assert.strictEqual(receipt.executor, "hq");
          assert.isNotEmpty(receipt.handles);
          assert.strictEqual(receipt.outcome.kind, "pending");
          const [job] = yield* f.sql<{
            readonly sha: string;
            readonly requested_by: string;
          }>`SELECT sha,requested_by FROM hq_deploy_job WHERE id::text=${receipt.handles[0]!}`;
          assert.strictEqual(job!.sha, wanted!.main_head);
          assert.strictEqual(job!.requested_by, "owner");
          const [before] = yield* f.sql<{
            readonly count: number;
          }>`SELECT count(*)::int AS count FROM hq_deploy_job`;
          assert.deepStrictEqual(
            yield* f.deploys.gitReceipt("owner", "run-original", intent),
            receipt,
          );
          assert.deepStrictEqual(
            yield* f.deploys.runGitAgain("owner", "run-original", intent),
            receipt,
          );
          assert.deepStrictEqual(
            (yield* f.sql`SELECT count(*)::int AS count FROM hq_deploy_job`)[0],
            before,
          );
          f.state.role = "READ_ONLY";
          const denied = yield* f.deploys
            .runGitAgain("owner", "role-lost", intent)
            .pipe(Effect.flip);
          assert.strictEqual(denied._tag, "DeployRefused");
        }),
    );
    it.effect("An application holds one production, whatever its target.", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const adoption = yield* f.preview();
        const request = {
          tier: "production",
          name: "production",
          target: f.target,
          adoption,
        } as const;
        const answers = yield* Effect.all(
          [
            f.structure.addGitEnvironment("owner", f.app.id, request),
            f.structure.addGitEnvironment("owner", f.app.id, request),
          ].map((e) => reason(e.pipe(Effect.provide(f.context)))),
          { concurrency: "unbounded" },
        );
        assert.strictEqual(answers.filter((a) => a === "ok").length, 1);
        assert.deepStrictEqual(yield* f.sql`SELECT target,tier FROM hq_environment`, [
          { target: "git", tier: "production" },
        ]);
        assert.strictEqual(
          yield* reason(
            f.structure.attachProject("owner", f.app.id, {
              projectId: "P_PROD",
              kind: "production",
              environment: { name: "zerops-production" },
            }),
          ),
          "placed_or_production_taken",
        );
      }),
    );
    it.effect("Git and Zerops attachments racing for production have one winner.", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const adoption = yield* f.preview();
        const answers = yield* Effect.all(
          [
            reason(
              f.structure
                .addGitEnvironment("owner", f.app.id, {
                  tier: "production",
                  name: "git-production",
                  target: f.target,
                  adoption,
                })
                .pipe(Effect.provide(f.context)),
            ),
            reason(
              f.structure.attachProject("owner", f.app.id, {
                projectId: "P_PROD",
                kind: "production",
                environment: { name: "zerops-production" },
              }),
            ),
          ],
          { concurrency: "unbounded" },
        );
        assert.strictEqual(answers.filter((answer) => answer === "ok").length, 1);
        assert.strictEqual(
          (yield* f.sql`SELECT 1 FROM hq_environment WHERE tier='production'`).length,
          1,
        );
      }),
    );
    it.effect(
      "Stage and production with distinct fixed branches attach without inheriting any delivery.",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const production = yield* f.add("production");
          const stage = yield* f.add("stage", "stage", "stage");
          assert.notStrictEqual(stage.environmentId, production.environmentId);
          yield* f.settled;
          assert.deepStrictEqual(
            yield* f.sql`SELECT tier,branch,delivery,sources,release_floor IS NOT NULL AS floor FROM hq_environment ORDER BY tier DESC`,
            [
              {
                tier: "stage",
                branch: "stage",
                delivery: "direct",
                sources: ["main"],
                floor: false,
              },
              {
                tier: "production",
                branch: "main",
                delivery: "direct",
                sources: ["release"],
                floor: true,
              },
            ],
          );
          assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_deploy_job`).length, 0);
          assert.strictEqual(gitAt(f.remoteDir, ["rev-parse", "main"]), f.remoteTip);
        }),
    );
    it.effect("Two git environments of one application never push the same branch.", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const adoption = yield* f.preview();
        const answers = yield* Effect.all(
          (["stage", "production"] as const).map((tier) =>
            reason(
              f.structure
                .addGitEnvironment("owner", f.app.id, {
                  tier,
                  name: tier,
                  target: f.target,
                  adoption,
                })
                .pipe(Effect.provide(f.context)),
            ),
          ),
          { concurrency: "unbounded" },
        );
        assert.strictEqual(answers.filter((a) => a === "ok").length, 1);
        assert.strictEqual(
          (yield* f.sql`SELECT 1 FROM hq_environment WHERE branch='main'`).length,
          1,
        );
      }),
    );
    it.effect(
      "Adding Git production to an untouched repository takes the origin's history as main, with no commit of HQ's own.",
      () =>
        Effect.gen(function* () {
          const f = yield* fixtureWith({});
          yield* f.add("production");
          assert.strictEqual(gitAt(f.dir, ["rev-parse", "main"]), f.remoteTip);
          assert.deepStrictEqual(
            yield* f.sql`SELECT main_head FROM hq_repo WHERE app_id::text=${f.app.id} AND name='web'`,
            [{ main_head: f.remoteTip }],
          );
        }),
    );
    it.effect(
      "A seed a delivery record names stays under main: adding Git production merges the origin into it.",
      () =>
        Effect.gen(function* () {
          const f = yield* fixtureWith({});
          // The remote has no `stage` branch: its attachment leaves the seed as main.
          const stage = yield* f.add("stage", "stage", "stage");
          assert.strictEqual(gitAt(f.dir, ["rev-parse", "main"]), f.main);
          yield* f.job(stage.environmentId, "unresolved", true);
          yield* f.add("production");
          assert.strictEqual(
            gitAt(f.dir, ["show", "-s", "--format=%P", "main"]),
            `${f.main} ${f.remoteTip}`,
          );
        }),
    );
    it.effect("A stale attachment review preserves HQ main and creates no environment.", () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const adoption = yield* f.preview();
        const next = gitAt(f.remoteDir, [
          "commit-tree",
          gitAt(f.remoteDir, ["rev-parse", `${f.remoteTip}^{tree}`]),
          "-p",
          f.remoteTip,
          "-m",
          "Moved",
        ]);
        gitAt(f.remoteDir, ["update-ref", "refs/heads/main", next]);
        assert.strictEqual(
          yield* reason(
            f.structure
              .addGitEnvironment("owner", f.app.id, {
                tier: "stage",
                name: "stage",
                target: f.target,
                adoption,
              })
              .pipe(Effect.provide(f.context)),
          ),
          "review_stale",
        );
        assert.strictEqual(gitAt(f.dir, ["rev-parse", "main"]), f.main);
        assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_environment`).length, 0);
      }),
    );
    it.effect(
      "Adoption receipts precede attachment: delayed old merges and releases never deliver to a new Git environment.",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const env = yield* f.add("stage");
          yield* f.settled;
          assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_deploy_job`).length, 0);
          assert.deepStrictEqual(
            yield* f.sql`SELECT project_id,target,branch,delivery,sources FROM hq_environment`,
            [
              {
                project_id: null,
                target: "git",
                branch: "main",
                delivery: "direct",
                sources: ["main"],
              },
            ],
          );
          const times = yield* f.sql<{
            readonly before: boolean;
          }>`SELECT bool_and(r.created_at<e.created_at) AS before FROM hq_rollout r JOIN hq_environment e ON e.id=${env.environmentId} WHERE r.cause='merge'`;
          assert.strictEqual(times[0]!.before, true);
          assert.strictEqual(gitAt(f.remoteDir, ["rev-parse", "main"]), f.remoteTip);
        }),
    );
    it.effect.each([
      { state: "submitting", drained: false },
      { state: "unresolved", drained: false },
    ] as const)(
      "Removal refuses a $state writer without a proven drain and retains its row and slot.",
      ({ state, drained }) =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const env = yield* f.add("production");
          yield* f.settled;
          yield* f.job(env.environmentId, state, drained);
          assert.strictEqual(yield* reason(f.remove(env.environmentId, true)), "deploy_running");
          assert.strictEqual(
            (yield* f.sql`SELECT 1 FROM hq_environment WHERE id=${env.environmentId}`).length,
            1,
          );
          assert.strictEqual(
            yield* reason(f.add("production", "another", "another")),
            "production_taken",
          );
        }),
    );
    it.effect(
      "A drained unresolved removal confirms only local history loss, retaining releases, remotes and external refs.",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const env = yield* f.add("production");
          yield* f.settled;
          yield* f.job(env.environmentId, "unresolved", true);
          yield* f.sql`INSERT INTO hq_release(app_id,tag,sha,state,entries,released_by,target,environment_id,environment_created_at)
        SELECT app_id,'v1.0.0',${f.main},'approved','[]'::jsonb,'owner','git',id,created_at FROM hq_environment WHERE id=${env.environmentId}`;
          assert.strictEqual(
            yield* reason(f.remove(env.environmentId)),
            "history_loss_confirmation_required",
          );
          assert.strictEqual(yield* reason(f.remove(env.environmentId, true)), "ok");
          assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_deploy_job`).length, 0);
          assert.deepStrictEqual(yield* f.sql`SELECT tag,environment_id FROM hq_release`, [
            { tag: "v1.0.0", environment_id: env.environmentId },
          ]);
          assert.strictEqual(
            (yield* f.sql`SELECT 1 FROM hq_repo_remote WHERE sealed IS NOT NULL`).length,
            1,
          );
          assert.strictEqual(gitAt(f.remoteDir, ["rev-parse", "main"]), f.remoteTip);
          const replacement = yield* f.add("production");
          assert.notStrictEqual(replacement.environmentId, env.environmentId);
          yield* f.settled;
          assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_deploy_job`).length, 0);
          yield* f.remove(replacement.environmentId);
          yield* f.sql`DELETE FROM hq_app_project WHERE app_id::text=${f.app.id}`;
          yield* f.sql`DELETE FROM hq_repo WHERE app_id::text=${f.app.id} AND name='web'`;
          assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_repo_remote`).length, 0);
          assert.deepStrictEqual(yield* f.sql`SELECT tag,environment_id FROM hq_release`, [
            { tag: "v1.0.0", environment_id: env.environmentId },
          ]);
          assert.strictEqual(
            yield* reason(f.structure.deleteApp("owner", f.app.id)),
            "app_not_empty",
          );
          assert.strictEqual(gitAt(f.remoteDir, ["rev-parse", "main"]), f.remoteTip);
        }),
    );
    it.effect(
      "Deleting an empty application cascades its saved remote without touching the external repository.",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const empty = yield* f.structure.createApp("owner", "Empty");
          yield* f.sql`INSERT INTO hq_repo(app_id,name,created_by) VALUES (${empty.id}::uuid,${RECIPE_REPO},'owner')`;
          yield* f.sql`INSERT INTO hq_repo_remote(app_id,repo,url,url_key,host,sealed,key_id,kept_by,kept_at)
            VALUES (${empty.id}::uuid,${RECIPE_REPO},'https://fixture.invalid/recipe.git','fixture.invalid/recipe','other',decode('01','hex'),'fixture','owner',now())`;
          assert.strictEqual(yield* reason(f.structure.deleteApp("owner", empty.id)), "ok");
          assert.strictEqual(
            (yield* f.sql`SELECT 1 FROM hq_repo_remote WHERE app_id::text=${empty.id}`).length,
            0,
          );
          assert.strictEqual(
            (yield* f.sql`SELECT 1 FROM hq_repo WHERE app_id::text=${empty.id}`).length,
            0,
          );
          assert.strictEqual(
            (yield* f.sql`SELECT 1 FROM hq_app WHERE id::text=${empty.id}`).length,
            0,
          );
          assert.strictEqual(gitAt(f.remoteDir, ["rev-parse", "main"]), f.remoteTip);
        }),
    );
    it.effect(
      "Only a current structure writer can attach or remove a Git environment; refused credentials never move main.",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture;
          f.state.refused = true;
          assert.strictEqual(yield* reason(f.add("production")), "credential_invalid");
          assert.strictEqual(gitAt(f.dir, ["rev-parse", "main"]), f.main);
          f.state.refused = false;
          const env = yield* f.add("production");
          f.state.role = "BASIC_USER";
          assert.strictEqual(yield* reason(f.preview()), "forbidden");
          assert.strictEqual(yield* reason(f.remove(env.environmentId, true)), "forbidden");
          assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_environment`).length, 1);
        }),
    );
  });
});
