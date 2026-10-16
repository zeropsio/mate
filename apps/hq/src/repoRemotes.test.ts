// @effect-diagnostics nodeBuiltinImport:off -- local HTTP host; database is the real custody consumer.
import * as NodeHttp from "node:http";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as SqlClient from "effect/sql/SqlClient";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { TEST_KEY_SECRET, testKey } from "../test/harness/deployKeys.ts";
import { tempDir } from "../test/harness/tempDir.ts";
import { Changes, changesLayer } from "./changes.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { rolloutsLayer } from "./rollouts.ts";
import { deployKeysLayer } from "./deployKeys.ts";
import { githubProbesLayer } from "./githubProbes.ts";
import { gitTransportLayer } from "./gitTransport.ts";
import { Leader } from "./leader.ts";
import { Roles, type OrgView } from "./roles.ts";
import { ZeropsUnavailable } from "./zerops/api.ts";
import { Remotes, repoRemotesLayer } from "./repoRemotes.ts";

const APP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REF = { appId: APP, repo: "web" };
const token = Redacted.make("repository-test-secret");
const input = { ...REF, url: "https://github.com/krls2020/tst123", token, branch: "main" };
const member = (userId: string, roleCode = "OWNER") => ({
  userId,
  clientUserId: userId,
  roleCode,
  status: "ACTIVE",
  canCreateProjects: true,
  name: userId,
  kind: "person" as const,
});
const fixture = Effect.gen(function* () {
  const url = yield* (yield* TempPostgres).createMigratedDatabase;
  const state = {
    mode: "write",
    id: 1416745513,
    path: "krls2020/tst123",
    members: [member("custodian"), member("other")],
    unreadable: false,
    freshness: "fresh" as "fresh" | "recent",
    seen: [] as string[],
    nextMetadata: undefined as ((response: NodeHttp.ServerResponse) => void) | undefined,
    nextRoles: undefined as Effect.Effect<void> | undefined,
    afterRules: undefined as (() => void) | undefined,
  };
  const origin = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ server: NodeHttp.Server; url: string }>((resolve) => {
          const server = NodeHttp.createServer((request, response) => {
            state.seen.push(`${request.method} ${request.url}`);
            if (
              state.nextMetadata &&
              !request.url?.includes("info/refs") &&
              !request.url?.includes("rules/branches")
            ) {
              const take = state.nextMetadata;
              state.nextMetadata = undefined;
              take(response);
              return;
            }
            if (state.mode === "private") {
              response.writeHead(404);
              response.end('{"message":"Not Found"}');
              return;
            }
            if (state.mode === "sso") {
              response.writeHead(403, {
                "x-github-sso":
                  "required; url=https://github.com/orgs/krls2020/sso?authorization_request=abc",
              });
              response.end("{}");
              return;
            }
            if (state.mode === "invalid") {
              response.writeHead(401);
              response.end('{"message":"Bad credentials"}');
              return;
            }
            if (state.mode === "rate") {
              response.writeHead(403, { "retry-after": "30" });
              response.end('{"message":"You have exceeded a secondary rate limit."}');
              return;
            }
            if (request.url?.includes("info/refs")) {
              // Recorded pt-s3-verify/nopull-receive-pack: 403 and this exact body.
              if (state.mode === "read") {
                response.writeHead(403);
                response.end("Write access to repository not granted.");
                return;
              }
              response.writeHead(200, {
                "content-type": "application/x-git-receive-pack-advertisement",
              });
              response.end(
                state.mode === "unknown"
                  ? "unexpected advertisement"
                  : "001f# service=git-receive-pack\n00000000",
              );
              return;
            }
            response.setHeader("content-type", "application/json");
            if (request.url?.includes("rules/branches")) {
              if (state.mode === "plan") {
                response.writeHead(403);
                response.end(
                  JSON.stringify({
                    message:
                      "Upgrade to GitHub Pro or make this repository public to enable this feature.",
                  }),
                );
                return;
              }
              state.afterRules?.();
              state.afterRules = undefined;
              response.end(state.mode === "pr" ? '[{"type":"pull_request"}]' : "[]");
              return;
            }
            if (state.mode === "classic") response.setHeader("x-oauth-scopes", "read:user");
            if (state.mode === "malformed") {
              response.end('{"permissions":{"admin":true}}');
              return;
            }
            // Recorded rw/nopull-repo selected Contents-write/read responses, restricted to probe fields.
            response.end(
              JSON.stringify({
                id: state.id,
                full_name: state.path,
                archived: state.mode === "archived",
                private: true,
                permissions: { admin: true },
                ...(state.mode === "read"
                  ? {}
                  : {
                      allow_merge_commit: true,
                      allow_auto_merge: false,
                      allow_rebase_merge: true,
                      allow_squash_merge: true,
                    }),
              }),
            );
          }).listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address && typeof address !== "string")
              resolve({ server, url: `http://127.0.0.1:${address.port}` });
          });
        }),
    ),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  const view = Effect.gen(function* () {
    const gate = state.nextRoles;
    state.nextRoles = undefined;
    if (gate) yield* gate;
    if (state.unreadable)
      return yield* new ZeropsUnavailable({
        operation: "roles",
        message: "Role read unavailable.",
      });
    return {
      orgId: "org",
      freshness: state.freshness,
      members: state.members,
      projects: [],
    } satisfies OrgView<"fresh" | "recent">;
  });
  const roles = Layer.succeed(
    Roles,
    Roles.of({
      forWrite: view,
      view: Effect.map(view, (v) => ({ ...v, freshness: "cached" as const })),
      recent: Effect.map(view, (v) => ({ ...v, freshness: "cached" as const })),
      readSince: () => Effect.die("HQ's door is outside this fixture"),
      exists: () => Effect.succeed(true),
      answeredAt: Effect.succeed(0),
      views: Stream.empty,
    }),
  );
  const leader = Layer.succeed(
    Leader,
    Leader.of({
      status: Effect.succeed({ state: "active", epoch: 1 }),
      write: (effect) => effect,
      nextAttempt: Effect.void,
      finished: Effect.void,
      changes: Stream.make({ state: "active" as const, epoch: 1 }),
      release: Effect.void,
      hold: () => Effect.void,
      held: Effect.succeed(null),
    }),
  );
  const client = Layer.effect(
    HttpClient.HttpClient,
    Effect.map(
      HttpClient.HttpClient,
      HttpClient.mapRequest((request) =>
        HttpClientRequest.setUrl(
          request,
          origin.url + new URL(request.url).pathname + new URL(request.url).search,
        ),
      ),
    ),
  ).pipe(Layer.provide(NodeHttpClient.layerNodeHttp));
  const rootDir = yield* tempDir("hq-remote-");
  const context = yield* Layer.build(
    repoRemotesLayer.pipe(
      Layer.provideMerge(changesLayer),
      Layer.provideMerge(gitHostLayer({ rootDir }).pipe(Layer.provide(rolloutsLayer))),
      Layer.provideMerge(deployKeysLayer(testKey(TEST_KEY_SECRET))),
      Layer.provideMerge(PgClient.layer({ url: Redacted.make(url) })),
      Layer.provide(roles),
      Layer.provide(leader),
      Layer.provide(
        githubProbesLayer.pipe(Layer.provide(gitTransportLayer), Layer.provide(client)),
      ),
    ),
  );
  const git = yield* Context.get(context, GitHost).opened(Duration.seconds(10));
  const sql = Context.get(context, SqlClient.SqlClient);
  for (const app of [APP, OTHER]) {
    yield* sql`INSERT INTO hq_app(id,name,created_by) VALUES (${app}::uuid,${app},'custodian')`;
    for (const repo of ["web", "worker"])
      yield* sql`INSERT INTO hq_repo(app_id,name,created_by) VALUES (${app}::uuid,${repo},'custodian')`;
  }
  return {
    sql,
    git,
    changes: Context.get(context, Changes),
    remotes: Context.get(context, Remotes),
    state,
  };
});

