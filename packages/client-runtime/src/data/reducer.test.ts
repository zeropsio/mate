import { describe, expect, it } from "vite-plus/test";

import { linkKeys, emptyAccount, type AccountState } from "./model.ts";
import type { Revision } from "./model.ts";
import { reduceAccount, supersedes, type AccountInput } from "./reducer.ts";
import { historyScope, runningScope } from "./families/process.ts";
import { projectsScope } from "./families/project.ts";
import { factOf, indexOf } from "./reducer.ts";
import { processValue } from "./__fixtures__/account.ts";

const ORG = "org";
const scope = runningScope(ORG);

const row = (id: string, version: number, status = "RUNNING") => ({
  family: "process" as const,
  id,
  value: processValue({ id, projectId: "x", status }),
  revision: { kind: "zerops" as const, version },
});

const pushRows = (rows: ReadonlyArray<ReturnType<typeof row>>): AccountInput => ({
  kind: "rows",
  scope: scope,
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
  scope: scope,
  generation: 1,
  delta: change,
});

const commit = (
  members: ReadonlyArray<string>,
  rows: ReadonlyArray<ReturnType<typeof row>>,
): AccountInput => ({
  kind: "baseline-commit",
  scope: scope,
  generation: 1,
  via: "zerops-realtime",
  members,
  rows,
});

