/** A drawn row holds only the source detail that decides project access. */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { RegistryContext } from "@effect/atom-react";
import {
  accountReadsAtom,
  makeAccountStore,
  projectsScope,
  type MateRecovery,
} from "@t3tools/client-runtime/data";
import { Atom, AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  drawnMateProjects,
  useDrawnProjectAccess,
  useVisibleProjectAccess,
} from "./useVisibleProjectAccess";
import { useMateRecovery } from "./useMateRecovery";
import { AccountDataContext, type AccountData } from "./ZeropsAccountData";

const viewer = vi.hoisted(() => ({ role: "OWNER" }));
vi.mock("./sessionContext", () => ({
  useZeropsSessionOptional: () => ({ activeOrganization: { roleCode: viewer.role } }),
}));
const ADA = { project: { id: "p-ada", hq: { kind: "mate" } } } as unknown as ZeropsCandidate;
const BO = { project: { id: "p-bo", hq: { kind: "production" } } } as unknown as ZeropsCandidate;
const CY = { project: { id: "p-cy", hq: { kind: "mate" } } } as unknown as ZeropsCandidate;
function Probe({ candidates }: { readonly candidates: ReadonlyArray<ZeropsCandidate> }) {
  useVisibleProjectAccess(drawnMateProjects(candidates));
  return null;
}
const rows: { drawn: (projectId: string) => () => () => void } = { drawn: () => () => () => {} };
function RowsProbe() {
  const drawn = useDrawnProjectAccess();
  useLayoutEffect(() => {
    rows.drawn = drawn;
  });
  return null;
}
function RecoveryProbe({ seen }: { readonly seen: MateRecovery[] }) {
  const recovery = useMateRecovery("p-cy", undefined, false);
  useLayoutEffect(() => {
    seen.push(recovery);
  }, [recovery, seen]);
  return null;
}
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  viewer.role = "OWNER";
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
it("names each project HQ places a Mate in, once", () => {
  expect(drawnMateProjects([ADA, BO, CY, ADA])).toEqual(["p-ada", "p-cy"]);
});
describe("a drawn Mate's own project row", () => {
  // It is read only where it decides the viewer's access: a NO_ACCESS member's project whose
  // listing row names no grant of theirs. Whose a Mate is comes from HQ's person facts.
  it.each([
    { name: "an organization member's: none", role: "OWNER", own: undefined, held: [] },
    { name: "a READ_ONLY member's: none", role: "READ_ONLY", own: undefined, held: [] },
    {
      name: "a READ_ONLY member with a project OWNER override: none",
      role: "READ_ONLY",
      own: "OWNER",
      held: [],
    },
    {
      name: "a NO_ACCESS member's: only the Mate whose listing names no grant of theirs",
      role: "NO_ACCESS",
      own: undefined,
      held: ["project/project/p-cy"],
    },
  ])("is held while the Mate is drawn — $name", async ({ role, own, held }) => {
    viewer.role = role;
    const registry = AtomRegistry.make();
    const rowsHeld: string[] = [];
    const roster = Atom.make({
      projects: [
        {
          id: "p-ada",
          name: "Ada",
          status: "ACTIVE",
          viewerRoleCode: "BASIC_USER",
          listingNamesGrants: true,
        },
        {
          id: "p-bo",
          name: "Bo",
          status: "ACTIVE",
          viewerRoleCode: "BASIC_USER",
          listingNamesGrants: true,
        },
        {
          id: "p-cy",
          name: "Cy",
          status: "ACTIVE",
          ...(own === undefined ? {} : { viewerRoleCode: own }),
          listingNamesGrants: own !== undefined,
        },
      ],
      read: "read",
      complete: true,
      live: true,
      reconnecting: false,
    });
    registry.set(accountReadsAtom, {
      data: { project: () => roster } as never,
      orgId: "org-1",
      demandDetail: (demand) => {
        const key = `${demand.family}/${demand.listing}/${demand.ownerId}`;
        rowsHeld.push(key);
        return () => rowsHeld.splice(rowsHeld.indexOf(key), 1);
      },
      renewHeld: () => {},
    });
    const probe = (candidates: ReadonlyArray<ZeropsCandidate>) =>
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(Probe, { candidates }),
      );
    await act(async () => {
      tree = create(probe([ADA, BO, CY]));
    });
    expect(rowsHeld.toSorted()).toEqual(held);

    // Its first own-row answer must not release the demand needed by the next grant round.
    await act(async () => {
      registry.set(roster, {
        ...registry.get(roster),
        projects: registry.get(roster).projects.map((project) => ({
          ...project,
          userRoles: [{ clientUserId: "viewer", roleCode: "OWNER" }],
        })),
      });
    });
    expect(rowsHeld.toSorted()).toEqual(held);

    await act(async () => tree?.unmount());
    tree = undefined;
    expect(rowsHeld).toEqual([]);
  });
});

