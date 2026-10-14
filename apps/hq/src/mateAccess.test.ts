// @effect-diagnostics nodeBuiltinImport:off -- a local stub stands in for the platform.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import { projectAccess, readOrgMembers, readProjectRoles } from "@t3tools/shared/mateAccess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { accessOf, MateAccess, mateAccessLayer } from "./mateAccess.ts";
import { Roles, type OrgSeen } from "./roles.ts";
import { Structure } from "./structure.ts";
import type { ZeropsMember } from "./zerops/api.ts";
import { makeZeropsApiHttp } from "./zerops/http.ts";

const row = (
  id: string,
  userId: string,
  roleCode: string,
  patch: { readonly status?: string; readonly email?: string } = {},
) => ({
  id,
  userId,
  roleCode,
  status: patch.status ?? "ACTIVE",
  canCreateProjects: false,
  user: { fullName: id, email: patch.email ?? `${id}@example.com` },
});

/** One org's member list as `GET /client/{org}/user/list` answers it, every kind of row in it. */
const MEMBERS = {
  clientUserList: [
    row("cu-own", "u-own", "OWNER"),
    row("cu-anchor", "t-anchor", "ADMIN", { email: "token-anchor@zerops.io" }),
    row("cu-deploy", "t-deploy", "BASIC_USER", { email: "token-deploy@zerops.io" }),
    row("cu-read", "u-read", "READ_ONLY"),
    row("cu-dev", "u-dev", "NO_ACCESS"),
    row("cu-low", "u-low", "OWNER"),
    row("cu-inv", "u-inv", "ADMIN", { status: "INVITED" }),
    row("cu-new", "u-new", "SUPERUSER"),
    row("cu-blank", "", "ADMIN"),
  ],
};

/** The Mate's project as `GET /project/{id}` answers it, with its own roles. */
const PROJECT = {
  id: "P",
  clientId: "ORG",
  name: "Acme - Ada",
  status: "ACTIVE",
  publicZone: "p.prg1-zerops.zone",
  userRoles: [
    { clientUserId: "cu-dev", roleCode: "BASIC_USER" },
    { clientUserId: "cu-low", roleCode: "NO_ACCESS" },
    { clientUserId: "", roleCode: "OWNER" },
  ],
};

/** A stub API answering the member list and the project. */
const stub = Effect.acquireRelease(
  Effect.promise(
    () =>
      new Promise<{ readonly url: string; readonly server: NodeHttp.Server }>((resolve) => {
        const server = NodeHttp.createServer((request, response) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(request.url?.endsWith("/user/list") ? MEMBERS : PROJECT));
        });
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address() as NodeNet.AddressInfo;
          resolve({ url: `http://127.0.0.1:${String(port)}`, server });
        });
      }),
  ),
  ({ server }) =>
    Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
);

describe("accessOf", () => {
  // R6: what HQ relays down a Mate's link is what the Mate's own read admits — the same rule over
  // the same member list, each side reading it its own way, token rows and all.
  it.live("relays for a project exactly what the Mate's own read of it admits", () =>
    Effect.gen(function* () {
      const { url } = yield* stub;
      const client = yield* Layer.build(NodeHttpClient.layerNodeHttp);
      const api = yield* makeZeropsApiHttp(url).pipe(Effect.provide(client));
      const credential = Redacted.make("hq");
      const members = yield* api.members("ORG")(credential);
      const project = yield* api.project("P")(credential);

      const relayed = accessOf({ members, projects: [project] }, "P");
      const own = projectAccess({
        projectId: "P",
        members: readOrgMembers(MEMBERS.clientUserList),
        overrides: readProjectRoles(PROJECT)?.overrides ?? {},
      });
      assert.deepStrictEqual(relayed, Option.some(own));
      assert.deepStrictEqual(
        own.map((member) => `${member.userId} ${member.visibility}`),
        ["u-own open", "t-anchor open", "t-deploy open", "u-read listed", "u-dev open"],
      );
    }),
  );

  it.live("a Chief's admission excludes every other person regardless of their platform role", () =>
    Effect.gen(function* () {
      const { url } = yield* stub;
      const client = yield* Layer.build(NodeHttpClient.layerNodeHttp);
      const api = yield* makeZeropsApiHttp(url).pipe(Effect.provide(client));
      const members = yield* api.members("ORG")(Redacted.make("hq"));
      const project = yield* api.project("P")(Redacted.make("hq"));
      const access = accessOf({ members, projects: [project] }, "P", {
        userId: "u-dev",
        ownerName: "Dev",
      });
      assert.deepStrictEqual(
        access,
        Option.some([{ userId: "u-dev", role: "BASIC_USER", visibility: "open" }]),
      );
    }),
  );

  it("a Chief without a registered owner admits nobody", () => {
    assert.deepStrictEqual(
      accessOf({ members: [], projects: [{ ...PROJECT, orgId: "ORG", tags: ["chief"] }] }, "P", {
        userId: null,
        ownerName: null,
      }),
      Option.some([]),
    );
  });
});

