// @effect-diagnostics nodeBuiltinImport:off -- the scenario's Core is a scoped external process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { WebSocket } from "ws";
import { makeHttpCall } from "./httpCall.ts";
import type { FakeWorld } from "./fakeWorld.ts";
import { deadline } from "./http.ts";

type Message = { readonly type: string; readonly [field: string]: unknown };
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/** Match the scenario's link operations, waiting on wire receipts rather than polling. */
const openLink = (origin: string, path: string) =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(`${origin.replace("http:", "ws:")}${path}`)),
      (socket) => Effect.sync(() => socket.terminate()),
    );
    const messages: Message[] = [];
    const changed = new Set<() => void>();
    let opened = false;
    let closed: number | undefined;
    const pings = { seen: 0, answering: true };
    let failure: Error | undefined;
    const notify = () => {
      for (const listener of changed) listener();
    };
    socket.on("open", () => {
      opened = true;
      notify();
    });
    socket.on("error", (error) => {
      failure = error;
      notify();
    });
    socket.on("close", (code) => {
      closed = code;
      failure = new Error(`External Core link closed (${code})`);
      notify();
    });
    socket.on("message", (frame) => {
      try {
        const message = decodeJson(frame.toString()) as Message;
        if (message.type === "ping") {
          pings.seen += 1;
          if (pings.answering) socket.send(encodeJson({ type: "pong" }));
        } else {
          // This driver is the fake Mate peer: consuming a ticket includes its wire receipt.
          if (path.split("?")[0] === "/api/mate/link" && message.type === "ticket") {
            socket.send(encodeJson({ type: "ticket-ack", ticket: message.ticket }));
          }
          messages.push(message);
        }
      } catch (error) {
        failure = new Error(`Invalid external Core link frame: ${String(error)}`);
      }
      notify();
    });
    const waitFor = <A>(read: () => A | undefined, what: string) =>
      Effect.promise(async () => {
        let listener: (() => void) | undefined;
        try {
          return await deadline(
            new Promise<A>((resolve, reject) => {
              listener = () => {
                const value = read();
                if (value !== undefined) {
                  changed.delete(listener!);
                  resolve(value);
                } else if (failure !== undefined) {
                  changed.delete(listener!);
                  reject(failure);
                }
              };
              changed.add(listener);
              listener();
            }),
            `External Core link ${what}`,
          );
        } finally {
          if (listener !== undefined) changed.delete(listener);
        }
      });
    yield* waitFor(() => (opened ? true : undefined), "open");
    const takeWhere = (what: string, matches: (message: Message) => boolean) =>
      waitFor(() => {
        const index = messages.findIndex(matches);
        return index < 0 ? undefined : messages.splice(index, 1)[0];
      }, what);
    return {
      opened,
      pings,
      pinged: (count: number) =>
        waitFor(() => (pings.seen >= count ? pings.seen : undefined), "ping"),
      takeWhere,
      take: (type: string) =>
        takeWhere(type, (message) => message.type === type).pipe(
          Effect.map(({ type: _type, ...rest }) => rest),
        ),
      next: (type: string) =>
        waitFor(() => {
          const index = messages.findIndex((message) => message.type === type);
          return index < 0 ? undefined : messages.splice(0, index + 1).at(-1);
        }, type).pipe(Effect.map(({ type: _type, ...rest }) => rest)),
      close: Effect.sync(() => socket.close()),
      closedWith: waitFor(() => closed, "close"),
      collected: Effect.sync(() => [...messages]),
      send: (message: unknown) => Effect.sync(() => socket.send(encodeJson(message))),
    };
  });

/** Where the Core reaches GitHub: its REST API and the Git host map (`HQ_GITHUB_API`, `HQ_GITHUB_GIT_URL`). */
export interface GithubAddress {
  readonly api: string;
  readonly gitUrl: string;
}

/** Hold the Core's wait clock from before its start so socket timers do not depend on wall time. */
const heldWaitClock = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-core-clock-"))),
    (dir) => Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })),
  );
  const file = NodePath.join(dir, "now");
  const at = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() => NodeFSP.writeFile(file, String(at)));
  return file;
});

/**
 * The command owns the Core; its readiness line means HTTP is active and names the Core's
 * database (as its owner), the wait clock it honours and each instance's own origin. It also takes one control command per
 * stdin line and answers each with one line (`{"done":…}` or `{"error":…}`): `stop` ends the Core's
 * process, `start` launches it again on the same origin and database, `start-new-build` as a
 * redeployed Core.
 */
