import { assert, describe, it } from "@effect/vitest";

import { GITHUB_TOKEN_USES, askedPermissions } from "./githubAuth.ts";

/**
 * What GitHub documents each call of a use needs of an installation token
 * (https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps, and each
 * endpoint's "Fine-grained access tokens" section).
 */
const DOCUMENTED = [
  // Nothing but whether the app reaches it: every installation holds metadata.
  ["reach", { metadata: "read" }],
  // Git over HTTPS takes Contents; a commit touching `.github/workflows` takes Workflows too
  // (https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).
  ["git", { contents: "write", workflows: "write" }],
  // The push probe (Contents), check runs (Checks), statuses (Commit statuses), workflow runs (Actions).
  ["ci", { contents: "write", checks: "read", statuses: "read", actions: "read" }],
  // Open, edit, list and get pull requests, comment and assign on them (Pull requests); "Get an
  // issue" on a closed one (Issues: read); its check runs (Checks).
  ["pullRequests", { pull_requests: "write", issues: "read", checks: "read" }],
  // "Merge a pull request" takes Contents: write; reading the pull request, Pull requests.
  ["merge", { contents: "write", pull_requests: "write" }],
  // Reactions, comments, labels, closing (Issues: write).
  ["issues", { issues: "write" }],
] as const;

describe("the app's tokens", () => {
  it("a token for each use asks for the permissions GitHub documents for that use's calls", () => {
    assert.deepStrictEqual(
      Object.fromEntries(DOCUMENTED.map(([use, permissions]) => [use, permissions])),
      GITHUB_TOKEN_USES,
    );
  });

  it("a token's permissions are its use's, each at most what the installation was granted", () => {
    const rows = [
      // Granted all it asks: all of it.
      [
        "merge",
        { contents: "write", pull_requests: "write", metadata: "read" },
        { contents: "write", pull_requests: "write" },
      ],
      // No Workflows granted: pushes take Contents alone.
      ["git", { contents: "write", metadata: "read" }, { contents: "write" }],
      // Granted less than it asks: what was granted.
      [
        "ci",
        { contents: "read", checks: "read", metadata: "read" },
        { contents: "read", checks: "read" },
      ],
      // Granted more than it asks: never more than the use's.
      [
        "pullRequests",
        { pull_requests: "admin", issues: "write" },
        { pull_requests: "write", issues: "read" },
      ],
      // Granted none of it: no token.
      ["issues", { metadata: "read", contents: "write" }, undefined],
    ] as const;
    for (const [use, granted, asked] of rows)
      assert.deepStrictEqual(askedPermissions(use, granted), asked, use);
  });
});