describe("repository credential custody", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "A GitHub Free branch preview carries the plan's lack of branch rules to its consumer",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, state } = yield* fixture;
            yield* remotes.connect("custodian", input);
            state.mode = "plan";
            const checked = yield* remotes.forUse(REF, "new-production");
            assert.strictEqual(checked.branchRules, "none_on_plan");
          }),
        ),
    );
    it.effect.each(["connect-git-remote", "probe-git-remote", "replace-git-remote-token"] as const)(
      "A repository token test does not read an unchosen branch: %s",
      (kind) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, state } = yield* fixture;
            if (kind === "replace-git-remote-token") yield* remotes.connect("custodian", input);
            state.mode = "pr";
            state.seen = [];
            const result = yield* remotes.write(
              "custodian",
              `no-branch-${kind}`,
              {
                kind,
                orgId: "org",
                hqProjectId: "HQ",
                ...REF,
                url: input.url,
              },
              token,
            );
            assert.strictEqual(result.acceptance.kind, "accepted");
            assert.deepStrictEqual(state.seen, [
              "GET /repos/krls2020/tst123",
              "GET /krls2020/tst123.git/info/refs?service=git-receive-pack",
            ]);
            const saved = yield* remotes.get(REF);
            if (kind !== "probe-git-remote") {
              assert.isDefined(saved);
              assert.strictEqual(
                (yield* remotes.forUse(REF, "release").pipe(Effect.flip)).reason,
                "pull_requests_only",
              );
            }
          }),
        ),
    );

    it.effect(
      "Connecting a repository address records the first code repository and creates its Git storage",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, git, changes } = yield* fixture;
            yield* sql`DELETE FROM hq_repo WHERE app_id::text=${APP}`;
            const result = yield* Effect.match(
              remotes.connect("custodian", { ...input, repo: "fresh" }),
              {
                onSuccess: () => "connected",
                onFailure: (error) => error._tag,
              },
            );
            assert.strictEqual(result, "connected");
            const repos = yield* changes.listRepos("custodian", APP);
            assert.deepStrictEqual(
              repos.map((repo) => repo.name),
              ["fresh"],
            );
            assert.strictEqual(
              (yield* remotes.get({ appId: APP, repo: "fresh" }))?.url,
              "https://github.com/krls2020/tst123.git",
            );
            const branches = yield* git.branches({ appId: APP, id: "fresh" });
            assert.strictEqual(branches.items[0]?.ref, "refs/heads/main");
            assert.strictEqual(branches.items[0]?.sha, repos[0]?.mainHead);
          }),
        ),
    );
    it.effect(
      "Testing a repository address before the first connection leaves repository records and Git storage empty",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, git } = yield* fixture;
            yield* sql`DELETE FROM hq_repo WHERE app_id::text=${APP}`;
            const receipt = yield* remotes.write(
              "custodian",
              "first-probe",
              {
                kind: "probe-git-remote",
                orgId: "org",
                hqProjectId: "HQ",
                ...REF,
                repo: "fresh",
                url: input.url,
                branch: "main",
              },
              token,
            );
            assert.strictEqual(receipt.acceptance.kind, "accepted");
            assert.deepStrictEqual(
              yield* sql`SELECT name FROM hq_repo WHERE app_id::text=${APP}`,
              [],
            );
            assert.deepStrictEqual(yield* git.list(APP), []);
          }),
        ),
    );
    it.effect(
      "A repository connection refuses reserved names, unknown applications and missing app write access",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, git, state } = yield* fixture;
            for (const repo of [RECIPE_REPO, "../outside", ""]) {
              const refused = yield* Effect.match(
                remotes.connect("custodian", { ...input, repo }),
                {
                  onSuccess: () => "connected",
                  onFailure: (error) =>
                    error._tag === "RemoteRefused" ? error.reason : error._tag,
                },
              );
              assert.strictEqual(refused, "bad_repo");
            }
            assert.strictEqual(
              yield* Effect.match(
                remotes.connect("custodian", {
                  ...input,
                  appId: "33333333-3333-4333-8333-333333333333",
                  repo: "fresh",
                }),
                {
                  onSuccess: () => "connected",
                  onFailure: (error) => (error._tag === "ChangeRefused" ? error.code : error._tag),
                },
              ),
              "app_not_found",
            );
            state.members = [member("custodian", "ADMIN")];
            assert.strictEqual(
              yield* Effect.match(remotes.connect("custodian", { ...input, repo: "fresh" }), {
                onSuccess: () => "connected",
                onFailure: (error) => (error._tag === "ChangeRefused" ? error.reason : error._tag),
              }),
              "not_app_developer",
            );
            assert.deepStrictEqual(yield* sql`SELECT name FROM hq_repo WHERE name='fresh'`, []);
            assert.deepStrictEqual(yield* git.list(), []);
          }),
        ),
    );
    it.effect(
      "Candidate verification leaves custody empty and recovers only the original request without its token",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, state } = yield* fixture;
            const intent = {
              kind: "probe-git-remote",
              orgId: "org",
              hqProjectId: "HQ",
              ...REF,
              url: input.url,
              branch: "main",
            } as const;
            const receipt = yield* remotes.write("custodian", "candidate-request", intent, token);
            assert.strictEqual(receipt.acceptance.kind, "accepted");
            assert.strictEqual(JSON.stringify(receipt).includes("repository-test-secret"), false);
            assert.strictEqual((yield* sql`SELECT 1 FROM hq_repo_remote`).length, 0);
            const calls = state.seen.length;
            assert.deepStrictEqual(
              yield* remotes.receipt("custodian", "candidate-request", intent),
              receipt,
            );
            assert.deepStrictEqual(
              yield* remotes.write("custodian", "candidate-request", intent, token),
              receipt,
            );
            assert.strictEqual(state.seen.length, calls);
            const persisted = yield* sql`SELECT intent,receipt FROM hq_git_target_receipt`;
            assert.strictEqual(JSON.stringify(persisted).includes("repository-test-secret"), false);
            state.members = [member("custodian", "READ_ONLY")];
            assert.strictEqual(
              yield* Effect.match(remotes.write("custodian", "new-request", intent, token), {
                onSuccess: () => "accepted",
                onFailure: (error) => error._tag,
              }),
              "RemoteRefused",
            );
          }),
        ),
    );

    it.effect.each([
      { label: "the same address", path: "krls2020/tst123" },
      { label: "the same GitHub repository at a renamed address", path: "krls2020/renamed" },
    ])(
      "A connection refused for $label leaves the new application's Git storage empty",
      ({ path }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, git, state } = yield* fixture;
            yield* remotes.connect("custodian", input);
            yield* sql`DELETE FROM hq_repo WHERE app_id::text=${OTHER}`;
            state.path = path;
            const refused = yield* remotes
              .connect("custodian", {
                ...input,
                appId: OTHER,
                repo: "fresh",
                url: `https://github.com/${path}`,
              })
              .pipe(Effect.flip);
            assert.strictEqual(refused.reason, "remote_taken");
            assert.strictEqual("applicationName" in refused && refused.applicationName, APP);
            assert.strictEqual("repository" in refused && refused.repository, path);
            assert.deepStrictEqual(yield* git.list(OTHER), []);
            assert.deepStrictEqual(
              yield* sql`SELECT name FROM hq_repo WHERE app_id::text=${OTHER}`,
              [],
            );
          }),
        ),
    );
    it.effect(
      "An occupied repository hides its application when the person's read access is no longer verified",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, state, sql } = yield* fixture;
            yield* remotes.connect("custodian", input);
            yield* sql`DELETE FROM hq_repo WHERE app_id::text=${OTHER}`;
            state.afterRules = () => {
              state.nextRoles = Effect.sync(() => {
                state.nextRoles = Effect.sync(() => {
                  state.members = [member("custodian", "NO_ACCESS")];
                });
              });
            };
            const refused = yield* remotes
              .connect("custodian", { ...input, appId: OTHER, repo: "fresh" })
              .pipe(Effect.flip);
            assert.strictEqual(refused.reason, "remote_taken");
            assert.isUndefined("applicationName" in refused ? refused.applicationName : undefined);
            assert.strictEqual("repository" in refused && refused.repository, "krls2020/tst123");
          }),
        ),
    );
    it.effect("A remote belongs to one application.", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { remotes, state } = yield* fixture;
          const connected = yield* remotes.connect("custodian", input);
          assert.strictEqual(connected.hostRepoId, "1416745513");
          assert.strictEqual(
            (yield* remotes.connect("custodian", { ...input, appId: OTHER }).pipe(Effect.flip))
              .reason,
            "remote_taken",
          );
          state.path = "krls2020/renamed";
          assert.strictEqual(
            (yield* remotes
              .connect("custodian", {
                ...input,
                appId: OTHER,
                url: "https://github.com/krls2020/renamed",
              })
              .pipe(Effect.flip)).reason,
            "remote_taken",
          );
          assert.strictEqual(
            (yield* remotes
              .connect("custodian", {
                ...input,
                repo: "worker",
                url: "https://github.com/krls2020/renamed",
              })
              .pipe(Effect.flip)).reason,
            "remote_taken",
          );
          assert.strictEqual(yield* remotes.get({ appId: OTHER, repo: "web" }), undefined);
        }),
      ),
    );
    it.effect("A token that cannot push is named before the remote is connected.", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { remotes, sql, state } = yield* fixture;
          state.mode = "read";
          const error = yield* remotes.connect("custodian", input).pipe(Effect.flip);
          assert.strictEqual(error.reason, "push_not_granted");
          assert.strictEqual(
            error.message,
            "This token can't push to krls2020/tst123: under Repository access choose Only select repositories → krls2020/tst123 with Contents: Read and write. If krls2020 approves tokens, it may still be pending.",
          );
          assert.deepStrictEqual(yield* sql`SELECT 1 FROM hq_repo_remote`, []);
          assert.deepStrictEqual(state.seen, [
            "GET /repos/krls2020/tst123",
            "GET /krls2020/tst123.git/info/refs?service=git-receive-pack",
          ]);
        }),
      ),
    );
    it.effect.each([
      ["private", "not_visible"],
      ["archived", "archived"],
      ["sso", "sso"],
      ["classic", "classic_scope"],
      ["invalid", "token_invalid"],
      ["malformed", "could_not_verify"],
      ["unknown", "could_not_verify"],
      ["pr", "pull_requests_only"],
      ["rate", "rate_limited"],
    ] as const)("Failed candidate evidence grants no connection or seal: %s.", ([mode, reason]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { remotes, sql, state } = yield* fixture;
          state.mode = mode;
          assert.strictEqual(
            (yield* remotes.connect("custodian", input).pipe(Effect.flip)).reason,
            reason,
          );
          assert.deepStrictEqual(yield* sql`SELECT * FROM hq_repo_remote`, []);
        }),
      ),
    );
    it.effect(
      "An old host refusal cannot invalidate a replacement sealed while its request was in flight.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, state } = yield* fixture;
            yield* remotes.connect("custodian", input);
            const arrived = new Promise<NodeHttp.ServerResponse>((resolve) => {
              state.nextMetadata = resolve;
            });
            const attempt = yield* Effect.forkChild(remotes.forUse(REF, "main").pipe(Effect.flip));
            const pending = yield* Effect.promise(() => arrived);
            const replacement = yield* remotes.connect("other", {
              ...input,
              token: Redacted.make("replacement-secret"),
            });
            pending.writeHead(401);
            pending.end('{"message":"Bad credentials"}');
            assert.strictEqual((yield* Fiber.join(attempt)).reason, "token_invalid");
            assert.strictEqual((yield* remotes.get(REF))!.keptAt, replacement.keptAt);
            assert.deepStrictEqual(yield* sql`SELECT invalid_since FROM hq_repo_remote`, [
              { invalid_since: null },
            ]);
            assert.strictEqual(
              Redacted.value((yield* remotes.forUse(REF, "main")).token),
              "replacement-secret",
            );
          }),
        ),
    );
    it.effect(
      "An old custodian denial cannot delete the replacement custodian's active seal.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, state } = yield* fixture;
            yield* remotes.connect("custodian", input);
            const arrived = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            state.nextRoles = Effect.andThen(
              Deferred.succeed(arrived, undefined),
              Deferred.await(release),
            );
            const attempt = yield* Effect.forkChild(remotes.forUse(REF, "main").pipe(Effect.flip));
            yield* Deferred.await(arrived);
            state.members = [member("other")];
            const replacement = yield* remotes.connect("other", {
              ...input,
              token: Redacted.make("replacement-secret"),
            });
            yield* Deferred.succeed(release, undefined);
            assert.strictEqual((yield* Fiber.join(attempt)).reason, "custodian_removed");
            assert.strictEqual((yield* remotes.get(REF))!.keptAt, replacement.keptAt);
            assert.strictEqual(
              Redacted.value((yield* remotes.forUse(REF, "main")).token),
              "replacement-secret",
            );
          }),
        ),
    );
    it.effect(
      "Decision L1e: rotation is a verified atomic swap; failed verification preserves the working token.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, state } = yield* fixture;
            const old = yield* remotes.connect("custodian", input);
            const before = yield* sql`SELECT * FROM hq_repo_remote`;
            state.mode = "read";
            yield* remotes
              .connect("custodian", { ...input, token: Redacted.make("failed-candidate") })
              .pipe(Effect.flip);
            assert.deepStrictEqual(yield* sql`SELECT * FROM hq_repo_remote`, before);
            state.mode = "write";
            const current = yield* remotes.connect("other", {
              ...input,
              token: Redacted.make("replacement-secret"),
            });
            assert.notStrictEqual(current.keptAt, old.keptAt);
            yield* remotes.invalidate(REF, old.keptAt!);
            const use = yield* remotes.forUse(REF, "main");
            assert.strictEqual(Redacted.value(use.token), "replacement-secret");
            assert.strictEqual(use.remote.invalidSince, null);
            assert.notInclude(JSON.stringify(use), "replacement-secret");
            assert.deepStrictEqual(yield* sql`SELECT 1 FROM hq_deploy_job`, []);
            assert.deepStrictEqual(yield* sql`SELECT 1 FROM hq_rollout`, []);
          }),
        ),
    );
    it.effect(
      "Decision L1e: tokens are sealed per application and repository and never serialized in a surface result.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql } = yield* fixture;
            const record = yield* remotes.connect("custodian", input);
            assert.strictEqual(record.expiryLabel, "Expiry not reported");
            assert.strictEqual(record.expiresAt, null);
            assert.notInclude(JSON.stringify(record), "repository-test-secret");
            const [stored] = yield* sql<{ sealed: Uint8Array }>`SELECT sealed FROM hq_repo_remote`;
            assert.notInclude(
              Buffer.from(stored!.sealed).toString("utf8"),
              "repository-test-secret",
            );
            yield* sql`UPDATE hq_repo_remote SET repo='worker'`;
            assert.strictEqual(
              (yield* remotes.forUse({ ...REF, repo: "worker" }, "main").pipe(Effect.flip)).reason,
              "key_unavailable",
            );
          }),
        ),
    );
    it.effect(
      "Decision L2c: fresh authoritative custodian removal deletes the active seal; transient or empty reads preserve unknown.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, state } = yield* fixture;
            yield* remotes.connect("custodian", input);
            const before = yield* sql`SELECT * FROM hq_repo_remote`;
            for (const situation of ["unreadable", "empty", "cached"] as const) {
              state.unreadable = situation === "unreadable";
              state.members = situation === "empty" ? [] : [member("custodian"), member("other")];
              state.freshness = situation === "cached" ? "recent" : "fresh";
              assert.strictEqual(
                (yield* remotes.forUse(REF, "main").pipe(Effect.flip)).reason,
                "membership_unknown",
              );
              assert.deepStrictEqual(yield* sql`SELECT * FROM hq_repo_remote`, before);
            }
            state.freshness = "fresh";
            state.members = [member("other")];
            const seen = state.seen.length;
            assert.strictEqual(
              (yield* remotes.forUse(REF, "main").pipe(Effect.flip)).reason,
              "custodian_removed",
            );
            assert.strictEqual(state.seen.length, seen);
            assert.deepStrictEqual(
              yield* sql`SELECT sealed,key_id,expires_at FROM hq_repo_remote`,
              [{ sealed: null, key_id: null, expires_at: null }],
            );
          }),
        ),
    );
    it.effect(
      "Fresh source denial stops new attempts even when custody changes during host verification.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, state } = yield* fixture;
            yield* remotes.connect("custodian", input);
            state.afterRules = () => {
              state.members = [member("other")];
            };
            assert.strictEqual(
              (yield* remotes.forUse(REF, "main").pipe(Effect.flip)).reason,
              "custodian_removed",
            );
            assert.deepStrictEqual(
              yield* sql`SELECT sealed,key_id,expires_at FROM hq_repo_remote`,
              [{ sealed: null, key_id: null, expires_at: null }],
            );
          }),
        ),
    );
    it.effect(
      "Decision L2c: the Zerops custodian is not an inferred GitHub token owner and a fresh structure writer supplies a replacement.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, state } = yield* fixture;
            state.members = [member("custodian", "BASIC_USER"), member("other")];
            assert.strictEqual(
              (yield* remotes.connect("custodian", input).pipe(Effect.flip)).reason,
              "not_structure_writer",
            );
            const record = yield* remotes.connect("other", input);
            assert.strictEqual(record.keptBy, "other");
            assert.strictEqual(record.url, "https://github.com/krls2020/tst123.git");
          }),
        ),
    );
    it.effect(
      "Decision L1c: same-id rename needs address review; a different repository id never inherits the seal or history.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, state, sql } = yield* fixture;
            yield* remotes.connect("custodian", input);
            state.path = "krls2020/renamed";
            const before = yield* sql`SELECT * FROM hq_repo_remote`;
            assert.strictEqual(
              (yield* remotes.forUse(REF, "main").pipe(Effect.flip)).reason,
              "address_review",
            );
            assert.deepStrictEqual(yield* sql`SELECT * FROM hq_repo_remote`, before);
            assert.strictEqual(
              (yield* remotes
                .connect("custodian", { ...input, url: "https://github.com/krls2020/renamed" })
                .pipe(Effect.flip)).reason,
              "disconnect_required",
            );
            const reviewed = yield* remotes.updateAddress("custodian", {
              ...input,
              url: "https://github.com/krls2020/renamed",
            });
            assert.strictEqual(reviewed.hostRepoId, "1416745513");
            assert.strictEqual(reviewed.url, "https://github.com/krls2020/renamed.git");
            state.id = 999;
            const stable = yield* sql`SELECT * FROM hq_repo_remote`;
            assert.strictEqual(
              (yield* remotes.forUse(REF, "main").pipe(Effect.flip)).reason,
              "repository_changed",
            );
            assert.strictEqual(
              (yield* remotes
                .updateAddress("custodian", { ...input, url: reviewed.url })
                .pipe(Effect.flip)).reason,
              "repository_changed",
            );
            assert.deepStrictEqual(yield* sql`SELECT * FROM hq_repo_remote`, stable);
          }),
        ),
    );
    it.effect(
      "Repository lists keep connections with their application and show a completed disconnect",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes } = yield* fixture;
            yield* remotes.connect("custodian", input);
            const connected = yield* remotes.listRepos("custodian", APP);
            const remote = connected.find((repo) => repo.name === "web")?.remote;
            assert.strictEqual(remote?.url, "https://github.com/krls2020/tst123.git");
            assert.strictEqual(remote?.repositoryId, "1416745513");
            assert.strictEqual(remote?.keptBy, "custodian");
            assert.strictEqual(remote?.invalidSince, null);
            assert.strictEqual(connected.find((repo) => repo.name === "worker")?.remote, null);
            const other = yield* remotes.listRepos("custodian", OTHER);
            assert.strictEqual(other.find((repo) => repo.name === "web")?.remote, null);
            yield* remotes.disconnect("custodian", REF);
            const disconnected = yield* remotes.listRepos("custodian", APP);
            assert.strictEqual(disconnected.find((repo) => repo.name === "web")?.remote, null);
          }),
        ),
    );
    it.effect(
      "Decision L2b: disconnect refuses stage or production dependencies and deletes only HQ's seal and metadata, never host refs or tokens.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, state } = yield* fixture;
            yield* remotes.connect("custodian", input);
            for (const tier of ["stage", "production"] as const) {
              yield* sql`INSERT INTO hq_environment(id,app_id,tier,name,target,sources,branch,delivery,created_by)
          VALUES (${tier},${APP}::uuid,${tier},${tier},'git',${tier === "stage" ? sql`ARRAY['main']` : sql`ARRAY['release']`},${tier},'direct','custodian')`;
              assert.strictEqual(
                (yield* remotes.disconnect("custodian", REF).pipe(Effect.flip)).reason,
                "in_use",
              );
              yield* sql`DELETE FROM hq_environment WHERE id=${tier}`;
            }
            const seen = state.seen.length;
            yield* remotes.disconnect("custodian", REF);
            assert.deepStrictEqual(yield* sql`SELECT * FROM hq_repo_remote`, []);
            assert.strictEqual(state.seen.length, seen);
            assert.strictEqual(
              state.seen.every((request) => request.startsWith("GET ")),
              true,
            );
          }),
        ),
    );
    it.effect(
      "Decision L4a: host rate limits retain the working seal and expose existing operationBackoff evidence.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { remotes, sql, state } = yield* fixture;
            yield* remotes.connect("custodian", input);
            const before = yield* sql`SELECT * FROM hq_repo_remote`;
            state.mode = "rate";
            const error = yield* remotes.forUse(REF, "main").pipe(Effect.flip);
            assert.strictEqual(error.reason, "rate_limited");
            assert.strictEqual(error._tag, "ProbeRefused");
            if (error._tag === "ProbeRefused") assert.strictEqual(error.retryAfterMs, 30_000);
            assert.deepStrictEqual(yield* sql`SELECT * FROM hq_repo_remote`, before);
          }),
        ),
    );
  });
});
