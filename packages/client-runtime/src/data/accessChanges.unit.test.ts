import { expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";

import { liveProjects, ORG, projectValue, zeropsVersion } from "./__fixtures__/account.ts";
import { membershipInputs } from "./__fixtures__/membership.ts";
import { followAccessChanges } from "./accountRuntime/accessChanges.ts";
import { projectsScope } from "./families/project.ts";
import type { AccountInput } from "./reducer.ts";
import { accountReadsAtom } from "./reads.ts";
import { makeAccountStore } from "./store.ts";

/** The account shown, its person's access heard: each move's projects, in order. */
const heard = (inputs: ReadonlyArray<AccountInput>) => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  inputs.forEach(store.dispatch);
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: ORG,
    demandDetail: () => () => {},
    renewHeld: () => {},
  });
  const moves: Array<ReadonlyArray<string>> = [];
  const stop = followAccessChanges(registry, (projects) => void moves.push(projects));
  return { store, moves, stop };
};

/** `/user/info` read again: the person's membership in the organization as it now answers. */
const membershipRead = (roleCode: string) => membershipInputs(roleCode, false, 1, ORG).slice(3, 5);

// witness: packages/client-runtime/src/data/accountRuntime/accessChanges.ts | if (role === "unknown") roles[projectId] = "unread"; → if (role === "unknown") roles[projectId] ??= "unread";
it("ST79: One change of the person's access is told once: a project whose role is still being read when the move is told counts its first role as no move", () => {
  const { store, moves, stop } = heard([
    ...membershipInputs("NO_ACCESS", false, 1, ORG),
    ...liveProjects(ORG, []),
  ]);
  // Promoted: Zerops lists the projects by id, then `/user/info` answers, then their rows.
  store.dispatch({
    kind: "membership",
    scope: projectsScope(ORG),
    generation: 1,
    delta: { add: ["p1", "p2"], remove: [] },
  });
  membershipRead("BASIC_USER").forEach(store.dispatch);
  store.dispatch({
    kind: "rows",
    scope: projectsScope(ORG),
    generation: 1,
    method: "read",
    via: "zerops-read",
    rows: ["p1", "p2"].map((id) => ({
      family: "project" as const,
      id,
      value: projectValue({ id }),
      revision: zeropsVersion(1),
    })),
  });
  expect(moves).toEqual([[]]);
  stop();
});

// witness: packages/client-runtime/src/data/accountRuntime/accessChanges.ts | if (ownMembership.reading || roster.reading || roster.unverified.length > 0) → if (roster.reading || roster.unverified.length > 0)
it("ST80: No reading of the person's access is taken while one of its reads is under way (their membership, the project roster read whole, a listed project's absence verified), so one change is told once in whichever order those reads land", () => {
  const roster = projectsScope(ORG);
  const rosterBegin: AccountInput = { kind: "baseline-begin", scope: roster, generation: 1 };
  const rosterCommit = (members: ReadonlyArray<string>): AccountInput => ({
    kind: "baseline-commit",
    scope: roster,
    generation: 1,
    via: "zerops-read",
    members,
    rows: [],
  });
  // `/user/info` read again: begun, then committed with the membership it now answers.
  const membershipBegin = membershipInputs("BASIC_USER", false, 1, ORG).slice(3, 4);
  const membershipCommit = (roleCode: string) =>
    membershipInputs(roleCode, false, 1, ORG).slice(4, 5);
  const denied = (id: string): AccountInput => ({
    kind: "access",
    family: "project",
    id,
    access: "denied",
  });
  const rowsRead: AccountInput = {
    kind: "rows",
    scope: roster,
    generation: 1,
    method: "read",
    via: "zerops-read",
    rows: ["p1", "p2"].map((id) => ({
      family: "project" as const,
      id,
      value: projectValue({ id }),
      revision: zeropsVersion(2),
    })),
  };
  // Demoted to No access: the roster read whole lists none, `/user/info` answers NO_ACCESS and
  // each project's owner refuses it; then, after it, access given back.
  const demotedUserInfoFirst = [
    rosterBegin,
    ...membershipBegin,
    ...membershipCommit("NO_ACCESS"),
    rosterCommit([]),
    denied("p1"),
    denied("p2"),
  ];
  const orders: ReadonlyArray<{
    readonly order: string;
    readonly inputs: ReadonlyArray<AccountInput>;
    readonly moves: ReadonlyArray<ReadonlyArray<string>>;
  }> = [
    {
      order: "the refusal before /user/info",
      inputs: [
        rosterBegin,
        ...membershipBegin,
        rosterCommit([]),
        denied("p1"),
        denied("p2"),
        ...membershipCommit("NO_ACCESS"),
      ],
      moves: [["p1", "p2"]],
    },
    { order: "/user/info before the roster", inputs: demotedUserInfoFirst, moves: [["p1", "p2"]] },
    {
      order: "access given back, /user/info before the roster lists the projects",
      inputs: [
        ...demotedUserInfoFirst,
        rosterBegin,
        ...membershipBegin,
        ...membershipCommit("BASIC_USER"),
        rosterCommit(["p1", "p2"]),
        rowsRead,
      ],
      moves: [["p1", "p2"], []],
    },
  ];
  for (const { order, inputs, moves: expected } of orders) {
    const { store, moves, stop } = heard([
      ...membershipInputs("BASIC_USER", false, 1, ORG),
      ...liveProjects(ORG, [{ id: "p1" }, { id: "p2" }]),
    ]);
    inputs.forEach(store.dispatch);
    expect(moves, order).toEqual(expected);
    stop();
  }
});

// witness: packages/client-runtime/src/data/accountRuntime/accessChanges.ts | same ?? { orgId: frame.orgId, membership: reading.membership, roles: {}, whole: false }, → same,
it("ST82: The person's membership counts from its first answer: a demotion that lands while the project roster is first read is told once that read is whole; breaks: HQ is never asked again, so a person demoted while the page loads keeps every Mate in the menu", () => {
  const roster = projectsScope(ORG);
  const stream = (
    event:
      | { readonly kind: "demand"; readonly demanded: true }
      | { readonly kind: "attempt" }
      | { readonly kind: "handshake" },
  ): AccountInput => ({ kind: "stream", key: roster, now: 1, event });
  // The page opens: the roster's first read is under way when `/user/info` answers Basic user.
  const { store, moves, stop } = heard([
    stream({ kind: "demand", demanded: true }),
    stream({ kind: "attempt" }),
    stream({ kind: "handshake" }),
    { kind: "baseline-begin", scope: roster, generation: 1 },
    ...membershipInputs("BASIC_USER", false, 1, ORG),
  ]);
  // Demoted meanwhile: `/user/info` is read again, the roster answers none, then `/user/info` No access.
  membershipInputs("NO_ACCESS", false, 1, ORG).slice(3, 4).forEach(store.dispatch);
  store.dispatch({
    kind: "baseline-commit",
    scope: roster,
    generation: 1,
    via: "zerops-realtime",
    members: [],
    rows: [],
  });
  membershipRead("NO_ACCESS").slice(1).forEach(store.dispatch);
  expect(moves).toEqual([[]]);
  stop();
});
