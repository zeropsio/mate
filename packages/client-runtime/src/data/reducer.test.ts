import { describe, expect, it } from "vite-plus/test";

import { emptyAccount, scopeKeys, type AccountState } from "./model.ts";
import type { Revision } from "./model.ts";
import { reduceAccount, supersedes, type AccountInput } from "./reducer.ts";

const ORG = "org";
const projects = scopeKeys.projects(ORG);

const projectRow = (id: string, version: number, name = id) => ({
  family: "project" as const,
  id,
  value: { id, name, status: "ACTIVE" },
  revision: { kind: "zerops" as const, version },
});

const pushRows = (rows: ReadonlyArray<ReturnType<typeof projectRow>>): AccountInput => ({
  kind: "rows",
  scope: projects,
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows,
});

const delta = (change: {
  add: ReadonlyArray<string>;
  remove: ReadonlyArray<string>;
}): AccountInput => ({
  kind: "membership",
  scope: projects,
  generation: 1,
  delta: change,
});

const commit = (
  members: ReadonlyArray<string>,
  rows: ReadonlyArray<ReturnType<typeof projectRow>>,
): AccountInput => ({
  kind: "baseline-commit",
  scope: projects,
  generation: 1,
  via: "zerops-realtime",
  members,
  rows,
});

/** The projects scope of `ORG`, demanded and in its first attempt. */
function attached(): AccountState {
  return apply(emptyAccount, [
    {
      kind: "stream",
      key: scopeKeys.zeropsLink(ORG),
      now: 0,
      event: { kind: "demand", demanded: true },
    },
    { kind: "stream", key: projects, now: 0, event: { kind: "demand", demanded: true } },
    { kind: "stream", key: projects, now: 0, event: { kind: "attempt" } },
  ]);
}

function apply(state: AccountState, inputs: ReadonlyArray<AccountInput>): AccountState {
  return inputs.reduce((current, input) => reduceAccount(current, input).state, state);
}

