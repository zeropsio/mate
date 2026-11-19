import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { makeAccountStore } from "../store.ts";
import { mateBrowserFrame, UNKNOWN_BROWSER_FRAME } from "../projections/mateBrowserFrame.ts";
import { makeMateBrowserFrameSink } from "./mateBrowserFrame.ts";

const image = { type: "frame" as const, data: "A", width: 10, height: 20 };
const identified = (revision: number, data = "A") => ({
  ...image,
  data,
  callId: "first",
  threadId: "thread",
  turnId: "turn",
  revision,
  completeness: "complete" as const,
});
function rig() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const sink = makeMateBrowserFrameSink({ store, environmentId: "mate" });
  sink.session();
  return {
    registry,
    sink,
    read: (callId = "first") =>
      registry.get(
        store.data.project(mateBrowserFrame, {
          environmentId: "mate",
          threadId: "thread",
          turnId: "turn",
          callId,
        }),
      ),
  };
}

// witness: packages/client-runtime/src/data/adapters/mateBrowserFrame.ts | mateBrowserFrameId(environmentId, event.threadId, event.turnId, event.callId) → mateBrowserFrameId(environmentId, event.threadId, event.threadId, event.callId)
it("AD39: A call's browser evidence belongs to its own turn and its newest revision, whatever order frames arrive in", () => {
  const r = rig();
  try {
    r.sink.event(identified(2));
    r.sink.event({ ...identified(9), callId: "second", turnId: "older-run" });
    expect(r.read().frame).toEqual(identified(2));
    expect(r.read("second")).toEqual(UNKNOWN_BROWSER_FRAME);
    r.sink.event({
      type: "call-result",
      callId: "first",
      threadId: "thread",
      turnId: "turn",
      revision: 3,
      completeness: "partial",
    });
    expect(r.read().frame).toEqual(identified(2));
    // A genuinely out-of-order complete absence cannot clear the newer partial revision.
    r.sink.event({
      type: "call-result",
      callId: "first",
      threadId: "thread",
      turnId: "turn",
      revision: 2,
      completeness: "complete",
      frame: null,
    });
    expect(r.read().frame).toEqual(identified(2));
    r.sink.event({
      type: "call-result",
      callId: "first",
      threadId: "thread",
      turnId: "turn",
      revision: 4,
      completeness: "complete",
      frame: null,
    });
    expect(r.read().kind).toBe("absent");
    expect(r.read().frame).toBeNull();
  } finally {
    r.registry.dispose();
  }
});

// witness: packages/client-runtime/src/data/adapters/mateBrowserFrame.ts | signal({ kind: "fault", fault, jitter: 0 }, now); → signal({ kind: "parent-lost" }, now);
it("AD40: A refusal withholds a retained browser frame without claiming it was deleted", () => {
  const r = rig();
  r.sink.event(identified(1));
  r.sink.lost({ outcome: "definitive-refusal", message: "denied" });
  expect(r.read().kind).toBe("refused");
  expect(r.read().frame).toBeNull();
  r.registry.dispose();
});
