import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsMateKey } from "./ZeropsMateKey.ts";
import { ZeropsOrgRead } from "./ZeropsOrgRead.ts";
import { make, containerStartedAt } from "./ZeropsRestartRead.ts";

const environment = resolveZeropsEnvironment({
  projectId: "own-project",
  apiHost: undefined,
})!;
const process = { serviceStackId: "own-zcp", actionName: "stack.restart", status: "FINISHED" };

for (const status of [200, 401, 403, 500]) {
  it.effect(`reads processes once with the Mate's key, without retries (${status})`, () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      let keyReads = 0;
      const reader = yield* make({ serviceId: "own-zcp" }).pipe(
        Effect.provideService(ZeropsMateKey, {
          read: Effect.sync(() => {
            keyReads++;
            return "test-mate-key";
          }),
          invalidate: Effect.die("must not retry"),
          lastSource: Effect.succeed("snapshot" as const),
        }),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            requests.push(request.url);
            assert.equal(
              request.url,
              `${environment.apiBaseUrl}/project/own-project/process?limit=1000`,
            );
            assert.equal(request.headers["authorization"], "Bearer test-mate-key");
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify({ list: [process] }), { status }),
              ),
            );
          }),
        ),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
      );
      const result = yield* reader.read.pipe(Effect.result);
      assert.equal(requests.length, 1);
      assert.equal(keyReads, 1);
      assert.equal(result._tag, status === 200 ? "Success" : "Failure");
      if (result._tag === "Success") {
        assert.deepStrictEqual(result.success, {
          name: "Fen",
          serviceId: "own-zcp",
          projectId: "own-project",
          processes: [process],
          containerStartedAt: null,
        });
      }
    }).pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        zerops: environment,
      } as ServerConfig.ServerConfig["Service"]),
      Effect.provideService(ZeropsOrgRead, {
        project: () =>
          Effect.succeed({ kind: "answered", status: 200, body: { name: "Fen", clientId: "org" } }),
        members: () => Effect.die("unused"),
      }),
      Effect.provide(NodeServices.layer),
    ),
  );
}

it("uses PID 1's start time to distinguish container replacement from a Mate-only restart", () => {
  const fields = ["S", ...Array.from({ length: 18 }, () => "0"), "30000"];
  assert.equal(
    containerStartedAt(`1 (init (container)) ${fields.join(" ")}`, "btime 1791066600\n"),
    "2026-10-03T22:35:00.000Z",
  );
  assert.equal(containerStartedAt("unreadable", "btime 1791066600\n"), null);
  assert.equal(containerStartedAt(`22 (mate) ${fields.join(" ")}`, "btime 1791066600\n"), null);
});