it("holds one access detail while any row is drawn and releases it with the last", async () => {
  viewer.role = "NO_ACCESS";
  const registry = AtomRegistry.make();
  const held: string[] = [];
  const acquired: string[] = [];
  const roster = Atom.make({
    projects: [],
    read: "unknown",
    complete: false,
    live: false,
    reconnecting: false,
  });
  registry.set(accountReadsAtom, {
    data: { project: () => roster } as never,
    orgId: "org-1",
    demandDetail: ({ ownerId }) => {
      held.push(ownerId);
      acquired.push(ownerId);
      return () => {
        held.splice(held.indexOf(ownerId), 1);
      };
    },
    renewHeld: () => {},
  });
  await act(async () => {
    tree = create(
      createElement(RegistryContext.Provider, { value: registry }, createElement(RowsProbe)),
    );
  });
  expect(held).toEqual([]);
  const drawn = rows.drawn("p-ada");
  expect(rows.drawn("p-ada")).toBe(drawn);
  let first = () => {};
  let second = () => {};
  await act(async () => {
    first = drawn();
    second = drawn();
  });
  expect(held).toEqual(["p-ada"]);
  expect(acquired).toEqual(["p-ada"]);
  await act(async () => first());
  expect(held).toEqual(["p-ada"]);
  await act(async () => second());
  expect(held).toEqual([]);
});

function recoveryAccount(role: string) {
  viewer.role = role;
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const scope = projectsScope("org-1");
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
  const held: string[] = [];
  const asked: string[] = [];
  const seen: MateRecovery[] = [];
  const account = {
    data: store.data,
    orgId: "org-1",
    demandDetail: (demand: { family: string; ownerId: string }) => {
      if (demand.family !== "project") return () => {};
      held.push(demand.ownerId);
      asked.push(demand.ownerId);
      return () => {
        held.splice(held.indexOf(demand.ownerId), 1);
      };
    },
    renewHeld: () => {},
  } as AccountData;
  registry.set(accountReadsAtom, account);
  const roster = (listed: boolean, named = false, partial = false) => {
    const scope = projectsScope("org-1");
    store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
    store.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      partial,
      members: listed ? ["p-cy"] : [],
      rows: listed
        ? [
            {
              family: "project",
              id: "p-cy",
              value: {
                id: "p-cy",
                name: "Cy",
                status: "STOPPED",
                ...(named ? { viewerRoleCode: "BASIC_USER" } : {}),
              },
              revision: { kind: "zerops", version: null },
            },
          ]
        : [],
    });
  };
  const mount = async () => {
    await act(async () => {
      tree = create(
        createElement(
          RegistryContext.Provider,
          { value: registry },
          createElement(
            AccountDataContext.Provider,
            { value: account },
            createElement(RecoveryProbe, { seen }),
          ),
        ),
      );
    });
  };
  return { store, held, asked, seen, roster, mount };
}

it.each([
  { role: "OWNER", named: false, expected: [] },
  { role: "READ_ONLY", named: false, expected: [] },
  { role: "NO_ACCESS", named: true, expected: [] },
  { role: "NO_ACCESS", named: false, expected: ["p-cy"] },
])(
  "recovery uses the listed grant for $role (named: $named)",
  async ({ role, named, expected }) => {
    const account = recoveryAccount(role);
    account.roster(true, named);
    await account.mount();
    expect(account.held).toEqual(expected);
    expect(account.seen.at(-1)).toMatchObject({ standing: { kind: "listed" }, status: "STOPPED" });
    if (expected.length > 0) {
      await act(async () => account.roster(true, true));
      expect(account.held, "A listing grant ends the own-row read").toEqual([]);
    }
  },
);

