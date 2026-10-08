/** A drawn row holds only the source detail that decides project access. */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { RegistryContext } from "@effect/atom-react";
import { accountReadsAtom } from "@t3tools/client-runtime/data";
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
function RecoveryProbe() {
  useMateRecovery("p-cy", undefined, false);
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

it.each([
  { role: "OWNER", listed: true, named: false, expected: [] },
  { role: "READ_ONLY", listed: true, named: false, expected: [] },
  { role: "NO_ACCESS", listed: true, named: true, expected: [] },
  { role: "NO_ACCESS", listed: true, named: false, expected: ["project/project/p-cy"] },
  { role: "OWNER", listed: false, named: false, expected: ["project/project/p-cy"] },
])(
  "Mate recovery asks for an own row only when $role access needs it (listing grant: $named)",
  async ({ role, listed, named, expected }) => {
    viewer.role = role;
    const registry = AtomRegistry.make();
    const held: string[] = [];
    const roster = Atom.make({
      projects: listed
        ? [{ id: "p-cy", name: "Cy", status: "ACTIVE", listingNamesGrants: named }]
        : [],
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
        held.push(key);
        return () => held.splice(held.indexOf(key), 1);
      },
      renewHeld: () => {},
    });
    await act(async () => {
      tree = create(
        createElement(RegistryContext.Provider, { value: registry }, createElement(RecoveryProbe)),
      );
    });
    expect(held).toEqual(expected);
    await act(async () => tree?.unmount());
    tree = undefined;
    expect(held).toEqual([]);
  },
);
