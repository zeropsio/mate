import { describe, expect, it } from "vite-plus/test";

import { mirrorLeadLine, mirrorStateLine } from "./gitMirror.logic";

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
  ] as const)("says $case", ({ remote: held, app: reach, says }) => {
    expect(mirrorStateLine(held, reach, NOW)).toBe(says);
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
