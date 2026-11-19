import { expect, it } from "vite-plus/test";
import { ORG, processValue } from "./__fixtures__/account.ts";
import {
  engineRun,
  engineHeader,
  engineRequest,
  noteItem,
  personItem,
} from "./__fixtures__/mateEngine.ts";
import {
  engineConversationLink,
  engineConversationScopes,
  engineFactId,
  type EngineConversationKey,
} from "./families/mateEngine.ts";
import { runningScope } from "./families/process.ts";
import { hqAppsScope, placementsScope } from "./families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState, type Revision } from "./model.ts";
import {
  reduceAccount,
  supersedes,
  factOf,
  indexOf,
  type AccountInput,
  type Row,
} from "./reducer.ts";
import { readsOfState } from "./store.ts";

const scope = runningScope(ORG);

const row = (id: string, version: number, status = "RUNNING") => ({
  family: "process" as const,
  id,
  value: processValue({ id, projectId: "x", status }),
  revision: { kind: "zerops" as const, version },
});

const pushRows = (rows: ReadonlyArray<ReturnType<typeof row>>): AccountInput => ({
  kind: "rows",
  scope,
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
  scope,
  generation: 1,
  delta: change,
});

const commit = (
  members: ReadonlyArray<string>,
  rows: ReadonlyArray<ReturnType<typeof row>>,
): AccountInput => ({
  kind: "baseline-commit",
  scope,
  generation: 1,
  via: "zerops-realtime",
  members,
  rows,
});

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

// witness: packages/client-runtime/src/data/reducer.ts | input.generation !== streamOf(state, input.scope).generation → input.generation > streamOf(state, input.scope).generation
it("ST1: Input that a superseded attempt delivers late is ignored", () => {
  const reattached = apply(attached(), [
    { kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } },
    { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
  ]);
  const late = reduceAccount(reattached, pushRows([row("p1", 9)]));

  expect(late.state).toBe(reattached);
  expect(late.changed.size).toBe(0);
});

// witness: packages/client-runtime/src/data/reducer.ts | staged: [...membership.baseline.staged, delta] → staged: [delta]
it("ST2: A baseline is committed at once, and the changes that arrived while it was read are replayed on it", () => {
  const begun = apply(attached(), [{ kind: "baseline-begin", scope, generation: 1 }]);
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
});

