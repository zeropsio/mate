import { expect, it } from "vite-plus/test";

import { deployedCommit, deployedVersion } from "./groupRows.ts";
import { sameCommit } from "./versionName.ts";

// witness: packages/client-runtime/src/zerops/versionName.ts | const COMMIT_DEPLOY_SHA = /^[0-9a-f]{12}$/u; → const COMMIT_DEPLOY_SHA = /^[0-9a-f]{11}$/u;
it("ZV193: A zcp commit-deploy version reads its 12-hex commit for display and matching, while other names keep their existing meaning", () => {
  const cases = [
    { input: "zcp abcdef012345", sha: "abcdef012345", label: "abcdef0", branch: undefined },
    { input: "  zcp   ABCDEF012345  ", sha: "abcdef012345", label: "abcdef0", branch: undefined },
    { input: "main abcdef0", sha: "abcdef0", label: "abcdef0", branch: "main" },
    { input: "zcp abcdef0", sha: "abcdef0", label: "abcdef0", branch: "zcp" },
    { input: "v1.2.3 abcdef0", sha: "abcdef0", label: "v1.2.3", branch: undefined },
    {
      input: "abcdef0123456789abcdef0123456789abcdef01",
      sha: "abcdef0123456789abcdef0123456789abcdef01",
      label: "abcdef0",
      branch: undefined,
    },
    {
      input: "abcdef0123456789abcdef0123456789abcdef01 v1.2.3 Alice",
      sha: "abcdef0123456789abcdef0123456789abcdef01",
      label: "v1.2.3",
      branch: undefined,
    },
    { input: "zcp abcdef01234", sha: undefined, label: "zcp abcdef01234", branch: undefined },
    { input: "zcp abcdef0123456", sha: undefined, label: "zcp abcdef0123456", branch: undefined },
    { input: "zcp abcdef01234g", sha: undefined, label: "zcp abcdef01234g", branch: undefined },
    {
      input: "zcp abcdef012345-dirty",
      sha: undefined,
      label: "zcp abcdef012345-dirty",
      branch: undefined,
    },
    {
      input: "zcp abcdef012345 extra",
      sha: undefined,
      label: "zcp abcdef012345 extra",
      branch: undefined,
    },
    { input: "main abcdef012345", sha: undefined, label: "main abcdef012345", branch: undefined },
    { input: "ZCP abcdef012345", sha: undefined, label: "ZCP abcdef012345", branch: undefined },
    { input: "abcdef012345", sha: undefined, label: "abcdef012345", branch: undefined },
  ];

  for (const { input, sha, label, branch } of cases) {
    const version = deployedVersion(input);
    expect({ sha: version.sha, label: version.label, branch: version.branch }, input).toEqual({
      sha,
      label,
      branch,
    });
    expect(deployedCommit(input), input).toBe(sha);
  }

  const commit = deployedCommit("zcp abcdef012345");
  expect(sameCommit(commit, "abcdef0123456789abcdef0123456789abcdef01")).toBe(true);
  expect(sameCommit(commit, "abcdef0fedcb6789abcdef0123456789abcdef01")).toBe(false);
});
