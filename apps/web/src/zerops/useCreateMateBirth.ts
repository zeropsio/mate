/**
 * *Set up Mate* and *Enable Zerops Mate* on a project that exists: its one Create, which HQ's
 * operation runs — it records the Mate, gives the zcp its own key, turns Zerops Mate on and
 * restarts it. The projects screen and a Mate's page press the same Create from here.
 */
import {
  type BirthIntent,
  formatMateFace,
  newMateTint,
  projectNameInApp,
} from "@t3tools/client-runtime/zerops";
import { ownerAtAdd } from "@t3tools/client-runtime/zerops/projectAccess";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { useCallback } from "react";

import { randomUUID } from "~/lib/utils";
import { HQ_UNFOLLOWED, useAccountOperations } from "./accountOperations";
import { useReadGroupAgents } from "./groupAgents";
import { useZeropsSession } from "./ZeropsSessionProvider";

/**
 * The one Create of a Mate on a project that exists — *Set up Mate* and *Enable* (`POST /api/births`
 * with `projectId`): HQ's operation grants `owner` the project first, records the Mate, mints its
 * key, and imports its container or turns on and restarts the one it holds; the tab writes none of
 * it. Its face is the one HQ records for the Mate already, else the tint its name gets among the
 * account's (`newMateTint`) and that tint's shape; its name is its project's in Zerops (D3).
 */
function mateSetUpBirth(input: {
  readonly id: string;
  readonly project: ZeropsCandidate["project"];
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  /** The application it is adopted into; HQ places it otherwise. */
  readonly appId?: string | undefined;
  readonly agents: BirthIntent["agents"];
  /** Whom its operation grants `OWNER` on the project (`ownerAtAdd`); none where nobody. */
  readonly owner: string | null;
}) {
  const recorded = input.project.hq?.mate?.face;
  const tint = newMateTint(input.candidates, input.project.name);
  return {
    id: input.id,
    projectId: input.project.id,
    ...(input.appId === undefined ? {} : { appId: input.appId }),
    face:
      recorded === undefined || recorded === ""
        ? formatMateFace({ tint, shape: MATE_SHAPE_OF_TINT[tint] })
        : recorded,
    intent: {
      projectName: input.project.name,
      recipe: { kind: "none" },
      agents: input.agents,
      standUp: false,
      automated: false,
      placement: { role: "dev", name: projectNameInApp(input.project), chief: false },
      location: null,
      userRoles: [],
    } satisfies BirthIntent,
    ...(input.owner === null ? {} : { owner: input.owner }),
  };
}

/** One Create on a project that exists (`mateSetUpBirth`): resolves once HQ took it, rejects with its refusal. */
export function useSendMateSetUp() {
  const operations = useAccountOperations();
  return useCallback(
    async (orgId: string, birth: Parameters<typeof mateSetUpBirth>[0]): Promise<void> => {
      await operations.run(
        { kind: "create-birth", orgId, ...mateSetUpBirth(birth) },
        { orgId, unobserved: HQ_UNFOLLOWED },
      );
    },
    [operations],
  );
}

/** The groups a project may sit in, each with its environments' candidates. */
type GroupsOf = ReadonlyArray<{
  readonly group: { readonly groupId: string };
  readonly environments: ReadonlyArray<{ readonly item?: ZeropsCandidate | undefined }>;
}>;

/**
 * A project's Create in its group's application, with the agents its group's environments are
 * signed in with. HQ's operation marks its owner where the project names none and the person may
 * (`ownerAtAdd`), then makes its Mate. False where nothing was sent.
 */
export function useCreateMateBirth(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly groups: GroupsOf;
}): (candidate: ZeropsCandidate, isCurrent: () => boolean) => Promise<boolean> {
  const { activeOrganization } = useZeropsSession();
  const readGroupAgents = useReadGroupAgents();
  const send = useSendMateSetUp();
  const { candidates, groups } = input;
  return useCallback(
    async (candidate, isCurrent) => {
      if (!activeOrganization) return false;
      const projectId = candidate.project.id;
      const group = groups.find((entry) =>
        entry.environments.some(({ item }) => item?.project.id === projectId),
      );
      const agents =
        group === undefined
          ? []
          : await readGroupAgents(
              group.environments.flatMap(({ item }) => (item === undefined ? [] : [{ item }])),
            );
      if (!isCurrent()) return false;
      await send(activeOrganization.id, {
        id: randomUUID(),
        project: candidate.project,
        candidates,
        appId: group?.group.groupId,
        agents,
        owner: ownerAtAdd({ userRoles: candidate.project.userRoles, adder: activeOrganization }),
      });
      return true;
    },
    [activeOrganization, candidates, groups, readGroupAgents, send],
  );
}
