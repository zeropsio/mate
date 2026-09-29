/**
 * The Brief editor as a crewmate chat opens it — the lead's *Change the
 * brief* — gathering what the sheet needs from the environment: the applied
 * crew's brief version and how many crewmates a save reaches. Renders nothing
 * while it is closed.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import { useCrew } from "../../../zerops/crew/useCrew";
import { useCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { CrewBriefSheet } from "./CrewBriefSheet";

export function CrewBriefEditor({
  environmentId,
  open,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const { snapshot, view } = useCrew(environmentId);
  const commands = useCrewCommand(environmentId);
  if (!open || snapshot === null) return null;
  return (
    <CrewBriefSheet
      commands={commands}
      crewmateCount={snapshot.crewmates.length}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
      version={view?.crew?.briefVersion ?? null}
    />
  );
}
