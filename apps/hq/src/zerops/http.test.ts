// @effect-diagnostics nodeBuiltinImport:off -- a local stub stands in for the platform's flakes.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type { ZeropsError } from "./api.ts";
import { makeZeropsApiHttp, makeZeropsDeployHttp } from "./http.ts";

const readRequestBody = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));

const MEMBERS = {
  clientUserList: [
    {
      id: "C1",
      userId: "T1",
      roleCode: "READ_ONLY",
      status: "ACTIVE",
      canCreateProjects: false,
      user: {
        fullName: "mate-hq-org:P1",
        avatar: {
          smallAvatarUrl: "https://avatar.test/member",
          externalAvatarUrl: "https://avatar.test/external",
        },
        email: "token-abc@zerops.io",
      },
    },
  ],
};

/** A stub API: the first `failures` requests answer `status` with `code`, the rest `MEMBERS`. */
const stub = (failures: number, status: number, code: string, body: unknown = MEMBERS) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{
          readonly url: string;
          readonly requests: () => number;
          readonly server: NodeHttp.Server;
        }>((resolve) => {
          let requests = 0;
          const server = NodeHttp.createServer((_, response) => {
            requests += 1;
            const failing = requests <= failures;
            response.writeHead(failing ? status : 200, { "content-type": "application/json" });
            response.end(JSON.stringify(failing ? { error: { code } } : body));
          });
          server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as NodeNet.AddressInfo;
            resolve({ url: `http://127.0.0.1:${String(port)}`, requests: () => requests, server });
          });
        }),
    ),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

const read = (url: string, read: "members" | "project") =>
  Effect.gen(function* () {
    const client = yield* Layer.build(NodeHttpClient.layerNodeHttp);
    const api = yield* makeZeropsApiHttp(url).pipe(Effect.provide(client));
    const credential = Redacted.make("token");
    const effect: Effect.Effect<unknown, ZeropsError> =
      read === "members" ? api.members("ORG")(credential) : api.project("P1")(credential);
    // The rows, or the failure's tag and reason.
    return yield* effect.pipe(
      Effect.match({
        onSuccess: (value): unknown => value,
        onFailure: (error) => (error._tag === "ZeropsRefused" ? error.reason : error._tag),
      }),
    );
  });

// Karel (2026-10-03): nothing is tried twice — a read too. One that does not answer is the caller's
// answer; HQ reads a handle again on its own cadence, never here.
describe("makeZeropsApiHttp", () => {
  it.live("answers user/list's spurious 400 userNotFound as unavailable, asking once", () =>
    Effect.gen(function* () {
      const api = yield* stub(1, 400, "userNotFound");
      assert.strictEqual(yield* read(api.url, "members"), "ZeropsUnavailable");
      assert.strictEqual(api.requests(), 1);
    }),
  );

  for (const [avatar, expected] of [
    [
      { smallAvatarUrl: null, externalAvatarUrl: "https://avatar.test/external" },
      "https://avatar.test/external",
    ],
    [{ smallAvatarUrl: null, externalAvatarUrl: null }, null],
    [null, null],
  ] as const) {
    it.live(`decodes nested member avatar ${JSON.stringify(avatar)}`, () =>
      Effect.gen(function* () {
        const api = yield* stub(0, 200, "", {
          clientUserList: [{ ...MEMBERS.clientUserList[0], user: { fullName: "Member", avatar } }],
        });
        const rows = yield* read(api.url, "members");
        assert.strictEqual((rows as Array<{ avatarUrl: string | null }>)[0]!.avatarUrl, expected);
      }),
    );
  }

  it.live("reads the member list in one ask", () =>
    Effect.gen(function* () {
      const api = yield* stub(0, 200, "");
      assert.deepStrictEqual(yield* read(api.url, "members"), [
        {
          name: "mate-hq-org:P1",
          kind: "token",
          roleCode: "READ_ONLY",
          status: "ACTIVE",
          userId: "T1",
          clientUserId: "C1",
          canCreateProjects: false,
          avatarUrl: "https://avatar.test/member",
        },
      ]);
      assert.strictEqual(api.requests(), 1);
    }),
  );

  it.live("answers a 503 as unavailable, asking once, and a verdict such as projectNotFound", () =>
    Effect.gen(function* () {
      const flaky = yield* stub(1, 503, "");
      assert.strictEqual(yield* read(flaky.url, "members"), "ZeropsUnavailable");
      assert.strictEqual(flaky.requests(), 1);
      const missing = yield* stub(100, 400, "projectNotFound");
      assert.strictEqual(yield* read(missing.url, "project"), "not_found");
      assert.strictEqual(missing.requests(), 1);
      const removed = yield* stub(100, 410, "");
      assert.strictEqual(yield* read(removed.url, "project"), "not_found");
    }),
  );
});

