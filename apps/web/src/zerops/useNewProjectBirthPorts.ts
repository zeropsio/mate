/** Rebuilds callable ports from the current account for a person's explicit retry. */
import { HQ_UNFOLLOWED, useAccountOperations } from "./accountOperations";
import { appProjectName, withZeropsMateTag } from "@t3tools/client-runtime/zerops";
import { invalidateZerops } from "./accountInvalidations";
import { captureAccountLifetime } from "./accountLifetime";
import { beginPress, finishMateSetup, PRESS_MAY_HAVE_LANDED, whilePressing } from "./matePress";
import { useNewMate } from "./newMate";
import {
  newProjectPlacement,
  progressNewProjectBirth,
  type NewProjectAsk,
  type NewProjectPorts,
} from "./newProjectBirth";
import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

export function useNewProjectBirthPorts(): (ask: NewProjectAsk) => NewProjectPorts {
  const { client } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const operations = useAccountOperations();
  const created = useNewMate((state) => state.created);
  return (ask) => {
    const { organizationId, birthId, name, botName, face } = ask;
    const organization = organizationRef(organizationId);
    const isCurrent = captureAccountLifetime();
    return {
      registerGroup: ({ name: groupName }) =>
        operations.run(
          { kind: "create-app", orgId: organizationId, name: groupName },
          { orgId: organizationId, unobserved: HQ_UNFOLLOWED },
        ),
      recordBirth: async ({ appId, face }) => ({
        id: (
          await operations.run(
            { kind: "record-birth", orgId: organizationId, appId, face },
            { orgId: organizationId, unobserved: HQ_UNFOLLOWED },
          )
        ).birthId,
      }),
      // The project alone, born a Mate under its birth intent (its marker on before anything
      // else): its press attaches it to its application, then imports its container (F6b). In
      // flight as a press: the background mints no throwaway while it reads the token list.
      createProject: ({ name: projectName, location }) =>
        whilePressing(
          () =>
            new Promise<{ readonly project: { readonly id: string } }>((resolve, reject) => {
              // Taken the moment Zerops takes its project; the project's own end is its press's.
              operations
                .run(
                  {
                    kind: "create-project",
                    orgId: organizationId,
                    name: projectName,
                    tagList: withZeropsMateTag([]),
                    ...(location === undefined ? {} : { location }),
                  },
                  {
                    orgId: organizationId,
                    unobserved: PRESS_MAY_HAVE_LANDED,
                    accepted: ({ projectId }) => resolve({ project: { id: projectId } }),
                  },
                )
                .catch(reject);
            }),
        ),
      accepted: (projectId, registration, startedAt) => {
        if (registration === null) return;
        const { hq, appId, intent } = registration;
        // The press goes on: the Mate attached to its application in HQ, its container imported
        // and the project closed off. The listing is read again so the project's group catches
        // up with it. Its row stands where the creation's stood, with the same face and name.
        const placement = newProjectPlacement({ ...ask, appId });
        beginPress({
          projectId,
          organizationId,
          startedAt,
          container: true,
          placement,
        });
        invalidateZerops({ topic: "inventory", organization });
        void finishMateSetup({
          inputs: { client, operations, organizationId },
          projectId,
          projectName: appProjectName(name, botName),
          // After its attach: a press that stops before it leaves a Mate HQ holds in its
          // application, which any browser finishes.
          container: { agents: ask.agents },
          registration: {
            hq,
            groupId: appId,
            kind: "mate",
            mate: { face },
            standUp: false,
            intent,
          },
          hq,
          isCurrent,
          // Kept on the creation, whose view draws each step under the project's row.
          onProgress: (progress) => {
            if (isCurrent()) progressNewProjectBirth(birthId, progress);
          },
        });
        // Who it is until the listing names it, as Add a Mate's are: its
        // view's face, name and stand-up.
        created({ projectId, groupId: appId, groupName: name, botName, face });
      },
    };
  };
}
