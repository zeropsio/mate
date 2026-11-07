import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ZeropsAccessReadModule from "./ZeropsAccessRead.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateAccessList from "./ZeropsMateAccessList.ts";
import { snapshotOnlyReader, ZeropsMateKey } from "./ZeropsMateKey.ts";
import { make, containerStartedAt } from "./ZeropsRestartRead.ts";

const environment = resolveZeropsEnvironment({
  projectId: "own-project",
  apiHost: undefined,
})!;
const process = { serviceStackId: "own-zcp", actionName: "stack.restart", status: "FINISHED" };

it.effect.each(
  Array.from([200, 401, 403, 500], (status) => ({
    title: `reads processes once with the Mate's key, without retries (${status})`,
    status,
  })),
)("$title", ({ status }) =>
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
        revision: Effect.succeed(0),
        changedSince: () => Effect.never,
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
    Effect.provideService(
      ZeropsMateAccessList.ZeropsMateAccessList,
      ZeropsMateAccessList.ZeropsMateAccessList.of({
        ownProject: Effect.succeed(
          Option.some({ name: "Fen", clientId: "org", overrides: {}, tagList: [] }),
        ),
      } as unknown as ZeropsMateAccessList.ZeropsMateAccessList["Service"]),
    ),
    Effect.provide(NodeServices.layer),
  ),
);

it.effect(
  "The Mate's project name and clientId come from the access list's live project document; no second read is cached 30 s.",
  () => {
    const requests: string[] = [];
    const http = HttpClient.make((request) => {
      requests.push(`${request.method} ${request.url}`);
      const body = request.url.endsWith("/project/own-project")
        ? { id: "own-project", name: "Fen", clientId: "org", userRoles: [], tagList: [] }
        : request.url.endsWith("/client-user/search")
          ? { items: [], totalHits: 0 }
          : { list: [process] };
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status: 200 })),
      );
    });
    const projectRead = `GET ${environment.apiBaseUrl}/project/own-project`;
    return Effect.gen(function* () {
      const read = yield* ZeropsAccessReadModule.ZeropsAccessRead;
      const access = yield* ZeropsMateAccessList.make({
        projectId: "own-project",
        read: read.read,
      });
      // The list's own read has landed: its report is the receipt.
      yield* access.reports.pipe(Stream.take(1), Stream.runDrain);
      const restart = yield* make({ serviceId: "own-zcp" }).pipe(
        Effect.provideService(ZeropsMateAccessList.ZeropsMateAccessList, access),
      );
      assert.equal((yield* restart.read).name, "Fen");
      assert.deepStrictEqual(
        Option.map(yield* access.ownProject, (own) => own.clientId),
        Option.some("org"),
      );
      // The access list's read is the only read of the project document.
      assert.deepStrictEqual(
        requests.filter((request) => request === projectRead),
        [projectRead],
      );
    }).pipe(
      Effect.provide(ZeropsAccessReadModule.layer(environment)),
      Effect.provideService(ZeropsMateKey, snapshotOnlyReader("test-mate-key")),
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
      Effect.provideService(ServerConfig.ServerConfig, {
        zerops: environment,
      } as ServerConfig.ServerConfig["Service"]),
      Effect.scoped,
    );
  },
);

it("uses PID 1's start time to distinguish container replacement from a Mate-only restart", () => {
  const fields = ["S", ...Array.from({ length: 18 }, () => "0"), "30000"];
  assert.equal(
    containerStartedAt(`1 (init (container)) ${fields.join(" ")}`, "btime 1791066600\n"),
    "2026-10-03T22:35:00.000Z",
  );
  assert.equal(containerStartedAt("unreadable", "btime 1791066600\n"), null);
  assert.equal(containerStartedAt(`22 (mate) ${fields.join(" ")}`, "btime 1791066600\n"), null);
});