describe("reduceAccount", () => {
  it("keeps the newer Zerops version of a row whichever order the rows arrive in", () => {
    const newer = projectRow("p1", 5, "renamed");
    const older = projectRow("p1", 4, "old");

    for (const order of [
      [newer, older],
      [older, newer],
    ]) {
      const state = apply(
        attached(),
        order.map((row) => pushRows([row])),
      );
      expect(state.project.get("p1")?.content).toEqual({ kind: "value", value: newer.value });
    }
  });

  it("ignores input a superseded attempt delivers late", () => {
    const reattached = apply(attached(), [
      { kind: "stream", key: projects, now: 0, event: { kind: "parent-lost" } },
      { kind: "stream", key: projects, now: 0, event: { kind: "attempt" } },
    ]);
    const late = reduceAccount(reattached, pushRows([projectRow("p1", 9)]));

    expect(late.state).toBe(reattached);
    expect(late.changed.size).toBe(0);
  });

  it("lists a member before its row and asks for the row; a row before its member stays unlisted", () => {
    const memberFirst = reduceAccount(attached(), delta({ add: ["p2"], remove: [] }));
    expect(memberFirst.state.memberships.get(projects)?.members.get("p2")).toBe("member");
    expect(memberFirst.directives).toEqual([{ kind: "resolve-rows", key: projects, ids: ["p2"] }]);
    expect(memberFirst.changed).toEqual(new Set([`members:${projects}`]));

    const rowFirst = apply(attached(), [pushRows([projectRow("p3", 1)])]);
    expect(rowFirst.memberships.get(projects)?.members.has("p3") ?? false).toBe(false);
    const joined = reduceAccount(rowFirst, delta({ add: ["p3"], remove: [] }));
    expect(joined.state.memberships.get(projects)?.members.get("p3")).toBe("member");
    expect(joined.directives).toEqual([]);
  });

  it("commits a baseline atomically and replays the changes that arrived while it was read", () => {
    const begun = apply(attached(), [{ kind: "baseline-begin", scope: projects, generation: 1 }]);
    const during = apply(begun, [
      delta({ add: ["p9"], remove: [] }),
      delta({ add: [], remove: ["p1"] }),
      pushRows([projectRow("p1", 7, "pushed")]),
    ]);
    expect(during.memberships.get(projects)?.coverage).toBe("unknown");

    const committed = reduceAccount(
      during,
      commit(["p1", "p2"], [projectRow("p1", 6), projectRow("p2", 1)]),
    );
    const membership = committed.state.memberships.get(projects);
    expect(membership?.coverage).toBe("complete");
    expect(membership?.baseline).toBeNull();
    expect([...(membership?.members ?? [])]).toEqual([
      ["p1", "absent-unverified"],
      ["p2", "member"],
      ["p9", "member"],
    ]);
    expect(committed.state.project.get("p1")?.content).toEqual({
      kind: "value",
      value: projectRow("p1", 7, "pushed").value,
    });
    expect(committed.directives).toEqual([
      { kind: "resolve-rows", key: projects, ids: ["p9"] },
      { kind: "verify-absence", key: projects, ids: ["p1"] },
    ]);
  });

  it("deletes a fact only on proof: transport events and absence keep it", () => {
    const held = apply(attached(), [
      { kind: "baseline-begin", scope: projects, generation: 1 },
      commit(["p1"], [projectRow("p1", 1)]),
    ]);
    const transport = apply(held, [
      { kind: "stream", key: projects, now: 0, event: { kind: "parent-lost" } },
      {
        kind: "stream",
        key: scopeKeys.zeropsLink(ORG),
        now: 0,
        event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "closed" } },
      },
      { kind: "stream", key: projects, now: 0, event: { kind: "close" } },
    ]);
    expect(transport.project).toBe(held.project);
    expect(transport.memberships).toBe(held.memberships);

    const absent = apply(held, [delta({ add: [], remove: ["p1"] })]);
    expect(absent.project.get("p1")?.content.kind).toBe("value");

    const deleted = apply(absent, [
      { kind: "proven-deletion", family: "project", id: "p1", evidence: "GET /project/p1 404" },
    ]);
    expect(deleted.project.get("p1")?.content).toEqual({
      kind: "deleted",
      evidence: "GET /project/p1 404",
    });
    expect(deleted.memberships.get(projects)?.members.has("p1")).toBe(false);

    const denied = apply(absent, [
      { kind: "access", family: "project", id: "p1", access: "denied" },
    ]);
    expect(denied.project.get("p1")).toMatchObject({
      content: { kind: "purged" },
      access: "denied",
    });
    expect(denied.memberships.get(projects)?.members.has("p1")).toBe(false);
  });

  describe("running work", () => {
    const running = scopeKeys.running(ORG);
    const processRow = (id: string, version: number, status: string, projectId = "x") => ({
      family: "process" as const,
      id,
      value: { id, projectId, status, actionName: "stack.deploy" },
      revision: { kind: "zerops" as const, version },
    });
    const live = (): AccountState =>
      apply(emptyAccount, [
        {
          kind: "stream",
          key: scopeKeys.zeropsLink(ORG),
          now: 0,
          event: { kind: "demand", demanded: true },
        },
        { kind: "stream", key: running, now: 0, event: { kind: "demand", demanded: true } },
        { kind: "stream", key: running, now: 0, event: { kind: "attempt" } },
        { kind: "baseline-begin", scope: running, generation: 1 },
        {
          kind: "baseline-commit",
          scope: running,
          generation: 1,
          via: "zerops-realtime",
          members: [],
          rows: [],
        },
      ]);
    const rows = (...batch: ReturnType<typeof processRow>[]): AccountInput => ({
      kind: "rows",
      scope: running,
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: batch,
    });
    const members = (add: string[], remove: string[]): AccountInput => ({
      kind: "membership",
      scope: running,
      generation: 1,
      delta: { add, remove },
    });

    it("never lights a process that starts and finishes inside one batch", () => {
      const reduction = reduceAccount(
        live(),
        rows(processRow("q", 1, "RUNNING"), processRow("q", 2, "FINISHED")),
      );
      expect(reduction.state.running.get("x") ?? new Set()).toEqual(new Set());
      expect(reduction.state.process.get("q")?.content).toMatchObject({
        value: { status: "FINISHED" },
      });
    });

    it("lights a running row before its membership and clears it on the terminal row", () => {
      const lit = apply(live(), [rows(processRow("q", 1, "RUNNING"))]);
      expect(lit.running.get("x")).toEqual(new Set(["q"]));

      const joined = reduceAccount(lit, members(["q"], []));
      expect(joined.directives).toEqual([]);
      expect(joined.state.running.get("x")).toEqual(new Set(["q"]));

      const ended = reduceAccount(joined.state, rows(processRow("q", 2, "FINISHED")));
      expect(ended.state.running.get("x")).toEqual(new Set());
      expect(ended.changed.has("running:x")).toBe(true);
    });

    it("clears a process that finished during an outage without inventing how it ended", () => {
      const lit = apply(live(), [members(["q"], []), rows(processRow("q", 1, "RUNNING"))]);
      expect(lit.running.get("x")).toEqual(new Set(["q"]));

      const recovered = apply(lit, [
        { kind: "stream", key: running, now: 0, event: { kind: "parent-lost" } },
        { kind: "stream", key: running, now: 0, event: { kind: "attempt" } },
        { kind: "baseline-begin", scope: running, generation: 2 },
      ]);
      expect(recovered.running.get("x")).toEqual(new Set(["q"]));

      const rebaselined = reduceAccount(recovered, {
        kind: "baseline-commit",
        scope: running,
        generation: 2,
        via: "zerops-realtime",
        members: [],
        rows: [],
      });
      expect(rebaselined.state.running.get("x")).toEqual(new Set());
      expect(rebaselined.state.memberships.get(running)?.members.get("q")).toBe("removed");
      expect(rebaselined.state.process.get("q")?.content).toMatchObject({
        value: { status: "RUNNING" },
      });
      expect(rebaselined.directives).toEqual([]);
    });
  });

  describe("supersedes", () => {
    const zerops = (version: number | null): Revision => ({ kind: "zerops", version });
    const hq = (generation: number, sequence: number): Revision => ({
      kind: "hq-observation",
      generation,
      sequence,
    });
    const mate = (incarnation: string, revision: number): Revision => ({
      kind: "mate-attention",
      incarnation,
      revision,
    });

    it.each([
      { name: "newer zerops version", current: zerops(4), incoming: zerops(5), push: true },
      { name: "older zerops version", current: zerops(5), incoming: zerops(4), push: false },
      { name: "equal zerops version", current: zerops(5), incoming: zerops(5), push: false },
      {
        name: "unversioned over versioned",
        current: zerops(5),
        incoming: zerops(null),
        push: false,
      },
      {
        name: "versioned over unversioned",
        current: zerops(null),
        incoming: zerops(1),
        push: true,
      },
      { name: "later hq place", current: hq(1, 3), incoming: hq(1, 4), push: true },
      { name: "earlier connection's hq", current: hq(2, 0), incoming: hq(1, 9), push: false },
      { name: "next connection's hq", current: hq(1, 9), incoming: hq(2, 0), push: true },
      { name: "newer mate revision", current: mate("a", 5), incoming: mate("a", 6), push: true },
      { name: "older mate revision", current: mate("a", 6), incoming: mate("a", 5), push: false },
      { name: "hq relay over mate's own", current: mate("a", 1), incoming: hq(9, 9), push: false },
      { name: "mate's own over hq relay", current: hq(9, 9), incoming: mate("a", 1), push: true },
      {
        name: "another incarnation, pushed",
        current: mate("a", 9),
        incoming: mate("b", 1),
        push: false,
      },
      { name: "zerops against hq", current: zerops(1), incoming: hq(1, 1), push: false },
    ])("$name: $push", ({ current, incoming, push }) => {
      expect(supersedes(current, incoming, "push")).toBe(push);
    });

    it("lets another incarnation in only through a baseline", () => {
      expect(supersedes(mate("a", 9), mate("b", 1), "baseline")).toBe(true);
    });
  });
});
