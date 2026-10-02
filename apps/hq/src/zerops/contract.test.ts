// @effect-diagnostics nodeBuiltinImport:off -- the real-API run reads its token from a file.
/**
 * One contract, two implementations. The fake runs it always; the HTTP implementation runs it
 * against the real API when `HQ_ZEROPS_CONTRACT=1` and `HQ_ZEROPS_CONTRACT_TOKEN_FILE` names an
 * org Read only credential of KRLS (the rig's Core one, `nastroje/rig/hq-org-token.sh`). Read-only
 * calls on org KRLS and one HQ's project: `HQ_ZEROPS_CONTRACT_PROJECT` names it, the rig's
 * `mate-rig-hq` by default (`nastroje/rig/hq-lib.mjs`), whose tag and env fixtures
 * (`hq-project.sh`) are checked only there.
 */
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as Scope from "effect/Scope";

import { type FakeService, emptyWorld, fakeZeropsApi } from "../../test/harness/zeropsFake.ts";
import type { ZeropsApi, ZeropsError } from "./api.ts";
import { makeZeropsApiHttp } from "./http.ts";

const API = "https://api.app-prg1.zerops.io/api/rest/public";
const KRLS = "BkC8AGjFQMyFrLbzjHoE9g";
const RIG_PROJECT = "mate-rig-hq";
const FOREIGN_ORG = "AAAAAAAAAAAAAAAAAAAAAA";
const UNKNOWN_PROJECT = "AAAAAAAAAAAAAAAAAAAAAA";
const UNKNOWN_SERVICE = "AAAAAAAAAAAAAAAAAAAAAA";
const PLAIN = { key: "HQ_CONTRACT_PLAIN", value: 'contract "plain" \\ value' };
const SECRET_KEY = "HQ_CONTRACT_SECRET";

interface Subject {
  readonly api: ZeropsApi["Service"];
  readonly credential: Redacted.Redacted;
  readonly orgId: string;
  /** The HQ project read, by its name; the rig's carries its tag and env fixtures. */
  readonly project: { readonly name: string; readonly rig: boolean };
}

const refusal = (error: ZeropsError) =>
  error._tag === "ZeropsRefused" ? error.reason : "unavailable";

