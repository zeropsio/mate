/**
 * What a person is offered of an application, as HQ's structure streamed it (`can`): drawn as HQ
 * decided it, refused in HQ's words, unavailable since HQ stopped answering, and nothing said
 * while HQ has not said it.
 */
import { RegistryContext } from "@effect/atom-react";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { zeropsSessionAtom } from "../state/zerops";
import { useChangeOffers, useReleasePermission } from "./useChangeOffers";
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

const ALLOW = { allow: true } as const;
const refused = (reason: string) => ({ allow: false, reason }) as const;

/** A developer of Shop who may not release it, nor keep its production's deploy key. */
const SHOP: HqStructure["apps"][number] = {
  id: "app-shop",
  name: "Shop",
  projects: [{ projectId: "p-stage", name: "stage", kind: "stage", mate: null }],
  can: {
    read_change: ALLOW,
    comment_change: ALLOW,
    merge_change: ALLOW,
    close_change: ALLOW,
    redeploy: ALLOW,
    release: refused("not_releaser"),
  },
  environments: [
    {
      projectId: "p-stage",
      tier: "stage",
      name: "stage",
      sources: ["main"],
      order: 1,
      keyHeld: false,
      keyInvalid: false,
      jobs: [],
      release: null,
      birth: null,
      can: { keep_deploy_token: ALLOW },
    },
    {
      projectId: "p-prod",
      tier: "production",
      name: "production",
      sources: ["release"],
      order: 2,
      keyHeld: false,
      keyInvalid: false,
      jobs: [],
      release: null,
      birth: null,
      can: { keep_deploy_token: refused("not_project_admin") },
    },
  ],
};

/** An application whose changes the person may not read, and one HQ sent no offers for. */
const GALLERY: HqStructure["apps"][number] = {
  id: "app-gallery",
  name: "Gallery",
  projects: [],
  can: {
    read_change: refused("changes_not_seen"),
    comment_change: refused("changes_not_seen"),
    merge_change: refused("app_not_seen"),
    close_change: refused("app_not_seen"),
    redeploy: refused("app_not_seen"),
    release: refused("not_releaser"),
  },
};
const SEED: HqStructure["apps"][number] = { id: "app-seed", name: "Seed", projects: [] };

interface Hq {
  /** The organization the structure was read for. */
  readonly organizationId?: string;
  readonly structure: HqStructure | null;
  readonly current?: boolean;
  readonly unavailableSince?: number | null;
}

/** `use`'s answer over HQ's structure as the tab last held it. */
function answerOf<T>(hq: Hq, use: () => T): T {
  const registry = AtomRegistry.make();
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { organizationId: "org-acme" },
  } as never);
  mountHqNavigation(registry, hq.organizationId ?? "org-acme", {
    ...(hq.structure === null ? {} : { structure: hq.structure }),
    live: hq.current ?? true,
  });
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
  structure: {
    can: { create_app: refused("not_structure_writer") },
    ungrouped: [],
    apps: [SHOP, GALLERY, SEED],
  },
};

describe("useChangeOffers", () => {
  it("draws what HQ offers, and says HQ's refusal", () => {
    const offers = answerOf(STREAMED, useChangeOffers);
    expect(offers("app-shop")).toEqual({
      read: true,
      comment: true,
      merge: true,
      close: true,
      redeploy: true,
      why: {},
      readRefused: false,
    });
    const gallery = offers("app-gallery");
    expect([gallery?.read, gallery?.merge, gallery?.readRefused]).toEqual([false, false, true]);
    expect(gallery?.why.read).toMatch(
      /^You need at least Basic user access to one of this project's Zerops projects to see its changes\.$/u,
    );
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

  // The web review, 2026-10-05: an HQ from before its offers sends an application with none: its
  // verbs are drawn not pressable, saying so, never read as refused.
  it("offers nothing HQ has not said, and says so: an application HQ sent no offers for", () => {
    const seed = answerOf(STREAMED, useChangeOffers)("app-seed");
    expect([seed?.read, seed?.merge, seed?.readRefused, seed?.why.merge]).toEqual([
      false,
      false,
      false,
      "HQ has not said yet.",
    ]);
  });

  it("offers nothing while HQ does not answer, and says since when", () => {
    const offers = answerOf(
      { ...STREAMED, current: false, unavailableSince: Date.parse("2026-10-04T10:05:00.000Z") },
      useChangeOffers,
    )("app-shop");
    expect([offers?.read, offers?.merge, offers?.readRefused]).toEqual([false, false, false]);
    expect(offers?.why.merge).toMatch(/^HQ unavailable since .+\.$/u);
  });
});

describe("useReleasePermission", () => {
  it("refuses in HQ's words what HQ refuses, and says nothing before it has said", () => {
    const permission = answerOf(STREAMED, useReleasePermission);
    expect(permission("app-shop")).toMatchObject({ allowed: false });
    expect((permission("app-shop") as { readonly reason: string } | undefined)?.reason).toMatch(
      /^You need at least Basic user access to this project's production to release it\./u,
    );
    expect(permission("app-seed")).toEqual({ allowed: false, reason: "HQ has not said yet." });
    expect(permission("app-other")).toBeUndefined();
  });

  it("offers what HQ offers", () => {
    const shop = { ...SHOP, can: { ...SHOP.can, release: ALLOW } };
    expect(
      answerOf({ structure: { ungrouped: [], apps: [shop] } }, useReleasePermission)("app-shop"),
    ).toEqual({ allowed: true });
  });

  it("is unavailable while HQ does not answer", () => {
    expect(
      answerOf(
        { ...STREAMED, current: false, unavailableSince: 5_000 },
        useReleasePermission,
      )("app-shop"),
    ).toMatchObject({ allowed: false, reason: expect.stringMatching(/^HQ unavailable since /u) });
  });
});
