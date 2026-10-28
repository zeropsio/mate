import { describe, expect, it } from "vite-plus/test";

import {
  installOffer,
  mirrorAuthorityLine,
  mirrorGateLine,
  mirrorLeadLine,
  mirrorStateLine,
  waitingAccount,
} from "./gitMirror.logic";

const NOW = Date.parse("2026-10-18T09:00:00Z");
const remote = {
  url: "https://github.com/acme/tea-shop.git",
  repositoryId: "7",
  keptAt: "2026-10-17T09:00:00Z",
  keptBy: "Nova",
  expiresAt: null,
  invalidSince: null,
} as const;
const app = { kind: "connected", name: "Acme Mate", repositories: [], installUrl: "" } as const;

describe("a repository's line in the mirror dialog", () => {
  it.each([
    { case: "nothing mirrored", remote: null, app, says: "Not mirrored" },
    {
      case: "the GitHub repository a repository follows while Mate keeps its code",
      remote: null,
      follows: "https://github.com/acme/tea-shop.git",
      app,
      says: "Follows github.com/acme/tea-shop · Mate keeps the code",
    },
    {
      case: "where it mirrors to, never what it followed before",
      remote: { ...remote, via: "app" },
      follows: "https://github.com/acme/old.git",
      app,
      says: "Mirrors to github.com/acme/tea-shop · through Acme Mate",
    },
    {
      case: "a mirror through the app",
      remote: { ...remote, via: "app" },
      app,
      says: "Mirrors to github.com/acme/tea-shop · through Acme Mate",
    },
    {
      case: "a mirror with a token",
      remote: { ...remote, expiresAt: "2027-10-17T09:00:00Z" },
      app,
      says: "Mirrors to github.com/acme/tea-shop · with a token that expires 2027-10-17",
    },
    {
      case: "a diverged mirror, never that it mirrors",
      remote: { ...remote, via: "app", divergedSince: "2026-10-16T12:00:00Z" },
      app,
      says: "GitHub's main and Mate's main differ since 2026-10-16 — nothing moves until they match",
    },
    {
      case: "a token the remote refused, before where it mirrors",
      remote: { ...remote, invalidSince: "2026-10-15T08:00:00Z" },
      app,
      says: "github.com/acme/tea-shop refused Mate's token on 2026-10-15 — replace the token",
    },
    {
      case: "a mirror through an app that is gone from HQ",
      remote: { ...remote, via: "app" },
      app: { kind: "none" },
      says: "The app is gone — connect GitHub again or use a token",
    },
    {
      case: "a mirror through an app HQ says no longer reaches it",
      remote: { ...remote, via: "app", invalidSince: "2026-10-15T08:00:00Z" },
      app,
      says: "The app is gone — connect GitHub again or use a token",
    },
    {
      case: "a mirror through the app while the app is not read",
      remote: { ...remote, via: "app" },
      app: { kind: "unknown" },
      says: "Mirrors to github.com/acme/tea-shop · through the organization's GitHub app",
    },
  ] as const)("says $case", (row) => {
    const { remote: held, app: reach, says } = row;
    const follows = "follows" in row ? { follows: row.follows } : {};
    expect(mirrorStateLine({ remote: held, ...follows }, reach, NOW)).toBe(says);
  });
});

describe("the mirror dialog's lead line", () => {
  it("promises review on GitHub only where the app mirrors, and says a token pushes main", () => {
    expect(mirrorLeadLine(app)).toBe(
      "Mirror a repository to GitHub, and Mate's changes to it open there for review.",
    );
    expect(mirrorLeadLine({ kind: "none" })).toBe(
      "Mirror a repository to GitHub or GitLab: Mate pushes what lands on its main there.",
    );
  });
});

describe("who may mirror, said where the way to mirror would stand", () => {
  it.each([
    { case: "a person HQ lets mirror", offer: { kind: "allowed" }, says: null },
    {
      case: "a person HQ refuses as no structure writer",
      offer: { kind: "refused", reason: "not_structure_writer" },
      says: "Only an Owner or Admin of the organization can mirror this project's code.",
    },
    {
      case: "a person HQ refuses for another reason, in HQ's words",
      offer: { kind: "refused", reason: "not_active_member" },
      says: "You are not an active member of this organization in Zerops.",
    },
    {
      case: "HQ has not said",
      offer: { kind: "unknown" },
      says: "HQ hasn't said yet whether you can mirror this project's code.",
    },
    {
      case: "HQ is not answering",
      offer: { kind: "unavailable", since: NOW },
      says: "HQ isn't answering, so mirroring waits until it does.",
    },
  ] as const)("$case", ({ offer, says }) => {
    expect(mirrorAuthorityLine(offer)).toBe(says);
  });
});

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
      case: "a ruleset that requires mate/gate but lets anyone push to main is told to require a pull request in it",
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