export const startExternalCore = (
  command: string,
  zeropsHttp: {
    readonly baseUrl: string;
    readonly world: FakeWorld;
    readonly github?: GithubAddress;
  },
) =>
  Effect.gen(function* () {
    const clock = yield* heldWaitClock;
    const env = {
      ...globalThis.process.env,
      HQ_BUILD_COMMIT: "1",
      HQ_ZEROPS_API: zeropsHttp.baseUrl,
      ...(zeropsHttp.github === undefined
        ? {}
        : { HQ_GITHUB_API: zeropsHttp.github.api, HQ_GITHUB_GIT_URL: zeropsHttp.github.gitUrl }),
      HQ_TEST_WAIT_CLOCK_FILE: clock,
      HQ_MATE_LINK_PING_MS: "20000",
      HQ_STREAM_PING_MS: "20000",
    };
    const process = yield* Effect.acquireRelease(
      Effect.sync(() => {
        // exec makes the captured child PID the command itself, including during cancellation.
        // Detached, it leads its own process group, which is how stop reaches every process the
        // launcher started, not only the launcher.
        const child = NodeChildProcess.spawn("/bin/sh", ["-c", `exec ${command}`], {
          env,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const pid = child.pid;
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr = (stderr + chunk).slice(-16_384);
        });
        const exit = new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`External Core exited (${code ?? signal}): ${stderr}`));
          });
        });
        // The readiness waiter and finalizer both observe this promise, even on early exit.
        void exit.catch(() => {});
        const lines = NodeReadline.createInterface({ input: child.stdout });
        const ready = new Promise<{
          origin: string;
          database: string;
          instances: ReadonlyArray<string>;
        }>((resolve, reject) => {
          lines.once("line", (line) => {
            try {
              const message = decodeJson(line) as {
                origin?: unknown;
                database?: unknown;
                clock?: unknown;
                instances?: unknown;
              };
              const httpOrigin = (value: unknown, what: string) => {
                if (typeof value !== "string") throw new Error(`${what} is missing`);
                const url = new URL(value);
                if (url.protocol !== "http:") throw new Error(`${what} must use HTTP`);
                return url.origin;
              };
              const origin = httpOrigin(message.origin, "origin");
              if (typeof message.database !== "string") throw new Error("database is missing");
              if (message.clock !== clock)
                throw new Error("the Core does not honour HQ_TEST_WAIT_CLOCK_FILE");
              if (!Array.isArray(message.instances)) throw new Error("instances are missing");
              const instances = (message.instances as unknown[]).map((instance, index) =>
                httpOrigin(
                  typeof instance === "object" && instance !== null && "origin" in instance
                    ? instance.origin
                    : undefined,
                  `instance ${index}'s origin`,
                ),
              );
              resolve({ origin, database: message.database, instances });
            } catch (error) {
              reject(new Error(`External Core readiness line is invalid: ${String(error)}`));
            }
          });
          void exit.then(
            () => reject(new Error(`External Core exited before readiness: ${stderr}`)),
            reject,
          );
        });
        // Only the group of the PID captured above is signalled; never a process-name match.
        // The group id stays reserved while any member lives, so a launcher that already exited
        // still leaves a group to signal; an empty group is the success case.
        const killGroup = () => {
          if (pid === undefined) return;
          try {
            globalThis.process.kill(-pid, "SIGKILL");
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ESRCH" && code !== "EPERM") throw error;
          }
        };
        let stopping: Promise<void> | undefined;
        const stop = Effect.promise(
          () =>
            (stopping ??= (async () => {
              child.stdin.end();
              try {
                await deadline(exit, "External Core shutdown");
              } catch (error) {
                killGroup();
                await exit.catch(() => {});
                throw error;
              } finally {
                // The launcher may exit while the processes it started live on.
                killGroup();
                lines.close();
              }
            })()),
        );
        // Answers come in the order the commands went out.
        const answers: Array<(line: string) => void> = [];
        lines.on("line", (line) => answers.shift()?.(line));
        const control = (name: "stop" | "start" | "start-new-build") =>
          Effect.promise(() =>
            deadline(
              new Promise<void>((resolve, reject) => {
                answers.push((line) => {
                  const answer = decodeJson(line) as { error?: unknown };
                  if (answer.error === undefined) resolve();
                  else reject(new Error(`External Core refused ${name}: ${String(answer.error)}`));
                });
                child.stdin.write(`${name}\n`);
              }),
              `External Core ${name}`,
            ),
          );
        return { child, lines, ready, exit, stop, control };
      }),
      ({ stop }) => stop,
    );
    const { origin, database, instances } = yield* Effect.promise(() =>
      deadline(process.ready, "External Core readiness"),
    );
    return {
      origin,
      /** Each Core instance's own origin, in index order; `origin` is the one in front of them. */
      instances,
      /** The Core's database as its owner, for a case's held row state. */
      url: database,
      call: makeHttpCall(new URL(origin).host),
      fake: zeropsHttp.world,
      stop: process.stop,
      /** The Core's process down, then up again on its origin: as it was, or as a redeployed build. */
      control: process.control,
      socket: (path: string) => openLink(origin, path),
    };
  });
