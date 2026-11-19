import { expect, it } from "vite-plus/test";
import type { ZeropsMacStreamEvent } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { mateMacView } from "../projections/mateMacView.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeMateMacViewSink } from "./mateMacView.ts";

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

// witness: packages/client-runtime/src/data/adapters/mateMacView.ts | state = foldMacViewEvent(state, event); → state = { ...state, ...foldMacViewEvent(state, event) };
it("AD41: Another app's window is never shown under a newly opened app", () => {
  const r = rig();
  r.sink.event(state("live"));
  r.sink.event(frame);
  r.sink.event(state("live", { app: "com.example.Notes" }));
  expect(r.view()).not.toHaveProperty("frame");
  r.registry.dispose();
});

// witness: packages/client-runtime/src/data/adapters/mateMacView.ts | else if (event.status !== "live") currentFrame = false; → else if (event.status !== "live" || event.inUse) currentFrame = false;
it("AD42: The Mac's window stays shown while someone uses the Mac, saying so", () => {
  const r = rig();
  r.sink.event(state("live"));
  r.sink.event(frame);
  r.sink.event(state("live", { inUse: true }));
  expect(r.view()).toMatchObject({ status: "live", inUse: true, frame });
  r.registry.dispose();
});
