import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import * as RpcSession from "../rpc/session.ts";
import {
  ConnectionAdmissionRef,
  makeConnectionAdmission,
  type AdmissionTicket,
  type ConnectionAdmission,
} from "./admission.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  ConnectionTransientError,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const ENTRY: ConnectionCatalogEntry = { target: TARGET, profile: Option.none() };
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: "wss://environment.example.test/ws?wsTicket=test",
  httpAuthorization: null,
  target: TARGET,
};

/** What the driver asked of the resolver, the admission and the socket, in order. */
function rig(session: {
  readonly opened: Effect.Effect<void, ConnectionTransientError>;
  readonly ready: Effect.Effect<void, ConnectionTransientError>;
}) {
  const log: Array<string> = [];
  let letThrough: () => void = () => undefined;
  const admitted = Promise.withResolvers<void>();
  const socketStarted = Promise.withResolvers<void>();
  const giveWay = new AbortController();
  const admission: ConnectionAdmission = {
    prefer: () => undefined,
    hold: () => () => undefined,
    preferred: () => null,
    down: () => () => undefined,
    admit: (environmentId) => {
      log.push(`admit ${environmentId}`);
      return new Promise<AdmissionTicket>((resolve) => {
        letThrough = () =>
          resolve({
            signal: giveWay.signal,
            claim: () => undefined,
            settle: (open) => void log.push(`settle ${environmentId} ${open}`),
            close: () => void log.push(`close ${environmentId}`),
          });
        admitted.resolve();
      });
    },
  };
  const layer = driverLayer(log, session, () => socketStarted.resolve());
  return {
    log,
    admission,
    layer,
    admitted: admitted.promise,
    socketStarted: socketStarted.promise,
    letThrough: () => letThrough(),
    giveWay: () => giveWay.abort(),
  };
}

function driverLayer(
  log: Array<string>,
  session: {
    readonly opened: Effect.Effect<void, ConnectionTransientError>;
    readonly ready: Effect.Effect<void, ConnectionTransientError>;
  },
  socketStarted: () => void = () => undefined,
) {
  return ConnectionDriver.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          ConnectionResolver.ConnectionResolver,
          ConnectionResolver.ConnectionResolver.of({
            prepare: () => Effect.sync(() => void log.push("ticket")).pipe(Effect.as(PREPARED)),
          }),
        ),
        Layer.succeed(
          RpcSession.RpcSessionFactory,
          RpcSession.RpcSessionFactory.of({
            connect: () =>
              Effect.sync(() => {
                log.push("socket");
                socketStarted();
                return {
                  client: {} as WsRpcProtocolClient,
                  initialConfig: Effect.die("unused"),
                  subscribeServerConfig: () => {
                    throw new Error("unused");
                  },
                  opened: session.opened,
                  ready: session.ready.pipe(Effect.tap(() => Effect.sync(() => log.push("ready")))),
                  probe: Effect.void,
                  closed: Effect.never,
                } satisfies RpcSession.RpcSession;
              }),
          }),
        ),
      ),
    ),
  );
}