interface Heard {
  readonly method: string;
  readonly path: string;
  readonly contentType: string | undefined;
  readonly authorization: string | undefined;
  readonly body: string;
}

/** A stub API that records every request and answers each by `answer`. */
const recording = (answer: (heard: Heard) => readonly [status: number, body: unknown]) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{
          readonly url: string;
          readonly heard: Array<Heard>;
          readonly server: NodeHttp.Server;
        }>((resolve) => {
          const heard: Array<Heard> = [];
          const server = NodeHttp.createServer((request, response) => {
            const chunks: Array<Buffer> = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
              const one: Heard = {
                method: request.method ?? "",
                path: request.url ?? "",
                contentType: request.headers["content-type"],
                authorization: request.headers.authorization,
                body: Buffer.concat(chunks).toString("latin1"),
              };
              heard.push(one);
              const [status, body] = answer(one);
              response.writeHead(status, { "content-type": "application/json" });
              response.end(JSON.stringify(body));
            });
          });
          server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as NodeNet.AddressInfo;
            resolve({ url: `http://127.0.0.1:${String(port)}`, heard, server });
          });
        }),
    ),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

const deployOver = (url: string) =>
  Effect.flatMap(Layer.build(NodeHttpClient.layerNodeHttp), (client) =>
    makeZeropsDeployHttp(url).pipe(Effect.provide(client)),
  );

describe("makeZeropsDeployHttp", () => {
  // The rig's own flow (`nastroje/rig/hq-deploy.mjs`), with the environment's token.
  it.live("deploys as the rig does: a named version, its archive, its build with the setup", () =>
    Effect.gen(function* () {
      const api = yield* recording((heard) =>
        heard.method === "GET"
          ? [200, { status: "FAILED", error: { code: "buildFailed", message: "Build failed" } }]
          : [200, { id: heard.path.includes("build-and-deploy") ? "PROC-1" : "AV-1" }],
      );
      const deploy = yield* deployOver(api.url);
      const key = Redacted.make("env-key");
      const version = yield* deploy.createAppVersion("SVC-1", "main 7e2d4c1")(key);
      yield* deploy.upload(version.id, new Uint8Array([0x1f, 0x8b, 0x08]))(key);
      const job = yield* deploy.buildAndDeploy(version.id, "zerops: []\n", "web")(key);
      const read = yield* deploy.process(job.processId)(key);
      assert.deepStrictEqual(
        [version, job, read],
        [{ id: "AV-1" }, { processId: "PROC-1" }, { status: "FAILED", failure: "Build failed" }],
      );
      assert.deepStrictEqual(
        api.heard.map(({ method, path, contentType, body }) => ({
          method,
          path,
          contentType,
          body,
        })),
        [
          {
            method: "POST",
            path: "/service-stack/SVC-1/app-version",
            contentType: "application/json",
            body: '{"name":"main 7e2d4c1"}',
          },
          {
            method: "PUT",
            path: "/app-version/AV-1/upload",
            contentType: "application/octet-stream",
            body: "\u001f\u008b\u0008",
          },
          {
            method: "PUT",
            path: "/app-version/AV-1/build-and-deploy",
            contentType: "application/json",
            body: '{"zeropsYaml":"zerops: []\\n","zeropsYamlSetup":"web"}',
          },
          { method: "GET", path: "/process/PROC-1", contentType: undefined, body: "" },
        ],
      );
      assert.isTrue(api.heard.every((heard) => heard.authorization === "Bearer env-key"));
    }),
  );

  // A recipe delta (main D15): services added to the environment's project.
  it.live("imports services into a project as the probe lib does", () =>
    Effect.gen(function* () {
      // As measured (2026-09-05): each service with the processes bringing it up.
      const api = yield* recording(() => [
        200,
        {
          projectId: "P1",
          projectName: "Shop - stage",
          serviceStacks: [
            { id: "S1", name: "api", processes: [{ id: "PR-1" }, { id: "PR-2" }] },
            { id: "S2", name: "cache" },
          ],
        },
      ]);
      const deploy = yield* deployOver(api.url);
      const imported = yield* deploy.importServices(
        "P1",
        "services:\n  - hostname: api\n  - hostname: cache\n",
      )(Redacted.make("env-key"));
      assert.deepStrictEqual(imported, {
        services: [
          { name: "api", processes: ["PR-1", "PR-2"] },
          { name: "cache", processes: [] },
        ],
      });
      assert.deepStrictEqual(
        api.heard.map(({ method, path, contentType, body }) => ({
          method,
          path,
          contentType,
          body,
        })),
        [
          {
            method: "POST",
            path: "/project/P1/service-stack/import",
            contentType: "application/json",
            body: '{"yaml":"services:\\n  - hostname: api\\n  - hostname: cache\\n"}',
          },
        ],
      );
    }),
  );

  it.live("asks a write once: a 503 is unavailable, never a second version", () =>
    Effect.gen(function* () {
      const api = yield* recording(() => [503, { error: { code: "" } }]);
      const deploy = yield* deployOver(api.url);
      const error = yield* Effect.flip(
        deploy.createAppVersion("SVC-1", "main 7e2d4c1")(Redacted.make("env-key")),
      );
      assert.strictEqual(error._tag, "ZeropsUnavailable");
      assert.strictEqual(api.heard.length, 1);
    }),
  );
});

