/**
 * Who HQ says is signed in to each agent's own login now, for the Mate an environment is
 * (`signedInNow` of its project): whose the conversation's composer is. `undefined` while the environment's project or HQ's word of it
 * is not known.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqProjectPeopleAtom, type HqProjectPeople } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";

import { useZeropsEnvironmentProject } from "./useZeropsEnvironmentProject";

export function useHqSigners(
  environmentId: EnvironmentId | null,
): HqProjectPeople["signedInNow"] | undefined {
  const project = useZeropsEnvironmentProject(environmentId);
  const people = useAtomValue(shownHqProjectPeopleAtom);
  return project === undefined ? undefined : people[project.projectId]?.signedInNow;
}
