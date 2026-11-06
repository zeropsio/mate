import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { AtomRegistry } from "effect/reactivity";
import type { OrchestrationShellSnapshot } from "@t3tools/contracts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { mateShell, conversationScope } from "../projections/mateConversation.ts";
import { conversationsListed, publishConversation } from "./mateConversation.ts";
const snapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 1,
  projects: [],
  threads: [],
  updatedAt: "2026-10-07T00:00:00Z",
};
describe("account conversation retention", () => {
  it("retains an owner's empty snapshot through disconnect and remount without claiming it is live", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const key = { environmentId: "mate" };
    const read = () => mateShell.derive(readsOfState(store.state()), key);
    expect(read().status).toBe("empty");
    store.dispatch({
      kind: "stream",
      key: conversationScope(key),
      now: 1,
      event: { kind: "demand", demanded: true },
    });
    publishConversation(store, key, {
      state: { snapshot: Option.some(snapshot), status: "live", error: Option.none() },
    });
    expect(read().status).toBe("live");
    expect(Option.getOrUndefined(read().snapshot)?.projects).toEqual([]);
    store.dispatch({
      kind: "stream",
      key: conversationScope(key),
      now: 1,
      event: { kind: "demand", demanded: false },
    });
    expect(read().status).toBe("cached");
    expect(Option.getOrUndefined(read().snapshot)).toEqual(snapshot);
    store.dispatch({ kind: "access", family: "mateShell", id: "mate", access: "unverified" });
    store.dispatch({
      kind: "stream",
      key: conversationScope(key),
      now: 1,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "access-unverified", message: "Verify access." },
      },
    });
    expect(Option.isNone(read().snapshot)).toBe(true);
    store.dispatch({
      kind: "stream",
      key: conversationScope(key),
      now: 1,
      event: { kind: "input-changed" },
    });
    expect(Option.isNone(read().snapshot)).toBe(true);
    store.dispatch({
      kind: "stream",
      key: conversationScope(key),
      now: 1,
      event: { kind: "demand", demanded: true },
    });
    publishConversation(store, key, {
      state: { snapshot: Option.some(snapshot), status: "live", error: Option.none() },
    });
    expect(read().status).toBe("live");
    store.dispatch({ kind: "access", family: "mateShell", id: "mate", access: "denied" });
    expect(Option.isNone(read().snapshot)).toBe(true);
    expect(store.state().facts.get("mateShell:mate")?.content.kind).not.toBe("value");
    store.close();
    registry.dispose();
  });
  it("a synchronizing source with no snapshot never asserts an empty owner answer", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    publishConversation(
      store,
      { environmentId: "mate" },
      { state: { snapshot: Option.none(), status: "synchronizing", error: Option.none() } },
    );
    expect(store.state().facts.has("mateShell:mate")).toBe(false);
    store.close();
    registry.dispose();
  });
});

describe("conversationsListed", () => {
  const ENGINE = { kind: "engine", protocol: 1 } as const;
  it.each([
    {
      title: "its door has not said where they are read",
      route: { kind: "unknown" } as const,
      rows: null,
      listed: false,
    },
    {
      title: "a Mate serving no engine: its shell lists them",
      route: { kind: "older" } as const,
      rows: null,
      listed: true,
    },
    { title: "an engine Mate before its rows are held", route: ENGINE, rows: null, listed: false },
    {
      title: "an engine Mate whose rows still read their first baseline",
      route: ENGINE,
      rows: { phase: "baselining" } as const,
      listed: false,
    },
    {
      title: "an engine Mate whose rows answered",
      route: ENGINE,
      rows: { phase: "live" } as const,
      listed: true,
    },
    {
      title: "an engine Mate whose rows answered and now reconnect",
      route: ENGINE,
      rows: { phase: "recovering", lostAt: 5 } as const,
      listed: true,
    },
  ])(
    "a conversation's absence is read off the list that names a Mate's conversations only once it answered whole: $title",
    ({ route, rows, listed }) => {
      expect(conversationsListed(route, rows)).toBe(listed);
    },
  );
});
