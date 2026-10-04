import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api.ts";
import { partitionZeropsToolProjects, readZeropsToolKind } from "./tools.ts";

/** The probe project as the platform actually returned it, 2026-09-05. */
const GITEA_PROJECT: ZeropsProject = {
  id: "VX2ruYMlTGOrTBfVBmS45Q",
  name: "mate-gitea",
  status: "ACTIVE",
  publicZone: "s7cg2lbb37ebf9fao4ts4408bp0.prg1-zerops.zone",
  zeropsSubdomainHost: "926",
  tagList: [],
  hqTool: "gitea",
};

describe("HQ tool records", () => {
  it("reads the HQ kind and ignores a legacy tool tag", () => {
    expect(readZeropsToolKind({ hqTool: "gitea" })).toBe("gitea");
    expect(readZeropsToolKind({ tagList: ["mate:tool:gitea"] })).toBeUndefined();
  });
});

describe("partitionZeropsToolProjects", () => {
  it("takes tools out of the list the group tree is built from", () => {
    const app: ZeropsProject = { id: "a", name: "crm", status: "ACTIVE", tagList: ["mate"] };
    const plain: ZeropsProject = { id: "b", name: "plain", status: "ACTIVE" };

    const { tools, rest } = partitionZeropsToolProjects([app, GITEA_PROJECT, plain]);

    expect(tools.map((tool) => tool.kind)).toEqual(["gitea"]);
    expect(rest.map((project) => project.name)).toEqual(["crm", "plain"]);
  });

  it("treats a tool HQ also places in a group as a tool — the two are disjoint", () => {
    const confused: ZeropsProject = {
      id: "c",
      name: "confused",
      status: "ACTIVE",
      hqTool: "gitea",
    };

    const { tools, rest } = partitionZeropsToolProjects([confused]);

    expect(tools).toHaveLength(1);
    expect(rest).toEqual([]);
  });
});
