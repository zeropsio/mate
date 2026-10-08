import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { makeAccountStore, readsOfState } from "../store.ts";
import {
  mateBrowserFrame,
  mateBrowserStream,
  UNKNOWN_BROWSER_FRAME,
} from "../projections/mateBrowserFrame.ts";
import { mateBrowserStreamId } from "../families/mateBrowserFrame.ts";
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
    store,
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

describe("Mate call frame slots", () => {
  it.each([
    { name: "legacy viewport", event: image, freshness: "stale" },
    { name: "live viewport status", event: { type: "state", status: "live" }, freshness: "stale" },
    { name: "another call", event: { ...identified(3), callId: "second" }, freshness: "stale" },
    { name: "older call revision", event: identified(2), freshness: "stale" },
    {
      name: "partial call revision",
      event: { ...identified(3), completeness: "partial" },
      freshness: "stale",
    },
    { name: "the retained call revision", event: identified(3), freshness: "live" },
  ] as const)("$name after reconnect proves only its own freshness", ({ event, freshness }) => {
    const r = rig();
    try {
      r.sink.event(identified(3));
      r.sink.lost({ outcome: "transient", message: "offline" });
      r.sink.session();
      r.sink.event(event);
      expect(r.read()).toMatchObject({ kind: "known", frame: { data: "A" }, freshness });
      if ("callId" in event && event.callId === "second")
        expect(r.read("second").freshness).toBe("live");
    } finally {
      r.registry.dispose();
    }
  });

  it("fences frames and faults from an attempt replaced by a new source session", () => {
    const r = rig();
    r.sink.event(identified(1));
    const replacement = makeMateBrowserFrameSink({ store: r.store, environmentId: "mate" });
    replacement.session();
    replacement.event(identified(2, "new"));
    r.sink.event(identified(3, "late"));
    r.sink.lost({ outcome: "definitive-refusal", message: "old source" });
    expect(r.read()).toMatchObject({ kind: "known", frame: { data: "new" } });
    r.registry.dispose();
  });
  it("retains the viewport source frame across an outage and source recreation, but hides it while not live", () => {
    const r = rig();
    r.sink.event({ type: "state", status: "live" });
    r.sink.event(image);
    r.sink.lost({ outcome: "transient", message: "offline" });
    const remounted = makeMateBrowserFrameSink({ store: r.store, environmentId: "mate" });
    remounted.session();
    remounted.event({ type: "state", status: "no-browser" });
    const fact = readsOfState(r.store.state()).fact(
      "mateBrowserFrame",
      mateBrowserStreamId("mate"),
    );
    expect(fact).toMatchObject({
      kind: "known",
      value: { kind: "stream", state: { frame: image } },
    });
    const shown = mateBrowserStream.derive(readsOfState(r.store.state()), "mate");
    expect(shown).toEqual({ status: "no-browser" });
    remounted.event({ type: "state", status: "live" });
    // A reconnect's live status is not proof that the retained viewport is current.
    expect(mateBrowserStream.derive(readsOfState(r.store.state()), "mate")).toEqual({
      status: "live",
    });
    remounted.event({ ...image, data: "new" });
    expect(mateBrowserStream.derive(readsOfState(r.store.state()), "mate")).toMatchObject({
      frame: { data: "new" },
    });
    r.registry.dispose();
  });
  it.each([
    { name: "legacy server has no identity", frame: image },
    { name: "identity without revision is unknown", frame: { ...image, callId: "first" } },
    {
      name: "legacy identity without its thread is unknown",
      frame: { ...identified(1), threadId: undefined },
    },
    {
      name: "identity without its turn is unknown",
      frame: { ...identified(1), turnId: undefined },
    },
    { name: "a negative revision is not source evidence", frame: identified(-1) },
    {
      name: "partial replacement cannot establish a slot",
      frame: { ...identified(1), completeness: "partial" as const },
    },
  ])("$name", ({ frame }) => {
    const r = rig();
    r.sink.event(frame);
    expect(r.read()).toEqual(UNKNOWN_BROWSER_FRAME);
    r.registry.dispose();
  });

  it("retains only the matching call through remount and outage, ignoring older revisions", () => {
    const r = rig();
    r.sink.event(identified(2));
    r.sink.lost({ outcome: "transient", message: "offline" });
    expect(r.read().frame?.data).toBe("A");
    expect(r.read().freshness).toBe("stale");
    expect(r.read("second")).toEqual(UNKNOWN_BROWSER_FRAME);
    r.sink.session();
    r.sink.event(identified(1, "older"));
    r.sink.event(identified(2, "equal"));
    expect(r.read().frame?.data).toBe("A");
    r.registry.dispose();
  });

  it("explicit complete absence replaces a frame; partial omission keeps it", () => {
    const r = rig();
    r.sink.event(identified(1));
    r.sink.event({
      type: "call-result",
      callId: "first",
      threadId: "thread",
      turnId: "turn",
      revision: 2,
      completeness: "partial",
    });
    expect(r.read().frame?.data).toBe("A");
    r.sink.event({
      type: "call-result",
      callId: "first",
      threadId: "thread",
      turnId: "turn",
      revision: 3,
      completeness: "complete",
      frame: null,
    });
    expect(r.read().kind).toBe("absent");
    expect(r.read().frame).toBeNull();
    r.registry.dispose();
  });

  it("refusal withholds a retained call frame without claiming deletion", () => {
    const r = rig();
    r.sink.event(identified(1));
    r.sink.lost({ outcome: "definitive-refusal", message: "denied" });
    expect(r.read().kind).toBe("refused");
    expect(r.read().frame).toBeNull();
    r.registry.dispose();
  });
});

it("a closed account fences late browser frames before its registry is disposed", () => {
  const r = rig();
  r.sink.event(identified(1));
  const before = r.store.state();
  r.store.close();
  r.registry.dispose();
  expect(() => r.sink.event(identified(2, "late"))).not.toThrow();
  expect(r.store.state()).toBe(before);
});
