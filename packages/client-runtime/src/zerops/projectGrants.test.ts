import { describe, expect, it } from "vite-plus/test";

import type { HqPlacement } from "./hq/placement.ts";
import type { Known } from "./knowledge/known.ts";
import { changeOffers, offerAsker, type OfferViewer } from "./offers.ts";
import { grantListing, projectGrantsOf, withProjectGrants } from "./projectGrants.ts";

const OWNER_THERE = [
  { clientUserId: "m-dev", roleCode: "OWNER" },
  { clientUserId: "m-key", roleCode: "BASIC_USER" },
] as const;

/** The access grant's last round: Cyd verified with its grants, a project made here without any. */
const EVIDENCE = {
  projects: new Map([
    ["p-cyd", { access: { userRoles: OWNER_THERE } }],
    ["p-made", { access: {} }],
  ]),
};

describe("projectGrantsOf — each project's grants, as the access grant's last round read them", () => {
  it("names the grants each verified read carried, and nothing for access no read said", () => {
    expect([...projectGrantsOf(EVIDENCE)]).toEqual([["p-cyd", OWNER_THERE]]);
  });

  it("names nothing before a round has verified anything", () => {
    expect(projectGrantsOf(null).size).toBe(0);
  });
});

describe("withProjectGrants — a project row with its own grants", () => {
  const grants = projectGrantsOf(EVIDENCE);

  it("carries the grants its read named", () => {
    expect(withProjectGrants({ id: "p-cyd", name: "Cyd" }, grants)).toEqual({
      id: "p-cyd",
      name: "Cyd",
      userRoles: OWNER_THERE,
    });
  });

  it("leaves a project no read named as it is", () => {
    const row = { id: "p-made", name: "Made" };
    expect(withProjectGrants(row, grants)).toBe(row);
  });

  it("joins a listing's rows, and leaves a listing not known as it is", () => {
    const listing: Known<ReadonlyArray<{ readonly project: { readonly id: string } }>> = {
      state: "known",
      value: [{ project: { id: "p-cyd" } }, { project: { id: "p-made" } }],
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    const joined = grantListing(listing, grants);
    expect(joined.state === "known" ? joined.value.map(({ project }) => project) : null).toEqual([
      { id: "p-cyd", userRoles: OWNER_THERE },
      { id: "p-made" },
    ]);
    const unread: Known<ReadonlyArray<{ readonly project: { readonly id: string } }>> = {
      state: "unread",
      waitingFor: null,
    };
    expect(grantListing(unread, grants)).toBe(unread);
  });
});

// F12 (e2e, 2026-10-03): the Developer — NO_ACCESS in the organization, able to create projects —
// is OWNER on Cyd, a Mate of application C. HQ lets them read, comment on, merge and close C's
// changes; the client offered none of it, its project rows naming no grant.
describe("a project grant counts in what the client offers", () => {
  const developer: OfferViewer = {
    userId: "u-dev",
    clientUserId: "m-dev",
    roleCode: "NO_ACCESS",
    canCreateProjects: true,
  };
  const placements = new Map<string, HqPlacement>([
    ["p-cyd", { appId: "app-c", appName: "C", kind: "mate", mate: null }],
  ]);
  const listed = [{ id: "p-cyd" }];

  it("offers every change verb on the application through the grant its read named", () => {
    const grants = projectGrantsOf(EVIDENCE);
    const offers = changeOffers(
      offerAsker(
        developer,
        listed.map((project) => withProjectGrants(project, grants)),
      ),
      placements,
      "app-c",
    );
    expect(offers).toEqual({ read: true, comment: true, merge: true, close: true, redeploy: true });
  });

  it("offers nothing where no read named the grant: the org role alone counts", () => {
    expect(changeOffers(offerAsker(developer, listed), placements, "app-c")).toEqual({
      read: false,
      comment: false,
      merge: false,
      close: false,
      redeploy: false,
    });
  });
});