describe("HQ's setup marker search", () => {
  for (const serviceId of ["zcp", null]) {
    it.live(
      `asks only for the setup key ${serviceId === null ? "in its project" : "on its container"}`,
      () =>
        Effect.gen(function* () {
          const source = yield* recording(() => [200, { items: [], totalHits: 0 }]);
          const client = yield* Layer.build(NodeHttpClient.layerNodeHttp);
          const api = yield* makeZeropsApiHttp(source.url).pipe(Effect.provide(client));
          yield* api.mateSetupMarker("ORG", "Ada", serviceId)(Redacted.make("token"));
          assert.strictEqual(source.heard.length, 1);
          const request = source.heard[0]!;
          assert.strictEqual(request.method, "POST");
          assert.strictEqual(request.path, "/user-data/search");
          assert.deepStrictEqual(readRequestBody(request.body), {
            search: [
              { name: "clientId", operator: "eq", value: "ORG" },
              { name: "projectId", operator: "eq", value: "Ada" },
              ...(serviceId === null
                ? []
                : [{ name: "serviceStackId", operator: "eq", value: serviceId }]),
              { name: "key", operator: "eq", value: "MATE_SETUP_RUNTIMES" },
            ],
            sort: [],
            limit: 1,
          });
        }),
    );
  }
  for (const [name, body, serviceId, want] of [
    [
      "present (content never decoded)",
      { items: [{ key: "MATE_SETUP_RUNTIMES", content: { secret: "ignored" } }], totalHits: 1 },
      "zcp",
      true,
    ],
    ["absent on a bound container", { items: [], totalHits: 0 }, "zcp", false],
    ["complete absence on an unbound legacy record", { items: [], totalHits: 0 }, null, false],
    ["partial coverage", { items: [], totalHits: 1 }, "zcp", null],
    ["corrupt answer", { items: [] }, "zcp", "ZeropsUnavailable"],
  ] as const) {
    it.live(name, () =>
      Effect.gen(function* () {
        const source = yield* stub(0, 200, "", body);
        const client = yield* Layer.build(NodeHttpClient.layerNodeHttp);
        const api = yield* makeZeropsApiHttp(source.url).pipe(Effect.provide(client));
        const value = yield* api
          .mateSetupMarker(
            "ORG",
            "Ada",
            serviceId,
          )(Redacted.make("token"))
          .pipe(Effect.catch((error) => Effect.succeed(error._tag)));
        assert.strictEqual(value, want);
        assert.strictEqual(source.requests(), 1);
      }),
    );
  }
  for (const [status, want] of [
    [403, "ZeropsRefused"],
    [503, "ZeropsUnavailable"],
  ] as const) {
    it.live(`classifies ${String(status)} without retrying`, () =>
      Effect.gen(function* () {
        const source = yield* stub(1, status, "insufficientPermissions");
        const client = yield* Layer.build(NodeHttpClient.layerNodeHttp);
        const api = yield* makeZeropsApiHttp(source.url).pipe(Effect.provide(client));
        const value = yield* api
          .mateSetupMarker(
            "ORG",
            "Ada",
            "zcp",
          )(Redacted.make("token"))
          .pipe(Effect.catch((error) => Effect.succeed(error._tag)));
        assert.strictEqual(value, want);
        assert.strictEqual(source.requests(), 1);
      }),
    );
  }
});
