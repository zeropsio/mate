// @effect-diagnostics nodeBuiltinImport:off -- process and network are the fixture's public boundary.
import { expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { emptyWorld } from "../harness/fakeWorld.ts";
import { startExternalCore } from "../harness/externalCore.ts";
import { serve } from "../harness/http.ts";

/** The kernel's view of a PID: a process that only awaits reaping (state Z) is dead. */
const alive = (pid: number) => {
  const state = NodeChildProcess.spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  }).stdout.trim();
  return state !== "" && !state.startsWith("Z");
};

const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

it.effect.each([0, 23])(
  "external Core uses the caller's Zerops API and awaits shutdown with exit code %s",
  (exitCode) =>
    Effect.gen(function* () {
      let stopped = false;
      const api = yield* Effect.acquireRelease(
        Effect.promise(() =>
          serve(() => {
            stopped = true;
            return { body: {} };
          }),
        ),
        (api) => Effect.promise(api.close),
      );
      const script = `
      const http = require("node:http");
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ api: process.env.HQ_ZEROPS_API }));
      });
      server.listen(0, "127.0.0.1", () => {
        // The readiness line of scripts/test-hq.ts: its database and the wait clock it honours.
        process.stdout.write(JSON.stringify({
          origin: "http://127.0.0.1:" + server.address().port,
          database: "postgres://127.0.0.1/stub",
          clock: process.env.HQ_TEST_WAIT_CLOCK_FILE,
        }) + "\\n");
      });
      process.stdin.resume();
      process.stdin.once("end", async () => {
        await fetch(process.env.HQ_ZEROPS_API + "/stopped");
        server.close(() => { process.exitCode = ${exitCode}; });
      });
    `;
      const result = yield* Effect.exit(
        Effect.gen(function* () {
          const core = yield* startExternalCore(`${quote(process.execPath)} -e ${quote(script)}`, {
            baseUrl: api.origin,
            world: emptyWorld(),
          });
          const answer = yield* core.call("GET", "/");
          expect(answer.status).toBe(200);
          expect(answer.body).toEqual({ api: api.origin });
        }).pipe(Effect.scoped),
      );
      if (exitCode === 0) expect(Exit.isSuccess(result)).toBe(true);
      else {
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result))
          expect(Cause.pretty(result.cause)).toContain("External Core exited (23)");
      }
      expect(stopped, "the command's shutdown receipt arrives before the scope closes").toBe(true);
    }).pipe(Effect.scoped),
);

it.effect("external Core calls survive the server ending an idle connection without retrying", () =>
  Effect.gen(function* () {
    let connections = 0;
    let requests = 0;
    let idle: NodeNet.Socket | undefined;
    const connectionIds = new WeakMap<NodeNet.Socket, number>();
    const server = NodeHttp.createServer((req, res) => {
      idle = req.socket;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          connection: connectionIds.get(req.socket),
          request: ++requests,
          ...(req.url === "/first" ? {} : { method: req.method, path: req.url }),
        }),
      );
    });
    server.on("connection", (socket) => connectionIds.set(socket, ++connections));
    yield* Effect.acquireRelease(
      Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))),
      () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    const origin = `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`;
    const script = `
      process.stdout.write(JSON.stringify({
          origin: ${JSON.stringify(origin)},
          database: "postgres://127.0.0.1/stub",
          clock: process.env.HQ_TEST_WAIT_CLOCK_FILE,
        }) + "\\n");
      process.stdin.resume();
      process.stdin.once("end", () => process.exit(0));
    `;
    const core = yield* startExternalCore(`${quote(process.execPath)} -e ${quote(script)}`, {
      baseUrl: "http://127.0.0.1:1",
      world: emptyWorld(),
    });
    const first = yield* core.call("GET", "/first");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ connection: 1, request: 1 });
    // Half-close the idle server socket before the client has received its FIN, then call again
    // in the same turn. The fresh connection must carry the next request, without replaying it.
    idle!.end();
    const next = yield* Effect.exit(
      core.call("PATCH", "/api/apps/project", { body: { name: "HQ returned" } }),
    );
    expect(
      Exit.isSuccess(next),
      `ASSERTION: The next Core call must use a fresh connection after the server's half-close${Exit.isFailure(next) ? `: ${Cause.pretty(next.cause)} (${(Cause.squash(next.cause) as NodeJS.ErrnoException).code})` : ""}`,
    ).toBe(true);
    if (Exit.isSuccess(next)) {
      expect(next.value.status).toBe(200);
      expect(next.value.body).toEqual({
        connection: 2,
        request: 2,
        method: "PATCH",
        path: "/api/apps/project",
      });
    }
  }).pipe(Effect.scoped),
);

it.effect("a scenario's external Core leaves no process behind when it is stopped", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "core-pgroup-"))),
      (dir) => Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })),
    );
    const socketPath = NodePath.join(dir, "held");
    // The held child reports "<pid> <launcher pid>" and keeps the connection until it dies.
    const held = Promise.withResolvers<{ child: number; launcher: number }>();
    const closed = Promise.withResolvers<void>();
    const server = NodeNet.createServer((connection) => {
      connection.once("data", (data) => {
        const [child, launcher] = data.toString().split(" ").map(Number);
        held.resolve({ child: child!, launcher: launcher! });
      });
      connection.once("close", () => closed.resolve());
    });
    yield* Effect.acquireRelease(
      Effect.promise(() => new Promise<void>((resolve) => server.listen(socketPath, resolve))),
      () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    const childScript = `
      process.on("SIGTERM", () => {});
      const socket = require("node:net").connect(${JSON.stringify(socketPath)}, () =>
        socket.write(process.pid + " " + process.ppid));
      setInterval(() => {}, 1 << 30);
    `;
    const script = `
      const http = require("node:http");
      require("node:child_process")
        .spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" })
        .unref();
      const server = http.createServer();
      server.listen(0, "127.0.0.1", () => {
        process.stdout.write(JSON.stringify({
          origin: "http://127.0.0.1:" + server.address().port,
          database: "postgres://127.0.0.1/stub",
          clock: process.env.HQ_TEST_WAIT_CLOCK_FILE,
        }) + "\\n");
      });
      process.stdin.resume();
      process.stdin.once("end", () => process.exit(0));
    `;
    yield* Effect.gen(function* () {
      const core = yield* startExternalCore(`${quote(process.execPath)} -e ${quote(script)}`, {
        baseUrl: "http://127.0.0.1:1",
        world: emptyWorld(),
      });
      const pids = yield* Effect.promise(() => held.promise);
      expect(alive(pids.child), "the held child runs before the stop").toBe(true);
      yield* core.stop;
      yield* Effect.promise(() => closed.promise);
      expect(alive(pids.child), "the child ignoring SIGTERM is gone").toBe(false);
      expect(alive(pids.launcher), "the launcher is gone").toBe(false);
    }).pipe(Effect.scoped);
  }).pipe(Effect.scoped),
);