const contract = (name: string, subject: Effect.Effect<Subject, never, Scope.Scope>) =>
  describe(name, () => {
    it.live("the credential is its org's Read only token, with no project grant and no flag", () =>
      Effect.gen(function* () {
        const { api, credential, orgId } = yield* subject;
        const own = yield* api.ownToken(credential);
        const now = yield* Clock.currentTimeMillis;
        assert.strictEqual(own.orgId, orgId);
        // Read at the API's own clock, minted before it.
        assert.isBelow(Math.abs((own.readAtMs ?? 0) - now), 5 * 60_000);
        assert.isAtMost(own.createdMs, own.readAtMs ?? 0);
        assert.deepStrictEqual(
          [
            own.roleCode,
            own.canCreateProjects,
            own.canViewFinances,
            own.canEditFinances,
            own.projects,
          ],
          ["READ_ONLY", false, false, false, []],
        );
      }),
    );

    it.live("members lists people and tokens, this credential's own token among them", () =>
      Effect.gen(function* () {
        const { api, credential, orgId } = yield* subject;
        const own = yield* api.ownToken(credential);
        const members = yield* api.members(orgId)(credential);
        assert.isTrue(members.some((member) => member.kind === "person"));
        assert.deepStrictEqual(
          members
            .filter((member) => member.name === own.name)
            .map(({ name, kind, roleCode, status, canCreateProjects }) => ({
              name,
              kind,
              roleCode,
              status,
              canCreateProjects,
            })),
          [
            {
              name: own.name,
              kind: "token",
              roleCode: "READ_ONLY",
              status: "ACTIVE",
              canCreateProjects: own.canCreateProjects,
            },
          ],
        );
        assert.isTrue(
          members.every((member) => member.userId !== "" && member.clientUserId !== ""),
        );
        // The member row's id is what a project's grants name; it is not the user id.
        assert.isTrue(members.every((member) => member.clientUserId !== member.userId));
        // Whoever minted the credential is a member, by user id.
        assert.isTrue(
          members.some((member) => member.userId === own.createdByUser && member.kind === "person"),
        );
      }),
    );

    it.live("projects lists the HQ project; project reads it by id with its tags and grants", () =>
      Effect.gen(function* () {
        const { api, credential, orgId, project: target } = yield* subject;
        const listed = (yield* api.projects(orgId)(credential)).filter(
          (project) => project.name === target.name,
        );
        assert.strictEqual(listed.length, 1);
        const project = yield* api.project(listed[0]?.id ?? "")(credential);
        assert.deepStrictEqual(project, listed[0]);
        assert.strictEqual(project.orgId, orgId);
        assert.strictEqual(project.status, "ACTIVE");
        if (target.rig) assert.include(project.tags, "mate-rig");
        assert.isArray(project.userRoles);
        // The project's own domain, the CNAME target every project has.
        assert.match(project.publicZone, /^[a-z0-9]+\.[a-z0-9]+-zerops\.zone$/u);
      }),
    );

    it.live(
      "projectEnv reads the env: the rig's plain fixture in clear, its sensitive one REDACTED",
      () =>
        Effect.gen(function* () {
          const { api, credential, orgId, project: target } = yield* subject;
          const projects = yield* api.projects(orgId)(credential);
          const found = projects.find((project) => project.name === target.name);
          const env = yield* api.projectEnv(found?.id ?? "")(credential);
          if (target.rig) {
            assert.strictEqual(env.get(PLAIN.key), PLAIN.value);
            assert.strictEqual(env.get(SECRET_KEY), "REDACTED");
          } else {
            assert.isAbove(env.size, 0);
          }
        }),
    );

    it.live(
      "services lists the rig project's services; service reads one directly, as listed",
      () =>
        Effect.gen(function* () {
          const { api, credential, orgId, project: target } = yield* subject;
          const projects = yield* api.projects(orgId)(credential);
          const rig = projects.find((project) => project.name === target.name);
          const services = yield* api.services(rig?.id ?? "")(credential);
          const hq = services.find((service) => service.name === "hq");
          assert.isDefined(hq);
          assert.deepStrictEqual(yield* api.service(hq?.id ?? "")(credential), hq);
          assert.deepStrictEqual([hq?.projectId, hq?.isSystem, hq?.http], [rig?.id, false, true]);
          // It runs the version its last deploy named: an HQ's deploys name it `hq-<stamp>`.
          assert.match(hq?.named?.name ?? "", /^hq-/u);
          assert.strictEqual(hq?.activeVersionId, hq?.named?.id);
          // The platform's own service is listed too, and marked.
          assert.isTrue(services.some((service) => service.name === "core" && service.isSystem));
        }),
    );

    it.live(
      "refuses: an unknown project not_found, another org forbidden, a bogus credential unauthorized",
      () =>
        Effect.gen(function* () {
          const { api, credential, orgId } = yield* subject;
          const bogus = Redacted.make("bogus-credential");
          const outcomes = yield* Effect.all([
            Effect.flip(api.project(UNKNOWN_PROJECT)(credential)),
            Effect.flip(api.projectEnv(UNKNOWN_PROJECT)(credential)),
            Effect.flip(api.members(FOREIGN_ORG)(credential)),
            Effect.flip(api.projects(FOREIGN_ORG)(credential)),
            Effect.flip(api.ownToken(bogus)),
            Effect.flip(api.members(orgId)(bogus)),
            Effect.flip(api.projects(orgId)(bogus)),
            Effect.flip(api.services(UNKNOWN_PROJECT)(credential)),
            Effect.flip(api.service(UNKNOWN_SERVICE)(credential)),
            Effect.flip(api.service(UNKNOWN_SERVICE)(bogus)),
          ]);
          assert.deepStrictEqual(outcomes.map(refusal), [
            "not_found",
            "not_found",
            "forbidden",
            "forbidden",
            "unauthorized",
            "unauthorized",
            "unauthorized",
            "not_found",
            "not_found",
            "unauthorized",
          ]);
        }),
    );
  });

/** Every read of an unreachable platform fails unavailable: never an empty answer. */
const unreachable = (name: string, subject: Effect.Effect<Subject, never, Scope.Scope>) =>
  it.live(`${name}: every read of an unreachable platform is unavailable`, () =>
    Effect.gen(function* () {
      const { api, credential, orgId } = yield* subject;
      const outcomes = yield* Effect.all([
        Effect.flip(api.members(orgId)(credential)),
        Effect.flip(api.projects(orgId)(credential)),
        Effect.flip(api.project(UNKNOWN_PROJECT)(credential)),
        Effect.flip(api.projectEnv(UNKNOWN_PROJECT)(credential)),
        Effect.flip(api.ownToken(credential)),
        Effect.flip(api.services(UNKNOWN_PROJECT)(credential)),
        Effect.flip(api.service(UNKNOWN_SERVICE)(credential)),
      ]);
      assert.deepStrictEqual(outcomes.map(refusal), Array(7).fill("unavailable"));
    }),
  );