it.each(["OWNER", "NO_ACCESS"])(
  "an accepted %s creation keeps its identity and the viewer's grant policy before its roster row",
  async (role) => {
    const account = recoveryAccount(role);
    account.roster(false, false, true);
    account.store.dispatch({
      kind: "operation-recorded",
      requestId: "create-cy",
      intent: { kind: "create-project", orgId: "org-1", name: "Cy", tagList: [] },
    });
    account.store.dispatch({
      kind: "operation-receipt",
      receipt: {
        requestId: "create-cy",
        operationId: "p-cy",
        executor: "zerops",
        affected: [{ family: "project", id: "p-cy" }],
        handles: ["p-cy"],
        acceptance: { kind: "accepted", result: { projectId: "p-cy" } },
        outcome: { kind: "pending" },
      },
    });
    await account.mount();
    expect(account.held, "Creation acceptance is identity evidence, not a project grant").toEqual(
      role === "NO_ACCESS" ? ["p-cy"] : [],
    );
    expect(account.seen.at(-1)).toMatchObject({
      standing: { kind: "accepted", name: "Cy" },
      status: undefined,
    });
    await act(async () => account.roster(true, true));
    expect(account.seen.at(-1)).toMatchObject({ standing: { kind: "listed" }, status: "STOPPED" });
    expect(account.held).toEqual([]);
    expect(account.asked).toEqual(role === "NO_ACCESS" ? ["p-cy"] : []);
    await act(async () => {
      account.store.dispatch({ kind: "access", family: "project", id: "p-cy", access: "denied" });
    });
    expect(account.seen.at(-1)?.standing.kind).toBe("denied");
    expect(account.held).toEqual([]);
  },
);

it.each([
  { role: "OWNER", verdict: "deleted", partial: true },
  { role: "READ_ONLY", verdict: "denied", partial: true },
  { role: "OWNER", verdict: "denied", partial: false },
  { role: "READ_ONLY", verdict: "deleted", partial: false },
] as const)(
  "a cold $role URL gets its $verdict verdict from a roster with partial=$partial",
  async ({ role, verdict, partial }) => {
    const account = recoveryAccount(role);
    account.roster(false, false, partial);
    await account.mount();
    expect(account.seen.at(-1)?.standing).toEqual({ kind: "unknown" });
    expect(account.held).toEqual(["p-cy"]);
    await act(async () => {
      account.store.dispatch(
        verdict === "deleted"
          ? {
              kind: "proven-deletion",
              family: "project",
              id: "p-cy",
              scope: "zerops:org-1:project:p-cy",
              evidence: "projectNotFound",
            }
          : {
              kind: "access",
              family: "project",
              id: "p-cy",
              scope: "zerops:org-1:project:p-cy",
              access: "denied",
            },
      );
    });
    expect(account.seen.at(-1)).toEqual({
      standing: { kind: verdict },
      status: undefined,
      process: undefined,
    });
    expect(account.held).toEqual([]);
    expect(account.asked).toEqual(["p-cy"]);
  },
);

it.each(["OWNER", "READ_ONLY"])(
  "an unread roster does not block a cold %s URL, and a known row ends the probe",
  async (role) => {
    const account = recoveryAccount(role);
    await account.mount();
    expect(account.held).toEqual(["p-cy"]);
    await act(async () => account.roster(true));
    expect(account.seen.at(-1)).toMatchObject({ standing: { kind: "listed" }, status: "STOPPED" });
    expect(account.held).toEqual([]);
    expect(account.asked).toEqual(["p-cy"]);
  },
);

it("a NO_ACCESS recovery releases its own-row read when the listing supplies a grant", async () => {
  const account = recoveryAccount("NO_ACCESS");
  account.roster(true);
  await account.mount();
  expect(account.held).toEqual(["p-cy"]);
  await act(async () => account.roster(true, true));
  expect(account.seen.at(-1)?.standing.kind).toBe("listed");
  expect(account.held).toEqual([]);
  expect(account.asked).toEqual(["p-cy"]);
});
