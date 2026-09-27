/**
 * The Crewmate editor as any crew surface opens it: the section's rows and
 * *+ Add crewmate*, and a crewmate chat's *Edit job* (PRD §4.5). It gathers
 * what the sheet needs from the environment — the applied crew and the dev
 * services the engine names, the Mate's coding agents and its tint — so a
 * caller names only the crewmate. Renders nothing while `target` is `null`.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import { useServerConfigs } from "../../../state/entities";
import { useCrew } from "../../../zerops/crew/useCrew";
import { useCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useZeropsMate } from "../../../zerops/useZeropsMates";
import { crewDevHosts } from "./CrewEditors.logic";
import { CrewmateSheet, type CrewmateSheetTarget } from "./CrewmateSheet";

export function CrewmateEditor({
  environmentId,
  target,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  /** The crewmate to edit or add; `null` keeps the editor closed. */
  readonly target: CrewmateSheetTarget | null;
  readonly onClose: () => void;
}) {
  const { snapshot } = useCrew(environmentId);
  const commands = useCrewCommand(environmentId);
  const providers = useServerConfigs().get(environmentId)?.providers;
  const mate = useZeropsMate(environmentId);
  if (target === null || snapshot === null) return null;
  return (
    <CrewmateSheet
      applied={new Set(snapshot.crewmates.map((row) => row.handle))}
      commands={commands}
      crewPort={snapshot.crewmates.find((row) => row.handle === target.handle)?.app?.port ?? null}
      devHosts={crewDevHosts(snapshot)}
      mateName={mate.kind === "mate" ? mate.mate.name : "the Mate"}
      mateTint={mate.kind === "mate" ? mate.mate.tint : undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      providers={providers}
      target={target}
    />
  );
}
