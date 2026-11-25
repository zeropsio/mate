import { expect, it } from "vite-plus/test";
import { repositoryPage } from "./ZeropsRepositoryBrowser.logic";

// witness: apps/web/src/components/zerops/ZeropsRepositoryBrowser.logic.ts | if (input.allowed === undefined) return { kind: "reading" }; → if (input.allowed === undefined) return { kind: "gone" };
it("MN+1: A repository's page is loading until HQ has answered, says the repository is gone when its project or the repository is no longer listed or HQ denies its reads, says the person has no access when HQ's offer refuses, and opens otherwise; breaks: a deleted repository reads as access not verified, or a repository HQ has not answered for reads as gone", () => {
  const base = {
    appsKnown: true,
    appListed: true,
    repositories: ["code"],
    repo: "code",
    allowed: true,
    accessReason: undefined,
    withheld: false,
    homeRefusal: undefined,
  };
  const rows = [
    [{ ...base, appsKnown: false, appListed: false }, { kind: "reading" }],
    [{ ...base, appListed: false }, { kind: "gone" }],
    [
      { ...base, allowed: false, withheld: true },
      { kind: "no-access", reason: "You do not have access to this repository." },
    ],
    [{ ...base, withheld: true }, { kind: "gone" }],
    [{ ...base, homeRefusal: "repo_not_found" }, { kind: "gone" }],
    [{ ...base, homeRefusal: "app_not_found" }, { kind: "gone" }],
    [{ ...base, allowed: undefined }, { kind: "reading" }],
    [{ ...base, repositories: ["other"] }, { kind: "gone" }],
    [base, { kind: "open" }],
    [{ ...base, repositories: undefined }, { kind: "open" }],
    [
      { ...base, allowed: false, accessReason: "HQ refused." },
      { kind: "no-access", reason: "HQ refused." },
    ],
  ] as const;
  for (const [input, expected] of rows) expect(repositoryPage(input)).toEqual(expected);
});