describe("connection driver admission", () => {
  it.effect(
    "waits its turn after its ticket, and gives the turn back once its socket opens, before it synchronizes",
    () =>
      Effect.gen(function* () {
        const { log, admission, layer, letThrough, admitted } = rig({
          opened: Effect.void,
          ready: Effect.void,
        });
        const driver = yield* ConnectionDriver.ConnectionDriver.pipe(Effect.provide(layer));
        const scope = yield* Scope.make();
        const fiber = yield* driver
          .connect(ENTRY, () => Effect.void)
          .pipe(
            Scope.provide(scope),
            Effect.provideService(ConnectionAdmissionRef, admission),
            Effect.forkChild,
          );
        yield* Effect.promise(() => admitted);
        expect(log).toEqual(["ticket", "admit environment-1"]);

        letThrough();
        yield* Fiber.join(fiber);
        expect(log).toEqual([
          "ticket",
          "admit environment-1",
          "socket",
          "settle environment-1 true",
          "ready",
        ]);

        yield* Scope.close(scope, Exit.void);
        expect(log.at(-1)).toBe("close environment-1");
      }),
  );

  it.effect.each([
    { name: "its socket never opens", opened: false },
    { name: "it is told to give way", opened: "never" },
  ] as const)("settles closed when $name", ({ opened }) =>
    Effect.gen(function* () {
      const failed = new ConnectionTransientError({ reason: "transport", detail: "refused" });
      const { log, admission, layer, letThrough, giveWay, admitted, socketStarted } = rig({
        opened: opened === false ? Effect.fail(failed) : Effect.never,
        ready: Effect.void,
      });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(Effect.provide(layer));
      const fiber = yield* driver
        .connect(ENTRY, () => Effect.void)
        .pipe(
          Effect.scoped,
          Effect.provideService(ConnectionAdmissionRef, admission),
          Effect.forkChild,
        );
      yield* Effect.promise(() => admitted);
      letThrough();
      if (opened === "never") {
        yield* Effect.promise(() => socketStarted);
        giveWay();
      }
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(log.slice(0, 4)).toEqual([
        "ticket",
        "admit environment-1",
        "socket",
        "settle environment-1 false",
      ]);
    }),
  );

  it.effect("an attempt interrupted while waiting its turn never creates a socket", () =>
    Effect.gen(function* () {
      const { log, admission, layer, admitted } = rig({ opened: Effect.void, ready: Effect.void });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(Effect.provide(layer));
      const fiber = yield* driver
        .connect(ENTRY, () => Effect.void)
        .pipe(
          Effect.scoped,
          Effect.provideService(ConnectionAdmissionRef, admission),
          Effect.forkChild,
        );
      yield* Effect.promise(() => admitted);
      yield* Fiber.interrupt(fiber);
      expect(log).toEqual(["ticket", "admit environment-1"]);
    }),
  );

  it.effect.each(Array.from({ length: 12 }, (_, hops) => ({ hops })))(
    "a route reconnect interrupted after $hops hops holds no other Mate",
    ({ hops }) =>
      Effect.gen(function* () {
        const admission = makeConnectionAdmission({ setTimer: () => () => {} });
        const OTHER = EnvironmentId.make("environment-2");
        const log: Array<string> = [];
        const driver = yield* ConnectionDriver.ConnectionDriver.pipe(
          Effect.provide(driverLayer(log, { opened: Effect.never, ready: Effect.void })),
        );
        // The route opened once and its socket dropped: it is reconnecting.
        admission.prefer(TARGET.environmentId);
        const first = yield* Effect.promise(() => admission.admit(TARGET.environmentId));
        first.claim();
        first.settle(true);
        first.close();

        const fiber = yield* driver
          .connect(ENTRY, () => Effect.void)
          .pipe(
            Effect.scoped,
            Effect.provideService(ConnectionAdmissionRef, admission),
            Effect.forkChild,
          );
        for (let hop = 0; hop < hops; hop += 1) yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);

        // The next ticket is the admission receipt: a leaked route hold never produces it.
        const other = yield* Effect.promise(() => admission.admit(OTHER));
        expect(other.signal.aborted).toBe(false);
        other.claim();
        other.settle(false);
      }),
  );
});

const OTHER = EnvironmentId.make("environment-2");
const ELSEWHERE = "wss://elsewhere.example.test/ws?wsTicket=test";

// Admission's tickets arrive as Promise reactions: the next event-loop turn has drained them.
const drained = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

/** A socket as a browser's. `close()` closes it and says nothing: the close event comes later, if at all. */
class TestSocket {
  readyState = 0;
  readonly sent: Array<string> = [];
  readonly origin: "dialed" | "new";
  private readonly listeners = new Map<string, Set<(event: never) => void>>();
  constructor(origin: "dialed" | "new") {
    this.origin = origin;
  }
  addEventListener(type: string, listener: (event: never) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: never) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  send(data: string | Uint8Array) {
    this.sent.push(String(data));
  }
  open() {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) listener({ type: "open" } as never);
  }
  close() {
    this.readyState = 3;
  }
  get closed() {
    return this.readyState === 3;
  }
}

/**
 * The driver over the tab's real admission, with `TARGET` as the route: HQ answers the ticket when
 * the test says, and every socket the attempt dials or opens is kept, in order.
 */
