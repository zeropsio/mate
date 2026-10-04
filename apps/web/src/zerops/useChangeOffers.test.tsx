/**
 * What a person is offered of an application's changes, as `useChangeOffers` asks HQ's rule over
 * the facts the client holds: the session's membership, the projects the inventory lists, and the
 * projects HQ places in the application — and nothing said while either is not known.
 */
import { flowChange } from "@t3tools/client-runtime/zerops";
import { useAtomValue, RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZeropsGitOverview } from "../components/zerops/ZeropsGitPage";
import { gitPageState } from "../components/zerops/ZeropsGitPage.logic";
import { useZeropsAppReleases } from "./useZeropsAppReleases";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { hqStructureAtom, zeropsSessionAtom } from "../state/zerops";
import { InventoryContext, type Inventory } from "./inventoryContext";
import { ZeropsSessionContext } from "./sessionContext";
import {
  useChangeOffers,
  useReleasePermission,
  type ZeropsChangeOffersOf,
} from "./useChangeOffers";
import type { ZeropsSessionValue } from "./ZeropsSessionProvider";

const MEMBERSHIP = "member-ada";

const mounted: ReactTestRenderer[] = [];
/** What the hook handed back, render by render. */
const seen: unknown[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  seen.length = 0;
});

function Probe({ use }: { readonly use: () => unknown }) {
  seen.push(use());
  return null;
}

interface Facts {
  readonly roleCode: string;
  readonly grants: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>;
  readonly placed: boolean;
  readonly listed?: boolean;
  readonly gitFixture?: boolean;
  readonly withheld?: boolean;
  readonly unverifiedProjects?: ReadonlyArray<string>;
  readonly afterMount?: (registry: AtomRegistry.AtomRegistry) => void;
}

/** The hook's answer, with the session's role, the grants listed, and HQ's structure where `placed`. */
function offersOf(input: Facts): ZeropsChangeOffersOf {
  return answerOf(input, useChangeOffers);
}

/** `use`'s answer over the same facts: HQ places a Mate, a stage and a production in the application. */
function answerOf<T>(input: Facts, use: () => T): T {
  const registry = AtomRegistry.make();
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { organizationId: "org-acme" },
  } as never);
  const gitApps = [
    {
      id: "app-shop",
      name: "Shop",
      projects: [{ projectId: "p-stage", kind: "stage", mate: null }],
    },
    {
      id: "app-gallery",
      name: "Gallery",
      projects: [{ projectId: "p-other", kind: "stage", mate: null }],
    },
    { id: "app-seed", name: "Seed", projects: [] },
  ];
  if (input.placed) {
    registry.set(hqStructureAtom, {
      organizationId: "org-acme",
      structure: {
        ungrouped: [],
        apps: input.gitFixture
          ? gitApps
          : [
              {
                id: "app-shop",
                name: "Shop",
                projects: [
                  { projectId: "p-mate", kind: "mate", mate: null },
                  { projectId: "p-stage", kind: "stage", mate: null },
                  { projectId: "p-prod", kind: "production", mate: null },
                ],
              },
            ],
      },
      changes: input.gitFixture ? new Map(gitApps.map((app) => [app.id, []])) : null,
      appReads: input.gitFixture
        ? new Map(
            gitApps.map((app, i) => [
              app.id,
              {
                revision: "1",
                failure: null,
                value: {
                  repos: (i === 2 ? ["group"] : ["appdev", "group"]).map((name) => ({
                    name,
                    mainHead: null,
                    updatedAt: "2026-10-04T00:00:00Z",
                  })),
                  releases: [],
                  recipes: { stage: { state: "absent" }, production: { state: "absent" } },
                },
              },
            ]),
          )
        : null,
      readAt: 1_000,
      current: true,
      unavailableSince: null,
    } as never);
  }
  const session = {
    user: { id: "user-ada" },
    activeOrganization: { membershipId: MEMBERSHIP, roleCode: input.roleCode },
  } as unknown as ZeropsSessionValue;
  const inventory = {
    isLoading: input.listed === false,
    account: { kind: input.withheld ? "withheld" : "authorized" },
    projects: [
      ...input.grants.map(({ projectId, roleCode }) => ({
        id: projectId,
        userRoles: [{ clientUserId: MEMBERSHIP, roleCode }],
      })),
      ...(input.unverifiedProjects ?? []).map((id) => ({ id })),
    ],
  } as unknown as Inventory;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted.push(
      create(
        <RegistryContext.Provider value={registry}>
          <ZeropsSessionContext.Provider value={session}>
            <InventoryContext.Provider value={inventory}>
              <Probe use={use} />
            </InventoryContext.Provider>
          </ZeropsSessionContext.Provider>
        </RegistryContext.Provider>,
      ),
    );
  });
  input.afterMount?.(registry);
  if (seen.length === 0) throw new Error("the probe never rendered");
  return seen.at(-1) as T;
}

