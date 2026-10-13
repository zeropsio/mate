import type { ScenarioExtension } from "../../harness/scenario.ts";
/** Move's platform rename uses the same versioned project facts as the real write. */
export const installMutations: ScenarioExtension = ({ zerops }) => {
  zerops.handlers.push((request) => {
    const projectId = request.url.pathname.match(/^\/api\/rest\/public\/project\/([^/]+)$/u)?.[1];
    if (projectId === undefined || request.method !== "PUT") return undefined;
    const row = zerops.rows("project").find((project) => project.id === projectId);
    const credential = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
    if (row === undefined) return zerops.error(400, "projectNotFound");
    if (!zerops.canWrite(credential, projectId))
      return zerops.error(403, "insufficientPermissions");
    if (typeof request.body.name !== "string") return zerops.error(400, "invalidName");
    zerops.put("project", {
      ...row,
      name: request.body.name,
      tagList: request.body.tagList ?? row.tagList,
    });
    return { body: zerops.rows("project").find((project) => project.id === projectId) };
  });
};
