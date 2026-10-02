// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- the tests reach Core as a client does: over HTTP and a WebSocket.
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";

import {
  CLIENT,
  enrollMate,
  sessionFor,
  setUpMate,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { ZeropsOwnToken } from "./zerops/api.ts";
import { failure } from "./api.ts";
import { NotLeader } from "./leader.ts";
import { ZeropsUnavailable } from "./zerops/api.ts";

describe("HQ's failures", () => {
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
});

describe("HQ API", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
            body: { projectId: "P_MATE", kind: "mate", mate: { name: "Ada", face: "face-3" } },
          });
          assert.strictEqual(attached.status, 201);
          assert.deepStrictEqual((yield* call("GET", "/api/structure", { session })).body, {
            ungrouped: [],
            apps: [
              {
                id: appId,
                name: "Shop",
                projects: [
                  {
                    projectId: "P_MATE",
                    name: "P_MATE",
                    kind: "mate",
                    mate: {
                      name: "Ada",
                      face: "face-3",
                      standupRequestedBy: null,
                      closedOff: false,
                    },
                  },
                ],
                environments: [],
              },
            ],
          });
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
            [201, { appId, projectId: "P_MATE", kind: "production" }],
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
            [{ projectId: "P_MATE", name: "P_MATE", kind: "production", mate: null }],
            [
              {
                projectId: "P_MATE",
                tier: "production",
                name: "live",
                sources: ["release"],
                order: 1,
                keyHeld: false,
                deploys: [],
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
            [204, null],
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
              keyHeld: true,
              deploys: [],
            },
          ],
        );
        assert.notInclude(new TextDecoder().decode(read.bytes), "key-stage");
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

    it.effect(
      "answers 503 while Zerops gives an empty member list, never a refusal or nothing",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          fake.members.set("ORG", []);
          const answers = yield* Effect.all([
            call("POST", "/api/apps", { session, body: { name: "Two" } }),
            call("POST", "/api/door", { body: { token: "door-dev" } }),
          ]);
          assert.deepStrictEqual(
            answers.map((answer) => [
              answer.status,
              (answer.body as { readonly code: string }).code,
            ]),
            [
              [503, "zerops_unavailable"],
              [503, "zerops_unavailable"],
            ],
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
        const { call, fake } = yield* startCore(true);
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
        const statuses = yield* Effect.forEach(Array.from({ length: 11 }), () => knock("10.0.0.1"));
        assert.deepStrictEqual(statuses, [...Array(10).fill(401), 429]);
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
      "streams the caller's structure over a WebSocket: a snapshot, then each change, pings answered",
      () =>
        Effect.gen(function* () {
          const { call, fake, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const owner = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, session)}`,
          );
          // What `GET /api/structure` answers, and beside it the changes of what the caller reads.
          assert.deepStrictEqual(yield* owner.next("snapshot"), {
            ...((yield* call("GET", "/api/structure", { session })).body as object),
            changes: {},
          });
          const appId = (
            (yield* call("POST", "/api/apps", { session, body: { name: "Shop" } })).body as {
              readonly id: string;
            }
          ).id;
          assert.deepStrictEqual(yield* owner.next("change"), {
            key: appId,
            value: { id: appId, name: "Shop", projects: [], environments: [] },
          });
          yield* call("POST", `/api/apps/${appId}/projects`, {
            session,
            body: { projectId: "P_MATE", kind: "mate", mate: { name: "Ada", face: "sky:flower" } },
          });
          const shopWith = (mate: { readonly name: string; readonly face: string }) => ({
            key: appId,
            value: {
              id: appId,
              name: "Shop",
              projects: [
                {
                  projectId: "P_MATE",
                  name: "P_MATE",
                  kind: "mate",
                  mate: { ...mate, standupRequestedBy: null, closedOff: false },
                },
              ],
              environments: [],
            },
          });
          assert.deepStrictEqual(
            yield* owner.next("change"),
            shopWith({ name: "Ada", face: "sky:flower" }),
          );
          yield* call("PATCH", "/api/mates/P_MATE", { session, body: { name: "Ada 2" } });
          assert.deepStrictEqual(
            yield* owner.next("change"),
            shopWith({ name: "Ada 2", face: "sky:flower" }),
          );

          // Deleted in Zerops: the reconcile drops it, and the socket says so.
          fake.projects.splice(
            fake.projects.findIndex((project) => project.id === "P_MATE"),
            1,
          );
          assert.deepStrictEqual(yield* owner.next("change"), {
            key: appId,
            value: { id: appId, name: "Shop", projects: [], environments: [] },
          });
          // Three pings answered: still open.
          yield* Effect.sleep(Duration.millis(1100));
          assert.isAtLeast(owner.pings.seen, 3);
          assert.deepStrictEqual(yield* owner.quiet("1 millis"), []);
          yield* owner.close;
        }),
    );

    it.effect(
      "sets a Mate up, renames an application and moves the Mate: each change on the socket",
      () =>
        Effect.gen(function* () {
          const { call, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const owner = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, session)}`,
          );
          assert.deepStrictEqual(yield* owner.next("snapshot"), {
            ungrouped: [],
            apps: [],
            changes: {},
          });
          const ada = { name: "Ada", face: "sky:flower" };
          const adaView = { ...ada, standupRequestedBy: null, closedOff: false };
          const lone = [{ projectId: "P_MATE", name: "P_MATE", mate: adaView }];

          const setUp = yield* call("POST", "/api/mates", {
            session,
            body: { projectId: "P_MATE", ...ada },
          });
          assert.deepStrictEqual(
            [setUp.status, setUp.body],
            [201, { projectId: "P_MATE", ...ada }],
          );
          assert.deepStrictEqual(yield* owner.next("change"), { key: "ungrouped", value: lone });

          const appId = (
            (yield* call("POST", "/api/apps", { session, body: { name: "Shop" } })).body as {
              readonly id: string;
            }
          ).id;
          yield* owner.next("change");
          const renamed = yield* call("PATCH", `/api/apps/${appId}`, {
            session,
            body: { name: "Store" },
          });
          assert.deepStrictEqual(
            [renamed.status, renamed.body],
            [200, { id: appId, name: "Store" }],
          );
          assert.deepStrictEqual(yield* owner.next("change"), {
            key: appId,
            value: { id: appId, name: "Store", projects: [], environments: [] },
          });

          const moved = yield* call("PUT", "/api/projects/P_MATE/app", {
            session,
            body: { appId, kind: "mate" },
          });
          assert.deepStrictEqual(
            [moved.status, moved.body],
            [200, { projectId: "P_MATE", appId, kind: "mate" }],
          );
          assert.sameDeepMembers(
            [yield* owner.next("change"), yield* owner.next("change")] as Array<object>,
            [
              { key: "ungrouped", value: [] },
              {
                key: appId,
                value: {
                  id: appId,
                  name: "Store",
                  projects: [{ projectId: "P_MATE", name: "P_MATE", kind: "mate", mate: adaView }],
                  environments: [],
                },
              },
            ],
          );
          const out = yield* call("PUT", "/api/projects/P_MATE/app", {
            session,
            body: { appId: null, kind: "mate" },
          });
          assert.deepStrictEqual(
            [out.status, out.body],
            [200, { projectId: "P_MATE", appId: null, kind: null }],
          );
          assert.sameDeepMembers(
            [yield* owner.next("change"), yield* owner.next("change")] as Array<object>,
            [
              { key: "ungrouped", value: lone },
              { key: appId, value: { id: appId, name: "Store", projects: [], environments: [] } },
            ],
          );
          yield* owner.close;
        }),
    );

    it.effect("a Developer's socket holds only what they see, and follows a role they gain", () =>
      Effect.gen(function* () {
        const { call, fake, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const dev = yield* sessionFor(call, "door-dev");
        const devSocket = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, dev)}`);
        assert.deepStrictEqual(yield* devSocket.next("snapshot"), {
          ungrouped: [],
          apps: [],
          changes: {},
        });
        const appId = (
          (yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } })).body as {
            readonly id: string;
          }
        ).id;
        yield* call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: { projectId: "P_MATE", kind: "stage" },
        });
        assert.deepStrictEqual(yield* devSocket.quiet("700 millis"), []);

        // Zerops grants dev the project: the open socket shows the application within its recheck.
        const project = fake.projects.find((candidate) => candidate.id === "P_MATE")!;
        Object.assign(project, {
          userRoles: [{ clientUserId: "C-dev", roleCode: "BASIC_USER" }],
        });
        assert.deepStrictEqual(yield* devSocket.next("change"), {
          key: appId,
          value: {
            id: appId,
            name: "Shop",
            projects: [{ projectId: "P_MATE", name: "P_MATE", kind: "stage", mate: null }],
            environments: [
              {
                projectId: "P_MATE",
                tier: "stage",
                name: "p-mate",
                sources: ["main"],
                order: 1,
                keyHeld: false,
                deploys: [],
              },
            ],
          },
        });
        yield* devSocket.close;
      }),
    );

    it.effect("a socket follows a role its holder loses: what they no longer see goes", () =>
      Effect.gen(function* () {
        const { call, fake, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const reader = yield* sessionFor(call, "door-reader");
        const appId = (
          (yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } })).body as {
            readonly id: string;
          }
        ).id;
        const readerSocket = yield* socket(
          `/api/structure/ws?ticket=${yield* ticketFor(call, reader)}`,
        );
        assert.deepStrictEqual(yield* readerSocket.next("snapshot"), {
          ungrouped: [],
          apps: [{ id: appId, name: "Shop", projects: [], environments: [] }],
          changes: { [appId]: [] },
        });

        // Zerops lowers the reader to no access: the open socket drops the application.
        const member = fake.members.get("ORG")!.find((row) => row.userId === "reader")!;
        Object.assign(member, { roleCode: "NO_ACCESS" });
        assert.deepStrictEqual(yield* readerSocket.next("change"), { key: appId, value: null });
        yield* readerSocket.close;
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
          assert.deepStrictEqual(yield* opened.next("snapshot"), {
            ungrouped: [],
            apps: [],
            changes: {},
          });
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

    it.effect(
      "drains on shutdown: gives the lead up, sends sockets away (1001), and still answers meanwhile",
      () =>
        Effect.gen(function* () {
          const { call, socket, stop } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const open = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, session)}`);
          yield* open.next("snapshot");
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

    it.effect("answers a client origin's preflight, and no other origin", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        const preflight = (origin: string) =>
          call("OPTIONS", "/api/structure", {
            headers: {
              origin,
              "access-control-request-method": "GET",
              "access-control-request-headers": "authorization",
            },
          });
        const allowed = yield* preflight(CLIENT);
        assert.isBelow(allowed.status, 300);
        assert.strictEqual(allowed.headers.get("access-control-allow-origin"), CLIENT);
        assert.strictEqual(
          (yield* preflight("http://localhost:4380")).headers.get("access-control-allow-origin"),
          "http://localhost:4380",
        );
        assert.isNull(
          (yield* preflight("https://evil.example")).headers.get("access-control-allow-origin"),
        );
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
          const owner = yield* setUpMate(call, "P_MATE");
          const credential = yield* enrollMate(call, fake, "P_MATE");
          const self = Effect.map(
            call("GET", "/api/mate/self", { headers: { authorization: `Mate ${credential}` } }),
            (answer) => [answer.status, answer.body],
          );
          const born = { projectId: "P_MATE", name: "Ada", face: "face-1" };
          // A Mate in no application: no changes beside its record.
          const none = { appId: null, appName: null, changes: [] };
          assert.deepStrictEqual(yield* self, [
            200,
            { ...born, standupRequestedBy: null, closedOff: false, ...none },
          ]);

          const standup = yield* call("POST", "/api/mates/P_MATE/standup", { session: owner });
          assert.deepStrictEqual(
            [standup.status, standup.body],
            [200, { ...born, standupRequestedBy: "owner", closedOff: false }],
          );
          const closed = yield* call("POST", "/api/mates/P_MATE/closed-off", { session: owner });
          assert.deepStrictEqual(
            [closed.status, closed.body],
            [200, { ...born, standupRequestedBy: "owner", closedOff: true }],
          );
          assert.deepStrictEqual(yield* self, [
            200,
            { ...born, standupRequestedBy: "owner", closedOff: true, ...none },
          ]);

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
      "a Mate's link brings its state down at once and on each change, and its summary up to whoever may operate it",
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
            name: "Ada",
            face: "face-1",
            appId: null,
            appName: null,
            changes: [],
          };
          assert.deepStrictEqual(yield* link.next("state"), {
            mate: { ...state, standupRequestedBy: null, closedOff: false },
          });
          yield* call("POST", "/api/mates/P_MATE/closed-off", { session: owner });
          assert.deepStrictEqual(yield* link.next("state"), {
            mate: { ...state, standupRequestedBy: null, closedOff: true },
          });

          // The owner operates the Mate and follows its summary; a reader only sees it listed.
          const ownerSocket = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`,
          );
          yield* ownerSocket.next("snapshot");
          const reader = yield* sessionFor(call, "door-reader");
          const readerSocket = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, reader)}`,
          );
          yield* readerSocket.next("snapshot");
          const summary = {
            main: {
              threadId: "t1",
              status: "working",
              lastRequest: "Add a login page",
              lastWords: null,
              lastTurnAt: "2026-10-02T10:00:00Z",
              waitingQuestion: null,
              firstError: null,
              liveStep: "Reading src/app.ts",
            },
            running: 1,
            waiting: 0,
            signers: { "claude-code": "owner" },
          };
          yield* link.send({ type: "summary", summary });
          const seen = (yield* ownerSocket.next("change")) as {
            readonly key: string;
            readonly value: ReadonlyArray<{
              readonly mate: {
                readonly live?: { readonly online: boolean; readonly summary: unknown };
              };
            }>;
          };
          assert.strictEqual(seen.key, "ungrouped");
          assert.deepStrictEqual(seen.value[0]?.mate.live?.summary, summary);
          assert.strictEqual(seen.value[0]?.mate.live?.online, true);
          assert.deepStrictEqual(yield* readerSocket.quiet("500 millis"), []);

          // The link goes: the Mate is offline, its last summary kept.
          yield* link.close;
          const gone = (yield* ownerSocket.next("change")) as typeof seen;
          assert.strictEqual(gone.value[0]?.mate.live?.online, false);
          assert.deepStrictEqual(gone.value[0]?.mate.live?.summary, summary);

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
            body: { projectId: "P_MATE", kind: "mate", mate: { name: "Ada", face: "face-1" } },
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
          body: { projectId: "P_MATE", kind: "mate", mate: { name: "Ada", face: "face-1" } },
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
