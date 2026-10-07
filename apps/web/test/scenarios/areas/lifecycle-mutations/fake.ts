import type { ScenarioExtension } from "../../harness/scenario.ts";
import { VcsStatusResult, WS_METHODS } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const encodeStatus = Schema.encodeSync(VcsStatusResult);

/** Move's platform rename uses the same versioned project facts as the real write. */
export const installMutations: ScenarioExtension = ({ zerops, onMate }) => {
  // Resolving a pending question refreshes the Mate's checkout status independently of HQ's repository.
  onMate.push((mate) =>
    mate.rpcHandlers.push((request, socket) => {
      if (request.tag !== WS_METHODS.vcsRefreshStatus) return false;
      mate.reply(
        socket,
        request.id,
        encodeStatus({
          isRepo: false,
          hasPrimaryRemote: false,
          isDefaultRef: true,
          refName: null,
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        }),
      );
      return true;
    }),
  );
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
