import { describe, expect, it } from "@effect/vitest";
import { EnvironmentAuthorizationError, type ZeropsMacStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/reactivity";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { mateMacViewScope } from "../families/mateMacView.ts";
import { mateMacView } from "../projections/mateMacView.ts";
import { streamOf } from "../reducer.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeMateMacViewSink, startMateMacView } from "./mateMacView.ts";

const frame: ZeropsMacStreamEvent = {
  type: "frame",
  mimeType: "image/jpeg",
  data: "A",
  width: 460,
  height: 816,
  bounds: { x: 100, y: 50, width: 230, height: 408 },
};
const state = (status: string, extra: object = {}) =>
  ({
    type: "state",
    status,
    macName: "Test Mac",
    app: "com.example.Counter",
    inUse: false,
    ...extra,
  }) as ZeropsMacStreamEvent;

function rig() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const sink = makeMateMacViewSink({ store, environmentId: "mate" });
  sink.session();
  return {
    registry,
    sink,
    view: () => mateMacView.derive(readsOfState(store.state()), "mate"),
  };
}

describe("the Mac tab's view", () => {
  it("knows nothing before the Mate answers", () => {
    const r = rig();
    expect(r.view()).toBeUndefined();
    r.registry.dispose();
  });

  it("shows the opened app's window while it is live", () => {
    const r = rig();
    r.sink.event(state("live"));
    r.sink.event(frame);
    expect(r.view()).toEqual({
      status: "live",
      macName: "Test Mac",
      app: "com.example.Counter",
      inUse: false,
      frame,
    });
    r.registry.dispose();
  });

  it.each(["no-app", "unreachable", "no-helper", "not-paired"])(
    "drops the window once the view is %s",
    (status) => {
      const r = rig();
      r.sink.event(state("live"));
      r.sink.event(frame);
      r.sink.event(state(status));
      expect(r.view()).toEqual({
        status,
        macName: "Test Mac",
        app: "com.example.Counter",
        inUse: false,
      });
      r.registry.dispose();
    },
  );

  it("hands the panel the commands for the person's next step on the Mac, and drops them once live", () => {
    const r = rig();
    const pairCommands = ["zcli vpn up Prj0AAAAAAAAAAAAAAAAAA", "ssh zcp mac host | sh"];
    r.sink.event(state("not-paired", { pairCommands }));
    expect(r.view()).toMatchObject({ status: "not-paired", pairCommands });
    r.sink.event(state("live"));
    expect(r.view()).not.toHaveProperty("pairCommands");
    r.registry.dispose();
  });

  it("keeps the window while someone uses the Mac, saying so", () => {
    const r = rig();
    r.sink.event(state("live"));
    r.sink.event(frame);
    r.sink.event(state("live", { inUse: true }));
    expect(r.view()).toMatchObject({ status: "live", inUse: true, frame });
    r.registry.dispose();
  });

  it("never shows another app's window under a new app", () => {
    const r = rig();
    r.sink.event(state("live"));
    r.sink.event(frame);
    r.sink.event(state("live", { app: "com.example.Notes" }));
    expect(r.view()).not.toHaveProperty("frame");
    r.registry.dispose();
  });

  it("is connecting while the Mate's own socket is down, keeping the Mac's name", () => {
    const r = rig();
    r.sink.event(state("live"));
    r.sink.event(frame);
    r.sink.lost({ outcome: "transient", message: "offline" });
    expect(r.view()).toEqual({
      status: "connecting",
      macName: "Test Mac",
      app: "com.example.Counter",
      inUse: false,
    });
    r.registry.dispose();
  });

  it("is unavailable where the Mate refuses to show its Mac", () => {
    const r = rig();
    r.sink.event(state("live"));
    r.sink.lost({ outcome: "definitive-refusal", message: "denied" });
    expect(r.view()).toBe("unavailable");
    r.registry.dispose();
  });
});

describe("Mac view supervision", () => {
  it.live("a definitive refusal survives remount and never reopens by itself", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      let opens = 0;
      const wire = {
        open: Stream.unwrap(
          Effect.sync(() => {
            opens++;
            return Stream.fail(
              new EnvironmentAuthorizationError({
                message: "denied",
                requiredScope: "orchestration:read",
              }),
            );
          }),
        ),
      };
      const first = startMateMacView({ environmentId: "mate", store, wire });
      yield* settle;
      expect(streamOf(store.state(), mateMacViewScope("mate")).phase).toBe("refused");
      first.stop();
      const second = startMateMacView({ environmentId: "mate", store, wire });
      yield* settle;
      expect(opens).toBe(1);
      second.stop();
      store.close();
      registry.dispose();
    }),
  );

  it.live("streams the Mac's events into the view", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const wire = {
        open: Stream.concat(
          Stream.make(
            { kind: "session" } as const,
            { kind: "event", event: state("live") } as const,
            { kind: "event", event: frame } as const,
          ),
          Stream.never,
        ),
      };
      const link = startMateMacView({ environmentId: "mate", store, wire });
      yield* settle;
      expect(mateMacView.derive(readsOfState(store.state()), "mate")).toMatchObject({
        status: "live",
        frame,
      });
      link.stop();
      store.close();
      registry.dispose();
    }),
  );
});