describe("useChangeOffers", () => {
  it.each([
    {
      who: "a Read only member of the organization",
      roleCode: "READ_ONLY",
      grants: [],
      want: { read: true, comment: true, merge: false, close: false, redeploy: false },
    },
    {
      who: "a No access member with Basic user on the application's stage",
      roleCode: "NO_ACCESS",
      grants: [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
      want: { read: true, comment: true, merge: true, close: true, redeploy: true },
    },
    {
      who: "a No access member with only Read only on its projects",
      roleCode: "NO_ACCESS",
      grants: [
        { projectId: "p-mate", roleCode: "READ_ONLY" },
        { projectId: "p-stage", roleCode: "READ_ONLY" },
      ],
      want: { read: false, comment: false, merge: false, close: false, redeploy: false },
    },
  ])("offers $who what HQ's rule allows", ({ roleCode, grants, want }) => {
    expect(offersOf({ roleCode, grants, placed: true })("app-shop")).toMatchObject(want);
  });

  it.each([
    ["Basic user", "BASIC_USER", [{ projectId: "p-stage", roleCode: "BASIC_USER" }]],
    ["KRLS owner", "OWNER", [{ projectId: "p-stage", roleCode: "OWNER" }]],
    [
      "KRLS Developer with a held grant",
      "NO_ACCESS",
      [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
    ],
  ])(
    "keeps %s's readable app while unrelated inventory reads are pending",
    (_who, roleCode, grants) => {
      expect(offersOf({ roleCode, grants, placed: true, listed: false })("app-shop")).toEqual({
        read: true,
        comment: true,
        merge: true,
        close: true,
        redeploy: true,
      });
    },
  );

  it("does not manufacture a project grant from an unverified metadata row", () => {
    const offers = offersOf({
      roleCode: "OWNER",
      grants: [],
      unverifiedProjects: ["p-stage"],
      placed: true,
    })("app-shop");
    expect(offers).toMatchObject({
      read: true,
      close: true,
      merge: false,
      reason: "Project access has not been verified.",
    });
  });
  it("restores the owner's offers when a manual HQ read supplies the structure again", () => {
    const offers = answerOf(
      {
        roleCode: "OWNER",
        grants: [{ projectId: "p-stage", roleCode: "OWNER" }],
        placed: true,
        listed: false,
        afterMount: (registry) => {
          const held = registry.get(hqStructureAtom);
          act(() => registry.set(hqStructureAtom, null));
          expect((seen.at(-1) as ZeropsChangeOffersOf)("app-shop")).toBeUndefined();
          act(() => registry.set(hqStructureAtom, held));
        },
      },
      useChangeOffers,
    );
    expect(offers("app-shop")).toEqual({
      read: true,
      comment: true,
      merge: true,
      close: true,
      redeploy: true,
    });
  });

  it("refuses a Developer's read when every app project grant is known, even while services load", () => {
    expect(
      offersOf({
        roleCode: "NO_ACCESS",
        grants: [
          { projectId: "p-mate", roleCode: "READ_ONLY" },
          { projectId: "p-stage", roleCode: "READ_ONLY" },
          { projectId: "p-prod", roleCode: "READ_ONLY" },
        ],
        placed: true,
        listed: false,
      })("app-shop")?.read,
    ).toBe(false);
  });

  it("explains a missing project grant even after unrelated reads finish", () => {
    expect(offersOf({ roleCode: "NO_ACCESS", grants: [], placed: true })("app-shop")).toMatchObject(
      { read: false, merge: false, reason: "Project access has not been verified." },
    );
  });

  it("says nothing while HQ has not placed the projects", () => {
    expect(offersOf({ roleCode: "READ_ONLY", grants: [], placed: false })("app-shop")).toBe(
      undefined,
    );
  });

  // An inventory still read lists no grant yet: a No access member's Basic user on the stage is
  // not known to be missing.
  it("explains missing grants without depending on unrelated reads", () => {
    expect(
      offersOf({ roleCode: "NO_ACCESS", grants: [], placed: true, listed: false })("app-shop"),
    ).toMatchObject({ read: false, reason: "Project access has not been verified." });
  });
});

describe("useReleasePermission", () => {
  it.each([
    {
      who: "a No access member with Basic user on its production",
      roleCode: "NO_ACCESS",
      grants: [{ projectId: "p-prod", roleCode: "BASIC_USER" }],
      want: { allowed: true },
    },
    {
      who: "a Read only member of the organization, in HQ's words",
      roleCode: "READ_ONLY",
      grants: [{ projectId: "p-prod", roleCode: "READ_ONLY" }],
      want: {
        allowed: false,
        reason: "You need at least Basic user access to this project's production to release it.",
      },
    },
  ])("decides for $who by HQ's rule", ({ roleCode, grants, want }) => {
    const permission = answerOf({ roleCode, grants, placed: true }, useReleasePermission);
    expect(permission("app-shop")).toEqual(want);
  });

  it("offers the owner's release while service reads are pending", () => {
    expect(
      answerOf(
        {
          roleCode: "OWNER",
          grants: [{ projectId: "p-prod", roleCode: "OWNER" }],
          placed: true,
          listed: false,
        },
        useReleasePermission,
      )("app-shop"),
    ).toEqual({ allowed: true });
  });
  it("explains an unverified production grant", () => {
    expect(
      answerOf(
        { roleCode: "NO_ACCESS", grants: [], placed: true },
        useReleasePermission,
      )("app-shop"),
    ).toEqual({ allowed: false, reason: "Production project access has not been verified." });
  });

  it("says nothing while HQ has not placed the projects", () => {
    const permission = answerOf(
      { roleCode: "READ_ONLY", grants: [], placed: false },
      useReleasePermission,
    );
    expect(permission("app-shop")).toBe(undefined);
  });
});

/** The real permission and AppReads hooks feeding the page's rendered repository list. */
function useGitMarkup() {
  const offers = useChangeOffers();
  const reads = useZeropsAppReleases();
  const hq = useAtomValue(hqStructureAtom);
  const state = gitPageState({
    appsKnown: hq?.structure !== null,
    apps: (hq?.structure?.apps ?? []).map((app) => ({
      appId: app.id,
      name: app.name,
      read: offers(app.id)?.read,
      readReason: offers(app.id)?.reason,
      repositories: reads.repos.get(app.id),
      changes: hq?.changes
        ?.get(app.id)
        ?.map((change) => flowChange(change, "https://hq.example.test")),
      failure: reads.failures.get(app.id),
    })),
    mateName: () => undefined,
  });
  return renderToStaticMarkup(<ZeropsGitOverview state={state} />);
}

describe("Git page with HQ repository facts (F01 / P3-11)", () => {
  it.each([
    ["Mate Basic user", "BASIC_USER", [], ["app-gallery", "app-seed", "app-shop"], 5],
    ["KRLS owner", "OWNER", [], ["app-gallery", "app-seed", "app-shop"], 5],
    [
      "KRLS Developer",
      "NO_ACCESS",
      [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
      ["app-shop"],
      2,
    ],
  ] as const)(
    "lists only %s's readable repositories while service reads are pending",
    (_who, roleCode, grants, appIds, repoCount) => {
      const html = answerOf(
        { roleCode, grants, placed: true, listed: false, gitFixture: true },
        useGitMarkup,
      );
      expect(
        [...html.matchAll(/data-zerops-git-app="([^"]+)"/gu)].map((match) => match[1]),
      ).toEqual(appIds);
      expect([...html.matchAll(/data-zerops-git-repository=/gu)]).toHaveLength(repoCount);
    },
  );

  it("withholds held facts during an account access lapse", () => {
    const html = answerOf(
      { roleCode: "BASIC_USER", grants: [], placed: true, gitFixture: true, withheld: true },
      useGitMarkup,
    );
    expect(html).not.toContain("data-zerops-git-repository");
    expect(html).toContain("Reading repositories and changes…");
  });
});
