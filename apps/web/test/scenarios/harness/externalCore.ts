// @effect-diagnostics nodeBuiltinImport:off -- the scenario's Core is a scoped external process.
import * as NodeChildProcess from "node:child_process";
import * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { WebSocket } from "ws";
import { makeHttpCall } from "../../../../hq/test/harness/httpCall.ts";
import type { FakeWorld } from "../../../../hq/test/harness/zeropsFake.ts";
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

/** The command owns timing configuration; its readiness line means HTTP is active. */
export const startExternalCore = (
  command: string,
  zeropsHttp: { readonly baseUrl: string; readonly world: FakeWorld },
  timings: { pingEvery?: number; reconcileEvery?: number; streamRecheck?: number } = {},
) =>
  Effect.gen(function* () {
    if (Object.values(timings).some((value) => value !== undefined)) {
      return yield* Effect.die(
        new Error("External Core command does not support scenario timing overrides"),
      );
    }
    const process = yield* Effect.acquireRelease(
      Effect.sync(() => {
        // exec makes the captured child PID the command itself, including during cancellation.
        const child = NodeChildProcess.spawn("/bin/sh", ["-c", `exec ${command}`], {
          env: { ...globalThis.process.env, HQ_ZEROPS_API: zeropsHttp.baseUrl },
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
        const ready = new Promise<string>((resolve, reject) => {
          lines.once("line", (line) => {
            try {
              const message = decodeJson(line) as { origin?: unknown };
              if (typeof message.origin !== "string") throw new Error("origin is missing");
              const origin = new URL(message.origin);
              if (origin.protocol !== "http:") throw new Error("origin must use HTTP");
              resolve(origin.origin);
            } catch (error) {
              reject(new Error(`External Core readiness line is invalid: ${String(error)}`));
            }
          });
          void exit.then(
            () => reject(new Error(`External Core exited before readiness: ${stderr}`)),
            reject,
          );
        });
        let stopping: Promise<void> | undefined;
        const stop = Effect.promise(
          () =>
            (stopping ??= (async () => {
              child.stdin.end();
              try {
                await deadline(exit, "External Core shutdown", 30_000);
              } catch (error) {
                // Only the PID created above is signalled; never a process-name match.
                if (child.exitCode === null && child.signalCode === null) {
                  child.kill("SIGKILL");
                  await exit.catch(() => {});
                }
                throw error;
              } finally {
                lines.close();
              }
            })()),
        );
        return { child, lines, ready, exit, stop };
      }),
      ({ stop }) => stop,
    );
    const origin = yield* Effect.promise(() =>
      deadline(process.ready, "External Core readiness", 120_000),
    );
    const agent = yield* Effect.acquireRelease(
      Effect.sync(() => new NodeHttp.Agent({ keepAlive: true })),
      (agent) => Effect.sync(() => agent.destroy()),
    );
    return {
      origin,
      call: makeHttpCall(new URL(origin).host, agent),
      fake: zeropsHttp.world,
      stop: process.stop,
      socket: (path: string) => openLink(origin, path),
    };
  });
