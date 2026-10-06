// @effect-diagnostics globalTimers:off preferSchemaOverJson:off -- real sockets carry scope receipts.
import { assert, describe, it } from "@effect/vitest";
import { RECIPE_REPO, RECIPE_TIER_PATHS } from "@t3tools/shared/hqRecipe";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { sealedFor } from "../test/harness/deployKeys.ts";
import { sessionFor, startCore, ticketFor, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { OperationRecord } from "./operations.ts";

describe("HQ operation scope", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const end of ["live", "unresolved"] as const)
      it.effect(`an accepted deploy and its ${end} evidence reach the subscribed application`, () =>
        Effect.scoped(
          Effect.gen(function* () {
            const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
            yield* untilHealth(core.call, "active");
            const session = yield* sessionFor(core.call, "door-owner");
            const app = yield* core.call("POST", "/api/apps", { session, body: { name: "Shop" } });
            assert.strictEqual(app.status, 201);
            const appId = (app.body as { id: string }).id;
            const git = yield* core.gitHost.opened(Duration.seconds(3));
            yield* core.sql`INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, 'web', 'owner')`;
            yield* git.create({ appId, id: "web" });
            const recipe = yield* git.commitFiles({ appId, id: RECIPE_REPO }, "refs/heads/main", {
              expectedHead:
                (yield* git.branches({ appId, id: RECIPE_REPO })).items.find(
                  (branch) => branch.ref === "refs/heads/main",
                )?.sha ?? null,
              message: "Declare stage service",
              author: { name: "Ada", email: "ada@mate.test" },
              files: {
                [RECIPE_TIER_PATHS.stage]: `services:\n  - hostname: web\n    type: nodejs@22\n    buildFromGit: https://hq.example.test/git/${appId}/web.git\n    zeropsSetup: web\n`,
              },
            });
            assert.isTrue("sha" in recipe);
            if (!("sha" in recipe)) return yield* Effect.die("recipe commit did not land");
            const recorded = yield* Stream.toPull(
              core.gitHost.recorded.pipe(
                Stream.filterEffect(() =>
                  Effect.map(
                    core.sql`SELECT 1 FROM hq_repo WHERE app_id::text = ${appId} AND name = ${RECIPE_REPO} AND main_head = ${recipe.sha}`,
                    (rows) => rows.length === 1,
                  ),
                ),
              ),
            );
            yield* recorded;
            assert.strictEqual(
              (yield* core.call("POST", `/api/apps/${appId}/projects`, {
                session,
                body: { projectId: "P_MATE", kind: "stage", environment: { name: "stage" } },
              })).status,
              201,
            );
            core.fake.tokens.set("key-stage", {
              ...core.fake.tokens.get("hq")!,
              id: "key-stage",
              roleCode: "NO_ACCESS",
              projects: [{ projectId: "P_MATE", roleCode: "BASIC_USER" }],
            });
            const sealed = sealedFor("P_MATE", "key-stage");
            yield* core.sql`INSERT INTO hq_deploy_token (project_id, key_id, sealed, kept_by) VALUES ('P_MATE', ${sealed.keyId}, ${sealed.sealed}, 'owner')`;
            const service = {
              id: "S-web",
              projectId: "P_MATE",
              name: "web",
              status: "ACTIVE",
              isSystem: false,
              subdomainAccess: false,
              http: false,
              named: { id: "V-old", name: "" },
              activeVersionId: "V-old",
            };
            core.fake.services.push(service);
            core.fake.outcome = () => "BUILDING";
            const ticket = yield* ticketFor(core.call, session);
            const socket = yield* Effect.acquireRelease(
              Effect.promise(
                () =>
                  new Promise<WebSocket>((resolve, reject) => {
                    const ws = new WebSocket(
                      `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                    );
                    ws.addEventListener("open", () => resolve(ws), { once: true });
                    ws.addEventListener("error", reject, { once: true });
                  }),
              ),
              (ws) => Effect.sync(() => ws.close()),
            );
            const receiving = yield* Effect.forkScoped(
              Effect.promise(
                () =>
                  new Promise<Array<OperationRecord>>((resolve, reject) => {
                    const timeout = setTimeout(
                      () => reject(new Error("no operation scope receipt")),
                      5000,
                    );
                    const values: Array<OperationRecord> = [];
                    socket.addEventListener("message", (event) => {
                      const message = JSON.parse(String(event.data)) as {
                        type: string;
                        scope?: { kind: string; appId?: string };
                        values?: Array<{ key: string; value: OperationRecord }>;
                      };
                      if (message.type === "ping") socket.send('{"type":"pong"}');
                      if (message.type === "scope-error") {
                        clearTimeout(timeout);
                        reject(new Error(String(event.data)));
                      }
                      if (message.scope?.kind !== "operation" || message.scope.appId !== appId)
                        return;
                      for (const value of message.values ?? []) {
                        if (value.value.kind !== "deploy") continue;
                        if (value.key !== `${appId}:${value.value.id}`) {
                          clearTimeout(timeout);
                          reject(new Error(`unexpected operation key ${value.key}`));
                          return;
                        }
                        values.push(value.value);
                        if (value.value.state === "building" && value.value.handle !== null) {
                          if (end === "unresolved") {
                            service.named = { id: "V-other", name: "another deployment" };
                            Object.defineProperty(service, "activeVersionId", {
                              get: () => "V-other",
                              set: () => {},
                              configurable: true,
                            });
                          }
                          core.fake.outcome = () => "ACTIVE";
                        }
                        if (value.value.state === end) {
                          clearTimeout(timeout);
                          resolve(values);
                        }
                      }
                    });
                    socket.send(
                      JSON.stringify({
                        type: "subscribe",
                        scopes: [{ scope: { kind: "operation", appId } }],
                      }),
                    );
                  }),
              ),
            );
            yield* git.commitFiles({ appId, id: "web" }, "refs/heads/main", {
              expectedHead: null,
              message: "Deploy web",
              author: { name: "Ada", email: "ada@mate.test" },
              files: {
                "zerops.yaml": "zerops:\n  - setup: web\n    run:\n      start: node index.js\n",
              },
            });
            const delivered = yield* Fiber.join(receiving);
            assert.isTrue(
              delivered.some((value) => value.state === "building" && value.handle !== null),
            );
            const finished = delivered.at(-1)!;
            assert.strictEqual(finished.executor, "hq");
            assert.strictEqual(finished.state, end);
            assert.strictEqual(finished.projectId, "P_MATE");
            assert.strictEqual(finished.evidence?.phase, "closed");
            assert.strictEqual(finished.evidence?.nextActor, end === "live" ? "none" : "person");
            assert.strictEqual(finished.evidence?.processes[0]?.status, "FINISHED");
            assert.isAbove(finished.steps.length, 0);
            assert.isTrue(
              delivered.every((value) => value.id === finished.id && value.appId === appId),
            );
            assert.strictEqual(
              finished.verifiedVersionId,
              end === "live" ? finished.versionId : null,
            );
            assert.strictEqual(core.fake.appVersions.size, 1);
          }),
        ),
      );
  });
});
