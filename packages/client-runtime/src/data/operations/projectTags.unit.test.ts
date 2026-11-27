import { expect, it } from "vite-plus/test";
import type { ZeropsProject } from "../../zerops/api/project.ts";
import { makeProjectTagWriter } from "./executors/projectTags.ts";

// witness: packages/client-runtime/src/data/operations/executors/projectTags.ts | source.writeProject(project, { name, tagList: project.tagList ?? [] }) → source.writeProject(project, { name, tagList: [] })
it("OP12: A project rename preserves the tags it read", async () => {
  let project: ZeropsProject = { id: "p1", name: "One", status: "ACTIVE", tagList: ["person"] };
  const writer = makeProjectTagWriter({
    source: {
      fetchProject: async () => project,
      writeProject: async (_read, record) => {
        project = { ...project, ...record };
        return project;
      },
    },
  });
  await writer.rename("p1", "Nova");
  expect([project.name, project.tagList]).toEqual(["Nova", ["person"]]);
});
