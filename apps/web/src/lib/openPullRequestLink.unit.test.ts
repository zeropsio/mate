import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { RepositoryIdentity } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { findProjectForChangeRequest, parseChangeRequestUrl } from "./openPullRequestLink.ts";

const project = (id: string, repositoryIdentity: RepositoryIdentity) =>
  ({ id, repositoryIdentity }) as Pick<
    EnvironmentProject,
    "id" | "repositoryIdentity"
  > as EnvironmentProject;

const bakery = project("p-bakery", {
  canonicalKey: "github.com/acme/bakery",
  locator: {
    source: "git-remote",
    remoteName: "origin",
    remoteUrl: "https://github.com/acme/bakery.git",
  },
  provider: "github",
  owner: "acme",
  name: "bakery",
});
const oven = project("p-oven", {
  canonicalKey: "gitlab.com/acme/kitchen/oven",
  locator: {
    source: "git-remote",
    remoteName: "origin",
    remoteUrl: "https://gitlab.com/acme/kitchen/oven.git",
  },
  provider: "gitlab",
  displayName: "acme/kitchen/oven",
  owner: "acme",
  name: "oven",
});
const projects = [bakery, oven];

const opensIn = (url: string) => {
  const link = parseChangeRequestUrl(url);
  return link === null ? undefined : findProjectForChangeRequest(projects, link)?.id;
};

// witness: apps/web/src/lib/openPullRequestLink.ts | identity.canonicalKey.split("/")[0]?.trim().toLowerCase() === link.host.toLowerCase() → link.host.toLowerCase().startsWith(identity.canonicalKey.split("/")[0]?.trim().toLowerCase() ?? "")
it("WL+3: A change-request link opens in a project only when its host and whole repository path, nested groups included, match the project's remote; another or lookalike host claims nothing", () => {
  expect(opensIn("https://github.com/acme/bakery/pull/12")).toBe("p-bakery");
  expect(opensIn("https://gitlab.com/acme/kitchen/oven/-/merge_requests/4")).toBe("p-oven");

  expect(opensIn("https://gitlab.com/kitchen/oven/-/merge_requests/4")).toBeUndefined();
  expect(opensIn("https://github.com/other/bakery/pull/12")).toBeUndefined();
  expect(opensIn("https://github.acme.test/acme/bakery/pull/12")).toBeUndefined();
  expect(opensIn("https://github.com.evil.test/acme/bakery/pull/12")).toBeUndefined();
});
