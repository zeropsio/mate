import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ZeropsApiError } from "../api.ts";
import type { PlatformWatchSocket } from "./platformSocket.ts";
import { makeZeropsWire, repairZeropsSession, type ZeropsWireClient } from "./zeropsWire.ts";

const Frame = Schema.fromJsonString(Schema.Unknown);
const encodeFrame = Schema.encodeSync(Frame);

class FakeSocket implements PlatformWatchSocket {
  readonly sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  receive(data: unknown) {
    this.onmessage?.({ data: encodeFrame(data) });
  }
}

function harness(overrides: Partial<ZeropsWireClient> = {}) {
  const sockets: FakeSocket[] = [];
  const client: ZeropsWireClient = { ...harnessClient(), ...overrides };
  const wire = makeZeropsWire({
    client,
    makeSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      // The platform greets a socket it accepted before anything else.
      queueMicrotask(() => {
        socket.onopen?.();
        socket.receive({ type: "SocketSuccess" });
      });
      return socket;
    },
  });
  return { wire, sockets };
}

describe("the Zerops wire", () => {
  it.effect(
    "opens a receiver with a fresh socket login and hands on every frame after the greeting",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { wire, sockets } = harness();
          const link = yield* wire.open;
          expect(link.receiverId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
          expect(sockets[0]?.url).toBe(
            `wss://api.example.test/api/rest/public/web-socket/${link.receiverId}/ws-token`,
          );
          const reading = yield* Effect.forkChild(Stream.runCollect(Stream.take(link.frames, 1)));
          yield* Effect.yieldNow;
          sockets[0]?.receive({ type: "search", subscriptionName: "s1", data: { update: [] } });
          const frames = yield* Fiber.join(reading);
          expect(frames).toEqual([
            { type: "search", subscriptionName: "s1", data: { update: [] } },
          ]);
        }),
      ),
  );

  it.effect.each([
    {
      name: "a 401 the client's own refresh did not cure",
      error: new ZeropsApiError("expired", "expired-session", 401),
      outcome: "recoverable-session",
    },
    {
      name: "a 403",
      error: new ZeropsApiError("no", "forbidden", 403),
      outcome: "authoritative-denial",
    },
    {
      name: "a 429",
      error: new ZeropsApiError("slow", "server", 429, null, null, 5_000),
      outcome: "transient",
      retryAfterMs: 5_000,
    },
    {
      name: "a 400",
      error: new ZeropsApiError("bad", "invalid-input", 400),
      outcome: "definitive-refusal",
    },
    {
      name: "a lost connection",
      error: new ZeropsApiError("net", "network"),
      outcome: "transient",
    },
  ])("classifies $name on a registration", ({ error, outcome, retryAfterMs }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { wire } = harness({
          requestData: async () => {
            throw error;
          },
        });
        const link = yield* wire.open;
        const fault = yield* Effect.flip(Effect.asVoid(link.post("/process/search", {})));
        expect(fault.outcome).toBe(outcome);
        expect(fault.retryAfterMs).toBe(retryAfterMs);
      }),
    ),
  );

  it.effect.each([404, 403])(
    "answers %s to an owner's read as a status, never a failure",
    (status) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { wire } = harness({
            requestData: async () => {
              throw new ZeropsApiError("gone", status === 404 ? "not-found" : "forbidden", status);
            },
          });
          const link = yield* wire.open;
          expect(yield* link.get("/project/p1")).toEqual({ status, body: null });
        }),
      ),
  );

  it.effect(
    "answers a read of a project the platform no longer has (400 projectNotFound) as 404",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { wire } = harness({
            requestData: async () => {
              throw new ZeropsApiError("Project not found.", "not-found", 400, "projectNotFound");
            },
          });
          const link = yield* wire.open;
          expect(yield* link.get("/project/p1")).toEqual({ status: 404, body: null });
        }),
      ),
  );

  it.effect.each([
    { path: "/service-stack/s1", code: "serviceStackNotFound", status: 404 },
    { path: "/project/p1", code: "serviceStackNotFound", status: null },
    { path: "/service-stack/s1", code: "projectNotFound", status: null },
  ])(
    "answers $path refused with 400 $code as gone only when the code is that entity's own",
    ({ path, code, status }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { wire } = harness({
            requestData: async () => {
              throw new ZeropsApiError("Not found.", "not-found", 400, code);
            },
          });
          const link = yield* wire.open;
          const answer = yield* Effect.result(link.get(path));
          expect(answer._tag === "Success" ? answer.success.status : null).toBe(status);
        }),
      ),
  );

  it.effect(
    "fails a read answered by another 400 not-found code: only a project's proves it gone",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { wire } = harness({
            requestData: async () => {
              throw new ZeropsApiError("Not found.", "not-found", 400, "clientNotFound");
            },
          });
          const link = yield* wire.open;
          const fault = yield* Effect.flip(link.get("/project/p1"));
          expect(fault.outcome).toBe("definitive-refusal");
        }),
      ),
  );

  it.effect(
    "ends the frames as transient when the socket closes, and closes it with the attempt",
    () =>
      Effect.gen(function* () {
        const { wire, sockets } = harness();
        const fault = yield* Effect.scoped(
          Effect.gen(function* () {
            const link = yield* wire.open;
            sockets[0]?.onclose?.();
            return yield* Effect.flip(Stream.runDrain(link.frames));
          }),
        );
        expect(fault.outcome).toBe("transient");
        expect(sockets[0]?.closed).toBe(true);
      }),
  );

  it.effect("breaks a socket whose pong does not come back in time", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { wire, sockets } = harness();
        const link = yield* wire.open;
        const reading = yield* Effect.forkChild(Effect.exit(Stream.runDrain(link.frames)));
        yield* TestClock.adjust(15_000);
        expect(sockets[0]?.sent).toEqual([encodeFrame({ type: "ping" })]);
        sockets[0]?.receive({ type: "pong" });
        yield* TestClock.adjust(15_000);
        expect(sockets[0]?.sent).toHaveLength(2);
        yield* TestClock.adjust(8_000);
        const ended = yield* Fiber.join(reading);
        expect(Exit.isFailure(ended)).toBe(true);
      }),
    ),
  );

  it.effect.each([
    { name: "a renewed session", renew: async () => undefined, outcome: null },
    {
      name: "a refresh the platform refuses",
      renew: async () => {
        throw new ZeropsApiError("expired", "expired-session", 401);
      },
      outcome: "definitive-refusal",
    },
    {
      name: "a refresh lost on the way",
      renew: async () => {
        throw new ZeropsApiError("net", "network");
      },
      outcome: "transient",
    },
  ])("repairs the session once with today's refresh: $name", ({ renew, outcome }) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        repairZeropsSession({ ...harnessClient(), renewHeldSession: renew }),
      );
      if (outcome === null) expect(Exit.isSuccess(exit)).toBe(true);
      else expect(exit).toMatchObject({ cause: { reasons: [{ error: { outcome } }] } });
    }),
  );
});

function harnessClient(): ZeropsWireClient {
  return {
    baseUrl: "https://api.example.test",
    exchangeWebSocketToken: async () => ({ webSocketToken: "ws-token" }),
    requestData: async () => ({ items: [] }),
    renewHeldSession: async () => undefined,
  };
}
