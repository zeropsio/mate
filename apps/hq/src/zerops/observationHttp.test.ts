// @effect-diagnostics nodeBuiltinImport:off -- the platform and its signed log backend are local HTTP stubs.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { makeZeropsObservationHttp } from "./http.ts";

const serve = (handler: NodeHttp.RequestListener) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ url: string; server: NodeHttp.Server }>((resolve) => {
          const server = NodeHttp.createServer(handler);
          server.listen(0, "127.0.0.1", () =>
            resolve({
              server,
              url: `http://127.0.0.1:${String((server.address() as NodeNet.AddressInfo).port)}`,
            }),
          );
        }),
    ),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

describe("HQ's bounded log transport", () => {
  it.live("keeps signed access and the deploy key in HQ, and projects bounded log entries", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const backend = yield* serve((req, res) => {
        const url = new URL(req.url ?? "", "http://local");
        assert.strictEqual(url.searchParams.get("serviceStackId"), "S1");
        assert.strictEqual(url.searchParams.get("limit"), "2");
        assert.strictEqual(url.searchParams.get("signature"), "signed-access");
        assert.isUndefined(req.headers.authorization);
        calls.push("backend");
        res.end(
          JSON.stringify({
            items: [1, 2, 3].map((n) => ({
              timestamp: `2026-10-04T12:00:0${String(n)}Z`,
              severityLabel: "info",
              message: "a".repeat(5000),
              secretField: "never",
            })),
          }),
        );
      });
      const platform = yield* serve((req, res) => {
        assert.strictEqual(req.url, "/project/P1/log");
        assert.strictEqual(req.headers.authorization, "Bearer deploy-key");
        calls.push("platform");
        res.end(JSON.stringify({ url: `GET ${backend.url}/logs?signature=signed-access` }));
      });
      const api = yield* makeZeropsObservationHttp(platform.url).pipe(
        Effect.provide(yield* Layer.build(NodeHttpClient.layerNodeHttp)),
      );
      const entries = yield* api.logs("P1", "S1", 2)(Redacted.make("deploy-key"));
      assert.deepStrictEqual(calls, ["platform", "backend"]);
      assert.strictEqual(entries.length, 2);
      assert.deepStrictEqual(Object.keys(entries[0]!).sort(), ["message", "severity", "timestamp"]);
      assert.strictEqual(entries[0]!.message.length, 4096);
    }),
  );
  it.live("reports a failed log backend once with no signed URL in the failure", () =>
    Effect.gen(function* () {
      let reads = 0;
      const backend = yield* serve((_, res) => {
        reads++;
        res.writeHead(503);
        res.end("signed-access");
      });
      const platform = yield* serve((_, res) =>
        res.end(JSON.stringify({ url: `${backend.url}/logs?signature=signed-access` })),
      );
      const api = yield* makeZeropsObservationHttp(platform.url).pipe(
        Effect.provide(yield* Layer.build(NodeHttpClient.layerNodeHttp)),
      );
      const failure = yield* api.logs("P1", "S1", 2)(Redacted.make("deploy-key")).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "ZeropsUnavailable");
      assert.strictEqual(reads, 1);
      assert.notInclude(failure.message, "signed-access");
    }),
  );
});

// `GET /app-version/{id}` as Zerops answers it (zerops-go `output.GetAppVersion`; read live
// 2026-10-16): no `name` — a deploy's name lives in its service's user data, never here.
const servingVersion = {
  id: "AV-SERVING",
  clientId: "CLIENT-1",
  projectId: "P1",
  serviceStackId: "S1",
  build: null,
  source: "CLI",
  sequence: 7,
  status: "ACTIVE",
  userDataList: [],
  created: "2026-10-16T08:41:02.000Z",
  lastUpdate: "2026-10-16T08:43:15.000Z",
  githubIntegration: null,
  gitlabIntegration: null,
  createdByUser: null,
  activationDate: "2026-10-16T08:43:10.000Z",
  publicGitSource: null,
};

describe("HQ's read of a service's active version", () => {
  const answering = (body: unknown) =>
    Effect.gen(function* () {
      const platform = yield* serve((req, res) => {
        assert.strictEqual(req.url, "/app-version/AV-SERVING");
        res.end(JSON.stringify(body));
      });
      const api = yield* makeZeropsObservationHttp(platform.url).pipe(
        Effect.provide(yield* Layer.build(NodeHttpClient.layerNodeHttp)),
      );
      return yield* api
        .activeVersion("AV-SERVING")(Redacted.make("deploy-key"))
        .pipe(Effect.match({ onFailure: (error) => error._tag, onSuccess: (read) => read }));
    });

  it.live("a Mate reads the active version of a service whose Zerops app version has no name", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* answering(servingVersion), {
        id: "AV-SERVING",
        activatedAt: "2026-10-16T08:43:10.000Z",
      });
    }),
  );
  it.live("a Zerops answer HQ cannot read is HQ's defect, never an outage to wait out", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* answering({ id: 7 }), "ZeropsUnexpectedAnswer");
    }),
  );
});
