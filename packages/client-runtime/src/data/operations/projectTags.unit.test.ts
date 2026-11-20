import { expect, it } from "vite-plus/test";
import type { ZeropsProject } from "../../zerops/api/project.ts";
import { makeProjectTagWriter } from "./executors/projectTags.ts";

// witness: packages/client-runtime/src/data/operations/executors/projectTags.ts | source.writeProject(project, { name, tagList: project.tagList ?? [] }) → source.writeProject(project, { name, tagList: [] })
it("OP12: A rename and a tag write to one project never undo each other", async () => {
  let project: ZeropsProject = { id: "p1", name: "One", status: "ACTIVE", tagList: [] };
  const writer = makeProjectTagWriter({
    source: {
      fetchProject: async () => project,
      writeProject: async (_read, record) => {
        project = { ...project, ...record };
        return project;
      },
    },
  });
  const writes = await Promise.allSettled([
    writer.write("p1", { kind: "mate" }),
    writer.rename("p1", "Nova"),
  ]);
  expect([project.name, project.tagList]).toEqual(["Nova", ["mate"]]);
  for (const write of writes) if (write.status === "rejected") throw write.reason;
});
