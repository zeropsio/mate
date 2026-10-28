// @effect-diagnostics nodeBuiltinImport:off -- the scenario's Core is a scoped external process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
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

const definedOf = <T extends object>(values: T) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

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

/** The real Core's own periods, which a scenario's timings override (`HQ_*_MS` in its launch). */
export const REAL_CORE_DEFAULTS = {
  pingEvery: 20_000,
  reconcileEvery: 30_000,
  streamRecheck: 30_000,
  viewRefresh: 300_000,
};

/**
 * The Core's wait clock (`HQ_TEST_WAIT_CLOCK_FILE`), held from before its start: its socket pings,
 * session and role rechecks and linked organisations' view refreshes come only when a case moves it
 * past their period, never by wall time. `waits` are the periods the Core started waiting out on it (`<file>.waits`), in order.
 */
const heldWaitClock = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-core-clock-"))),
    (dir) => Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })),
  );
  const file = NodePath.join(dir, "now");
  let at = yield* Clock.currentTimeMillis;
  // One rename per move, so the Core never reads a half-written instant.
  const write = async () => {
    await NodeFSP.writeFile(`${file}.next`, String(at));
    await NodeFSP.rename(`${file}.next`, file);
  };
  yield* Effect.promise(write);
  yield* Effect.promise(() => NodeFSP.writeFile(`${file}.waits`, ""));
  const waits = () =>
    NodeFS.readFileSync(`${file}.waits`, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map(Number);
  return {
    file,
    /** Moves the held instant `ms` on: every wait of at most that much the Core began ends. */
    advance: (ms: number) =>
      Effect.promise(() => {
        at += ms;
        return write();
      }),
    /** The periods the Core started waiting out on the held clock so far, in order. */
    waits,
    /** Resolves with `waits()` once `ready` holds for them. */
    until: (ready: (waits: ReadonlyArray<number>) => boolean, what: string) =>
      Effect.promise(async () => {
        const watcher = NodeFS.watch(`${file}.waits`);
        try {
          await deadline(
            new Promise<void>((resolve) => {
              const check = () => {
                if (ready(waits())) resolve();
              };
              watcher.on("change", check);
              check();
            }),
            what,
          );
          return waits();
        } finally {
          watcher.close();
        }
      }),
  };
});

/**
 * The command owns the Core; its readiness line means HTTP is active and names the Core's
 * database (as its owner) and the wait clock it honours. It also takes one control command per
 * stdin line and answers each with one line (`{"done":…}` or `{"error":…}`): `stop` ends the Core's
 * process, `start` launches it again on the same origin and database, `start-new-build` as a
 * redeployed Core. A scenario's timings become the Core's
 * periods; the case moves the clock past one where it waits for it.
 */
export const startExternalCore = (
  command: string,
  zeropsHttp: {
    readonly baseUrl: string;
    readonly world: FakeWorld;
    readonly github?: GithubAddress;
  },
  timings: { pingEvery?: number; reconcileEvery?: number; streamRecheck?: number } = {},
) =>
  Effect.gen(function* () {
    const clock = yield* heldWaitClock;
    const periods = { ...REAL_CORE_DEFAULTS, ...definedOf(timings) };
    const env = {
      ...globalThis.process.env,
      HQ_ZEROPS_API: zeropsHttp.baseUrl,
      ...(zeropsHttp.github === undefined
        ? {}
        : { HQ_GITHUB_API: zeropsHttp.github.api, HQ_GITHUB_GIT_URL: zeropsHttp.github.gitUrl }),
      HQ_TEST_WAIT_CLOCK_FILE: clock.file,
      HQ_MATE_LINK_PING_MS: String(periods.pingEvery),
      HQ_STREAM_PING_MS: String(periods.pingEvery),
      HQ_RECONCILE_INTERVAL_MS: String(periods.reconcileEvery),
      HQ_STREAM_RECHECK_MS: String(periods.streamRecheck),
      HQ_ORG_VIEW_REFRESH_MS: String(periods.viewRefresh),
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
        const ready = new Promise<{ origin: string; database: string }>((resolve, reject) => {
          lines.once("line", (line) => {
            try {
              const message = decodeJson(line) as {
                origin?: unknown;
                database?: unknown;
                clock?: unknown;
              };
              if (typeof message.origin !== "string") throw new Error("origin is missing");
              const origin = new URL(message.origin);
              if (origin.protocol !== "http:") throw new Error("origin must use HTTP");
              if (typeof message.database !== "string") throw new Error("database is missing");
              if (message.clock !== clock.file)
                throw new Error("the Core does not honour HQ_TEST_WAIT_CLOCK_FILE");
              resolve({ origin: origin.origin, database: message.database });
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
          try {
            globalThis.process.kill(-child.pid!, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
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
    const { origin, database } = yield* Effect.promise(() =>
      deadline(process.ready, "External Core readiness"),
    );
    const agent = yield* Effect.acquireRelease(
      Effect.sync(() => new NodeHttp.Agent({ keepAlive: true })),
      (agent) => Effect.sync(() => agent.destroy()),
    );
    return {
      origin,
      /** The Core's database as its owner, for a case's held row state. */
      url: database,
      clock: { advance: clock.advance, waits: clock.waits, until: clock.until },
      periods,
      call: makeHttpCall(new URL(origin).host, agent),
      fake: zeropsHttp.world,
      stop: process.stop,
      /** The Core's process down, then up again on its origin: as it was, or as a redeployed build. */
      control: process.control,
      socket: (path: string) => openLink(origin, path),
    };
  });
