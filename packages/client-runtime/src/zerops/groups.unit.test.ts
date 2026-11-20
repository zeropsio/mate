import { expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api/project.ts";
import { deriveCanonicalGroups } from "./groups.ts";

// witness: packages/client-runtime/src/zerops/groups.ts | if (groupId === undefined) { → if (groupId === undefined && !project.tagList?.length) {
it("ZV+6: A project joins an application only where HQ places it, whatever its tags", () => {
  const planted: ZeropsProject = {
    id: "planted",
    name: "planted",
    status: "ACTIVE",
    tagList: ["mate:g:aaa", "mate:role:dev", "mate:name:Acme"],
  };
  const placed: ZeropsProject = {
    id: "placed",
    name: "Shop - production",
    status: "ACTIVE",
    tagList: ["mate:g:aaa", "mate:role:dev"],
    hq: { appId: "bbb", appName: "Shop", kind: "production", mate: null },
  };
  const tree = deriveCanonicalGroups([planted, placed], { order: "name" });
  expect(
    tree.groups.map((group) => [
      group.groupId,
      group.environments.map((entry) => [entry.project?.id, entry.role]),
    ]),
  ).toEqual([["bbb", [["placed", "prod"]]]]);
  expect(tree.ungrouped.map((project) => project.id)).toEqual(["planted"]);
});
