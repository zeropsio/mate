/**
 * Runs a New project's creation over the account's operations: each step recorded under the id
 * its creation names (`creationSteps`), from the press and again on the person's *Try again*.
 */
import { appProjectName, withZeropsMateTag } from "@t3tools/client-runtime/zerops";
import { useCallback } from "react";

import { HQ_UNFOLLOWED, useAccountOperations } from "./accountOperations";
import { invalidateZerops } from "./accountInvalidations";
import { captureAccountLifetime } from "./accountLifetime";
import { runOnce } from "./creations";
import { beginPress, finishMateSetup, PRESS_MAY_HAVE_LANDED, whilePressing } from "./matePress";
import { newProjectPlacement, runNewProjectBirth, type CreationAsk } from "./newProjectBirth";
import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

export function useRunNewProject(): (held: CreationAsk) => void {
  const { client } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const operations = useAccountOperations();
  return useCallback(
    (held) => {
      const { ask, startedAt } = held;
      const { organizationId, birthId, name, botName, face } = ask;
      const organization = organizationRef(organizationId);
      const isCurrent = captureAccountLifetime();
      const hqStep = { orgId: organizationId, unobserved: HQ_UNFOLLOWED };
      void runOnce(birthId, () =>
        runNewProjectBirth(held, () => operations.readCreation(organizationId, birthId), {
          registerGroup: (requestId, groupName) =>
            operations.run(
              { kind: "create-app", orgId: organizationId, name: groupName },
              { ...hqStep, requestId },
            ),
          recordBirth: (requestId, { appId, face: birthFace }) =>
            operations.run(
              { kind: "record-birth", orgId: organizationId, appId, face: birthFace },
              { ...hqStep, requestId },
            ),
          // The project alone, born a Mate under its birth intent (its marker on before anything
          // else): its press attaches it to its application, then imports its container (F6b). In
          // flight as a press: the background mints no throwaway while it reads the token list.
          createProject: (requestId, { name: projectName, location }) =>
            whilePressing(
              () =>
                new Promise<{ readonly projectId: string }>((resolve, reject) => {
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
                        requestId,
                        accepted: resolve,
                      },
                    )
                    .catch(reject);
                }),
            ),
          accepted: (projectId, { hq, appId, intent }) => {
            // A step still running when the person signs out lands nowhere.
            if (!isCurrent()) return;
            // The press goes on: the Mate attached to its application in HQ, its container
            // imported and the project closed off. The listing is read again so the project's
            // group catches up with it. Its row stands where the creation's stood, with the same
            // face and name, on the creation's own clock — never from 0:00.
            beginPress({
              projectId,
              organizationId,
              startedAt,
              container: true,
              placement: newProjectPlacement({ ...ask, appId }),
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
            });
          },
        }),
      );
    },
    [client, operations, organizationRef],
  );
}
