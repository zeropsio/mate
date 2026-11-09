/**
 * What a person is offered of an application, decided from their live Zerops roles over HQ's
 * structure: refused in the rule's words, and nothing said before the roles are read.
 */
import { accountReadsAtom, type AccountStore } from "@t3tools/client-runtime/data";
import { liveProjects, membershipInputs } from "@t3tools/client-runtime/data/fixtures";
import { RegistryContext } from "@effect/atom-react";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { zeropsSessionAtom } from "../state/zerops";
import { useChangeOffers, useKeepDeployKeyOffer } from "./useChangeOffers";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

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

const environment = (projectId: string, tier: "stage" | "production", order: number) => ({
  projectId,
  tier,
  name: tier,
  sources: [tier === "stage" ? "main" : "release"],
  order,
  keyHeld: false,
  keyInvalid: false,
  jobs: [],
  release: null,
  birth: null,
});

/** Shop, worked in through its stage project; its production is another project. */
const SHOP: HqStructure["apps"][number] = {
  id: "app-shop",
  name: "Shop",
  projects: [{ projectId: "p-stage", name: "stage", kind: "stage", mate: null }],
  environments: [environment("p-stage", "stage", 1), environment("p-prod", "production", 2)],
};

/** An application with no project the person is given. */
const GALLERY: HqStructure["apps"][number] = { id: "app-gallery", name: "Gallery", projects: [] };

interface Hq {
  /** The organization the structure was read for. */
  readonly organizationId?: string;
  readonly structure: HqStructure | null;
  /** The person's role in the organization and their own on each project; unread where absent. */
  readonly roles?: Roles | undefined;
}

interface Roles {
  readonly org: string;
  readonly projects: Readonly<Record<string, string | undefined>>;
}

/**
 * Of no access to the organization; Full access on Shop's stage project, none of their own on its
 * production, which Zerops still lists them.
 */
const STAGE_ADMIN: Roles = {
  org: "NO_ACCESS",
  projects: { "p-stage": "ADMIN", "p-prod": undefined },
};

/** Zerops' answer of the person's roles, into the account's store. */
function answerRoles(store: AccountStore, orgId: string, roles: Roles): void {
  const projects = Object.entries(roles.projects).map(([id, roleCode]) => ({
    id,
    ...(roleCode === undefined ? {} : { userRoles: [{ clientUserId: "member", roleCode }] }),
  }));
  for (const input of [
    ...membershipInputs(roles.org, false, 1, orgId),
    ...liveProjects(orgId, projects),
  ])
    store.dispatch(input);
}

/** `use`'s answer over HQ's structure as the tab last held it. */
function answerOf<T>(hq: Hq, use: () => T): T {
  const registry = AtomRegistry.make();
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { organizationId: "org-acme" },
  } as never);
  const orgId = hq.organizationId ?? "org-acme";
  const { store } = mountHqNavigation(registry, orgId, {
    ...(hq.structure === null ? {} : { structure: hq.structure }),
    live: true,
  });
  if (hq.roles !== undefined) answerRoles(store, orgId, hq.roles);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted.push(
      create(
        <RegistryContext.Provider value={registry}>
          <Probe use={use} />
        </RegistryContext.Provider>,
      ),
    );
  });
  if (seen.length === 0) throw new Error("the probe never rendered");
  return seen.at(-1) as T;
}

const STREAMED: Hq = {
  structure: { ungrouped: [], apps: [SHOP, GALLERY] },
  roles: STAGE_ADMIN,
};

describe("useChangeOffers", () => {
  it("a same-tab organization round trip preserves the known Merge offer", () => {
    const registry = AtomRegistry.make();
    const { store } = mountHqNavigation(registry, "org-acme", {
      structure: STREAMED.structure!,
      live: true,
    });
    answerRoles(store, "org-acme", STAGE_ADMIN);
    mountHqNavigation(
      registry,
      "org-beta",
      { structure: { apps: [], ungrouped: [] }, live: true },
      store,
    );
    const session = (organizationId: string) =>
      ({
        status: "signed-in",
        organizationStatus: "selected",
        activeOrganization: { organizationId },
      }) as never;
    registry.set(zeropsSessionAtom, session("org-acme"));
    function OffersProbe() {
      seen.push(useChangeOffers()("app-shop"));
      return null;
    }
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    act(() =>
      mounted.push(
        create(
          <RegistryContext.Provider value={registry}>
            <OffersProbe />
          </RegistryContext.Provider>,
        ),
      ),
    );
    expect(seen.at(-1)).toMatchObject({ merge: true });
    const switchOrganization = (orgId: string) =>
      act(() => {
        registry.set(zeropsSessionAtom, session(orgId));
        registry.set(accountReadsAtom, { ...registry.get(accountReadsAtom)!, orgId });
      });
    switchOrganization("org-beta");
    expect(seen.at(-1)).toBeUndefined();
    const beforeReturn = seen.length;
    switchOrganization("org-acme");
    expect(seen.slice(beforeReturn)).not.toHaveLength(0);
    for (const offer of seen.slice(beforeReturn))
      expect(offer).toMatchObject({ merge: true, why: {} });
  });

  it("a reader can review but cannot merge", () => {
    const offers = answerOf(
      { ...STREAMED, roles: { org: "READ_ONLY", projects: { "p-stage": undefined } } },
      useChangeOffers,
    )("app-shop");
    expect(offers?.read).toBe(true);
    expect(offers?.merge).toBe(false);
    expect(offers?.close).toBe(false);
    expect(offers?.why.merge).toBe(
      "You need more than Read access to one of this project's Zerops projects to do this.",
    );
  });

  it("offers what the person's Zerops roles let them do, and says the refusal", () => {
    const offers = answerOf(STREAMED, useChangeOffers);
    expect(offers("app-shop")).toEqual({
      read: true,
      comment: true,
      merge: true,
      close: true,
      why: {},
      readRefused: false,
    });
    const gallery = offers("app-gallery");
    expect([gallery?.read, gallery?.merge, gallery?.readRefused]).toEqual([false, false, true]);
    expect(gallery?.why.read).toBe("You have no access to that project.");
  });

  it.each<[string, Hq, string]>([
    ["before HQ's structure is known", { structure: null }, "app-shop"],
    ["for an application HQ did not send", STREAMED, "app-other"],
    [
      "over another organization's structure",
      { ...STREAMED, organizationId: "org-beta" },
      "app-shop",
    ],
  ])("says nothing %s", (_, hq, appId) => {
    expect(answerOf(hq, useChangeOffers)(appId)).toBeUndefined();
  });

  // The web review, 2026-10-05: verbs not decided yet are drawn not pressable, saying so, never
  // read as refused.
  it("offers nothing before the person's Zerops roles are read, and says so", () => {
    const shop = answerOf({ ...STREAMED, roles: undefined }, useChangeOffers)("app-shop");
    expect([shop?.read, shop?.merge, shop?.readRefused, shop?.why.merge]).toEqual([
      false,
      false,
      false,
      "HQ has not said yet.",
    ]);
  });
});

describe("useKeepDeployKeyOffer", () => {
  it("says per environment whether the person may keep its key; nothing where it is not held", () => {
    const mayKeep = answerOf(STREAMED, useKeepDeployKeyOffer);
    expect([mayKeep("p-stage"), mayKeep("p-prod"), mayKeep("p-elsewhere")]).toEqual([
      true,
      false,
      undefined,
    ]);
  });
});