describe("MateAccess", () => {
  const owners = (count: number): ReadonlyArray<ZeropsMember> =>
    Array.from({ length: count }, (_, index) => ({
      name: `owner ${String(index)}`,
      kind: "person" as const,
      roleCode: "OWNER",
      status: "ACTIVE",
      userId: `u-${String(index).padStart(20, "0")}`,
      clientUserId: `cu-${String(index)}`,
      canCreateProjects: false,
    }));
  const seen = (members: ReadonlyArray<ZeropsMember>): OrgSeen => ({
    view: {
      orgId: "ORG",
      members,
      projects: [
        {
          id: "P",
          orgId: "ORG",
          name: "P",
          status: "ACTIVE",
          tags: [],
          userRoles: [],
          publicZone: "p.prg1-zerops.zone",
        },
      ],
    },
    answered: 0,
  });

  // A frame past the link's bound is not sent — the Mate reads Zerops itself — and a large org
  // is seen in HQ's log once per Mate, not once per view.
  it.effect("sends nothing past the frame bound, and says so once per Mate", () =>
    Effect.gen(function* () {
      const logged: Array<string> = [];
      const current = yield* Ref.make(seen(owners(1500)));
      const views = Stream.make(seen(owners(1500)), seen(owners(1500)), seen(owners(2))).pipe(
        Stream.tap((view) => Ref.set(current, view)),
      );
      const frames = yield* Effect.gen(function* () {
        const access = yield* MateAccess;
        return yield* Stream.runCollect(access.frames("P"));
      }).pipe(
        Effect.provide(
          Layer.merge(
            mateAccessLayer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(
                    Roles,
                    Roles.of({
                      views,
                      answeredAt: Effect.succeed(0),
                    } as unknown as Roles["Service"]),
                  ),
                  Layer.succeed(
                    Structure,
                    Structure.of({
                      changes: Stream.empty,
                      navigation: Ref.get(current).pipe(
                        Effect.map((view) => ({
                          facts: { ...view.view, freshness: "cached" as const },
                          chiefOwners: new Map(),
                        })),
                      ),
                    } as unknown as Structure["Service"]),
                  ),
                ),
              ),
            ),
            Logger.layer([
              Logger.make(({ message }) => {
                logged.push(String(message));
              }),
            ]),
          ),
        ),
      );
      assert.deepStrictEqual(
        frames.map(
          (frame) =>
            (JSON.parse(frame) as { readonly members: ReadonlyArray<unknown> }).members.length,
        ),
        [2],
      );
      assert.lengthOf(
        logged.filter((line) => line.includes("past the link's frame bound")),
        1,
        logged.join(" | "),
      );
    }),
  );

  it.effect(
    "registering a Chief immediately changes its container admission without a platform view",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0);
        const source = seen(owners(2));
        const navigation = Effect.gen(function* () {
          const count = yield* Ref.getAndUpdate(reads, (value) => value + 1);
          return {
            facts: { ...source.view, freshness: "cached" as const },
            chiefOwners: new Map(count === 0 ? [] : [["P", source.view.members[0]!.userId]]),
          };
        });
        const frames = yield* Effect.gen(function* () {
          const access = yield* MateAccess;
          return yield* Stream.runCollect(access.frames("P"));
        }).pipe(
          Effect.provide(
            mateAccessLayer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(
                    Roles,
                    Roles.of({
                      views: Stream.empty,
                      answeredAt: Effect.succeed(0),
                    } as unknown as Roles["Service"]),
                  ),
                  Layer.succeed(
                    Structure,
                    Structure.of({
                      navigation,
                      changes: Stream.make(0, 1),
                    } as unknown as Structure["Service"]),
                  ),
                ),
              ),
            ),
          ),
        );
        assert.deepStrictEqual(
          frames.map((frame) => {
            const decoded = JSON.parse(frame) as {
              readonly chief: { readonly userId: string; readonly ownerName: string } | null;
              readonly members: ReadonlyArray<{ readonly userId: string }>;
            };
            return { chief: decoded.chief, users: decoded.members.map((member) => member.userId) };
          }),
          [
            { chief: null, users: source.view.members.map((member) => member.userId) },
            {
              chief: { userId: source.view.members[0]!.userId, ownerName: "owner 0" },
              users: [source.view.members[0]!.userId],
            },
          ],
        );
      }),
  );

  it.effect(
    "linked Mates share one admission source read and a late subscriber receives its current answer",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make(0);
        const first = yield* Deferred.make<void>();
        const second = yield* Deferred.make<void>();
        const view = seen(owners(1));
        const navigation = Ref.update(reads, (count) => count + 1).pipe(
          Effect.as({
            facts: { ...view.view, freshness: "cached" as const },
            chiefOwners: new Map(),
          }),
        );
        const changes = Stream.make(0).pipe(
          Stream.concat(
            Stream.fromEffect(Effect.all([Deferred.await(first), Deferred.await(second)])).pipe(
              Stream.drain,
            ),
          ),
        );
        const frames = yield* Effect.gen(function* () {
          const access = yield* MateAccess;
          const collect = (ready: Deferred.Deferred<void>) =>
            access.frames("P").pipe(
              Stream.tap(() => Deferred.succeed(ready, undefined)),
              Stream.runCollect,
            );
          return yield* Effect.all([collect(first), collect(second)], { concurrency: "unbounded" });
        }).pipe(
          Effect.provide(
            mateAccessLayer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(
                    Roles,
                    Roles.of({
                      views: Stream.empty,
                      answeredAt: Effect.succeed(0),
                    } as unknown as Roles["Service"]),
                  ),
                  Layer.succeed(
                    Structure,
                    Structure.of({ navigation, changes } as unknown as Structure["Service"]),
                  ),
                ),
              ),
            ),
          ),
        );
        assert.strictEqual(yield* Ref.get(reads), 1);
        assert.strictEqual(frames[0].length, 1);
        assert.deepStrictEqual(frames[1], frames[0]);
      }),
  );
});
