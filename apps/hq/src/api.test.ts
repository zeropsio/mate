import { scopeReset, scopeValue, nextScopeValue, scopeRemoval } from "../test/harness/scopes.ts";
import type {
  HqNavigationApp,
  HqNavigationProject,
  HqNavigationPerson,
  HqAttentionScopeValue,
} from "@t3tools/shared/hqStream";
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- the tests reach Core as a client does: over HTTP and a WebSocket.
import { assert, describe, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as Layer from "effect/Layer";

import { GitError } from "@t3tools/hq-git";

import {
  CLIENT,
  enrollMate,
  sessionFor,
  setUpMate,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { addProject, rowsWhere } from "../test/harness/mates.ts";
import { mainAt, overviewOf } from "../test/harness/overviews.ts";
import { tempDir } from "../test/harness/tempDir.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { ZeropsOwnToken } from "./zerops/api.ts";
import { corsRoutes, failure } from "./api.ts";
import { NotLeader } from "./leader.ts";
import { ZeropsRefused, ZeropsUnavailable } from "./zerops/api.ts";

describe("HQ's failures", () => {
  it.effect("caches a preflight from any origin for two hours, without credentials", () =>
    Effect.gen(function* () {
      const { handler, dispose } = HttpRouter.toWebHandler(
        corsRoutes.pipe(Layer.provide(HttpServer.layerServices)),
      );
      yield* Effect.addFinalizer(() => Effect.promise(dispose));
      const preflight = yield* Effect.promise(() =>
        handler(
          new Request("https://hq.example/api/structure", {
            method: "OPTIONS",
            headers: {
              origin: "https://mate.dev-team.example.org",
              "access-control-request-method": "GET",
              "access-control-request-headers": "authorization",
            },
          }),
        ),
      );
      assert.strictEqual(preflight.headers.get("access-control-max-age"), "7200");
      assert.strictEqual(preflight.headers.get("access-control-allow-origin"), "*");
      assert.isNull(preflight.headers.get("access-control-allow-credentials"));
      assert.strictEqual(
        preflight.headers.get("access-control-allow-methods"),
        "GET, POST, PUT, PATCH, DELETE",
      );
      assert.strictEqual(
        preflight.headers.get("access-control-allow-headers"),
        "authorization,content-type",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("answers every 503 with Retry-After: whatever is unavailable now, try again", () =>
    Effect.gen(function* () {
      for (const error of [
        new NotLeader({ reason: "fenced" }),
        new ZeropsUnavailable({ operation: "members", message: "down" }),
        { _tag: "SqlError" },
        { _tag: "GitError" },
      ]) {
        const response = yield* failure(error);
        assert.deepStrictEqual(
          [response.status, response.headers["retry-after"]],
          [503, "5"],
          error._tag,
        );
      }
    }),
  );

  // a definitive refusal from Zerops is no outage — nothing tells the caller to retry.
  it.effect("answers Zerops' definitive refusal as a refusal, never a 503 to try again", () =>
    Effect.gen(function* () {
      for (const reason of ["unauthorized", "forbidden", "not_found", "invalid"] as const) {
        const response = yield* failure(
          new ZeropsRefused({ operation: "view", reason, status: 0, code: "noCredential" }),
        );
        assert.deepStrictEqual(
          [
            response.status,
            response.headers["retry-after"],
            yield* Effect.promise(() => HttpServerResponse.toWeb(response).json()),
          ],
          [403, undefined, { code: "zerops_refused", reason }],
          reason,
        );
      }
    }),
  );

  // H2: a repository git quarantined is refused as such, with the reason it is withheld.
  it.effect("answers a quarantined repository 503 repo_unavailable, naming why", () =>
    Effect.gen(function* () {
      const response = yield* failure(
        new GitError({ operation: "serve", reason: "unavailable", message: "converge_git_failed" }),
      );
      assert.deepStrictEqual(
        [
          response.status,
          response.headers["retry-after"],
          yield* Effect.promise(() => HttpServerResponse.toWeb(response).json()),
        ],
        [503, "5", { code: "repo_unavailable", reason: "converge_git_failed" }],
      );
    }),
  );
});

/** A statement on Core's database, as an operator would run it. */
const query = (url: string, statement: string) => rowsWhere(url, statement, () => true);

const ALLOW = { allow: true } as const;
const refusedFor = (reason: string) => ({ allow: false, reason }) as const;
/** Each of `verbs` decided as `decision`. */
const each = (verbs: ReadonlyArray<string>, decision: object) =>
  Object.fromEntries(verbs.map((verb) => [verb, decision]));
const ORG_VERBS = ["create_app", "rename_app", "delete_app"];
/** What an org owner may do with the organization, and with each application. */
const ORG_ALLOWED = each(ORG_VERBS, ALLOW);
const ORG_REFUSED = each(ORG_VERBS, refusedFor("not_structure_writer"));
const APP_ALLOWED = each(
  [
    "read_change",
    "comment_change",
    "merge_change",
    "close_change",
    "redeploy",
    "release",
    "add_stage",
    "add_production",
  ],
  ALLOW,
);
/** The same where the application has no production: nobody releases it, an org owner neither. */
const APP_NO_PRODUCTION = { ...APP_ALLOWED, release: refusedFor("no_production") };
/** An owner's Mate permissions; move destinations are requested when the dialog opens. */
const MATE_OWNED = () => ({
  can: { observe_mate: ALLOW, edit_mate_record: ALLOW, detach: ALLOW },
});
describe("HQ API", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("explicit deletion completion checks one project and publishes empty contents", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const dev = yield* sessionFor(call, "door-dev");
        const app = yield* call("POST", "/api/apps", {
          session: owner,
          body: { name: "Deletion" },
        });
        const appId = (app.body as { readonly id: string }).id;
        yield* call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: { projectId: "P_MATE", kind: "mate", mate: { face: "" } },
        });
        const prepared = yield* call("POST", "/api/projects/P_MATE/deletion", { session: owner });
        assert.strictEqual(prepared.status, 200);
        const completion = (prepared.body as { readonly completion: string }).completion;
        const finish = (session: string) =>
          call("POST", "/api/projects/P_MATE/deleted", { session, body: { completion } });
        assert.deepStrictEqual((yield* finish(owner)).body, {
          code: "conflict",
          reason: "project_still_exists",
        });
        assert.strictEqual((yield* finish(dev)).status, 403);
        fake.projects.splice(
          fake.projects.findIndex((p) => p.id === "P_MATE"),
          1,
        );
        assert.strictEqual((yield* finish(owner)).status, 200);
        const read = (yield* call("GET", "/api/structure", { session: owner })).body as {
          readonly apps: ReadonlyArray<{ readonly contents: { readonly empty: boolean } }>;
        };
        assert.strictEqual(read.apps[0]?.contents.empty, true);
        assert.strictEqual(
          (yield* call("DELETE", `/api/apps/${appId}`, { session: owner })).status,
          204,
        );
      }),
    );

    it.effect(
      "an owner comes through the door, creates an application, attaches a Mate and reads it",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const created = yield* call("POST", "/api/apps", { session, body: { name: "Shop" } });
          assert.strictEqual(created.status, 201);
          const appId = (created.body as { readonly id: string }).id;
          const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
            session,
            body: { projectId: "P_MATE", kind: "mate", mate: { face: "face-3" } },
          });
          assert.strictEqual(attached.status, 201);
          assert.deepStrictEqual((yield* call("GET", "/api/structure", { session })).body, {
            can: ORG_ALLOWED,
            unheld: {},
            presses: {},
            ungrouped: [],
            apps: [
              {
                id: appId,
                name: "Shop",
                can: APP_NO_PRODUCTION,
                contents: { empty: false, deletingProjectIds: [] },
                projects: [
                  {
                    projectId: "P_MATE",
                    name: "P_MATE",
                    kind: "mate",
                    mate: {
                      face: "face-3",
                      madeBy: "owner",
                      standupRequestedBy: null,
                      closedOff: false,
                      setupMarker: null,
                      keyWider: false,
                    },
                    ...MATE_OWNED(),
                  },
                ],
                environments: [],
                births: [],
              },
            ],
          });
        }),
    );

    // The lead, 2026-10-03: under load an application was answered before its repository existed:
    // git opens a moment after the lead (its takeover converges every repository first), and the
    // repository's making was only logged as missed. Create answers once its repository is made.
    it.effect("answers a new application once its repository is made, though git opens late", () =>
      Effect.gen(function* () {
        // The volume is a file until git may open: no repository root can be made under it.
        const dir = yield* tempDir("hq-late-git-");
        const volume = NodePath.join(dir, "vol");
        yield* Effect.promise(() => NodeFSP.writeFile(volume, ""));
        const gitRoot = NodePath.join(volume, "git");
        const { call } = yield* startCore(true, { gitRoot });
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        yield* Effect.forkChild(
          Effect.andThen(
            Effect.sleep(Duration.millis(300)),
            Effect.promise(() => NodeFSP.rm(volume)),
          ),
        );
        const created = yield* call("POST", "/api/apps", { session, body: { name: "Shop" } });
        assert.strictEqual(created.status, 201);
        const appId = (created.body as { readonly id: string }).id;
        const head = yield* Effect.promise(() =>
          NodeFSP.stat(NodePath.join(gitRoot, appId, "group.git", "HEAD")).then(
            (found) => found.isFile(),
            () => false,
          ),
        );
        assert.isTrue(head, "its repository is there when HQ answers");
      }),
    );

    // E2E 2026-10-03 (F5): an application a stopped New project left holds its recipe repository
    // only. Deleted, it goes from disk too: nothing reconciles or bundles it again.
    // F22 (2026-10-03): a release asked while KRLS's org-wide reads stalled went with its client,
    // who gave up at 20 s, and was never made. A write that started is finished, and its result is
    // there to read, whoever is left to hear its answer.
    it.effect("finishes a write whose client went away while Zerops stalled", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        const created = yield* call("POST", "/api/apps", { session, body: { name: "Shop" } });
        const appId = (created.body as { readonly id: string }).id;
        // The member list answers in 1.5 s; the view HQ holds is past its age (200 ms here).
        fake.membersTake = 1500;
        yield* Effect.sleep(Duration.millis(400));
        yield* Effect.exit(
          call("PATCH", `/api/apps/${appId}`, {
            session,
            body: { name: "Store" },
            signal: AbortSignal.timeout(300),
          }),
        );
        yield* Effect.sleep(Duration.millis(2500));
        fake.membersTake = 0;
        const structure = yield* call("GET", "/api/structure", { session });
        assert.deepStrictEqual(
          (structure.body as { readonly apps: ReadonlyArray<{ readonly name: string }> }).apps.map(
            (app) => app.name,
          ),
          ["Store"],
        );
      }),
    );

    it.effect("deletes an application that holds nothing, its repository with it; no other", () =>
      Effect.gen(function* () {
        const { call, gitRoot } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        const made = (name: string) =>
          Effect.map(
            call("POST", "/api/apps", { session, body: { name } }),
            (answer) => (answer.body as { readonly id: string }).id,
          );
        const empty = yield* made("Shop");
        const team = yield* made("Team");
        yield* call("POST", `/api/apps/${team}/projects`, {
          session,
          body: { projectId: "P_MATE", kind: "mate", mate: { face: "face-3" } },
        });
        const onDisk = () => Effect.promise(() => NodeFSP.readdir(gitRoot));
        assert.include(yield* onDisk(), empty);

        const dev = yield* sessionFor(call, "door-dev");
        const answers = yield* Effect.all([
          call("DELETE", `/api/apps/${empty}`, { session: dev }),
          call("DELETE", `/api/apps/${team}`, { session }),
          call("DELETE", `/api/apps/${empty}`, { session }),
        ]);
        assert.deepStrictEqual(
          answers.map((answer) => {
            const body = answer.body as { readonly code?: string; readonly reason?: string } | null;
            return [answer.status, body?.code, body?.reason];
          }),
          [
            [403, "forbidden", "not_structure_writer"],
            [409, "conflict", "app_not_empty"],
            [204, undefined, undefined],
          ],
        );
        assert.notInclude(yield* onDisk(), empty);
        assert.deepStrictEqual(
          (
            (yield* call("GET", "/api/structure", { session })).body as {
              readonly apps: ReadonlyArray<{ readonly name: string }>;
            }
          ).apps.map((app) => app.name),
          ["Team"],
        );
      }),
    );

    it.effect("attaches an environment named as asked, and refuses a name main refused", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        const created = yield* call("POST", "/api/apps", { session, body: { name: "Shop" } });
        const appId = (created.body as { readonly id: string }).id;
        const attach = (projectId: string, kind: string, name: string) =>
          Effect.map(
            call("POST", `/api/apps/${appId}/projects`, {
              session,
              body: { projectId, kind, environment: { name } },
            }),
            (response) => [response.status, response.body],
          );
        assert.deepStrictEqual(
          [
            yield* attach("P_MATE", "production", "Live"),
            yield* attach("P_MATE", "production", "live"),
          ],
          [
            [400, { code: "invalid", reason: "environment_name_invalid" }],
            // A production before any release asks for nothing.
            [
              201,
              { appId, projectId: "P_MATE", kind: "production", deploys: { jobs: [], note: null } },
            ],
          ],
        );
        const read = (yield* call("GET", "/api/structure", { session })).body as {
          readonly apps: ReadonlyArray<{
            readonly projects: ReadonlyArray<unknown>;
            readonly environments: ReadonlyArray<unknown>;
          }>;
        };
        assert.deepStrictEqual(
          [read.apps[0]?.projects, read.apps[0]?.environments],
          [
            [
              {
                projectId: "P_MATE",
                name: "P_MATE",
                kind: "production",
                mate: null,
                can: { finish: ALLOW },
              },
            ],
            [
              {
                projectId: "P_MATE",
                tier: "production",
                name: "live",
                sources: ["release"],
                order: 1,
                can: { keep_deploy_token: ALLOW },
                keyHeld: false,
                keyInvalid: false,
                jobs: [],
                release: null,
                birth: { ended: false },
              },
            ],
          ],
        );
      }),
    );

    it.effect("keeps an environment's deploy token, answering only that it holds one", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        const created = yield* call("POST", "/api/apps", { session, body: { name: "Shop" } });
        const appId = (created.body as { readonly id: string }).id;
        yield* call("POST", `/api/apps/${appId}/projects`, {
          session,
          body: { projectId: "P_MATE", kind: "stage", environment: { name: "stage" } },
        });
        const key = (over: Partial<ZeropsOwnToken> = {}) => ({
          id: "T_KEY",
          name: "deploy-stage",
          orgId: "ORG",
          roleCode: "NO_ACCESS",
          canCreateProjects: false,
          canViewFinances: false,
          canEditFinances: false,
          projects: [{ projectId: "P_MATE", roleCode: "BASIC_USER" }],
          createdMs: 0,
          createdByUser: "owner",
          ...over,
        });
        fake.tokens.set("key-stage", key());
        // One key per way a token reaches more than its project (main E02).
        const scope = {
          "key-other-org": key({ orgId: "ORG2" }),
          "key-two-projects": key({
            projects: [
              { projectId: "P_MATE", roleCode: "BASIC_USER" },
              { projectId: "HQ_PROJECT", roleCode: "BASIC_USER" },
            ],
          }),
          "key-admin-on-p": key({ projects: [{ projectId: "P_MATE", roleCode: "ADMIN" }] }),
          "key-org-read": key({ roleCode: "READ_ONLY" }),
          "key-creates-projects": key({ canCreateProjects: true }),
          "key-sees-finances": key({ canViewFinances: true }),
        };
        for (const [value, record] of Object.entries(scope)) fake.tokens.set(value, record);
        // dev develops Shop through a Basic user grant on its stage's project: no Full access.
        const project = fake.projects.find((candidate) => candidate.id === "P_MATE")!;
        Object.assign(project, { userRoles: [{ clientUserId: "C-dev", roleCode: "BASIC_USER" }] });
        const dev = yield* sessionFor(call, "door-dev");
        const put = (name: string, token: string, as = session) =>
          Effect.map(
            call("PUT", `/api/apps/${appId}/environments/${name}/deploy-token`, {
              session: as,
              body: { token },
            }),
            (response) => [response.status, response.body],
          );
        const SCOPE = [400, { code: "invalid", reason: "deploy_token_scope" }];
        assert.deepStrictEqual(
          [
            yield* put("production", "key-stage"),
            yield* put("stage", "key-bogus"),
            ...(yield* Effect.forEach(Object.keys(scope), (value) => put("stage", value))),
            yield* put("stage", "key-stage", dev),
            yield* put("stage", "key\r\nX-Injected: 1"),
            yield* put("stage", "k".repeat(513)),
            yield* put("stage", "key-stage"),
          ],
          [
            [404, { code: "environment_not_found", reason: "environment_not_found" }],
            [400, { code: "invalid", reason: "deploy_token_refused" }],
            SCOPE,
            SCOPE,
            SCOPE,
            SCOPE,
            SCOPE,
            SCOPE,
            [403, { code: "forbidden", reason: "not_project_admin" }],
            [400, { code: "invalid" }],
            [400, { code: "invalid" }],
            // The key kept asks for the stage's deploys: a tier HQ cannot read asks for none.
            [200, { deploys: { jobs: [], note: "the stage tier could not be read" } }],
          ],
        );
        const read = yield* call("GET", "/api/structure", { session });
        assert.deepStrictEqual(
          (
            read.body as {
              readonly apps: ReadonlyArray<{ readonly environments: ReadonlyArray<unknown> }>;
            }
          ).apps[0]?.environments,
          [
            {
              projectId: "P_MATE",
              tier: "stage",
              name: "stage",
              sources: ["main"],
              order: 1,
              can: { keep_deploy_token: ALLOW },
              keyHeld: true,
              keyInvalid: false,
              jobs: [],
              release: null,
              birth: { ended: true },
            },
          ],
        );
        assert.notInclude(new TextDecoder().decode(read.bytes), "key-stage");
      }),
    );

    // Fable round 9: an application's environments and deploys go to whoever reads its changes. A
    // Read only grant shows the application, and none of them; a developer's snapshot carries them.
    it.effect("the structure carries environments only to who reads the application changes", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const created = yield* call("POST", "/api/apps", {
          session: owner,
          body: { name: "Shop" },
        });
        const appId = (created.body as { readonly id: string }).id;
        yield* call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: { projectId: "P_MATE", kind: "stage", environment: { name: "stage" } },
        });
        const project = fake.projects.find((candidate) => candidate.id === "P_MATE")!;
        const dev = yield* sessionFor(call, "door-dev");
        const snapshotAs = (roleCode: string) =>
          Effect.gen(function* () {
            Object.assign(project, { userRoles: [{ clientUserId: "C-dev", roleCode }] });
            yield* Effect.sleep(Duration.millis(400));
            const response = yield* call("GET", "/api/structure", { session: dev });
            return (response.body as { apps: ReadonlyArray<{ environments: unknown }> }).apps.map(
              (app) => app.environments,
            );
          });
        // Refused, and said so: never an empty list that reads as "no environments".
        assert.deepStrictEqual(yield* snapshotAs("READ_ONLY"), [{ refused: "changes_not_seen" }]);
        assert.deepStrictEqual(yield* snapshotAs("BASIC_USER"), [
          [
            {
              projectId: "P_MATE",
              tier: "stage",
              name: "stage",
              sources: ["main"],
              order: 1,
              can: { keep_deploy_token: refusedFor("not_project_admin") },
              keyHeld: false,
              keyInvalid: false,
              jobs: [],
              release: null,
              birth: { ended: false },
            },
          ],
        ]);
      }),
    );

    // "Run again" (main B36): whoever develops the application asks a failed deploy again; one who
    // sees it through a Read only grant may not (Fable round 9).
    it.effect("asks a failed deploy again for a developer, never for a Read only grant", () =>
      Effect.gen(function* () {
        const { call, fake, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const created = yield* call("POST", "/api/apps", {
          session: owner,
          body: { name: "Shop" },
        });
        const appId = (created.body as { readonly id: string }).id;
        yield* call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: { projectId: "P_MATE", kind: "stage", environment: { name: "stage" } },
        });
        const sha = "a".repeat(40);
        yield* rowsWhere(
          url,
          `INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state,
             reason, ended_at)
           SELECT id, 'deploy', 'P_MATE', 'web', 'web', '${sha}', 'failed', 'failed: Build failed',
             now()
           FROM hq_rollout WHERE project_id = 'P_MATE'
           RETURNING 1`,
          (rows) => rows.length === 1,
        );
        const project = fake.projects.find((candidate) => candidate.id === "P_MATE")!;
        Object.assign(project, { userRoles: [{ clientUserId: "C-dev", roleCode: "READ_ONLY" }] });
        const dev = yield* sessionFor(call, "door-dev");
        const ask = (session: string, body: unknown) =>
          Effect.map(
            call("POST", `/api/apps/${appId}/environments/stage/redeploy`, { session, body }),
            (response) => [response.status, response.body],
          );
        assert.deepStrictEqual(
          [
            yield* ask(dev, { service: "web", sha }),
            yield* ask(owner, { service: "web", sha: "not-a-sha" }),
            yield* ask(owner, { service: "web", sha }),
          ],
          [
            [403, { code: "forbidden", reason: "not_app_developer" }],
            [400, { code: "invalid" }],
            // Run, and answered: no key kept for the stage, so refused at once.
            [
              200,
              {
                deploys: {
                  jobs: [
                    {
                      environment: "stage",
                      kind: "deploy",
                      service: "web",
                      sha,
                      job: "2",
                      state: "refused",
                      processId: null,
                      appVersionId: null,
                      verifiedVersionId: null,
                      behind: null,
                      reason:
                        "stage has no deploy token yet; an admin who opens the projects page in Zerops Mate mints it",
                      steps: [],
                      evidence: {
                        phase: "closed",
                        nextActor: "none",
                        nextAction: "Operation ended",
                        processes: [],
                        version: null,
                      },
                    },
                  ],
                  note: null,
                },
              },
            ],
          ],
        );
        // A job of its own, saying who asked.
        yield* rowsWhere(
          url,
          `SELECT 1 FROM hq_deploy_job WHERE sha = '${sha}' AND requested_by = 'owner'`,
          (rows) => rows.length === 1,
        );
        // Add service, by the same rule: only a service the stage's tier declares.
        const add = yield* call("POST", `/api/apps/${appId}/environments/stage/services`, {
          session: owner,
          body: { service: "cache" },
        });
        assert.deepStrictEqual(
          [add.status, add.body],
          [409, { code: "conflict", reason: "service_not_declared" }],
        );
      }),
    );

    it.effect(
      "a Developer comes through, may not create, and sees nothing Zerops hides from them",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const dev = yield* sessionFor(call, "door-dev");
          const refused = yield* call("POST", "/api/apps", {
            session: dev,
            body: { name: "Mine" },
          });
          // The refusal says what and why, nothing of the server's own types.
          assert.deepStrictEqual(
            [refused.status, refused.body],
            [403, { code: "forbidden", reason: "not_structure_writer" }],
          );
          assert.deepStrictEqual((yield* call("GET", "/api/structure", { session: dev })).body, {
            can: ORG_REFUSED,
            unheld: {},
            presses: {},
            ungrouped: [],
            apps: [],
          });
        }),
    );

    it.effect(
      "refuses a token that is no fresh throwaway with one code, and a call without a live session",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const answers = yield* Effect.all([
            call("POST", "/api/door", { body: { token: "door-flagged" } }),
            call("POST", "/api/door", { body: { token: "door-stale" } }),
            call("POST", "/api/door", { body: { token: "unknown" } }),
            call("POST", "/api/door", { body: { nope: true } }),
            call("GET", "/api/structure"),
            call("GET", "/api/structure", { session: "forged" }),
          ]);
          assert.deepStrictEqual(
            answers.map((answer) => [
              answer.status,
              (answer.body as { readonly code: string }).code,
            ]),
            [
              [401, "zerops_throwaway_required"],
              [401, "zerops_throwaway_required"],
              [401, "zerops_throwaway_required"],
              [400, "invalid"],
              [401, "session_required"],
              [401, "session_required"],
            ],
          );
          const session = yield* sessionFor(call, "door-owner");
          assert.strictEqual((yield* call("DELETE", "/api/session", { session })).status, 204);
          assert.strictEqual((yield* call("GET", "/api/structure", { session })).status, 401);
        }),
    );

    // An empty member list is an outage, never "nobody may": the door answers 503, and a write is
    // decided over the last view Zerops answered within five minutes (F22, option A).
    it.effect(
      "answers a door 503 while Zerops gives an empty member list, a write over the last good view",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          fake.members.set("ORG", []);
          // Past the age a door may admit by (the harness's view TTL): it reads the org again.
          yield* Effect.sleep(Duration.millis(400));
          const answers = yield* Effect.all([
            call("POST", "/api/apps", { session, body: { name: "Two" } }),
            call("POST", "/api/door", { body: { token: "door-dev" } }),
          ]);
          assert.deepStrictEqual(
            answers.map((answer) => [
              answer.status,
              (answer.body as { readonly code?: string }).code ?? "made",
            ]),
            [
              [201, "made"],
              [503, "zerops_unavailable"],
            ],
          );
        }),
    );

    // The owner, 2026-10-05: a write that cannot be taken back is never decided over the last good
    // view; while Zerops does not answer it is refused, said so, and nothing is written.
    it.effect(
      "refuses a write that cannot be undone while Zerops does not answer, one that can goes on",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const appId = (
            (yield* call("POST", "/api/apps", { session, body: { name: "Shop" } })).body as {
              readonly id: string;
            }
          ).id;
          fake.members.set("ORG", []);
          yield* Effect.sleep(Duration.millis(400));
          const renamed = yield* call("PATCH", `/api/apps/${appId}`, {
            session,
            body: { name: "Store" },
          });
          const deleted = yield* call("DELETE", `/api/apps/${appId}`, { session });
          assert.deepStrictEqual(
            [
              [renamed.status, (renamed.body as { readonly name?: string }).name],
              [deleted.status, (deleted.body as { readonly code?: string }).code],
            ],
            [
              [200, "Store"],
              [503, "zerops_unanswered"],
            ],
          );
          const read = yield* call("GET", "/api/structure", { session });
          assert.deepStrictEqual(
            (read.body as { readonly apps: ReadonlyArray<{ readonly id: string }> }).apps.map(
              (app) => app.id,
            ),
            [appId],
          );
        }),
    );

    it.effect("opens one session per throwaway: its replay is refused", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        yield* sessionFor(call, "door-owner");
        const replay = yield* call("POST", "/api/door", { body: { token: "door-owner" } });
        assert.deepStrictEqual(
          [replay.status, (replay.body as { readonly code: string }).code],
          [401, "zerops_throwaway_required"],
        );
      }),
    );

    it.effect("judges a presented token before spending HQ's own credential on it", () =>
      Effect.gen(function* () {
        // The structure's reconcile spends HQ's credential on its own clock: off here, so every
        // spend counted is the door's. Official's next read comes 30 s after boot, past the
        // health wait's 10 s.
        const { call, fake } = yield* startCore(true, { reconcileEvery: Duration.minutes(5) });
        yield* untilHealth(call, "active");
        const spent = () => fake.calls.filter((entry) => entry.endsWith(":hq")).length;
        const before = spent();
        for (const token of ["door-flagged", "door-stale", "unknown"]) {
          yield* call("POST", "/api/door", { body: { token } });
        }
        assert.strictEqual(spent(), before);
      }),
    );

    it.effect("limits the door per client address, and bounds every body", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const knock = (ip: string) =>
          Effect.map(
            call("POST", "/api/door", { body: { token: "unknown" }, headers: { "x-real-ip": ip } }),
            (answer) => answer.status,
          );
        // A whole office comes from one address (t12, 2026-10-03): its bucket starts at 120, so
        // the first 120 get in. Core runs on the real clock and refills one a second while the
        // knocks travel, so the 429 after them is awaited, not counted to — the exact steps are
        // rateLimit.test.ts's, on a test clock. A hundred more knocks without one is 100 s.
        const statuses = yield* Effect.forEach(Array.from({ length: 120 }), () =>
          knock("10.0.0.1"),
        );
        assert.deepStrictEqual(statuses, Array(120).fill(401));
        let status = 401;
        for (let more = 0; status !== 429 && more < 100; more++) status = yield* knock("10.0.0.1");
        assert.strictEqual(status, 429);
        assert.strictEqual(yield* knock("10.0.0.2"), 401);

        const session = yield* sessionFor(call, "door-owner");
        // Refused on their declared length, before a byte is read: no connection is cut.
        const tooLarge = yield* Effect.all([
          call("POST", "/api/door", { body: { token: "x".repeat(9000) } }),
          call("POST", "/api/apps", { session, body: { name: "x".repeat(70_000) } }),
        ]);
        assert.deepStrictEqual(
          tooLarge.map((answer) => [
            answer.status,
            (answer.body as { readonly code: string }).code,
          ]),
          [
            [413, "too_large"],
            [413, "too_large"],
          ],
        );
      }),
    );

    // t12, 2026-10-03: our agents and Karel come from one address, and HQ's door answered them
    // 429 at ten a minute. An office behind one NAT gets in; one person's flood of throwaways is
    // stopped at the person, never at their colleagues.
    it.effect("lets an office behind one address in, and stops one person's flood alone", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const now = yield* Clock.currentTimeMillis;
        const throwaways = (userId: string, count: number) => {
          fake.members.get("ORG")!.push({
            name: userId,
            kind: "person",
            roleCode: "BASIC_USER",
            status: "ACTIVE",
            userId,
            clientUserId: `C-${userId}`,
            canCreateProjects: false,
          });
          return Array.from({ length: count }, (_, index) => {
            const value = `door-${userId}-${String(index)}`;
            fake.tokens.set(value, {
              id: value,
              name: "mate-door:HQ1:n0nce",
              orgId: "ORG",
              roleCode: "NO_ACCESS",
              canCreateProjects: false,
              canViewFinances: false,
              canEditFinances: false,
              projects: [],
              createdMs: now,
              createdByUser: userId,
            });
            return value;
          });
        };
        const office = Array.from({ length: 20 }, (_, person) =>
          throwaways(`staff-${String(person)}`, 3),
        );
        // Twenty, then twenty more to await the 429 by: the person refills one every three seconds
        // on the real clock, so twenty without one is a minute. The address's 120 hold all 101.
        const flood = throwaways("flooder", 40);
        const colleague = throwaways("colleague", 1);
        // Past the org view the boot read: the new people are in the next.
        yield* Effect.sleep(Duration.millis(400));
        const enter = (token: string) =>
          Effect.map(
            call("POST", "/api/door", { body: { token }, headers: { "x-real-ip": "10.0.0.9" } }),
            (answer) => answer.status,
          );
        // Twenty people, three doors each — a reload, another tab, a reload — inside a minute.
        assert.deepStrictEqual(
          new Set(yield* Effect.forEach(office.flat(), enter)),
          new Set([200]),
        );
        assert.deepStrictEqual(
          yield* Effect.forEach(flood.slice(0, 20), enter),
          Array(20).fill(200),
        );
        let status = 200;
        for (const token of flood.slice(20)) {
          status = yield* enter(token);
          if (status === 429) break;
        }
        assert.strictEqual(status, 429);
        assert.deepStrictEqual(yield* Effect.forEach(colleague, enter), [200]);
      }),
    );

    it.effect("ends a session whose organization is no longer this HQ's", () =>
      Effect.gen(function* () {
        const first = yield* startCore(true);
        yield* untilHealth(first.call, "active");
        const session = yield* sessionFor(first.call, "door-owner");
        yield* first.stop;
        // HQ restarts with a credential of another org, where the same people are members.
        const moved = yield* startCore(true, { url: first.url, orgId: "ORG2" });
        yield* untilHealth(moved.call, "active");
        const answer = yield* moved.call("POST", "/api/apps", { session, body: { name: "Moved" } });
        assert.deepStrictEqual(
          [answer.status, (answer.body as { readonly code: string }).code],
          [401, "session_required"],
        );
        assert.strictEqual((yield* sessionFor(moved.call, "door-owner-2")).length, 43);
      }),
    );

    it.effect(
      "streams demanded navigation values, people and explicit removals while answering pings",
      () =>
        Effect.gen(function* () {
          const { call, fake, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const owner = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, session)}`,
          );
          const nav = { kind: "navigation" } as const;
          const initial = yield* scopeReset(owner, nav);
          assert.deepStrictEqual(scopeValue<{ can: unknown }>(initial, "org").can, ORG_ALLOWED);
          assert.deepStrictEqual(
            scopeValue<{ official: unknown }>(initial, "status").official,
            "ok",
          );
          const app = yield* call("POST", "/api/apps", { session, body: { name: "Shop" } });
          const appId = (app.body as { id: string }).id;
          const listed = yield* nextScopeValue<HqNavigationApp>(owner, nav, `app:${appId}`);
          assert.deepStrictEqual([listed.name, listed.projectIds], ["Shop", []]);
          assert.notProperty(listed, "releases");
          assert.notProperty(listed, "repos");
          assert.notProperty(listed, "recipes");
          const detail = yield* scopeReset(owner, { kind: "app-detail", appId });
          assert.sameMembers(
            detail.map((value) => value.key),
            ["releases", "repos", "recipe:mate", "recipe:stage", "recipe:production", "changes"],
          );
          yield* call("POST", `/api/apps/${appId}/projects`, {
            session,
            body: { projectId: "P_MATE", kind: "mate", mate: { face: "sky:flower" } },
          });
          const project = yield* nextScopeValue<HqNavigationProject>(
            owner,
            nav,
            "project:P_MATE",
            (value) => value.mate?.face === "sky:flower",
          );
          assert.strictEqual(project.appId, appId);
          const person = yield* nextScopeValue<HqNavigationPerson>(owner, nav, "person:owner");
          assert.deepStrictEqual(person, {
            name: "owner",
            clientUserId: "C-owner",
            avatarUrl: null,
          });
          yield* call("PATCH", "/api/mates/P_MATE", { session, body: { face: "rose:seal" } });
          yield* nextScopeValue<HqNavigationProject>(
            owner,
            nav,
            "project:P_MATE",
            (value) => value.mate?.face === "rose:seal",
          );
          fake.projects.splice(
            fake.projects.findIndex((project) => project.id === "P_MATE"),
            1,
          );
          // A roles read may withdraw access before the reconcile confirms record deletion.
          const removed = yield* scopeRemoval(owner, nav, "project:P_MATE");
          assert.strictEqual(removed.key, "project:P_MATE");
          assert.include(["deleted", "no-access"], removed.reason);
          yield* nextScopeValue<HqNavigationApp>(
            owner,
            nav,
            `app:${appId}`,
            (value) => value.contents.empty,
          );
          assert.deepStrictEqual(yield* scopeRemoval(owner, nav, "person:owner"), {
            key: "person:owner",
            reason: "no-access",
          });
          yield* Effect.sleep(Duration.millis(1100));
          assert.isAtLeast(owner.pings.seen, 3);
          yield* owner.close;
        }),
    );

    // B3: a Mate's stand-up ask rides in the write that records the Mate, so the two never part. An
    // attach under a birth intent that asked records the intent's maker as the asker; under one that
    // did not, nobody. An attach, or a record set up, with no intent carries its own ask.
    it.effect("records a Mate's stand-up ask in the write that records the Mate", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        for (const id of ["P_ASKED", "P_UNASKED", "P_PLAIN"]) addProject(fake, id);
        const appId = (
          (yield* call("POST", "/api/apps", { session, body: { name: "Shop" } })).body as {
            readonly id: string;
          }
        ).id;
        const intent = (standUp: boolean) =>
          Effect.map(
            call("POST", "/api/births", {
              session,
              body: { appId, face: "rose:seal", standUp },
            }),
            (answer) => (answer.body as { readonly id: string }).id,
          );
        const attach = (projectId: string, extra: Record<string, unknown>) =>
          call("POST", `/api/apps/${appId}/projects`, {
            session,
            body: { projectId, kind: "mate", mate: { face: "rose:seal" }, ...extra },
          });
        yield* attach("P_ASKED", { birth: yield* intent(true) });
        yield* attach("P_UNASKED", { birth: yield* intent(false) });
        yield* attach("P_PLAIN", { mate: { face: "rose:seal", standUp: true } });
        yield* call("POST", "/api/mates", {
          session,
          body: { projectId: "P_MATE", face: "face-1", standUp: true },
        });
        const read = (yield* call("GET", "/api/structure", { session })).body as {
          readonly apps: ReadonlyArray<{
            readonly projects: ReadonlyArray<{
              readonly projectId: string;
              readonly mate: { readonly standupRequestedBy: string | null } | null;
            }>;
          }>;
          readonly ungrouped: ReadonlyArray<{
            readonly projectId: string;
            readonly mate: { readonly standupRequestedBy: string | null };
          }>;
        };
        const asker = (projectId: string) =>
          [...read.apps.flatMap((app) => app.projects), ...read.ungrouped].find(
            (project) => project.projectId === projectId,
          )?.mate?.standupRequestedBy;
        assert.deepStrictEqual(["P_ASKED", "P_UNASKED", "P_PLAIN", "P_MATE"].map(asker), [
          "owner",
          null,
          "owner",
          "owner",
        ]);
      }),
    );

    // D3: a client from before it still names the Mate in its writes. HQ takes them and keeps no
    // name: the Mate goes by its project's in Zerops. A rename HQ no longer takes.
    it.effect(
      "takes a write that names a Mate, as a client before D3 sends it, keeping no name",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const appId = (
            (yield* call("POST", "/api/apps", { session, body: { name: "Shop" } })).body as {
              readonly id: string;
            }
          ).id;
          const birth = yield* call("POST", "/api/births", {
            session,
            body: { appId, name: "Gus", face: "rose:seal" },
          });
          const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
            session,
            body: {
              projectId: "P_MATE",
              kind: "mate",
              mate: { name: "Gus", face: "rose:seal" },
              birth: (birth.body as { readonly id: string }).id,
            },
          });
          const renamed = yield* call("PATCH", "/api/mates/P_MATE", {
            session,
            body: { name: "Gus 2" },
          });
          assert.deepStrictEqual(
            [birth.status, attached.status, renamed.status, renamed.body],
            [201, 201, 400, { code: "invalid" }],
          );
          const read = (yield* call("GET", "/api/structure", { session })).body as {
            readonly apps: ReadonlyArray<{
              readonly projects: ReadonlyArray<{ readonly name: string }>;
            }>;
          };
          assert.strictEqual(read.apps[0]?.projects[0]?.name, "P_MATE");
        }),
    );

    it.effect("records a Mate's birth intent in its application, and its attach closes it", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        const appId = (
          (yield* call("POST", "/api/apps", { session, body: { name: "Shop" } })).body as {
            readonly id: string;
          }
        ).id;
        const birthsOf = Effect.map(
          call("GET", "/api/structure", { session }),
          (read) =>
            (
              read.body as {
                readonly apps: ReadonlyArray<{ readonly id: string; readonly births: unknown }>;
              }
            ).apps.find((app) => app.id === appId)?.births,
        );

        const recorded = yield* call("POST", "/api/births", {
          session,
          body: { appId, face: "rose:seal" },
        });
        const { id } = recorded.body as { readonly id: string };
        assert.deepStrictEqual([recorded.status, recorded.body], [201, { id, face: "rose:seal" }]);
        assert.deepStrictEqual(yield* birthsOf, [{ id, face: "rose:seal" }]);

        const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
          session,
          body: {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "rose:seal" },
            birth: id,
          },
        });
        assert.strictEqual(attached.status, 201);
        assert.deepStrictEqual(yield* birthsOf, []);
      }),
    );

    it.effect(
      "sets up, renames and moves a Mate through navigation values and asks move offers on open",
      () =>
        Effect.gen(function* () {
          const { call, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const owner = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, session)}`,
          );
          const nav = { kind: "navigation" } as const;
          yield* scopeReset(owner, nav);
          const setup = yield* call("POST", "/api/mates", {
            session,
            body: { projectId: "P_MATE", face: "sky:flower", madeBy: "dev" },
          });
          assert.deepStrictEqual(
            [setup.status, setup.body],
            [201, { projectId: "P_MATE", face: "sky:flower" }],
          );
          const lone = yield* nextScopeValue<HqNavigationProject>(owner, nav, "project:P_MATE");
          assert.strictEqual(lone.mate?.madeBy, "owner");
          assert.isNull(lone.appId);
          assert.notProperty(lone, "moveTo");
          const app = yield* call("POST", "/api/apps", { session, body: { name: "Shop" } });
          const appId = (app.body as { id: string }).id;
          yield* nextScopeValue<HqNavigationApp>(owner, nav, `app:${appId}`);
          yield* owner.send({ type: "move-offers", requestId: "open", projectId: "P_MATE" });
          const offers = yield* owner.take("move-offers");
          assert.strictEqual(offers.requestId, "open");
          assert.property(offers.moveTo as object, appId);
          const renamed = yield* call("PATCH", `/api/apps/${appId}`, {
            session,
            body: { name: "Store" },
          });
          assert.strictEqual(renamed.status, 200);
          yield* nextScopeValue<HqNavigationApp>(
            owner,
            nav,
            `app:${appId}`,
            (value) => value.name === "Store",
          );
          const moved = yield* call("PUT", "/api/projects/P_MATE/app", {
            session,
            body: { appId, kind: "mate" },
          });
          assert.strictEqual(moved.status, 200);
          yield* nextScopeValue<HqNavigationProject>(
            owner,
            nav,
            "project:P_MATE",
            (value) => value.appId === appId,
          );
          yield* nextScopeValue<HqNavigationApp>(owner, nav, `app:${appId}`, (value) =>
            value.projectIds.includes("P_MATE"),
          );
          const out = yield* call("PUT", "/api/projects/P_MATE/app", {
            session,
            body: { appId: null, kind: "mate" },
          });
          assert.strictEqual(out.status, 200);
          yield* nextScopeValue<HqNavigationProject>(
            owner,
            nav,
            "project:P_MATE",
            (value) => value.appId === null,
          );
          yield* nextScopeValue<HqNavigationApp>(
            owner,
            nav,
            `app:${appId}`,
            (value) => value.projectIds.length === 0,
          );
          yield* owner.close;
        }),
    );

    it.effect("a Developer's socket holds only visible apps and follows a gained role", () =>
      Effect.gen(function* () {
        const { call, fake, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const dev = yield* sessionFor(call, "door-dev");
        const watching = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, dev)}`);
        const nav = { kind: "navigation" } as const;
        assert.isFalse(
          (yield* scopeReset(watching, nav)).some((value) => value.key.startsWith("app:")),
        );
        const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
        const appId = (app.body as { id: string }).id;
        yield* call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: { projectId: "P_MATE", kind: "stage" },
        });
        assert.isFalse(
          (yield* watching.quiet("700 millis")).some((message) =>
            JSON.stringify(message).includes(appId),
          ),
        );
        Object.assign(
          fake.projects.find((project) => project.id === "P_MATE")!,
          { userRoles: [{ clientUserId: "C-dev", roleCode: "BASIC_USER" }] },
        );
        const visible = yield* nextScopeValue<HqNavigationApp>(watching, nav, `app:${appId}`);
        assert.deepStrictEqual([visible.name, visible.projectIds], ["Shop", ["P_MATE"]]);
        assert.isTrue(visible.can.read_change!.allow);
        yield* watching.close;
      }),
    );

    it.effect("a socket removes navigation and demanded detail when its holder loses access", () =>
      Effect.gen(function* () {
        const { call, fake, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const reader = yield* sessionFor(call, "door-reader");
        const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
        const appId = (app.body as { id: string }).id;
        const watching = yield* socket(
          `/api/structure/ws?ticket=${yield* ticketFor(call, reader)}`,
        );
        const nav = { kind: "navigation" } as const;
        const detail = { kind: "app-detail", appId } as const;
        const listed = scopeValue<HqNavigationApp>(
          yield* scopeReset(watching, nav),
          `app:${appId}`,
        );
        assert.strictEqual(listed.name, "Shop");
        const fields = yield* scopeReset(watching, detail);
        for (const key of ["releases", "repos"] as const) {
          const response = yield* call("GET", `/api/apps/${appId}/${key}`, { session: reader });
          assert.deepStrictEqual(
            scopeValue(fields, key),
            (response.body as Record<string, unknown>)[key],
          );
        }
        for (const tier of ["mate", "stage", "production"] as const)
          assert.deepStrictEqual(
            scopeValue(fields, `recipe:${tier}`),
            (yield* call("GET", `/api/apps/${appId}/recipe/${tier}`, { session: reader })).body,
          );
        Object.assign(
          fake.members.get("ORG")!.find((member) => member.userId === "reader")!,
          { roleCode: "NO_ACCESS" },
        );
        assert.deepStrictEqual(yield* scopeRemoval(watching, nav, `app:${appId}`), {
          key: `app:${appId}`,
          reason: "no-access",
        });
        assert.deepStrictEqual(yield* scopeRemoval(watching, detail, "releases"), {
          key: "releases",
          reason: "no-access",
        });
        assert.strictEqual((yield* watching.take("scope-error")).code, "forbidden");
        yield* watching.close;
      }),
    );

    it.effect(
      "refuses at the door every throwaway that is not this HQ's own, fresh, of an active member",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const knock = (token: string) =>
            Effect.map(call("POST", "/api/door", { body: { token } }), (answer) => [
              answer.status,
              (answer.body as { readonly code: string }).code,
            ]);
          assert.deepStrictEqual(
            yield* Effect.all([
              knock("door-other-org"),
              knock("door-wrong-name"),
              knock("door-invited"),
            ]),
            [
              [401, "zerops_throwaway_required"],
              [401, "zerops_throwaway_required"],
              [401, "zerops_throwaway_required"],
            ],
          );
          // The platform's clock missing is HQ's trouble, never the caller's verdict.
          fake.apiClock = false;
          assert.deepStrictEqual(yield* knock("door-owner"), [503, "zerops_unavailable"]);
        }),
    );

    it.effect(
      "opens a socket only with a fresh one-use ticket, and closes one that ends its session or stops answering",
      () =>
        Effect.gen(function* () {
          const { call, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const ticket = yield* ticketFor(call, session);
          const opened = yield* socket(`/api/structure/ws?ticket=${ticket}`);
          yield* scopeReset(opened, { kind: "navigation" });
          assert.deepStrictEqual(
            [
              (yield* socket(`/api/structure/ws?ticket=${ticket}`)).opened,
              (yield* socket("/api/structure/ws")).opened,
            ],
            [false, false],
          );
          // The session ends: the socket closes 4401 within its recheck.
          yield* call("DELETE", "/api/session", { session });
          assert.strictEqual(yield* opened.closedWith, 4401);

          // A client that never answers a ping is closed after three: 4408.
          const silent = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, yield* sessionFor(call, "door-owner-2"))}`,
          );
          silent.pings.answering = false;
          assert.strictEqual(yield* silent.closedWith, 4408);
        }),
    );

    // A session ends only when it expires or is revoked: a session check that cannot be read is
    // HQ's trouble, and the socket stays its holder's.
    it.effect("keeps a socket open through a session check that cannot be read", () =>
      Effect.gen(function* () {
        const { call, socket, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        const open = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, session)}`);
        yield* scopeReset(open, { kind: "navigation" });
        yield* query(url, "ALTER TABLE hq_session RENAME TO hq_session_unreadable");
        // Several rechecks (200 ms each) meet the unreadable session relation.
        yield* Effect.sleep(Duration.seconds(1));
        yield* query(url, "ALTER TABLE hq_session_unreadable RENAME TO hq_session");
        const created = yield* call("POST", "/api/apps", { session, body: { name: "Kept" } });
        const appId = (created.body as { id: string }).id;
        const value = yield* nextScopeValue<HqNavigationApp>(
          open,
          { kind: "navigation" },
          `app:${appId}`,
        );
        assert.strictEqual(value.name, "Kept");
      }),
    );

    it.effect(
      "drains on shutdown: gives the lead up, sends sockets away (1001), and still answers meanwhile",
      () =>
        Effect.gen(function* () {
          const { call, socket, stop } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const open = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, session)}`);
          yield* scopeReset(open, { kind: "navigation" });
          const stopping = yield* Effect.forkChild(stop);
          assert.strictEqual(yield* open.closedWith, 1001);
          const health = yield* call("GET", "/health");
          assert.deepStrictEqual(
            [health.status, (health.body as { readonly state: string }).state],
            [200, "standby"],
          );
          yield* Fiber.join(stopping);
        }),
    );

    // A browser at any address may call: every call carries a bearer, never a
    // cookie, so CORS answers without credentials and grants a foreign page nothing.
    it.effect("answers a preflight from any origin, without credentials", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        for (const origin of [CLIENT, "https://mate.dev-team.example.org"]) {
          const preflight = yield* call("OPTIONS", "/api/structure", {
            headers: {
              origin,
              "access-control-request-method": "GET",
              "access-control-request-headers": "authorization",
            },
          });
          assert.isBelow(preflight.status, 300, origin);
          assert.strictEqual(preflight.headers.get("access-control-allow-origin"), "*", origin);
          assert.isNull(preflight.headers.get("access-control-allow-credentials"), origin);
          assert.strictEqual(preflight.headers.get("access-control-max-age"), "7200", origin);
        }
      }),
    );

    it.effect("serves a bearer from any origin, and refuses a call without one", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        const headers = { origin: "https://mate.dev-team.example.org" };
        const read = yield* call("GET", "/api/structure", { session, headers });
        assert.strictEqual(read.status, 200);
        assert.strictEqual(read.headers.get("access-control-allow-origin"), "*");
        assert.strictEqual((yield* call("GET", "/api/structure", { headers })).status, 401);
      }),
    );

    it.effect(
      "a Mate proves its project through the project's env and HQ knows it by its credential",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          yield* setUpMate(call, "P_MATE");
          const challenge = yield* call("POST", "/api/mate/challenge", {
            body: { projectId: "P_MATE" },
          });
          assert.strictEqual(challenge.status, 200);
          const { nonce, expiresIn } = challenge.body as {
            readonly nonce: string;
            readonly expiresIn: number;
          };
          assert.strictEqual(expiresIn, 120);
          fake.env.set("P_MATE", [{ key: "MATE_HQ_CHALLENGE", value: nonce, sensitive: false }]);

          const issued = yield* call("POST", "/api/mate/credential", {
            body: { projectId: "P_MATE", nonce },
          });
          assert.strictEqual(issued.status, 200);
          const { credential } = issued.body as { readonly credential: string };
          const whoami = (authorization: string) =>
            Effect.map(
              call("GET", "/api/mate/whoami", { headers: { authorization } }),
              (answer) => [answer.status, answer.body],
            );
          assert.deepStrictEqual(yield* whoami(`Mate ${credential}`), [
            200,
            { projectId: "P_MATE" },
          ]);
          for (const forged of [`Mate ${credential}x`, `Bearer ${credential}`, ""]) {
            assert.deepStrictEqual(yield* whoami(forged), [
              401,
              { code: "mate_credential_required" },
            ]);
          }
        }),
    );

    // One Mate per project (audit D2): a zcp enrolls naming its service, the one the Mate's record
    // names — at its set-up where its client knows it, else the first that enrolls — and another
    // service of the project is refused. An HQ that does not know a field a zcp names ignores it,
    // as this one does.
    it.effect("refuses a zcp service other than its Mate's with 409 not_this_projects_mate", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* setUpMate(call, "P_MATE");
        fake.projects.push({
          id: "P_NAMED",
          orgId: "ORG",
          name: "P_NAMED",
          status: "ACTIVE",
          tags: [],
          userRoles: [],
          publicZone: "P_NAMED.prg1-zerops.zone",
        });
        const named = yield* call("POST", "/api/mates", {
          session,
          body: { projectId: "P_NAMED", face: "face-1", serviceId: "S4" },
        });
        assert.strictEqual(named.status, 201);
        for (const [id, projectId] of [
          ["S1", "P_MATE"],
          ["S2", "P_MATE"],
          ["S3", "P_NAMED"],
          ["S4", "P_NAMED"],
        ] as const) {
          fake.services.push({
            id,
            projectId,
            name: id.toLowerCase(),
            status: "ACTIVE",
            isSystem: false,
            subdomainAccess: false,
            http: false,
            named: null,
            activeVersionId: null,
          });
        }
        const present = (projectId: string, body: Readonly<Record<string, string>>) =>
          Effect.gen(function* () {
            const { nonce } = (yield* call("POST", "/api/mate/challenge", {
              body: { projectId },
            })).body as { readonly nonce: string };
            fake.env.set(projectId, [{ key: "MATE_HQ_CHALLENGE", value: nonce, sensitive: false }]);
            const answer = yield* call("POST", "/api/mate/credential", {
              body: { projectId, nonce, ...body },
            });
            return [answer.status, (answer.body as { readonly code?: string }).code];
          });
        assert.deepStrictEqual(
          [
            yield* present("P_MATE", { serviceId: "S1", futureField: "kept out" }),
            yield* present("P_MATE", { serviceId: "S2" }),
            yield* present("P_MATE", { serviceId: "S1" }),
            yield* present("P_NAMED", { serviceId: "S3" }),
            yield* present("P_NAMED", { serviceId: "S4" }),
          ],
          [
            [200, undefined],
            [409, "not_this_projects_mate"],
            [200, undefined],
            [409, "not_this_projects_mate"],
            [200, undefined],
          ],
        );
      }),
    );

    // Audit K3 and the adoption's harden: a Mate names its own key's id — an id, never a value — at
    // its enrollment and again with its credential, and HQ tells it to whoever administers the
    // Mate's project, who adopts it or deletes it; nobody else.
    it.effect("a Mate names its key's id, and HQ tells it to its project's admin alone", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* setUpMate(call, "P_MATE");
        // The Mate's keys as the platform holds them, each granting its project alone.
        for (const id of ["tok-key-1", "tok-key-2"]) {
          fake.tokens.set(`value-of-${id}`, {
            id,
            name: "zerops-zcp-zcp",
            orgId: "ORG",
            roleCode: "NO_ACCESS",
            canCreateProjects: false,
            canViewFinances: false,
            canEditFinances: false,
            projects: [{ projectId: "P_MATE", roleCode: "ADMIN" }],
            createdMs: 0,
            createdByUser: "owner",
          });
        }
        const { nonce } = (yield* call("POST", "/api/mate/challenge", {
          body: { projectId: "P_MATE" },
        })).body as { readonly nonce: string };
        fake.env.set("P_MATE", [{ key: "MATE_HQ_CHALLENGE", value: nonce, sensitive: false }]);
        const issued = yield* call("POST", "/api/mate/credential", {
          body: { projectId: "P_MATE", nonce, keyTokenId: "tok-key-1" },
        });
        const { credential } = issued.body as { readonly credential: string };
        const dev = yield* sessionFor(call, "door-dev");
        const keyAs = (session: string) =>
          Effect.map(call("GET", "/api/mates/P_MATE/key", { session }), (answer) => [
            answer.status,
            answer.body,
          ]);
        assert.deepStrictEqual(yield* keyAs(owner), [200, { keyTokenId: "tok-key-1" }]);

        const named = (authorization: string) =>
          Effect.map(
            call("PUT", "/api/mate/key", {
              headers: { authorization },
              body: { keyTokenId: "tok-key-2" },
            }),
            (answer) => answer.status,
          );
        assert.deepStrictEqual(
          [yield* named(`Mate ${credential}`), yield* named(`Mate ${credential}x`)],
          [204, 401],
        );
        assert.deepStrictEqual(
          [yield* keyAs(owner), yield* keyAs(dev)],
          [
            [200, { keyTokenId: "tok-key-2" }],
            [403, { code: "forbidden", reason: "not_project_admin" }],
          ],
        );
      }),
    );

    // ADR 0003's fallout: a Mate naming a key an earlier client widened gets its credential as any
    // other — the word that its key reads other projects stays HQ's — and the project's admin, who
    // finished its setup, asks HQ to read the key again; nobody else.
    it.effect(
      "a Mate's widened key is said, never answered back, and read again by its admin",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* setUpMate(call, "P_MATE");
          fake.tokens.set("value-of-tok-wide", {
            id: "tok-wide",
            name: "zcp-P_MATE",
            orgId: "ORG",
            roleCode: "NO_ACCESS",
            canCreateProjects: false,
            canViewFinances: false,
            canEditFinances: false,
            projects: [
              { projectId: "P_MATE", roleCode: "BASIC_USER" },
              { projectId: "P_ELSE", roleCode: "READ_ONLY" },
            ],
            createdMs: 0,
            createdByUser: "owner",
          });
          const { nonce } = (yield* call("POST", "/api/mate/challenge", {
            body: { projectId: "P_MATE" },
          })).body as { readonly nonce: string };
          fake.env.set("P_MATE", [{ key: "MATE_HQ_CHALLENGE", value: nonce, sensitive: false }]);
          const issued = yield* call("POST", "/api/mate/credential", {
            body: { projectId: "P_MATE", nonce, keyTokenId: "tok-wide" },
          });
          assert.deepStrictEqual(Object.keys(issued.body as object), ["credential"]);
          const dev = yield* sessionFor(call, "door-dev");
          const check = (session: string) =>
            Effect.map(
              call("POST", "/api/mates/P_MATE/key-check", { session }),
              (answer) => answer.status,
            );
          assert.deepStrictEqual([yield* check(owner), yield* check(dev)], [204, 403]);
        }),
    );

    it.effect(
      "answers each refusal of a Mate's proof with its code, and limits the Mate's door per address",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          yield* setUpMate(call, "P_MATE");
          for (const [id, orgId] of [
            ["P_ELSE", "ORG2"],
            ["P_PLAIN", "ORG"],
          ] as const) {
            fake.projects.push({
              id,
              orgId,
              name: id,
              status: "ACTIVE",
              tags: [],
              userRoles: [],
              publicZone: `${id}.prg1-zerops.zone`,
            });
          }
          const { nonce } = (yield* call("POST", "/api/mate/challenge", {
            body: { projectId: "P_MATE" },
          })).body as { readonly nonce: string };
          const answers = yield* Effect.forEach(
            [
              ["/api/mate/challenge", { projectId: "P_ELSE" }],
              ["/api/mate/challenge", { projectId: "P_NONE" }],
              ["/api/mate/challenge", { projectId: "P_PLAIN" }],
              ["/api/mate/credential", { projectId: "P_MATE", nonce: "never-handed-out" }],
              ["/api/mate/credential", { projectId: "P_MATE", nonce }],
              ["/api/mate/credential", { projectId: "P_MATE" }],
            ] as const,
            ([path, body]) => call("POST", path, { body }),
          );
          assert.deepStrictEqual(
            answers.map((answer) => [
              answer.status,
              (answer.body as { readonly code: string }).code,
            ]),
            [
              [403, "not_a_mate"],
              [403, "not_a_mate"],
              [403, "not_a_mate"],
              [401, "unknown_nonce"],
              [401, "env_mismatch"],
              [400, "invalid"],
            ],
          );

          const knock = (path: string, body: unknown) =>
            Effect.map(
              call("POST", path, { body, headers: { "x-real-ip": "10.0.0.9" } }),
              (answer) => answer.status,
            );
          const statuses = yield* Effect.forEach(Array.from({ length: 11 }), () =>
            knock("/api/mate/credential", { projectId: "P_MATE", nonce: "never-handed-out" }),
          );
          assert.deepStrictEqual(statuses, [...Array(10).fill(401), 429]);
          // A person's door at the same address keeps its own bucket.
          assert.strictEqual(yield* knock("/api/door", { token: "unknown" }), 401);
        }),
    );

    it.effect(
      "the Mate's birth is recorded by its project's admin, and the Mate reads its own state",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          // Its stand-up asked in the write that sets it up (B3): no mark of its own any more.
          const created = yield* call("POST", "/api/mates", {
            session: owner,
            body: { projectId: "P_MATE", face: "face-1", standUp: true },
          });
          assert.strictEqual(created.status, 201);
          const credential = yield* enrollMate(call, fake, "P_MATE");
          const self = Effect.map(
            call("GET", "/api/mate/self", { headers: { authorization: `Mate ${credential}` } }),
            (answer) => [answer.status, answer.body],
          );
          // Named as its project is in Zerops (D3).
          const born = { projectId: "P_MATE", name: "P_MATE", face: "face-1" };
          // A Mate in no application: no changes beside its record.
          const none = { appId: null, appName: null, changes: [] };
          assert.deepStrictEqual(yield* self, [
            200,
            { ...born, standupRequestedBy: "owner", closedOff: false, signers: {}, ...none },
          ]);
          const standup = yield* call("POST", "/api/mates/P_MATE/standup", { session: owner });
          assert.strictEqual(standup.status, 404);
          const closed = yield* call("POST", "/api/mates/P_MATE/closed-off", { session: owner });
          assert.deepStrictEqual(
            [closed.status, closed.body],
            [200, { ...born, standupRequestedBy: "owner", closedOff: true }],
          );
          assert.deepStrictEqual(yield* self, [
            200,
            { ...born, standupRequestedBy: "owner", closedOff: true, signers: {}, ...none },
          ]);

          // B5: its press held by the browser running it, read by another, and let go at its end.
          const pressed = yield* call("PUT", "/api/presses/P_MATE", {
            session: owner,
            body: { owner: "press-a", kind: "mate", importProcessId: "imp-1" },
          });
          assert.deepStrictEqual(
            [pressed.status, (pressed.body as { importProcessId?: string }).importProcessId],
            [200, "imp-1"],
          );
          const taken = yield* call("PUT", "/api/presses/P_MATE", {
            session: owner,
            body: { owner: "press-b", kind: "mate" },
          });
          assert.deepStrictEqual(
            [taken.status, taken.body],
            [409, { code: "conflict", reason: "press_held" }],
          );
          const stopped = yield* call("POST", "/api/presses/P_MATE/press-a/stopped", {
            session: owner,
          });
          assert.strictEqual(stopped.status, 200);
          const finished = yield* call("DELETE", "/api/presses/P_MATE/press-a", { session: owner });
          assert.strictEqual(finished.status, 200);

          const dev = yield* sessionFor(call, "door-dev");
          const refused = yield* call("POST", "/api/mates/P_MATE/closed-off", { session: dev });
          assert.deepStrictEqual(
            [refused.status, refused.body],
            [403, { code: "forbidden", reason: "not_project_admin" }],
          );
          const nobody = yield* call("GET", "/api/mate/self", {
            headers: { authorization: `Mate ${credential}x` },
          });
          assert.strictEqual(nobody.status, 401);
        }),
    );

    it.effect(
      "a Mate's link brings its state down at once and on each change, and its overview up to whoever may operate it",
      () =>
        Effect.gen(function* () {
          const { call, fake, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* setUpMate(call, "P_MATE");
          const credential = yield* enrollMate(call, fake, "P_MATE");
          const mateAuth = { authorization: `Mate ${credential}` };
          const ticket = (yield* call("POST", "/api/mate/link-ticket", { headers: mateAuth }))
            .body as { readonly ticket: string; readonly expiresIn: number };
          assert.strictEqual(ticket.expiresIn, 60);
          const link = yield* socket(`/api/mate/link?ticket=${ticket.ticket}`);
          // A Mate in no application: no changes beside its record.
          const state = {
            projectId: "P_MATE",
            name: "P_MATE",
            face: "face-1",
            appId: null,
            appName: null,
            changes: [],
          };
          assert.deepStrictEqual((yield* link.next("state")).mate, {
            ...state,
            standupRequestedBy: null,
            closedOff: false,
          });
          yield* call("POST", "/api/mates/P_MATE/closed-off", { session: owner });
          assert.deepStrictEqual((yield* link.next("state")).mate, {
            ...state,
            standupRequestedBy: null,
            closedOff: true,
          });

          // The owner operates the Mate and follows its overview; a reader only sees it listed.
          const ownerSocket = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`,
          );
          yield* scopeReset(ownerSocket, { kind: "attention", projectId: "P_MATE" });
          const reader = yield* sessionFor(call, "door-reader");
          const readerSocket = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, reader)}`,
          );
          yield* readerSocket.send({
            type: "subscribe",
            scopes: [{ scope: { kind: "attention", projectId: "P_MATE" } }],
          });
          assert.strictEqual((yield* readerSocket.take("scope-error")).code, "forbidden");
          const overview = overviewOf({ main: mainAt("Read the schema") });
          yield* link.send({ type: "overview", full: true, overview });
          const scope = { kind: "attention", projectId: "P_MATE" } as const;
          const seen = yield* nextScopeValue<HqAttentionScopeValue>(
            ownerSocket,
            scope,
            "P_MATE",
            (value) => value.presence.overview === "live",
          );
          assert.deepStrictEqual(seen.overview, overview);
          assert.deepStrictEqual([seen.presence.online, seen.presence.overview], [true, "live"]);
          assert.deepStrictEqual(yield* readerSocket.quiet("700 millis"), []);
          yield* link.close;
          const gone = yield* nextScopeValue<HqAttentionScopeValue>(
            ownerSocket,
            scope,
            "P_MATE",
            (value) => !value.presence.online,
          );
          assert.deepStrictEqual(gone.overview, overview);
          assert.deepStrictEqual([gone.presence.online, gone.presence.overview], [false, "stored"]);

          // Without a Mate's credential there is no ticket, and a ticket opens one link.
          assert.strictEqual(
            (yield* call("POST", "/api/mate/link-ticket", { headers: { authorization: "Mate x" } }))
              .status,
            401,
          );
          const reused = yield* socket(`/api/mate/link?ticket=${ticket.ticket}`);
          assert.isFalse(reused.opened);
        }),
    );

    it.effect("a Mate's link keeps who signed in each login where it reads its own state", () =>
      Effect.gen(function* () {
        const { call, fake, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        yield* setUpMate(call, "P_MATE");
        const credential = yield* enrollMate(call, fake, "P_MATE");
        const mateAuth = { authorization: `Mate ${credential}` };
        const signers = Effect.map(
          call("GET", "/api/mate/self", { headers: mateAuth }),
          (answer) => (answer.body as { readonly signers?: unknown }).signers,
        );
        assert.deepStrictEqual(yield* signers, {});
        const ticket = (yield* call("POST", "/api/mate/link-ticket", { headers: mateAuth }))
          .body as { readonly ticket: string };
        const link = yield* socket(`/api/mate/link?ticket=${ticket.ticket}`);
        yield* link.next("state");
        const login = (signedInBy: string | null, lastSignedInBy?: string | null) => ({
          signedInBy,
          ...(lastSignedInBy === undefined ? {} : { lastSignedInBy }),
          present: true,
          token: false,
        });
        yield* link.send({
          type: "overview",
          full: true,
          overview: overviewOf({
            logins: { "claude-code": login("U1", "U1"), codex: login(null, null) },
          }),
        });
        assert.deepStrictEqual((yield* link.next("state")).mate, {
          projectId: "P_MATE",
          name: "P_MATE",
          face: "face-1",
          standupRequestedBy: null,
          closedOff: false,
          signers: { "claude-code": "U1" },
          appId: null,
          appName: null,
          changes: [],
        });
        assert.deepStrictEqual(yield* signers, { "claude-code": "U1" });
        // A later sign-in replaces the earlier one; a login that lost its signer keeps the record.
        yield* link.send({
          type: "overview",
          full: false,
          sections: { logins: { "claude-code": login(null, null), codex: login("U2", undefined) } },
        });
        yield* link.next("state");
        assert.deepStrictEqual(yield* signers, { "claude-code": "U1", codex: "U2" });
      }),
    );

    it.effect(
      "a Mate's link follows it into an application, between two, its renaming and out",
      () =>
        Effect.gen(function* () {
          const { call, fake, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* setUpMate(call, "P_MATE");
          const credential = yield* enrollMate(call, fake, "P_MATE");
          const ticket = (yield* call("POST", "/api/mate/link-ticket", {
            headers: { authorization: `Mate ${credential}` },
          })).body as { readonly ticket: string };
          const link = yield* socket(`/api/mate/link?ticket=${ticket.ticket}`);
          // The application it is in, by id and by its name now.
          const appOf = Effect.map(link.next("state"), (state) => {
            const { mate } = state as {
              readonly mate: { readonly appId: string | null; readonly appName: string | null };
            };
            return [mate.appId, mate.appName];
          });
          assert.deepStrictEqual(yield* appOf, [null, null]);
          const made = (name: string) =>
            Effect.map(
              call("POST", "/api/apps", { session: owner, body: { name } }),
              (answer) => (answer.body as { readonly id: string }).id,
            );
          const [a, b] = [yield* made("A"), yield* made("B")];
          const attached = yield* call("POST", `/api/apps/${a}/projects`, {
            session: owner,
            body: { projectId: "P_MATE", kind: "mate", mate: { face: "face-1" } },
          });
          assert.strictEqual(attached.status, 201);
          assert.deepStrictEqual(yield* appOf, [a, "A"]);
          const moved = yield* call("PUT", "/api/projects/P_MATE/app", {
            session: owner,
            body: { appId: b, kind: "mate" },
          });
          assert.strictEqual(moved.status, 200);
          assert.deepStrictEqual(yield* appOf, [b, "B"]);
          const renamed = yield* call("PATCH", `/api/apps/${b}`, {
            session: owner,
            body: { name: "Bakery" },
          });
          assert.strictEqual(renamed.status, 200);
          assert.deepStrictEqual(yield* appOf, [b, "Bakery"]);
          const detached = yield* call("PUT", "/api/projects/P_MATE/app", {
            session: owner,
            body: { appId: null, kind: "mate" },
          });
          assert.strictEqual(detached.status, 200);
          assert.deepStrictEqual(yield* appOf, [null, null]);
        }),
    );

    it.effect("a Mate's push is refused another application's repository: not_your_app", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const appOf = (name: string) =>
          Effect.map(
            call("POST", "/api/apps", { session: owner, body: { name } }),
            (answer) => (answer.body as { readonly id: string }).id,
          );
        const [a, b] = [yield* appOf("A"), yield* appOf("B")];
        yield* call("POST", `/api/apps/${a}/projects`, {
          session: owner,
          body: { projectId: "P_MATE", kind: "mate", mate: { face: "face-1" } },
        });
        const credential = yield* enrollMate(call, fake, "P_MATE");
        const advertised = yield* call(
          "GET",
          `/git/${b}/x.git/info/refs?service=git-receive-pack`,
          {
            headers: {
              authorization: `Basic ${Buffer.from(`mate:${credential}`).toString("base64")}`,
            },
          },
        );
        assert.deepStrictEqual(
          [advertised.status, advertised.body],
          [403, { code: "forbidden", reason: "not_your_app" }],
        );
      }),
    );

    it.effect("an HQ that is not the official one answers its API 503 not_active", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(false);
        yield* untilHealth(call, "standby");
        const door = yield* call("POST", "/api/door", { body: { token: "door-owner" } });
        assert.deepStrictEqual(
          [door.status, (door.body as { readonly code: string }).code],
          [503, "not_active"],
        );
      }),
    );
  });
});
