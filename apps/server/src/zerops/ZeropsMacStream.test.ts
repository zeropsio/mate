import { describe, expect, it } from "@effect/vitest";

import type { ZeropsMacStreamEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { MacHostRecord, MacViewRecord } from "./mac/MacHost.ts";
import { make, type MacStreamProcess } from "./ZeropsMacStream.ts";

const record: MacHostRecord = {
  address: "10.12.0.4",
  port: 22_417,
  user: "tester",
  hostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleHostKey",
  root: "/Users/tester/.zerops-mate/Prj0AAAAAAAAAAAAAAAAAA",
  workspace: "/Users/tester/ZeropsMate/Prj0AAAAAAAAAAAAAAAAAA",
  name: "Test Mac",
  macos: "26.1",
};

/** One message as the Mac's view helper writes it. */
const wire = (header: object, bytes?: Uint8Array): Uint8Array => {
  const line = new TextEncoder().encode(
    `${JSON.stringify(bytes ? { ...header, size: bytes.length } : header)}\n`,
  );
  const out = new Uint8Array(line.length + (bytes?.length ?? 0));
  out.set(line);
  if (bytes) out.set(bytes, line.length);
  return out;
};
const IMAGE = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
const windowFrame = (inUse = false) =>
  wire(
    {
      type: "frame",
      mimeType: "image/jpeg",
      width: 460,
      height: 816,
      bounds: { x: 100, y: 50, width: 230, height: 408 },
      inUse,
    },
    IMAGE,
  );

interface FakeConnection {
  readonly app: string;
  readonly output: Queue.Queue<Uint8Array, Cause.Done>;
  readonly exit: Deferred.Deferred<number>;
  closed: boolean;
}

/** A Mac reached over a fake ssh: each stream it opens is a queue the test writes the helper's wire into. */
/** The commands the Mate hands out for pairing: the vpn first, then the pairing itself. */
const PAIR = ["zcli vpn up Prj0AAAAAAAAAAAAAAAAAA", "ssh zcp mac host | sh"] as const;

const fakeMac = (options: {
  readonly paired?: boolean;
  readonly view?: MacViewRecord | undefined;
  readonly deviceExit?: number;
}) =>
  Effect.gen(function* () {
    const connections: FakeConnection[] = [];
    const pressed: Array<ReadonlyArray<string>> = [];
    const view = yield* Ref.make<MacViewRecord | undefined>(
      "view" in options ? options.view : { app: "com.example.Counter", at: 1 },
    );
    const service = yield* make({
      pairCommands: PAIR,
      readRecord: Effect.succeed(options.paired === false ? undefined : record),
      readView: Ref.get(view),
      openStream: (_, app) =>
        Effect.gen(function* () {
          const output = yield* Queue.unbounded<Uint8Array, Cause.Done>();
          const exit = yield* Deferred.make<number>();
          const connection: FakeConnection = { app, output, exit, closed: false };
          connections.push(connection);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              connection.closed = true;
            }),
          );
          return {
            output: Stream.fromQueue(output),
            exitCode: Deferred.await(exit),
          } satisfies MacStreamProcess;
        }),
      runDevice: (_, args) =>
        Effect.sync(() => {
          pressed.push(args);
          return options.deviceExit ?? 0;
        }),
      retryDelaysMs: [1000],
      pollMs: 500,
      stallMs: 15_000,
    });
    const send = (index: number, bytes: Uint8Array) =>
      Queue.offer(connections[index]!.output, bytes);
    const exitWith = (index: number, code: number) =>
      Effect.gen(function* () {
        yield* Queue.end(connections[index]!.output);
        yield* Deferred.succeed(connections[index]!.exit, code);
      });
    return { service, connections, pressed, view, send, exitWith };
  });

/** Subscribes, collecting events into a queue the test reads from. */
const watch = (service: Effect.Success<ReturnType<typeof fakeMac>>["service"]) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const events = yield* Queue.unbounded<ZeropsMacStreamEvent>();
    const stream = yield* service.subscribe.pipe(Scope.provide(scope));
    yield* Stream.runForEach(stream, (event) => Queue.offer(events, event)).pipe(
      Effect.forkIn(scope),
    );
    const next = Queue.take(events);
    /** Takes events until one matches. */
    const until = (match: (event: ZeropsMacStreamEvent) => boolean) =>
      Effect.gen(function* () {
        while (true) {
          const event = yield* next;
          if (match(event)) return event;
        }
      });
    return { next, until, leave: Scope.close(scope, Exit.void) };
  });

/** Lets forked fibers run until they block again. */
const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
});

const stateIs = (status: string) => (event: ZeropsMacStreamEvent) =>
  event.type === "state" && event.status === status;

