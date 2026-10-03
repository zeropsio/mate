// @effect-diagnostics nodeBuiltinImport:off -- a local stub stands in for the platform.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import { projectAccess, readOrgMembers, readProjectRoles } from "@t3tools/shared/mateAccess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

import { accessOf, MateAccess, mateAccessLayer } from "./mateAccess.ts";
import { Roles, type OrgSeen } from "./roles.ts";
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
      const views = Stream.make(seen(owners(1500)), seen(owners(1500)), seen(owners(2)));
      const frames = yield* Effect.gen(function* () {
        const access = yield* MateAccess;
        return yield* Stream.runCollect(access.frames("P"));
      }).pipe(
        Effect.provide(
          Layer.merge(
            mateAccessLayer.pipe(
              Layer.provide(
                Layer.succeed(Roles, Roles.of({ views } as unknown as Roles["Service"])),
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
});
