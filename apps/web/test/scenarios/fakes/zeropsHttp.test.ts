// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- real Core HTTP adapters against loopback.
import { WebSocket } from "ws";
import { expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import {
  makeZeropsApiHttp,
  makeZeropsDeployHttp,
  makeZeropsObservationHttp,
} from "../../../../hq/src/zerops/http.ts";
import { seedCoreWorld } from "../../../../hq/test/harness/runningCore.ts";
import { ZeropsFake } from "./zerops.ts";
import { serve, deadline } from "../harness/http.ts";

const rig = Effect.fn("zeropsHttp.rig")(function* () {
  const fake = new ZeropsFake(seedCoreWorld(yield* Clock.currentTimeMillis, true, "ORG"));
  const server = yield* Effect.acquireRelease(
    Effect.promise(() => serve(fake.handle, fake.socket)),
    (server) => Effect.promise(server.close),
  );
  fake.origin = server.origin;
  fake.people.set("door-owner", "owner");
  return { fake, server, base: `${server.origin}/api/rest/public` };
});

it.layer(NodeHttpClient.layerNodeHttp, { excludeTestServices: true })((it) => {
  it.effect("real HTTP deploy/import/observation adapters write the shared realtime world", () =>
    Effect.gen(function* () {
      const { fake, server, base } = yield* rig();
      fake.put("service-stack", {
        id: "runtime",
        name: "runtime",
        projectId: "P_MATE",
        clientId: "ORG",
        status: "ACTIVE",
      });
      const login = yield* Effect.promise(
        async () =>
          (
            await fetch(`${base}/web-socket/login`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ token: "door-owner" }),
            })
          ).json() as Promise<{ webSocketToken: string }>,
      );
      const socket = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WebSocket(
              `${server.origin.replace("http:", "ws:")}/web-socket/deploy/${login.webSocketToken}`,
            ),
        ),
        (socket) => Effect.sync(() => socket.terminate()),
      );
      const frames: Record<string, unknown>[] = [];
      const opened = deadline(
        new Promise<void>((resolve) => socket.once("message", () => resolve())),
        "deployment receiver",
      );
      let finished = () => {};
      const delivered = new Promise<void>((resolve) => {
        finished = resolve;
      });
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as {
          data?: { update?: Record<string, unknown>[] };
        };
        for (const row of frame.data?.update ?? []) {
          frames.push(row);
          if (row.status === "FINISHED") finished();
        }
      });
      yield* Effect.promise(() => opened);
      yield* Effect.promise(() =>
        fetch(`${base}/process/search`, {
          method: "POST",
          headers: { authorization: "Bearer door-owner", "content-type": "application/json" },
          body: JSON.stringify({
            receiverId: "deploy",
            subscriptionName: "jobs",
            wsOutputType: "updateStream",
            search: [{ name: "clientId", operator: "eq", value: "ORG" }],
          }),
        }),
      );
      const api = yield* makeZeropsApiHttp(base);
      const deploy = yield* makeZeropsDeployHttp(base);
      const observation = yield* makeZeropsObservationHttp(base);
      const credential = Redacted.make("door-owner");
      const { id } = yield* deploy.createAppVersion("runtime", "release-1")(credential);
      yield* deploy.upload(id, new Uint8Array([0, 127, 255]))(credential);
      const { processId } = yield* deploy.buildAndDeploy(id, "yaml", "setup")(credential);
      const started = fake.rows("process").find((row) => row.id === processId)!;
      expect(started).toMatchObject({
        projectId: "P_MATE",
        actionName: "service-stack.build-and-deploy",
        status: "RUNNING",
        _version: 3,
      });
      expect(started.started).not.toBeNull();
      expect((yield* deploy.process(processId)(credential)).status).toBe("FINISHED");
      expect(fake.rows("process").find((row) => row.id === processId)).toMatchObject({
        status: "FINISHED",
        _version: 4,
      });
      expect(Array.from(fake.world.appVersions.get(id)!.archive!)).toEqual([0, 127, 255]);
      expect((yield* api.service("runtime")(credential)).activeVersionId).toBe(id);
      expect(yield* observation.activeVersion(id)(credential)).toEqual({ id, name: "release-1" });
      expect(yield* observation.logs("P_MATE", "runtime", 10)(credential)).toEqual([]);
      const imported = yield* deploy.importServices(
        "P_MATE",
        "services:\n  - hostname: worker\n    type: nodejs@22\n",
      )(credential);
      const importedId = imported.services[0]!.processes[0]!;
      expect((yield* deploy.process(importedId)(credential)).status).toBe("FINISHED");
      expect(fake.rows("service-stack").find((row) => row.name === "worker")).toMatchObject({
        status: "ACTIVE",
      });
      fake.writes.transition(importedId, "CANCELLED");
      expect((yield* deploy.process(importedId)(credential)).status).toBe("CANCELED");
      expect(
        fake.requestsByCredential
          .get("door-owner")
          ?.get("POST /project/P_MATE/service-stack/import"),
      ).toBe(1);
      yield* Effect.promise(() => deadline(delivered, "HTTP deploy realtime FINISHED"));
      expect(frames.slice(0, 3).map((row) => [row.status, row._version])).toEqual([
        ["PENDING", 2],
        ["RUNNING", 3],
        ["FINISHED", 4],
      ]);
      expect(frames[2]).toMatchObject({
        projectId: "P_MATE",
        actionName: "service-stack.build-and-deploy",
        finished: expect.any(String),
      });
    }),
  );

  it.effect(
    "the real HTTP API classifies measured refusals, 429 and 5xx and spends counted HTTP requests",
    () =>
      Effect.gen(function* () {
        const { fake, base } = yield* rig();
        const api = yield* makeZeropsApiHttp(base);
        expect(yield* api.project("gone")(Redacted.make("hq")).pipe(Effect.flip)).toMatchObject({
          _tag: "ZeropsRefused",
          reason: "not_found",
          status: 400,
          code: "projectNotFound",
        });
        expect(yield* api.project("HQ1")(Redacted.make("revoked")).pipe(Effect.flip)).toMatchObject(
          { _tag: "ZeropsRefused", reason: "unauthorized", status: 401, code: "notAuthorized" },
        );
        for (const [status, reason] of [
          [403, "forbidden"],
          [429, "unavailable"],
          [503, "unavailable"],
        ] as const) {
          fake.faults.set("GET /project/HQ1", { status, retryAfter: 7 });
          const error = yield* api.project("HQ1")(Redacted.make("hq")).pipe(Effect.flip);
          expect(error._tag).toBe(reason === "unavailable" ? "ZeropsUnavailable" : "ZeropsRefused");
          if (error._tag === "ZeropsRefused") expect(error.reason).toBe(reason);
        }
        expect(fake.requestsByCredential.get("hq")?.get("GET /project/HQ1")).toBe(3);
      }),
  );

  it.effect("the real HTTP API waits on admitted fake latency", () =>
    Effect.gen(function* () {
      const { fake, base } = yield* rig();
      const api = yield* makeZeropsApiHttp(base);
      fake.faults.set("GET /project/P_MATE", { latency: 5000 });
      const request = yield* api.project("P_MATE")(Redacted.make("hq")).pipe(Effect.forkChild);
      yield* Effect.promise(() => fake.waitForRequest("GET /project/P_MATE"));
      fake.clock.advance(4999);
      expect(request.pollUnsafe()).toBeUndefined();
      fake.clock.advance(1);
      expect((yield* Fiber.join(request)).id).toBe("P_MATE");
    }),
  );
});