function aheadRig(
  options: {
    /** The session never begins: the attempt holds its socket and nothing has used it. */
    readonly sessionNeverBegins?: boolean;
    /** Runs as the attempt asks for its ticket, in the step it dialed in. */
    readonly asTicketIsAsked?: (admission: ConnectionAdmission) => void;
  } = {},
) {
  const admission = makeConnectionAdmission({ setTimer: () => () => {} });
  admission.prefer(TARGET.environmentId);
  const sockets: Array<TestSocket> = [];
  const log: Array<string> = [];
  let ticket = Promise.withResolvers<PreparedConnection>();
  /** The tab's one driver: what it learned of a Mate's address stays with it. */
  let driver: ConnectionDriver.ConnectionDriver["Service"] | null = null;
  const layer = ConnectionDriver.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          ConnectionResolver.ConnectionResolver,
          ConnectionResolver.ConnectionResolver.of({
            prepare: () =>
              Effect.suspend(() => {
                options.asTicketIsAsked?.(admission);
                return Effect.promise(() => ticket.promise);
              }),
            socketUrlAhead: () => PREPARED.socketUrl,
          }),
        ),
        Layer.succeed(
          RpcSession.RpcSessionFactory,
          RpcSession.RpcSessionFactory.of({
            dial: (socketUrl) => {
              const socket = new TestSocket("dialed");
              sockets.push(socket);
              log.push(`dial ${socketUrl}`);
              return socket;
            },
            connect: (_prepared, dialed) =>
              options.sessionNeverBegins === true
                ? Effect.never
                : Effect.sync(() => {
                    const given = sockets.find((known) => Object.is(known, dialed));
                    // Every socket of the attempt's before a new one is closed by then, or two are alive.
                    log.push(
                      given === undefined
                        ? `open a new socket beside ${sockets.filter((known) => !known.closed).length} alive`
                        : "connect on the dialed socket",
                    );
                    const connected = given ?? new TestSocket("new");
                    if (given === undefined) {
                      connected.open();
                      sockets.push(connected);
                    }
                    return {
                      client: {} as WsRpcProtocolClient,
                      initialConfig: Effect.die("unused"),
                      subscribeServerConfig: () => {
                        throw new Error("unused");
                      },
                      opened: Effect.callback<void>((resume) => {
                        if (connected.readyState === 1) resume(Effect.void);
                        else connected.addEventListener("open", () => resume(Effect.void));
                      }),
                      ready: Effect.void,
                      probe: Effect.void,
                      closed: Effect.never,
                    } satisfies RpcSession.RpcSession;
                  }),
          }),
        ),
      ),
    ),
  );
  /** One attempt in its own scope: its first when `ahead`, else a retry. */
  const attempt = Effect.fnUntraced(function* (ahead: boolean) {
    ticket = Promise.withResolvers<PreparedConnection>();
    const answer = ticket;
    driver ??= yield* ConnectionDriver.ConnectionDriver.pipe(Effect.provide(layer));
    const scope = yield* Scope.make();
    const fiber = yield* driver
      .connect(ENTRY, () => Effect.void, undefined, { ahead })
      .pipe(
        Scope.provide(scope),
        Effect.provideService(ConnectionAdmissionRef, admission),
        Effect.forkChild,
      );
    yield* drained;
    return {
      fiber,
      /** HQ answers: the ticket names `socketUrl`. */
      ticketed: (socketUrl = PREPARED.socketUrl) => answer.resolve({ ...PREPARED, socketUrl }),
      refused: () => answer.reject(new Error("refused")),
      /** The connection ends: its scope closes. */
      end: Scope.close(scope, Exit.void),
    };
  });
  /** Another Mate's attempt, admitted or still waiting its turn. */
  const other = Effect.promise(async () => {
    const waiting = Symbol("waiting");
    const admitted = await Promise.race([
      admission.admit(OTHER),
      new Promise<typeof waiting>((resolve) => setImmediate(() => resolve(waiting))),
    ]);
    if (admitted === waiting) return null;
    admitted.claim();
    return admitted;
  });
  return { admission, sockets, log, attempt, other };
}