describe("ZeropsMacStream", () => {
  it.effect("says no Mac is paired, and reaches for none", () =>
    Effect.gen(function* () {
      const mac = yield* fakeMac({ paired: false });
      const viewer = yield* watch(mac.service);
      expect(yield* viewer.until(stateIs("not-paired"))).toEqual({
        type: "state",
        status: "not-paired",
        inUse: false,
        pairCommands: PAIR,
      });
      expect(mac.connections).toHaveLength(0);
      yield* viewer.leave;
    }),
  );

  it.effect("says nothing is open on the paired Mac before an agent opens an app", () =>
    Effect.gen(function* () {
      const mac = yield* fakeMac({ view: undefined });
      const viewer = yield* watch(mac.service);
      expect(yield* viewer.until(stateIs("no-app"))).toEqual({
        type: "state",
        status: "no-app",
        macName: "Test Mac",
        inUse: false,
      });
      expect(mac.connections).toHaveLength(0);
      yield* viewer.leave;
    }),
  );

  it.effect(
    "streams the opened app's window once someone watches, and lets the Mac go when the last one leaves",
    () =>
      Effect.gen(function* () {
        const mac = yield* fakeMac({});
        const viewer = yield* watch(mac.service);
        expect(
          yield* viewer.until(
            (event) => event.type === "state" && event.status === "connecting" && "app" in event,
          ),
        ).toMatchObject({ macName: "Test Mac", app: "com.example.Counter" });
        yield* settle;
        expect(mac.connections.map((c) => c.app)).toEqual(["com.example.Counter"]);

        yield* mac.send(0, windowFrame());
        expect(yield* viewer.until(stateIs("live"))).toMatchObject({ inUse: false });
        expect(yield* viewer.next).toEqual({
          type: "frame",
          mimeType: "image/jpeg",
          data: Buffer.from(IMAGE).toString("base64"),
          width: 460,
          height: 816,
          bounds: { x: 100, y: 50, width: 230, height: 408 },
        });

        yield* viewer.leave;
        yield* settle;
        expect(mac.connections[0]!.closed).toBe(true);
      }),
  );

  it.effect("serves every watcher from one connection to the Mac", () =>
    Effect.gen(function* () {
      const mac = yield* fakeMac({});
      const first = yield* watch(mac.service);
      yield* first.until(stateIs("connecting"));
      yield* settle;
      const second = yield* watch(mac.service);
      yield* mac.send(0, windowFrame());
      yield* first.until((event) => event.type === "frame");
      yield* second.until((event) => event.type === "frame");
      expect(mac.connections).toHaveLength(1);
      yield* first.leave;
      yield* settle;
      expect(mac.connections[0]!.closed).toBe(false);
      yield* second.leave;
      yield* settle;
      expect(mac.connections[0]!.closed).toBe(true);
    }),
  );

  it.effect.each([
    ["does not answer", 255, "unreachable"],
    ["has no view helper", 7, "no-helper"],
  ] as const)("says when the Mac %s, and tries again while someone watches", ([, code, status]) =>
    Effect.gen(function* () {
      const mac = yield* fakeMac({});
      const viewer = yield* watch(mac.service);
      yield* viewer.until(stateIs("connecting"));
      yield* settle;
      yield* mac.exitWith(0, code);
      expect(yield* viewer.until(stateIs(status))).toMatchObject({
        macName: "Test Mac",
        pairCommands: PAIR,
      });
      yield* TestClock.adjust(Duration.millis(1000));
      yield* settle;
      expect(mac.connections).toHaveLength(2);
      yield* viewer.leave;
    }),
  );

  it.effect.each([
    ["no-app", "no-app"],
    ["no-window", "no-app"],
    ["no-capture", "no-helper"],
  ] as const)("reads the Mac's %s as %s, dropping the last frame", ([reported, status]) =>
    Effect.gen(function* () {
      const mac = yield* fakeMac({});
      const viewer = yield* watch(mac.service);
      yield* viewer.until(stateIs("connecting"));
      yield* settle;
      yield* mac.send(0, windowFrame());
      yield* viewer.until((event) => event.type === "frame");
      yield* mac.send(0, wire({ type: "state", status: reported, inUse: false }));
      const said = yield* viewer.until(stateIs(status));
      expect(said).toMatchObject({ app: "com.example.Counter" });
      // Only a step for the person comes with the commands for it.
      expect(said.type === "state" ? said.pairCommands : undefined).toEqual(
        status === "no-helper" ? PAIR : undefined,
      );
      const late = yield* watch(mac.service);
      expect(yield* late.next).toMatchObject({ type: "state", status });
      yield* viewer.leave;
      yield* late.leave;
    }),
  );

  it.effect("follows the app an agent opens next", () =>
    Effect.gen(function* () {
      const mac = yield* fakeMac({});
      const viewer = yield* watch(mac.service);
      yield* viewer.until(stateIs("connecting"));
      yield* settle;
      yield* Ref.set(mac.view, { app: "com.example.Notes", at: 2 });
      yield* TestClock.adjust(Duration.millis(500));
      yield* settle;
      expect(mac.connections.map((c) => [c.app, c.closed])).toEqual([
        ["com.example.Counter", true],
        ["com.example.Notes", false],
      ]);
      expect(
        yield* viewer.until((event) => event.type === "state" && event.app === "com.example.Notes"),
      ).toMatchObject({ status: "connecting" });
      yield* viewer.leave;
    }),
  );

  it.effect("drops a stream that went silent and says the Mac does not answer", () =>
    Effect.gen(function* () {
      const mac = yield* fakeMac({});
      const viewer = yield* watch(mac.service);
      yield* viewer.until(stateIs("connecting"));
      yield* settle;
      yield* mac.send(0, windowFrame());
      yield* viewer.until((event) => event.type === "frame");
      yield* TestClock.adjust(Duration.millis(15_000));
      yield* settle;
      expect(yield* viewer.until(stateIs("unreachable"))).toMatchObject({
        macName: "Test Mac",
        pairCommands: PAIR,
      });
      expect(mac.connections[0]!.closed).toBe(true);
      yield* viewer.leave;
    }),
  );

  describe("input", () => {
    const live = (deviceExit?: number) =>
      Effect.gen(function* () {
        const mac = yield* fakeMac(deviceExit === undefined ? {} : { deviceExit });
        const viewer = yield* watch(mac.service);
        yield* viewer.until(stateIs("connecting"));
        yield* settle;
        yield* mac.send(0, windowFrame());
        yield* viewer.until((event) => event.type === "frame");
        return { mac, viewer };
      });

    it.effect("a click on the image presses the window's place on the Mac's screen", () =>
      Effect.gen(function* () {
        const { mac, viewer } = yield* live();
        // A Retina capture is twice the window: pixel (230, 408) is the window's middle.
        yield* mac.service.sendInput({ kind: "click", x: 230, y: 408 });
        expect(mac.pressed).toEqual([["press", "215", "254"]]);
        yield* viewer.leave;
      }),
    );

    it.effect("typed text goes to the app", () =>
      Effect.gen(function* () {
        const { mac, viewer } = yield* live();
        yield* mac.service.sendInput({ kind: "text", text: "hello" });
        expect(mac.pressed).toEqual([["type", "hello"]]);
        yield* viewer.leave;
      }),
    );

    it.effect("a click before any frame presses nothing", () =>
      Effect.gen(function* () {
        const mac = yield* fakeMac({});
        yield* mac.service.sendInput({ kind: "click", x: 1, y: 1 });
        expect(mac.pressed).toEqual([]);
      }),
    );

    it.effect("a click refused because someone is using the Mac turns the view's input off", () =>
      Effect.gen(function* () {
        const { mac, viewer } = yield* live(75);
        yield* mac.service.sendInput({ kind: "click", x: 10, y: 10 });
        expect(yield* viewer.until((event) => event.type === "state")).toEqual({
          type: "state",
          status: "live",
          macName: "Test Mac",
          app: "com.example.Counter",
          inUse: true,
        });
        yield* viewer.leave;
      }),
    );

    it.effect("says the Mac is in use as soon as the Mac reports it, and free again after", () =>
      Effect.gen(function* () {
        const { mac, viewer } = yield* live();
        yield* mac.send(0, wire({ type: "tick", inUse: true }));
        expect(yield* viewer.until((event) => event.type === "state")).toMatchObject({
          status: "live",
          inUse: true,
        });
        yield* mac.send(0, wire({ type: "tick", inUse: false }));
        expect(yield* viewer.until((event) => event.type === "state")).toMatchObject({
          status: "live",
          inUse: false,
        });
        yield* viewer.leave;
      }),
    );
  });

  it.effect("a late watcher gets the current state, then the current frame", () =>
    Effect.gen(function* () {
      const mac = yield* fakeMac({});
      const first = yield* watch(mac.service);
      yield* first.until(stateIs("connecting"));
      yield* settle;
      yield* mac.send(0, windowFrame());
      yield* first.until((event) => event.type === "frame");
      const late = yield* watch(mac.service);
      expect(yield* late.next).toMatchObject({ type: "state", status: "live" });
      expect(yield* late.next).toMatchObject({ type: "frame", width: 460 });
      yield* first.leave;
      yield* late.leave;
    }),
  );
});
