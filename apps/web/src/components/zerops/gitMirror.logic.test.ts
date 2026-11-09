import { describe, expect, it } from "vite-plus/test";

import { installOffer, parseMirrorSearch, mirrorGateLine, waitingAccount } from "./gitMirror.logic";

const remote = {
  url: "https://github.com/acme/tea-shop.git",
  repositoryId: "7",
  keptAt: "2026-10-17T09:00:00Z",
  keptBy: "Nova",
  expiresAt: null,
  invalidSince: null,
} as const;
const app = { kind: "connected", name: "Acme Mate", repositories: [], installUrl: "" } as const;

describe("whether GitHub lets only what was approved in Mate reach a repository's main", () => {
  const viaApp = { ...remote, via: "app" } as const;
  const withId = { ...app, appId: 123456 } as const;
  it.each([
    {
      case: "a governed repository says so",
      remote: { ...viaApp, governance: "governed" },
      app: withId,
      says: "Main is protected by Mate. Nothing reaches main on GitHub without Mate's approval: mate/gate from app ID 123456.",
    },
    {
      case: "an installation that has not approved writing statuses is advisory and asks for the approval",
      remote: { ...viaApp, governance: "permission_not_approved" },
      app: withId,
      says: "Main is not protected. Acme Mate (app ID 123456) can't set mate/gate yet. On GitHub, its owner adds Commit statuses: write and Workflows: write to its permissions where they're missing, then an organization owner approves them.",
    },
    {
      case: "a repository without a ruleset is advisory and names the app id to require",
      remote: { ...viaApp, governance: "no_ruleset" },
      app: withId,
      says: `Main is not protected. Nothing on GitHub stops a push or merge into main without Mate's approval. Add a ruleset on main that turns on "Require a pull request before merging" with 0 approvals and requires the check mate/gate from app ID 123456.`,
    },
    {
      case: "a ruleset that does not require mate/gate is advisory",
      remote: { ...viaApp, governance: "gate_not_required" },
      app: withId,
      says: "Main is not protected. Its ruleset doesn't require Mate's approval. Require the check mate/gate from app ID 123456.",
    },
    {
      case: "mate/gate required from any source is advisory",
      remote: { ...viaApp, governance: "gate_not_pinned" },
      app: withId,
      says: "Main is not protected. The mate/gate check its ruleset requires isn't tied to Mate's app, so anyone can set it. Require it from app ID 123456 so only Mate can.",
    },
    {
      case: "an HQ that does not say its app's id names the app",
      remote: { ...viaApp, governance: "gate_not_pinned" },
      app,
      says: "Main is not protected. The mate/gate check its ruleset requires isn't tied to Mate's app, so anyone can set it. Require it from Acme Mate so only Mate can.",
    },
    {
      case: "a mirror through the app not read yet says nothing",
      remote: viaApp,
      app: withId,
      says: undefined,
    },
    {
      case: "a mirror with a token says nothing",
      remote: { ...remote, governance: "governed" },
      app: withId,
      says: undefined,
    },
    {
      case: "a mirror through an app that is gone says nothing more",
      remote: { ...viaApp, governance: "governed", invalidSince: "2026-10-15T08:00:00Z" },
      app: withId,
      says: undefined,
    },
  ] as const)("$case", ({ remote: given, app: reading, says }) => {
    expect(mirrorGateLine(given, reading)).toBe(says);
  });
});

describe("installing the app on another account or more repositories", () => {
  const INSTALL = "https://github.com/apps/acme-mate/installations/new";
  const newer = { ...app, installUrl: INSTALL, installTrip: true } as const;
  it.each([
    {
      case: "an admin, with an HQ of install trips",
      app: newer,
      admin: true,
      offer: { kind: "trip" },
    },
    {
      case: "a member, with an HQ of install trips",
      app: newer,
      admin: false,
      offer: {
        kind: "page",
        url: INSTALL,
        note: "What you install there waits for an admin's OK.",
      },
    },
    {
      case: "an admin, with an older HQ",
      app: { ...app, installUrl: INSTALL },
      admin: true,
      offer: { kind: "page", url: INSTALL, note: null },
    },
  ] as const)("$case gets $offer.kind", ({ app: shown, admin, offer }) => {
    expect(installOffer(shown, admin)).toEqual(offer);
  });

  it("names the account whose installation reaches a repository but waits for an OK", () => {
    const waiting = {
      ...newer,
      waiting: [{ account: "Stranger", repositories: ["Stranger/Notes"] }],
    };
    expect(waitingAccount(waiting, "stranger/notes")).toBe("Stranger");
    expect(waitingAccount(waiting, "acme/api")).toBeNull();
  });
});

describe("back from GitHub's install page, the mirror dialog opens again over its project", () => {
  it.each([
    { case: "the project it left from", raw: { mirror: "app-1" }, opens: "app-1" },
    {
      case: "beside what HQ adds to the return",
      raw: { mirror: "app-1", github: "connected" },
      opens: "app-1",
    },
    { case: "nothing without one", raw: { github: "connected" }, opens: undefined },
    { case: "nothing for an empty one", raw: { mirror: "" }, opens: undefined },
  ])("$case", ({ raw, opens }) => {
    expect(parseMirrorSearch(raw).mirror).toBe(opens);
  });
});