describe("the route's Mate's socket, dialed beside its ticket request", () => {
  // witness: packages/client-runtime/src/connection/driver.ts | sessions.connect(prepared, dialed?.socket) → sessions.connect(prepared)
  it.effect(
    "a first attempt dials its socket while HQ is still asked for its ticket, sends nothing on it, and connects on that one socket",
    () =>
      Effect.gen(function* () {
        const { sockets, log, attempt } = aheadRig();
        const first = yield* attempt(true);
        expect(log).toEqual([`dial ${PREPARED.socketUrl}`]);
        sockets[0]!.open();
        yield* drained;
        // Open, and silent: only the ticket's attempt writes on it.
        expect(sockets[0]!.sent).toEqual([]);
        expect(first.fiber.pollUnsafe()).toBeUndefined();

        first.ticketed();
        yield* Fiber.join(first.fiber);
        expect(log).toEqual([`dial ${PREPARED.socketUrl}`, "connect on the dialed socket"]);
        expect(sockets).toHaveLength(1);
        // The connection's socket now: it stays open until the connection ends.
        expect(sockets[0]!.closed).toBe(false);
        yield* first.end;
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | const ahead = options?.ahead === true ? yield* startAhead(entry, admission) : null; → const ahead = yield* startAhead(entry, admission);
  it.effect(
    "a retry dials nothing ahead: its ticket is asked first, and a Mate connecting meanwhile keeps its turn",
    () =>
      Effect.gen(function* () {
        const { sockets, attempt, other, admission } = aheadRig();
        // The route's first attempt failed: its hold on the others is over.
        const failed = yield* Effect.promise(() => admission.admit(TARGET.environmentId));
        failed.claim();
        failed.settle(false);
        const connecting = yield* other;

        const retry = yield* attempt(false);
        expect(sockets).toEqual([]);
        expect(connecting?.signal.aborted).toBe(false);
        connecting?.settle(false);
        retry.ticketed();
        yield* Fiber.join(retry.fiber);
        yield* retry.end;
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | admission.preferred() !== environmentId → false
  it.effect(
    "a Mate that is not the route's dials nothing ahead: its socket waits its turn after its ticket",
    () =>
      Effect.gen(function* () {
        const { sockets, attempt, admission } = aheadRig();
        // No route named: nothing would keep its socket waiting, yet none is dialed.
        admission.prefer(null);
        const first = yield* attempt(true);
        expect(sockets).toEqual([]);
        yield* Fiber.interrupt(first.fiber);
        yield* first.end;
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | ticket?.close(); → void ticket;
  it.effect(
    "the route's place is given back the moment its connection ends, whatever the browser has said of the socket: its reconnect makes a connecting Mate give way",
    () =>
      Effect.gen(function* () {
        const { sockets, attempt, other, admission } = aheadRig();
        const first = yield* attempt(true);
        sockets[0]!.open();
        first.ticketed();
        yield* Fiber.join(first.fiber);
        // The link died: the session ended. No close event has come from the browser.
        yield* first.end;

        const connecting = yield* other;
        const reconnect = yield* Effect.promise(() => admission.admit(TARGET.environmentId));
        reconnect.claim();
        expect(connecting?.signal.aborted).toBe(true);
        reconnect.settle(false);
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | socketUrl !== input.socketUrl || → false ||
  it.effect(
    "a ticket naming another address than the socket was dialed at: that socket is closed before the attempt opens its own, which goes first, and a Mate connecting meanwhile gives way",
    () =>
      Effect.gen(function* () {
        const { sockets, log, attempt, other } = aheadRig();
        const first = yield* attempt(true);
        sockets[0]!.open();
        // The route's socket is open: another Mate may connect.
        const connecting = yield* other;
        expect(connecting?.signal.aborted).toBe(false);

        first.ticketed(ELSEWHERE);
        yield* Fiber.join(first.fiber);
        expect(sockets[0]!.closed).toBe(true);
        expect(sockets[0]!.sent).toEqual([]);
        expect(log.at(-1)).toBe("open a new socket beside 0 alive");
        expect(connecting?.signal.aborted).toBe(true);
        yield* first.end;
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | elsewhere.has(environmentId) || → false ||
  it.effect(
    "a Mate whose ticket once named another address than it is registered at is not dialed ahead again",
    () =>
      Effect.gen(function* () {
        const { sockets, attempt } = aheadRig();
        const first = yield* attempt(true);
        first.ticketed(ELSEWHERE);
        yield* Fiber.join(first.fiber);
        yield* first.end;
        const dialedBefore = sockets.filter((socket) => socket.origin === "dialed").length;

        const next = yield* attempt(true);
        expect(sockets.filter((socket) => socket.origin === "dialed")).toHaveLength(dialedBefore);
        next.ticketed(ELSEWHERE);
        yield* Fiber.join(next.fiber);
        yield* next.end;
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | now - input.dialedAt >= SOCKET_AHEAD_MS || → false ||
  it.effect.each([
    { name: "just under 3 s after the dial is used", after: ConnectionDriver.SOCKET_AHEAD_MS - 1 },
    { name: "3 s after the dial is too old", after: ConnectionDriver.SOCKET_AHEAD_MS },
  ])(
    "a ticket that comes $name: no timer decides, the socket's age is read when the ticket has come",
    ({ after }) =>
      Effect.gen(function* () {
        const { sockets, log, attempt } = aheadRig();
        const first = yield* attempt(true);
        sockets[0]!.open();
        yield* TestClock.adjust(after);

        first.ticketed();
        yield* Fiber.join(first.fiber);
        const fresh = after < ConnectionDriver.SOCKET_AHEAD_MS;
        expect(log.at(-1)).toBe(
          fresh ? "connect on the dialed socket" : "open a new socket beside 0 alive",
        );
        expect(sockets[0]!.closed).toBe(!fresh);
        yield* first.end;
      }).pipe(Effect.provide(TestClock.layer())),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | socket?.close(); → void socket;
  it.effect(
    "a first attempt whose ticket HQ refuses closes the socket it dialed and holds no other Mate",
    () =>
      Effect.gen(function* () {
        const { sockets, attempt, other } = aheadRig();
        const first = yield* attempt(true);
        expect(sockets[0]!.readyState).toBe(0);

        first.refused();
        expect(Exit.isFailure(yield* Fiber.await(first.fiber))).toBe(true);
        yield* first.end;
        expect(sockets[0]!.closed).toBe(true);
        expect(sockets[0]!.sent).toEqual([]);
        const connecting = yield* other;
        expect(connecting).not.toBeNull();
        connecting?.settle(false);
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | socket?.close(); → if (!taken) socket?.close();
  it.effect(
    "a socket its ticket came for, whose attempt ends before a session began on it, is closed with the attempt",
    () =>
      Effect.gen(function* () {
        const { sockets, attempt } = aheadRig({ sessionNeverBegins: true });
        const first = yield* attempt(true);
        first.ticketed();
        yield* drained;
        expect(sockets[0]!.closed).toBe(false);

        yield* Fiber.interrupt(first.fiber);
        yield* first.end;
        expect(sockets).toHaveLength(1);
        expect(sockets[0]!.closed).toBe(true);
        expect(sockets[0]!.sent).toEqual([]);
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | if (admitted.signal.aborted) return end(); → void end;
  it.effect(
    "a route that moves to another Mate in the step the attempt began in leaves no socket of the attempt's connecting beside that Mate's",
    () =>
      Effect.gen(function* () {
        let route: AdmissionTicket | null = null;
        const { sockets, attempt } = aheadRig({
          asTicketIsAsked: (admission) => {
            admission.prefer(OTHER);
            void admission.admit(OTHER).then((admitted) => {
              admitted.claim();
              route = admitted;
            });
          },
        });
        const first = yield* attempt(true);
        expect(route).not.toBeNull();
        expect(sockets.filter((socket) => !socket.closed)).toEqual([]);
        yield* Fiber.interrupt(first.fiber);
        yield* first.end;
      }),
  );

  // witness: packages/client-runtime/src/connection/driver.ts | admitted.signal.addEventListener("abort", lost, { once: true }); → void lost;
  it.effect(
    "a socket dialed ahead and still connecting when the route moves to another Mate is closed for that Mate's, and its attempt waits its turn like any other's",
    () =>
      Effect.gen(function* () {
        const { sockets, log, attempt, admission } = aheadRig();
        const first = yield* attempt(true);
        expect(sockets[0]!.readyState).toBe(0);

        admission.prefer(OTHER);
        const route = yield* Effect.promise(() => admission.admit(OTHER));
        route.claim();
        expect(route.signal.aborted).toBe(false);
        expect(sockets[0]!.closed).toBe(true);

        first.ticketed();
        yield* drained;
        // Its own socket now waits behind the route's.
        expect(first.fiber.pollUnsafe()).toBeUndefined();
        route.settle(true);
        yield* Fiber.join(first.fiber);
        expect(log.at(-1)).toBe("open a new socket beside 0 alive");
        yield* first.end;
      }),
  );
});
