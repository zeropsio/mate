import { scopeReset, scopeValue, nextScopeValue } from "../test/harness/scopes.ts";
import { hqAppFamily } from "../../../packages/client-runtime/src/data/families/hqNavigation.ts";
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off globalTimers:off globalConsoleInEffect:off -- real HQ socket acceptance test.
import { assert, describe, it } from "@effect/vitest";
import { HqAttentionValue } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Statement from "effect/sql/Statement";
import { overviewOf } from "../test/harness/overviews.ts";
import {
  startCore,
  sessionFor,
  setUpMate,
  enrollMate,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const readAttention = Schema.decodeEffect(HqAttentionValue);

describe("HQ scoped socket", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "Mixed Git and Zerops records and delayed Git evidence traverse the real scoped socket",
      () =>
        Effect.gen(function* () {
          const core = yield* startCore(true, {
            reconcileEvery: Duration.infinity,
            streamRecheck: Duration.infinity,
            pingEvery: Duration.infinity,
          });
          yield* untilHealth(core.call, "active");
          const session = yield* sessionFor(core.call, "door-owner");
          const appId = (
            (yield* core.call("POST", "/api/apps", { session, body: { name: "Mixed" } })).body as {
              readonly id: string;
            }
          ).id;
          yield* core.call("POST", `/api/apps/${appId}/projects`, {
            session,
            body: { projectId: "P_MATE", kind: "stage", environment: { name: "zerops-stage" } },
          });
          yield* core.sql`INSERT INTO hq_environment(id,target,app_id,tier,name,sources,branch,delivery,created_by) VALUES ('git-mixed','git',${appId}::uuid,'stage','git-stage','{main}','staging','direct','owner')`;
          yield* core.sql`INSERT INTO hq_rollout(app_id,cause,environment_id,environment_created_at,by)
            SELECT app_id,'env_added',id,created_at,'owner' FROM hq_environment WHERE id='git-mixed'`;
          const pushedEvidence = {
            remote: "https://github.com/krls2020/tst123",
            repositoryId: "123",
            identity: "github",
            ref: "refs/heads/staging",
            sha: "a".repeat(40),
            keptAt: "2026-10-14T00:00:00Z",
            phase: "closed",
            before: null,
            writerDrained: true,
            after: "a".repeat(40),
            via: "answer",
            at: "2026-10-14T00:00:00Z",
            version: null,
            processes: [],
            nextActor: "none",
            nextAction: "",
          };
          yield* core.sql`INSERT INTO hq_deploy_job(rollout_id,environment_id,kind,repo,sha,state,ended_at,ord,evidence)
            SELECT id,'git-mixed','push','api',${"a".repeat(40)},'pushed',now(),0,${JSON.stringify(pushedEvidence)}::jsonb FROM hq_rollout WHERE environment_id='git-mixed'`;
          const socket = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, session)}`,
          );
          const navigation = { kind: "navigation" } as const;
          const detail = { kind: "app-detail", appId } as const;
          yield* socket.send({
            type: "subscribe",
            scopes: [{ scope: navigation }, { scope: detail }],
          });
          const reset = yield* scopeReset(socket, navigation);
          const app =
            hqAppFamily.hq!.decode(scopeValue(reset, `app:${appId}`), `app:${appId}`) ??
            (yield* Effect.die(new Error("The account rejected the scoped Git navigation")));
          assert.isArray(app.environments);
          const environments = Array.isArray(app.environments) ? app.environments : [];
          const git = environments.find((row) => row.id === "git-mixed")!;
          assert.deepStrictEqual(git.target, {
            kind: "git",
            branch: "staging",
            delivery: "direct",
          });
          assert.notProperty(git, "projectId");
          assert.strictEqual(git.jobs.length, 1);
          assert.strictEqual(git.jobs[0]!.service, "api");
          assert.strictEqual(git.jobs[0]!.sha, "a".repeat(40));
          assert.strictEqual(git.jobs[0]!.state, "pushed");
          assert.strictEqual(
            environments.find((row) => row.name === "zerops-stage")!.target.kind,
            "zerops",
          );
          const first = yield* scopeReset(socket, detail);
          assert.deepStrictEqual(app.can?.release, { allow: false, reason: "no_production" });
          const release = yield* core.call("POST", `/api/apps/${appId}/releases`, {
            session,
            body: {
              tag: "v1.0.0",
              groupHead: "a".repeat(40),
              entries: [{ service: "web", sha: "a".repeat(40) }],
            },
          });
          assert.strictEqual(release.status, 403);
          assert.deepStrictEqual(
            { allow: false, reason: (release.body as { readonly reason: string }).reason },
            app.can?.release,
          );
          assert.isUndefined(first.find((row) => row.key === "probe:api"));
          const probe = {
            ok: true,
            remote: {
              url: "https://github.com/krls2020/tst123",
              repositoryId: "123",
              expiresAt: null,
              invalidSince: null,
            },
          };
          const receipt = {
            requestId: "delayed-probe",
            operationId: "delayed-probe",
            executor: "hq",
            affected: [{ family: "hqAppDetail", id: appId }],
            handles: [],
            acceptance: { kind: "accepted", result: probe },
            outcome: { kind: "succeeded", evidence: "delayed-probe" },
          };
          const intent = {
            kind: "probe-git-remote",
            orgId: "ORG",
            hqProjectId: "HQ1",
            appId,
            repo: "api",
            url: probe.remote.url,
          };
          yield* core.sql`INSERT INTO hq_git_target_receipt(request_id,user_id,app_id,intent,receipt) VALUES ('delayed-probe','owner',${appId}::uuid,${JSON.stringify(intent)}::jsonb,${JSON.stringify(receipt)}::jsonb)`;
          yield* core.call("PATCH", `/api/apps/${appId}`, {
            session,
            body: { name: "Mixed after receipt" },
          });
          assert.deepStrictEqual(yield* nextScopeValue(socket, detail, "probe:api"), probe);
          assert.notInclude(JSON.stringify(yield* socket.collected), "CANDIDATE_BOUNDARY_MARKER");
          yield* socket.close;
        }),
    );
    it.effect("five tabs each receive real HQ data and show the application menu", () =>
      Effect.gen(function* () {
        const core = yield* startCore(true, {
          reconcileEvery: Duration.infinity,
          streamRecheck: Duration.infinity,
          pingEvery: Duration.infinity,
        });
        yield* untilHealth(core.call, "active");
        const session = yield* sessionFor(core.call, "door-owner");
        const created = yield* core.call("POST", "/api/apps", {
          session,
          body: { name: "Shop" },
        });
        assert.strictEqual(created.status, 201);
        const appId = (created.body as { id: string }).id;
        assert.strictEqual(
          (yield* core.call("POST", "/api/mates", {
            session,
            body: { projectId: "P_MATE", face: "face" },
          })).status,
          201,
        );
        assert.strictEqual(
          (yield* core.call("PUT", "/api/projects/P_MATE/app", {
            session,
            body: { appId, kind: "mate" },
          })).status,
          200,
        );
        const tickets = yield* Effect.forEach(
          Array.from({ length: 5 }),
          () => ticketFor(core.call, session),
          { concurrency: "unbounded" },
        );
        const samples = yield* Effect.promise(() =>
          Promise.all(
            tickets.map(
              (ticket) =>
                new Promise<number>((resolve, reject) => {
                  const ws = new WebSocket(
                    `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                  );
                  let opened = 0;
                  let firstShop: number | undefined;
                  const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error("no Shop navigation receipt"));
                  }, 3000);
                  const fail = (error: unknown) => {
                    clearTimeout(timeout);
                    ws.close();
                    reject(error);
                  };
                  ws.addEventListener("error", fail);
                  ws.addEventListener("open", () => {
                    opened = performance.now();
                    ws.send(
                      JSON.stringify({
                        type: "subscribe",
                        scopes: [{ scope: { kind: "navigation" } }],
                      }),
                    );
                  });
                  ws.addEventListener("message", (event) => {
                    const message = JSON.parse(String(event.data)) as {
                      type: string;
                      values?: Array<{
                        key: string;
                        value: { name?: string; projectIds?: string[] };
                      }>;
                    };
                    if (message.type === "ping") ws.send('{"type":"pong"}');
                    if (message.type === "scope-error") return fail(new Error(String(event.data)));
                    if (message.type === "scope-reset" || message.type === "scope-values") {
                      const app = message.values?.find((row) => row.key === `app:${appId}`)?.value;
                      if (app?.name === "Shop" && app.projectIds?.includes("P_MATE"))
                        firstShop ??= performance.now() - opened;
                    }
                    if (message.type === "scope-ready") {
                      clearTimeout(timeout);
                      ws.close();
                      if (firstShop === undefined)
                        return reject(new Error("navigation omitted Shop"));
                      resolve(firstShop);
                    }
                  });
                }),
            ),
          ),
        );
        assert.lengthOf(samples, 5);
        const sorted = samples.toSorted((a, b) => a - b);
        const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]!;
        assert.isAtMost(percentile(0.5), 300, "Five-tab first HQ data p50 target");
        assert.isAtMost(percentile(0.95), 600, "Five-tab first HQ data p95 target");
      }).pipe(Effect.scoped),
    );
    it.effect(
      "five distinct people get cold navigation with Mate facts within the read budget; unchanged resumes send no values",
      () =>
        Effect.gen(function* () {
          const queries: string[] = [];
          let recording = false;
          const core = yield* startCore(true, {
            reconcileEvery: Duration.infinity,
            streamRecheck: Duration.infinity,
            pingEvery: Duration.infinity,
            viewTtl: Duration.zero,
          }).pipe(
            Effect.provideService(Statement.CurrentTransformer, (statement) =>
              Effect.sync(() => {
                if (recording) queries.push(statement.compile()[0]);
                return statement;
              }),
            ),
          );
          yield* untilHealth(core.call, "active");
          const session = yield* sessionFor(core.call, "door-owner");
          const created = yield* core.call("POST", "/api/apps", {
            session,
            body: { name: "Alpha" },
          });
          assert.strictEqual(created.status, 201);
          const people = ["owner", "person-1", "person-2", "person-3", "person-4"];
          for (const userId of people.slice(1)) {
            core.fake.members.get("ORG")!.push({
              name: userId,
              userId,
              clientUserId: `C-${userId}`,
              kind: "person",
              status: "ACTIVE",
              roleCode: "OWNER",
              canCreateProjects: false,
            });
            core.fake.tokens.set(`door-${userId}`, {
              ...core.fake.tokens.get("door-owner")!,
              id: `door-${userId}`,
              createdByUser: userId,
            });
          }
          const projects = Array.from({ length: 30 }, (_, index) =>
            index === 0 ? "P_MATE" : `P_MATE_${index}`,
          );
          for (const id of projects.slice(1))
            core.fake.projects.push({
              ...core.fake.projects.find((project) => project.id === "P_MATE")!,
              id,
              name: id,
              publicZone: `${id}.zone`,
              userRoles: [{ clientUserId: "C-owner", roleCode: "OWNER" }],
            });
          yield* Effect.forEach(
            projects,
            (projectId, index) =>
              Effect.gen(function* () {
                const app =
                  index === 0
                    ? created
                    : yield* core.call("POST", "/api/apps", {
                        session,
                        body: { name: `App ${index}` },
                      });
                assert.strictEqual(app.status, 201);
                const appId = (app.body as { id: string }).id;
                yield* core.sql`INSERT INTO hq_repo (app_id, name, created_by)
                  VALUES (${appId}::uuid, ${"appdev"}, ${"owner"})`;
                const head = "a".repeat(40);
                yield* core.sql`INSERT INTO hq_change
                  (app_id, repo, number, mate_project_id, branch, title, body, head, ready_head, mergeability)
                  VALUES (${appId}::uuid, ${"appdev"}, ${1}, ${projectId}, ${`mate/${projectId}/1`},
                    ${"Menu change " + index}, ${"private description ".repeat(500)},
                    ${head}, ${head}, ${"clean"})`;
                yield* core.sql`INSERT INTO hq_change
                  (app_id, repo, number, mate_project_id, branch, title, state)
                  VALUES (${appId}::uuid, ${"appdev"}, ${2}, ${projectId}, ${`mate/${projectId}/2`},
                    ${"settled private title"}, ${"closed"})`;
                assert.strictEqual(
                  (yield* core.call("POST", "/api/mates", {
                    session,
                    body: { projectId, face: "face" },
                  })).status,
                  201,
                );
                assert.strictEqual(
                  (yield* core.call("PUT", `/api/projects/${projectId}/app`, {
                    session,
                    body: { appId, kind: "mate" },
                  })).status,
                  200,
                );
                const link = yield* core.overviews.connect(projectId);
                yield* core.overviews.report(projectId, link, {
                  type: "overview",
                  full: true,
                  overview: overviewOf(),
                });
                yield* core.overviews.reportAttention(projectId, link, {
                  source: {
                    environmentId: `env-${index}`,
                    epoch: 1,
                    incarnation: "boot",
                    revision: 1,
                  },
                  mainThreadId: "thread",
                  lastThreadId: "thread",
                  working: 1,
                  waiting: 0,
                  results: [
                    {
                      threadId: "thread",
                      turnId: "result",
                      completedAt: "2026-10-06T00:00:00.000Z",
                    },
                  ],
                  questions: [],
                  truncated: false,
                });
              }),
            { concurrency: 4 },
          );
          yield* core.sql`INSERT INTO hq_attention_seen (user_id, project_id, result_id)
            VALUES (${"owner"}, ${"P_MATE"}, ${"result"})`;
          const sessions = yield* Effect.forEach(people, (userId) =>
            userId === "owner" ? Effect.succeed(session) : sessionFor(core.call, `door-${userId}`),
          );
          assert.strictEqual(new Set(sessions).size, 5);
          const tickets = yield* Effect.forEach(
            sessions,
            (personSession) => ticketFor(core.call, personSession),
            { concurrency: "unbounded" },
          );
          const coldReads = core.fake.calls.filter((call) => call === "members:hq").length;
          const coldCalls = core.fake.calls.length;
          recording = true;
          const samples = yield* Effect.promise(() =>
            Promise.all(
              tickets.map(
                (ticket) =>
                  new Promise<{
                    elapsed: number;
                    deliveries: Array<Record<string, unknown>>;
                    cursor: { incarnation: string; revision: number };
                  }>((resolve, reject) => {
                    const began = performance.now();
                    let firstData: number | undefined;
                    const ws = new WebSocket(
                      `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                    );
                    const timeout = setTimeout(() => {
                      ws.close();
                      reject(new Error("no scope receipt"));
                    }, 3000);
                    const deliveries: Array<Record<string, unknown>> = [];
                    ws.addEventListener("open", () =>
                      ws.send(
                        JSON.stringify({
                          type: "subscribe",
                          scopes: [{ scope: { kind: "navigation" } }],
                        }),
                      ),
                    );
                    ws.addEventListener("message", (event) => {
                      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
                      if (message.type === "ping") ws.send('{"type":"pong"}');
                      if (message.type === "scope-reset" || message.type === "scope-values") {
                        firstData ??= performance.now() - began;
                        deliveries.push(message);
                      }
                      if (message.type === "scope-ready") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve({
                          elapsed: firstData!,
                          deliveries,
                          cursor: {
                            incarnation: String(message.incarnation),
                            revision: Number(message.revision),
                          },
                        });
                      }
                    });
                    ws.addEventListener("error", reject);
                  }),
              ),
            ),
          );
          recording = false;
          const sessionQueries = queries.filter((query) => /\bhq_session\b/.test(query));
          const seenQueries = queries.filter((query) => /\bhq_attention_seen\b/.test(query));
          const navigationCalls = core.fake.calls.slice(coldCalls);
          const memberReads = navigationCalls.filter((call) => call === "members:hq").length;
          const structureQueries = queries.filter((query) =>
            /FROM hq_app a (?:LEFT JOIN hq_intake i ON i\.app_id = a\.id[\s\S]*?)?ORDER BY a\.seq/.test(
              query,
            ),
          );
          // The app's emptiness subquery also mentions hq_change; count it with structure. An
          // automated Mate's task reads (`hq_task`: the Mates' one query, the dispatcher's) mention
          // it too, read once for everyone, never per person; so does the pull-request keeper's
          // read of the changes due on GitHub (`pullRequests.ts`), which the apps' last creation
          // above wakes after its debounce, inside this window or after it.
          const keeperQueries = queries.filter(
            (query) => /\bhq_pull_request\b/.test(query) && /\bhq_repo_remote\b/.test(query),
          );
          assert.isAtMost(
            keeperQueries.length,
            1,
            "the keeper reads due changes once, not per Mate",
          );
          const changeQueries = queries.filter(
            (query) =>
              /\bhq_change\b/.test(query) &&
              !/\bhq_task\b/.test(query) &&
              !keeperQueries.includes(query) &&
              !structureQueries.includes(query),
          );
          process.stdout.write(
            `HQ cold reads: SQL=${queries.length}, sessions=${sessionQueries.length}, structure=${structureQueries.length}, changes=${changeQueries.length}, seen=${seenQueries.length}, members=${memberReads}\n`,
          );
          assert.isAbove(
            core.fake.calls.filter((call) => call === "members:hq").length,
            coldReads,
            "roles view was cold",
          );
          const times = samples.map((sample) => sample.elapsed).sort((a, b) => a - b);
          process.stdout.write(
            `HQ five people / 30 Mates / cold roles: p50=${times[2]?.toFixed(1)}ms p95=${times[4]?.toFixed(1)}ms\n`,
          );
          // Socket authentication, its initial session check, and the person's first sign-in
          // (read once per person: it never changes).
          const sessionReadsPerPerson = 3;
          assert.strictEqual(sessionQueries.length, people.length * sessionReadsPerPerson);
          assert.strictEqual(
            seenQueries.length,
            people.length,
            "one scoped seen read per person, not per Mate",
          );
          // The shared structure is read cold, then once when setup-marker evidence lands.
          const sharedStructureReads = 1 + 1;
          assert.isAtLeast(structureQueries.length, 1);
          assert.isAtMost(structureQueries.length, sharedStructureReads);
          assert.strictEqual(
            changeQueries.length,
            1,
            "one shared change read for all people and Mates",
          );
          // Each shared snapshot: isolation SET, five structure SELECTs, four environment SELECTs,
          // and one organization policy SELECT shared by every navigation recipient.
          // Each person also reads seen results and key health. The asynchronous release read
          // starts three shared SELECTs and its first recipe lookup before the scope receipts.
          // The pull-request keeper's due read may land here too.
          const statementsPerStructureRead = 1 + 5 + 4 + 1;
          const sqlBudget =
            people.length * (sessionReadsPerPerson + 1 + 1) +
            structureQueries.length * statementsPerStructureRead +
            1 +
            3 +
            1 +
            keeperQueries.length;
          assert.isAtMost(
            queries.length,
            sqlBudget,
            "total SQL for cold navigation, including all read kinds",
          );
          // Each socket authenticates and checks its session; navigation checks roles before
          // and after loading. Concurrent checks can share a read, but never add per-Mate reads.
          const roleReadsPerPerson = 2 + 2;
          assert.isAtMost(memberReads, people.length * roleReadsPerPerson + sharedStructureReads);
          assert.isAtMost(
            navigationCalls.filter((call) => call === "projects:hq").length,
            people.length * roleReadsPerPerson + sharedStructureReads,
          );
          assert.isAtMost(
            navigationCalls.filter((call) => call === "mateSetupMarker:hq").length,
            projects.length,
            "setup evidence is shared across people",
          );
          for (const [index, sample] of samples.entries()) {
            assert.lengthOf(sample.deliveries, 1);
            const values = sample.deliveries[0]!.values as Array<{
              key: string;
              value: { person?: { unseen: number } };
            }>;
            assert.strictEqual(
              values.find((value) => value.key === "project:P_MATE")!.value.person!.unseen,
              index === 0 ? 0 : 1,
            );
            assert.strictEqual(
              values.find((value) => value.key === "project:P_MATE_1")!.value.person!.unseen,
              1,
            );
            const payload = JSON.stringify(sample.deliveries);
            assert.include(payload, "Alpha");
            assert.include(payload, "project:P_MATE");
            assert.include(payload, '"person":{"role":');
            assert.notInclude(payload, '"recipes"');
            assert.notInclude(payload, '"releases"');
            assert.notInclude(payload, '"repos"');
            assert.notInclude(payload, '"moveTo"');
            assert.include(payload, '"title":"Menu change 0"');
            assert.include(payload, '"hasHead":true');
            assert.notInclude(payload, "private description");
            assert.notInclude(payload, "settled private title");
          }
          const ticket = yield* ticketFor(core.call, session);
          const resumed = yield* Effect.promise(
            () =>
              new Promise<Array<string>>((resolve, reject) => {
                const ws = new WebSocket(
                  `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                );
                const timeout = setTimeout(() => {
                  ws.close();
                  reject(new Error("no resume receipt"));
                }, 3000);
                const types: string[] = [];
                ws.addEventListener("open", () =>
                  ws.send(
                    JSON.stringify({
                      type: "subscribe",
                      scopes: [
                        {
                          scope: { kind: "navigation" },
                          cursor: samples[0]!.cursor,
                          knownKeys: [
                            "org",
                            ...(samples[0]!.deliveries[0]!.values as Array<{ key: string }>).map(
                              (value) => value.key,
                            ),
                          ],
                        },
                      ],
                    }),
                  ),
                );
                ws.addEventListener("message", (event) => {
                  const message = JSON.parse(String(event.data)) as { type: string };
                  types.push(message.type);
                  if (message.type === "scope-ready") {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(types);
                  }
                });
              }),
          );
          assert.deepStrictEqual(resumed, ["scope-ready"]);
        }).pipe(Effect.scoped),
    );
    it.effect("seen results survive a Core restart and remain person-specific", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
          yield* untilHealth(core.call, "active");
          const session = yield* setUpMate(core.call, "P_MATE");
          const attention = {
            source: { environmentId: "environment", epoch: 1, incarnation: "boot", revision: 1 },
            mainThreadId: "thread",
            lastThreadId: "thread",
            working: 0,
            waiting: 0,
            results: [
              { threadId: "thread", turnId: "result", completedAt: "2026-10-06T00:00:00.000Z" },
            ],
            questions: [],
            truncated: false,
          };
          const report = (instance: typeof core) =>
            Effect.gen(function* () {
              const link = yield* instance.overviews.connect("P_MATE");
              yield* instance.overviews.reportAttention("P_MATE", link, attention);
            });
          yield* report(core);
          const navigation = (origin: string, ticket: string, acknowledge = false) =>
            Effect.promise(
              () =>
                new Promise<number | null>((resolve, reject) => {
                  const ws = new WebSocket(
                    `${origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                  );
                  const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error("no navigation receipt"));
                  }, 3000);
                  let unseen: number | null = null;
                  let ready = false;
                  ws.addEventListener("open", () =>
                    ws.send(
                      JSON.stringify({
                        type: "subscribe",
                        scopes: [{ scope: { kind: "navigation" } }],
                      }),
                    ),
                  );
                  ws.addEventListener("error", reject);
                  ws.addEventListener("message", (event) => {
                    const message = JSON.parse(String(event.data)) as {
                      type: string;
                      values?: Array<{
                        key: string;
                        value: { person?: { unseen: number | null } };
                      }>;
                    };
                    if (message.type === "ping") ws.send('{"type":"pong"}');
                    const project = message.values?.find((value) => value.key === "project:P_MATE");
                    if (project !== undefined) unseen = project.value.person!.unseen;
                    if (message.type === "scope-ready") {
                      ready = true;
                      if (acknowledge)
                        ws.send(
                          JSON.stringify({
                            type: "seen",
                            projectId: "P_MATE",
                            resultIds: ["result", "not-a-published-result"],
                          }),
                        );
                    }
                    if (ready && (!acknowledge || (project !== undefined && unseen === 0))) {
                      clearTimeout(timeout);
                      ws.close();
                      resolve(unseen);
                    }
                  });
                }),
            );
          assert.strictEqual(
            yield* navigation(core.origin, yield* ticketFor(core.call, session)),
            1,
          );
          assert.strictEqual(
            yield* navigation(core.origin, yield* ticketFor(core.call, session), true),
            0,
          );
          yield* core.stop;
          const restarted = yield* startCore(true, {
            url: core.url,
            reconcileEvery: Duration.hours(1),
          });
          yield* untilHealth(restarted.call, "active");
          yield* report(restarted);
          const owner = yield* sessionFor(restarted.call, "door-owner-2");
          assert.strictEqual(
            yield* navigation(restarted.origin, yield* ticketFor(restarted.call, owner)),
            0,
          );
          const other = yield* sessionFor(restarted.call, "door-reader");
          // This person has no observation grant, so result coverage remains unknown.
          assert.strictEqual(
            yield* navigation(restarted.origin, yield* ticketFor(restarted.call, other)),
            null,
          );
          assert.strictEqual(
            (yield* restarted.sql`SELECT * FROM hq_attention_seen WHERE project_id = ${"P_MATE"}`)
              .length,
            1,
          );
          yield* restarted.overviews.forget(["P_MATE"]);
          assert.strictEqual(
            (yield* restarted.sql`SELECT * FROM hq_attention_seen WHERE project_id = ${"P_MATE"}`)
              .length,
            0,
          );
          yield* report(restarted);
          assert.strictEqual(
            yield* navigation(restarted.origin, yield* ticketFor(restarted.call, owner)),
            1,
          );
        }),
      ),
    );
    it.effect("seen acknowledges devstage attention without a Mate record", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
          yield* untilHealth(core.call, "active");
          const session = yield* sessionFor(core.call, "door-owner");
          const app = yield* core.call("POST", "/api/apps", {
            session,
            body: { name: "Devstage" },
          });
          assert.strictEqual(app.status, 201);
          const attached = yield* core.call(
            "POST",
            `/api/apps/${(app.body as { id: string }).id}/projects`,
            {
              session,
              body: { projectId: "P_MATE", kind: "devstage", mate: { face: "face" } },
            },
          );
          assert.strictEqual(attached.status, 201);
          // This branch requires a body at attach; reproduce an attached project without its record.
          yield* core.sql`DELETE FROM hq_mate WHERE project_id = ${"P_MATE"}`;
          assert.lengthOf(yield* core.sql`SELECT * FROM hq_mate WHERE project_id = ${"P_MATE"}`, 0);
          const credential = yield* enrollMate(core.call, core.fake, "P_MATE");
          const issued = yield* core.call("POST", "/api/mate/link-ticket", {
            headers: { authorization: `Mate ${credential}` },
          });
          assert.strictEqual(issued.status, 200);
          const received = yield* Stream.toPull(
            core.overviews.changes.pipe(
              Stream.filterEffect(() =>
                Effect.map(
                  core.overviews.all,
                  (entries) => entries.get("P_MATE")?.attention !== undefined,
                ),
              ),
            ),
          );
          const wire = yield* Effect.acquireRelease(
            Effect.promise(
              () =>
                new Promise<WebSocket>((resolve, reject) => {
                  const ws = new WebSocket(
                    `${core.origin.replace("http:", "ws:")}/api/mate/link?ticket=${(issued.body as { ticket: string }).ticket}`,
                  );
                  ws.addEventListener("open", () => resolve(ws), { once: true });
                  ws.addEventListener("error", reject, { once: true });
                }),
            ),
            (ws) => Effect.sync(() => ws.close()),
          );
          wire.send(
            JSON.stringify({
              type: "attention",
              attention: {
                source: { environmentId: "devstage", epoch: 1, incarnation: "boot", revision: 1 },
                mainThreadId: "thread",
                lastThreadId: "thread",
                working: 0,
                waiting: 0,
                results: [
                  { threadId: "thread", turnId: "result", completedAt: "2026-10-06T00:00:00.000Z" },
                ],
                questions: [],
                truncated: false,
              },
            }),
          );
          yield* received;
          const ticket = yield* ticketFor(core.call, session);
          const unseen = yield* Effect.promise(
            () =>
              new Promise<Array<number | null>>((resolve, reject) => {
                const ws = new WebSocket(
                  `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                );
                const fail = (error: unknown) => {
                  clearTimeout(timeout);
                  ws.close();
                  reject(error);
                };
                const timeout = setTimeout(() => fail(new Error("no seen receipt")), 3000);
                const values: Array<number | null> = [];
                ws.addEventListener("open", () =>
                  ws.send(
                    JSON.stringify({
                      type: "subscribe",
                      scopes: [{ scope: { kind: "navigation" } }],
                    }),
                  ),
                );
                ws.addEventListener("error", fail);
                ws.addEventListener("message", (event) => {
                  const message = JSON.parse(String(event.data)) as {
                    type: string;
                    values?: Array<{
                      key: string;
                      value: {
                        person?: { unseen: number | null };
                        can?: { finish?: { allow: boolean } };
                      };
                    }>;
                  };
                  if (message.type === "ping") ws.send('{"type":"pong"}');
                  if (message.type === "scope-error") return fail(new Error(String(event.data)));
                  const project = message.values?.find((value) => value.key === "project:P_MATE");
                  if (project !== undefined) {
                    if (project.value.can?.finish?.allow !== true)
                      return fail(
                        new Error("Navigation did not offer the owner finish for devstage"),
                      );
                    values.push(project.value.person!.unseen);
                  }
                  if (message.type === "scope-ready")
                    ws.send(
                      JSON.stringify({
                        type: "seen",
                        projectId: "P_MATE",
                        resultIds: ["result"],
                      }),
                    );
                  if (values.at(-1) === 0) {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(values);
                  }
                });
              }),
          );
          assert.deepStrictEqual(unseen, [1, 0]);
          assert.lengthOf(
            yield* core.sql`SELECT * FROM hq_attention_seen WHERE project_id = ${"P_MATE"}`,
            1,
          );
          assert.lengthOf(yield* core.sql`SELECT * FROM hq_mate WHERE project_id = ${"P_MATE"}`, 0);
        }),
      ),
    );
    it.effect("the real Mate link ingests today's overview and revisioned attention", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
          yield* untilHealth(core.call, "active");
          yield* setUpMate(core.call, "P_MATE");
          const credential = yield* enrollMate(core.call, core.fake, "P_MATE");
          const issued = yield* core.call("POST", "/api/mate/link-ticket", {
            headers: { authorization: `Mate ${credential}` },
          });
          const ticket = (issued.body as { ticket: string }).ticket;
          const received = yield* Stream.toPull(
            core.overviews.changes.pipe(
              Stream.filterEffect(() =>
                Effect.map(
                  core.overviews.all,
                  (entries) => entries.get("P_MATE")?.attention?.source.revision === 3,
                ),
              ),
            ),
          );
          const wire = yield* Effect.acquireRelease(
            Effect.promise(
              () =>
                new Promise<WebSocket>((resolve, reject) => {
                  const ws = new WebSocket(
                    `${core.origin.replace("http:", "ws:")}/api/mate/link?ticket=${ticket}`,
                  );
                  ws.addEventListener("open", () => resolve(ws), { once: true });
                  ws.addEventListener("error", reject, { once: true });
                }),
            ),
            (ws) => Effect.sync(() => ws.close()),
          );
          const overview = overviewOf();
          const attention = {
            source: { environmentId: "environment", epoch: 1, incarnation: "boot", revision: 3 },
            mainThreadId: "thread",
            lastThreadId: "thread",
            working: 1,
            waiting: 0,
            results: [],
            questions: [],
            truncated: false,
          };
          wire.send(JSON.stringify({ type: "overview", full: true, overview }));
          wire.send(
            JSON.stringify({ type: "attention", attention: { ...attention, results: null } }),
          );
          wire.send(JSON.stringify({ type: "attention", attention }));
          yield* received;
          const entry = (yield* core.overviews.all).get("P_MATE");
          assert.deepStrictEqual(entry?.overview, overview);
          assert.deepStrictEqual(entry?.attention, yield* readAttention(attention));
          assert.strictEqual(entry?.attentionState, "live");
        }),
      ),
    );
  });
});