// witness: packages/client-runtime/src/data/reducer.ts | ? { ...current, content: { kind: "deleted", evidence: input.evidence } } → ? { ...current, content: { kind: "purged" } }
it("ST3: A fact is deleted only on proof: transport events and absence keep it", () => {
  const held = apply(attached(), [
    { kind: "baseline-begin", scope, generation: 1 },
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

  const denied = apply(absent, [{ kind: "access", family: "process", id: "p1", access: "denied" }]);
  expect(factOf(denied, "process", "p1")).toMatchObject({
    content: { kind: "purged" },
    access: "denied",
  });
  expect(denied.memberships.get(scope)?.members.has("p1")).toBe(false);
  expect(denied.memberships.get(scope)?.excluded).toEqual(new Set(["p1"]));
});

// witness: packages/client-runtime/src/data/reducer.ts | if (unresolved.length > 0) directives.push → if (membership.coverage === "complete" && unresolved.length > 0) directives.push
it("ST4: A member listed before its row is asked for; a row that arrives before its member stays unlisted", () => {
  const memberFirst = reduceAccount(attached(), delta({ add: ["p2"], remove: [] }));
  expect(memberFirst.state.memberships.get(scope)?.members.get("p2")).toBe("member");
  expect(memberFirst.directives).toEqual([{ kind: "resolve-rows", key: scope, ids: ["p2"] }]);

  const rowFirst = apply(attached(), [pushRows([row("p3", 1)])]);
  expect(rowFirst.memberships.get(scope)?.members.has("p3") ?? false).toBe(false);
  const joined = reduceAccount(rowFirst, delta({ add: ["p3"], remove: [] }));
  expect(joined.state.memberships.get(scope)?.members.get("p3")).toBe("member");
  expect(joined.directives).toEqual([]);
});

// witness: packages/client-runtime/src/data/reducer.ts | draft.set(key, fact); → if (draft.get(key) === state.facts.get(key)) draft.set(key, fact);
it("ST5: A process that starts and finishes inside one batch is never lit as running", () => {
  const live = apply(attached(), [
    { kind: "baseline-begin", scope, generation: 1 },
    commit([], []),
  ]);
  const reduction = reduceAccount(
    live,
    pushRows([row("q", 1, "RUNNING"), row("q", 2, "FINISHED")]),
  );
  expect(indexOf(reduction.state, "running", "x")).toEqual(new Set());
  expect(factOf(reduction.state, "process", "q")?.content).toMatchObject({
    value: { status: "FINISHED" },
  });
});

// witness: packages/client-runtime/src/data/reducer.ts | : incoming.seq > current.seq; → : incoming.seq >= current.seq;
it("ST6: An engine conversation's records are ordered by epoch, then sequence", () => {
  const conversation = (epoch: number, seq: number, environmentId = "env-a"): Revision => ({
    kind: "mate-conversation",
    environmentId,
    epoch,
    seq,
  });
  const order = (current: Revision, incoming: Revision) => [
    supersedes(current, incoming, "push"),
    supersedes(current, incoming, "baseline"),
  ];
  expect(order(conversation(4, 12), conversation(4, 13))).toEqual([true, true]);
  expect(order(conversation(4, 12), conversation(4, 12))).toEqual([false, false]);
  expect(order(conversation(4, 13), conversation(4, 12))).toEqual([false, false]);
  expect(order(conversation(4, 13), conversation(5, 2))).toEqual([true, true]);
  expect(order(conversation(5, 2), conversation(4, 13))).toEqual([false, false]);
  expect(order(conversation(4, 13), conversation(9, 99, "env-b"))).toEqual([false, true]);
  expect(order({ kind: "mate-link", sequence: 1 }, conversation(4, 1))).toEqual([false, false]);
});

const ENV = "env-ada";
const revision = (seq: number): Revision => ({
  kind: "mate-conversation",
  environmentId: ENV,
  epoch: 4,
  seq,
});

/** The conversation's link and four scopes demanded and in their first attempt. */
function attachConversation(state: AccountState, key: EngineConversationKey): AccountState {
  const scopes = Object.values(engineConversationScopes(key));
  return apply(state, [
    {
      kind: "stream",
      key: engineConversationLink(key),
      now: 0,
      event: { kind: "demand", demanded: true },
    },
    ...scopes.flatMap((key): AccountInput[] => [
      { kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } },
      { kind: "stream", key, now: 0, event: { kind: "attempt" } },
    ]),
  ]);
}

function conversationRows(key: EngineConversationKey): ReadonlyArray<Row> {
  const seq = 3;
  const run = engineRun(key.conversationId, 1, { rev: seq });
  const at = (id: string) => engineFactId(key.environmentId, id);
  return [
    {
      family: "mateEngineConversation",
      id: at(key.conversationId),
      value: {
        environmentId: key.environmentId,
        header: engineHeader(key.conversationId),
        window: { oldestOrdinal: 1, earlier: false },
      },
      revision: revision(seq),
    },
    {
      family: "mateEngineRun",
      id: at(run.id),
      value: { ...run, environmentId: key.environmentId },
      revision: revision(seq),
    },
    {
      family: "mateEngineItem",
      id: at(`${run.id}/i/1`),
      value: { ...personItem(run.id, 1, "Deploy the api"), environmentId: key.environmentId },
      revision: revision(1),
    },
    {
      family: "mateEngineItem",
      id: at(`${run.id}/i/2`),
      value: {
        ...noteItem(run.id, 2, "Deployed.", { rev: seq }),
        environmentId: key.environmentId,
      },
      revision: revision(seq),
    },
    {
      family: "mateEngineRequest",
      id: at(`${run.id}/q/1`),
      value: {
        ...engineRequest(run.id, 1, { kind: "approval", requestKind: "command", detail: "ls" }),
        environmentId: key.environmentId,
      },
      revision: revision(2),
    },
  ];
}

const conversationDelivery = (key: EngineConversationKey): AccountInput => ({
  kind: "delivery",
  via: "mate-direct",
  scopes: Object.values(engineConversationScopes(key)).map((scope) => ({ scope, generation: 1 })),
  reset: true,
  partial: true,
  rows: conversationRows(key),
  removals: [],
});

// witness: packages/client-runtime/src/data/reducer.ts | memberships.delete(scope); → memberships.set(scope, { ...EMPTY_MEMBERSHIP, coverage: "complete" });
it("ST7: A forgotten conversation's memberships, coverage and index entries are dropped, never claimed deleted", () => {
  const ada = { environmentId: ENV, conversationId: "thread-ada" };
  const scout = { environmentId: ENV, conversationId: "thread-scout" };
  const held = apply(attachConversation(attachConversation(emptyAccount, ada), scout), [
    conversationDelivery(ada),
    conversationDelivery(scout),
  ]);
  const state = apply(held, [
    { kind: "forget", scopes: Object.values(engineConversationScopes(ada)) },
  ]);
  const read = readsOfState(state);
  const scopes = engineConversationScopes(ada);
  expect(read.members(scopes.item).ids).toEqual([]);
  expect(read.coverage(scopes.item)).toBe("unknown");
  expect(indexOf(state, "engineItemsIn", engineFactId(ENV, "thread-ada")).size).toBe(0);
  expect(indexOf(state, "engineItemsIn", engineFactId(ENV, "thread-scout")).size).toBe(2);
  expect(read.members(scopes.item).excluded).toEqual([]);
});

const apps = hqAppsScope(ORG);
const placements = placementsScope(ORG);

const shop: Row = {
  family: "hqApp",
  id: "shop",
  value: {
    id: "shop",
    name: "Shop",
    contents: { empty: false, deletingProjectIds: [] },
    projectIds: [],
    births: [],
    environments: [],
    changes: [],
    releaseOffer: null,
  },
  revision: { kind: "hq", incarnation: "a", revision: 1 },
};

/** The link and both scopes demanded and in their first attempt (generation 1). */
function attachedHq(): AccountState {
  const now = 0;
  return apply(emptyAccount, [
    { kind: "stream", key: linkKeys.hq(ORG), now, event: { kind: "demand", demanded: true } },
    ...[apps, placements].flatMap((key): AccountInput[] => [
      { kind: "stream", key, now, event: { kind: "demand", demanded: true } },
      { kind: "stream", key, now, event: { kind: "attempt" } },
    ]),
  ]);
}

const scopes = (generation = 1) => [
  { scope: apps, generation },
  { scope: placements, generation },
];

const resetApps = (rows: ReadonlyArray<Row>, generation = 1): AccountInput => ({
  kind: "delivery",
  via: "hq-stream",
  scopes: scopes(generation),
  reset: true,
  rows,
  removals: [],
});

// witness: packages/client-runtime/src/data/reducer.ts | if (rows.length === 0) continue; → if (rows.length === 0) { if (input.reset) next = forget(next, [scope], changed); continue; }
it("ST8: An HQ record a reset leaves out is kept: only an explicit removal takes it", () => {
  const state = apply(attachedHq(), [resetApps([shop]), resetApps([])]);
  expect(readsOfState(state).fact("hqApp", "shop")).toMatchObject({
    kind: "known",
    value: { name: "Shop" },
  });
  expect(readsOfState(state).members(apps).ids).toEqual(["shop"]);
});

// witness: packages/client-runtime/src/data/reducer.ts | if (!current(state, input.scopes)) → if (input.kind === "hq-ready" && !current(state, input.scopes))
it("ST9: A delivery of a superseded HQ registration is fenced out whole", () => {
  const state = apply(attachedHq(), [resetApps([shop], 0)]);
  expect(readsOfState(state).fact("hqApp", "shop").kind).toBe("unknown");
});

// witness: packages/client-runtime/src/data/reducer.ts | ? reduceDelivery(state, input, changed) → ? completeScopes(reduceDelivery(state, input, changed), input.scopes, changed)
it("ST10: HQ scopes' coverage is complete only when HQ says catchup ended", () => {
  const delivered = apply(attachedHq(), [resetApps([shop])]);
  expect(readsOfState(delivered).coverage(apps)).toBe("unknown");
  const ready = apply(delivered, [{ kind: "hq-ready", scopes: scopes() }]);
  expect(readsOfState(ready).coverage(apps)).toBe("complete");
  expect(readsOfState(ready).coverage(placements)).toBe("complete");
});

const hq = (incarnation: string, revision: number): Revision => ({
  kind: "hq",
  incarnation,
  revision,
});

// witness: packages/client-runtime/src/data/reducer.ts | return current.version === null || incoming.version > current.version; → return current.version === null || incoming.version >= current.version;
it("ST11: A pushed Zerops version, HQ revision or Mate link reading replaces the held one only when it is newer in the same source, and never one of another source", () => {
  const zerops = (version: number | null): Revision => ({ kind: "zerops", version });
  const link = (sequence: number): Revision => ({ kind: "mate-link", sequence });
  const push = (current: Revision, incoming: Revision) => supersedes(current, incoming, "push");
  expect(push(zerops(4), zerops(5))).toBe(true);
  expect(push(zerops(5), zerops(4))).toBe(false);
  expect(push(zerops(5), zerops(5))).toBe(false);
  expect(push(hq("a", 3), hq("a", 4))).toBe(true);
  expect(push(hq("a", 4), hq("a", 3))).toBe(false);
  expect(push(hq("a", 4), hq("a", 4))).toBe(false);
  expect(push(zerops(1), hq("a", 1))).toBe(false);
  expect(push(link(3), link(4))).toBe(true);
  expect(push(link(4), link(3))).toBe(false);
  expect(push(hq("a", 1), link(9))).toBe(false);
});

// witness: packages/client-runtime/src/data/reducer.ts | : method === "baseline"; → : method === "push";
it("ST12: Another HQ incarnation replaces what is held only through a baseline, never through a push", () => {
  expect(supersedes(hq("a", 9), hq("b", 1), "push")).toBe(false);
  expect(supersedes(hq("a", 9), hq("b", 1), "baseline")).toBe(true);
});