/** The scope scope of `ORG`, demanded and in its first attempt. */
function attached(): AccountState {
  return apply(emptyAccount, [
    {
      kind: "stream",
      key: linkKeys.zerops(ORG),
      now: 0,
      event: { kind: "demand", demanded: true },
    },
    { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
    { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
  ]);
}

function apply(state: AccountState, inputs: ReadonlyArray<AccountInput>): AccountState {
  return inputs.reduce((current, input) => reduceAccount(current, input).state, state);
}

describe("reduceAccount", () => {
  it("keeps the newer Zerops version of a row whichever order the rows arrive in", () => {
    const newer = row("p1", 5, "FINISHED");
    const older = row("p1", 4, "RUNNING");

    for (const order of [
      [newer, older],
      [older, newer],
    ]) {
      const state = apply(
        attached(),
        order.map((row) => pushRows([row])),
      );
      expect(factOf(state, "process", "p1")?.content).toEqual({
        kind: "value",
        value: newer.value,
      });
    }
  });

  it("ignores input a superseded attempt delivers late", () => {
    const reattached = apply(attached(), [
      { kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } },
      { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
    ]);
    const late = reduceAccount(reattached, pushRows([row("p1", 9)]));

    expect(late.state).toBe(reattached);
    expect(late.changed.size).toBe(0);
  });

  it("lists a member before its row and asks for the row; a row before its member stays unlisted", () => {
    const memberFirst = reduceAccount(attached(), delta({ add: ["p2"], remove: [] }));
    expect(memberFirst.state.memberships.get(scope)?.members.get("p2")).toBe("member");
    expect(memberFirst.directives).toEqual([{ kind: "resolve-rows", key: scope, ids: ["p2"] }]);
    expect(memberFirst.changed).toEqual(new Set([`members:${scope}`]));

    const rowFirst = apply(attached(), [pushRows([row("p3", 1)])]);
    expect(rowFirst.memberships.get(scope)?.members.has("p3") ?? false).toBe(false);
    const joined = reduceAccount(rowFirst, delta({ add: ["p3"], remove: [] }));
    expect(joined.state.memberships.get(scope)?.members.get("p3")).toBe("member");
    expect(joined.directives).toEqual([]);
  });

  it("commits a baseline atomically and replays the changes that arrived while it was read", () => {
    const begun = apply(attached(), [{ kind: "baseline-begin", scope: scope, generation: 1 }]);
    const during = apply(begun, [
      delta({ add: ["p9"], remove: [] }),
      delta({ add: [], remove: ["p1"] }),
      pushRows([row("p1", 7, "CANCELING")]),
    ]);
    expect(during.memberships.get(scope)?.coverage).toBe("unknown");

    const committed = reduceAccount(during, commit(["p1", "p2"], [row("p1", 6), row("p2", 1)]));
    const membership = committed.state.memberships.get(scope);
    expect(membership?.coverage).toBe("complete");
    expect(membership?.baseline).toBeNull();
    expect([...(membership?.members ?? [])]).toEqual([
      ["p1", "removed"],
      ["p2", "member"],
      ["p9", "member"],
    ]);
    expect(factOf(committed.state, "process", "p1")?.content).toEqual({
      kind: "value",
      value: row("p1", 7, "CANCELING").value,
    });
    expect(committed.directives).toEqual([{ kind: "resolve-rows", key: scope, ids: ["p9"] }]);
  });

  it("deletes a fact only on proof: transport events and absence keep it", () => {
    const held = apply(attached(), [
      { kind: "baseline-begin", scope: scope, generation: 1 },
      commit(["p1"], [row("p1", 1)]),
    ]);
    const transport = apply(held, [
      { kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } },
      {
        kind: "stream",
        key: linkKeys.zerops(ORG),
        now: 0,
        event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "closed" } },
      },
      { kind: "stream", key: scope, now: 0, event: { kind: "close" } },
    ]);
    expect(transport.facts).toBe(held.facts);
    expect(transport.memberships).toBe(held.memberships);

    const absent = apply(held, [delta({ add: [], remove: ["p1"] })]);
    expect(factOf(absent, "process", "p1")?.content.kind).toBe("value");

    const deleted = apply(absent, [
      { kind: "proven-deletion", family: "process", id: "p1", evidence: "GET /process/p1 404" },
    ]);
    expect(factOf(deleted, "process", "p1")?.content).toEqual({
      kind: "deleted",
      evidence: "GET /process/p1 404",
    });
    expect(deleted.memberships.get(scope)?.members.has("p1")).toBe(false);

    const denied = apply(absent, [
      { kind: "access", family: "process", id: "p1", access: "denied" },
    ]);
    expect(factOf(denied, "process", "p1")).toMatchObject({
      content: { kind: "purged" },
      access: "denied",
    });
    expect(denied.memberships.get(scope)?.members.has("p1")).toBe(false);
  });

  describe("the project roster", () => {
    const projects = projectsScope(ORG);
    const project = (id: string, version: number) => ({
      family: "project" as const,
      id,
      value: { id, name: id, status: "ACTIVE" },
      revision: { kind: "zerops" as const, version },
    });
    const live = (): AccountState =>
      apply(emptyAccount, [
        {
          kind: "stream",
          key: linkKeys.zerops(ORG),
          now: 0,
          event: { kind: "demand", demanded: true },
        },
        { kind: "stream", key: projects, now: 0, event: { kind: "demand", demanded: true } },
        { kind: "stream", key: projects, now: 0, event: { kind: "attempt" } },
        { kind: "baseline-begin", scope: projects, generation: 1 },
        {
          kind: "baseline-commit",
          scope: projects,
          generation: 1,
          via: "zerops-realtime",
          members: ["p1", "p2"],
          rows: [project("p1", 1), project("p2", 1)],
        },
      ]);

    it("asks whether a project that left the roster is gone or no longer the viewer's", () => {
      const left = reduceAccount(live(), {
        kind: "membership",
        scope: projects,
        generation: 1,
        delta: { add: [], remove: ["p1"] },
      });
      expect(left.state.memberships.get(projects)?.members.get("p1")).toBe("absent-unverified");
      expect(factOf(left.state, "project", "p1")?.content.kind).toBe("value");
      expect(left.directives).toEqual([{ kind: "verify-absence", key: projects, ids: ["p1"] }]);

      const missing = reduceAccount(
        apply(live(), [{ kind: "baseline-begin", scope: projects, generation: 1 }]),
        {
          kind: "baseline-commit",
          scope: projects,
          generation: 1,
          via: "zerops-realtime",
          members: ["p2"],
          rows: [project("p2", 1)],
        },
      );
      expect(missing.directives).toEqual([{ kind: "verify-absence", key: projects, ids: ["p1"] }]);
    });

    it.each(["deleted", "denied"] as const)(
      "asks nothing again of a project its owner %s, when a later baseline lacks it",
      (word) => {
        const settled = apply(live(), [
          word === "deleted"
            ? { kind: "proven-deletion", family: "project", id: "p1", evidence: "404" }
            : { kind: "access", family: "project", id: "p1", access: "denied" },
          { kind: "baseline-begin", scope: projects, generation: 1 },
        ]);
        const again = reduceAccount(settled, {
          kind: "baseline-commit",
          scope: projects,
          generation: 1,
          via: "zerops-realtime",
          members: ["p2"],
          rows: [project("p2", 1)],
        });
        expect(again.directives).toEqual([]);
      },
    );
  });

  describe("running work", () => {
    const running = runningScope(ORG);
    const processRow = (id: string, version: number, status: string, projectId = "x") => ({
      family: "process" as const,
      id,
      value: processValue({ id, projectId, status }),
      revision: { kind: "zerops" as const, version },
    });
    const live = (): AccountState =>
      apply(emptyAccount, [
        {
          kind: "stream",
          key: linkKeys.zerops(ORG),
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
      expect(indexOf(reduction.state, "running", "x") ?? new Set()).toEqual(new Set());
      expect(factOf(reduction.state, "process", "q")?.content).toMatchObject({
        value: { status: "FINISHED" },
      });
    });

    it("lights a running row before its membership and clears it on the terminal row", () => {
      const lit = apply(live(), [rows(processRow("q", 1, "RUNNING"))]);
      expect(indexOf(lit, "running", "x")).toEqual(new Set(["q"]));

      const joined = reduceAccount(lit, members(["q"], []));
      expect(joined.directives).toEqual([]);
      expect(indexOf(joined.state, "running", "x")).toEqual(new Set(["q"]));

      const ended = reduceAccount(joined.state, rows(processRow("q", 2, "FINISHED")));
      expect(indexOf(ended.state, "running", "x")).toEqual(new Set());
      expect(ended.changed.has("index:running:x")).toBe(true);
    });

    it("keeps every process of a project it holds under the project, running or ended", () => {
      const ended = apply(live(), [
        members(["q"], []),
        rows(processRow("q", 1, "RUNNING")),
        rows(processRow("q", 2, "FINISHED")),
        members([], ["q"]),
        rows(processRow("r", 1, "FAILED", "y")),
      ]);
      expect(indexOf(ended, "running", "x")).toEqual(new Set());
      expect(indexOf(ended, "project", "x")).toEqual(new Set(["q"]));
      expect(indexOf(ended, "project", "y")).toEqual(new Set(["r"]));
    });

    it("clears a process that finished during an outage without inventing how it ended", () => {
      const lit = apply(live(), [members(["q"], []), rows(processRow("q", 1, "RUNNING"))]);
      expect(indexOf(lit, "running", "x")).toEqual(new Set(["q"]));

      const recovered = apply(lit, [
        { kind: "stream", key: running, now: 0, event: { kind: "parent-lost" } },
        { kind: "stream", key: running, now: 0, event: { kind: "attempt" } },
        { kind: "baseline-begin", scope: running, generation: 2 },
      ]);
      expect(indexOf(recovered, "running", "x")).toEqual(new Set(["q"]));

      const rebaselined = reduceAccount(recovered, {
        kind: "baseline-commit",
        scope: running,
        generation: 2,
        via: "zerops-realtime",
        members: [],
        rows: [],
      });
      expect(indexOf(rebaselined.state, "running", "x")).toEqual(new Set());
      expect(rebaselined.state.memberships.get(running)?.members.get("q")).toBe("removed");
      expect(factOf(rebaselined.state, "process", "q")?.content).toMatchObject({
        value: { status: "RUNNING" },
      });
      expect(rebaselined.directives).toEqual([]);
    });
  });

  describe("a detail listing", () => {
    const running = runningScope(ORG);
    const history = historyScope(ORG, "x");
    const rowOf = (id: string, version: number, status: string) => ({
      family: "process" as const,
      id,
      value: processValue({ id, projectId: "x", status }),
      revision: { kind: "zerops" as const, version },
    });

    it("lists a demanded history and keeps the running index on the running scope's word", () => {
      const lit = apply(emptyAccount, [
        {
          kind: "stream",
          key: linkKeys.zerops(ORG),
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
          members: ["q"],
          rows: [rowOf("q", 1, "RUNNING")],
        },
        { kind: "stream", key: history, now: 0, event: { kind: "demand", demanded: true } },
        { kind: "stream", key: history, now: 0, event: { kind: "attempt" } },
        { kind: "baseline-begin", scope: history, generation: 1 },
        {
          kind: "baseline-commit",
          scope: history,
          generation: 1,
          via: "zerops-read",
          members: ["q", "old"],
          rows: [rowOf("q", 2, "RUNNING"), rowOf("old", 3, "FINISHED")],
        },
      ]);
      expect([...(lit.memberships.get(history)?.members ?? [])]).toEqual([
        ["q", "member"],
        ["old", "member"],
      ]);
      expect(factOf(lit, "process", "q")?.scope).toBe(history);
      expect(indexOf(lit, "running", "x")).toEqual(new Set(["q"]));

      const stopped = reduceAccount(lit, {
        kind: "membership",
        scope: running,
        generation: 1,
        delta: { add: [], remove: ["q"] },
      });
      expect(indexOf(stopped.state, "running", "x")).toEqual(new Set());
      expect(stopped.state.memberships.get(history)?.members.get("q")).toBe("member");
    });
  });

  describe("an end read after an outage", () => {
    const history = historyScope(ORG, "x");
    const commitHistory = (status: string, version: number | null): AccountInput => ({
      kind: "baseline-commit",
      scope: history,
      generation: 1,
      via: "zerops-read",
      members: ["q"],
      rows: [
        {
          family: "process",
          id: "q",
          value: processValue({ id: "q", projectId: "x", status }),
          revision: { kind: "zerops", version },
        },
      ],
    });
    const pushedThen = (status: string) =>
      apply(attached(), [
        pushRows([row("q", 3, status)]),
        { kind: "stream", key: history, now: 0, event: { kind: "demand", demanded: true } },
        { kind: "stream", key: history, now: 0, event: { kind: "attempt" } },
        { kind: "baseline-begin", scope: history, generation: 1 },
      ]);

    it.each([
      {
        name: "a read's end over a stale running push",
        pushed: "RUNNING",
        read: "FINISHED",
        is: "FINISHED",
      },
      {
        name: "never a read's running over a pushed end",
        pushed: "FAILED",
        read: "RUNNING",
        is: "FAILED",
      },
      {
        name: "never an unversioned running over a running push",
        pushed: "RUNNING",
        read: "PENDING",
        is: "RUNNING",
      },
    ])("takes $name", ({ pushed, read, is }) => {
      const state = apply(pushedThen(pushed), [commitHistory(read, null)]);
      expect(factOf(state, "process", "q")?.content).toMatchObject({ value: { status: is } });
    });
  });

  describe("supersedes", () => {
    const zerops = (version: number | null): Revision => ({ kind: "zerops", version });
    const hq = (incarnation: string, revision: number): Revision => ({
      kind: "hq",
      incarnation,
      revision,
    });
    const mate = (incarnation: string, revision: number, live = true): Revision => ({
      kind: "mate-attention",
      incarnation,
      revision,
      live,
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
      { name: "newer hq revision", current: hq("a", 3), incoming: hq("a", 4), push: true },
      { name: "older hq revision", current: hq("a", 4), incoming: hq("a", 3), push: false },
      { name: "equal hq revision", current: hq("a", 4), incoming: hq("a", 4), push: false },
      {
        name: "another hq incarnation, pushed",
        current: hq("a", 9),
        incoming: hq("b", 1),
        push: false,
      },
      { name: "newer mate revision", current: mate("a", 5), incoming: mate("a", 6), push: true },
      { name: "older mate revision", current: mate("a", 6), incoming: mate("a", 5), push: false },
      {
        name: "newer mate revision HQ stored",
        current: mate("a", 5),
        incoming: mate("a", 6, false),
        push: true,
      },
      {
        name: "hq relay over mate's own",
        current: mate("a", 1),
        incoming: hq("a", 9),
        push: false,
      },
      { name: "mate's own over hq relay", current: hq("a", 9), incoming: mate("a", 1), push: true },
      {
        name: "another incarnation, live, pushed",
        current: mate("a", 9),
        incoming: mate("b", 1),
        push: true,
      },
      { name: "zerops against hq", current: zerops(1), incoming: hq("a", 1), push: false },
    ])("$name: $push", ({ current, incoming, push }) => {
      expect(supersedes(current, incoming, "push")).toBe(push);
    });

    it("lets another HQ incarnation in only through a baseline", () => {
      expect(supersedes(hq("a", 9), hq("b", 1), "baseline")).toBe(true);
    });

    it.each(["baseline", "push"] as const)(
      "lets another Mate incarnation in by being live, never by being stored: %s",
      (method) => {
        expect(supersedes(mate("a", 9), mate("b", 1), method)).toBe(true);
        expect(supersedes(mate("a", 9), mate("b", 1, false), method)).toBe(false);
        expect(supersedes(mate("a", 9, false), mate("b", 1, false), method)).toBe(false);
      },
    );
  });
});