/** The fake, seeded like the rig: org KRLS, its owner, Core's token, the rig project and its env. */
const fakeSubject = (down: boolean) =>
  Effect.sync((): Subject => {
    const world = emptyWorld();
    const own = {
      id: "T1",
      name: "mate-hq-org:P1",
      orgId: KRLS,
      roleCode: "READ_ONLY",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [],
      createdMs: 0,
      createdByUser: "U-owner",
    };
    world.tokens.set("fake-token", own);
    world.members.set(KRLS, [
      {
        name: "Org Owner",
        kind: "person",
        roleCode: "OWNER",
        status: "ACTIVE",
        userId: "U-owner",
        clientUserId: "C-owner",
        canCreateProjects: true,
      },
      {
        name: own.name,
        kind: "token",
        roleCode: "READ_ONLY",
        status: "ACTIVE",
        userId: "T1",
        clientUserId: "C-t1",
        canCreateProjects: false,
      },
    ]);
    world.projects.push({
      id: "P1",
      orgId: KRLS,
      name: RIG_PROJECT,
      status: "ACTIVE",
      tags: ["mate-rig"],
      userRoles: [],
      publicZone: "p1zone.prg1-zerops.zone",
    });
    world.env.set("P1", [
      { key: PLAIN.key, value: PLAIN.value, sensitive: false },
      { key: SECRET_KEY, value: "s3cret", sensitive: true },
    ]);
    const service = (name: string, over: Partial<FakeService> = {}): FakeService => ({
      id: `S-${name}`,
      projectId: "P1",
      name,
      status: "ACTIVE",
      isSystem: false,
      subdomainAccess: false,
      http: false,
      named: null,
      activeVersionId: null,
      ...over,
    });
    world.services.push(
      service("core", { isSystem: true }),
      service("hq", {
        http: true,
        named: { id: "V-hq", name: "hq-2a9f6c1.20261002T120000" },
        activeVersionId: "V-hq",
      }),
      service("db"),
    );
    world.down = down;
    return {
      api: fakeZeropsApi(world),
      credential: Redacted.make("fake-token"),
      orgId: KRLS,
      project: { name: RIG_PROJECT, rig: true },
    };
  });

/** The HTTP implementation, its client alive for the test's scope. */
const httpSubject = (baseUrl: string, token: string, project = RIG_PROJECT) =>
  Effect.gen(function* () {
    const client = yield* Layer.build(NodeHttpClient.layerNodeHttp);
    const api = yield* makeZeropsApiHttp(baseUrl).pipe(Effect.provide(client));
    return {
      api,
      credential: Redacted.make(token),
      orgId: KRLS,
      project: { name: project, rig: project === RIG_PROJECT },
    };
  });

/** A local port with nothing listening on it. */
const deadUrl = Effect.promise(
  () =>
    new Promise<string>((resolve) => {
      const server = NodeNet.createServer().listen(0, "127.0.0.1", () => {
        const { port } = server.address() as NodeNet.AddressInfo;
        server.close(() => resolve(`http://127.0.0.1:${String(port)}`));
      });
    }),
);

contract("ZeropsApi contract: fake", fakeSubject(false));
unreachable("fake", fakeSubject(true));
unreachable(
  "http",
  Effect.flatMap(deadUrl, (url) => httpSubject(url, "any-token")),
);

const tokenFile = process.env["HQ_ZEROPS_CONTRACT_TOKEN_FILE"];
if (process.env["HQ_ZEROPS_CONTRACT"] === "1" && tokenFile !== undefined) {
  contract(
    "ZeropsApi contract: http against the real API",
    httpSubject(
      API,
      NodeFS.readFileSync(tokenFile, "utf8").trim(),
      process.env["HQ_ZEROPS_CONTRACT_PROJECT"],
    ),
  );
} else {
  describe.skip("ZeropsApi contract: http against the real API (HQ_ZEROPS_CONTRACT=1 to run)", () => {
    it("skipped", () => undefined);
  });
}
