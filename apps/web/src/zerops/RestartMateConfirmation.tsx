import { RecoveryItems, useRecoveryFeedback } from "./recoveryOutcomes";
import { useAtomValue } from "@effect/atom-react";

import { ZeropsRestartMateDialog } from "../components/zerops/ZeropsRestartMateDialog";
import { restartMateWords } from "../components/zerops/ZeropsRestartMateDialog.logic";
import { useThreadShells } from "../state/entities";
import { hqMatesAtom } from "../state/zerops";

interface RestartTarget {
  readonly name: string;
  readonly projectId: string;
  readonly environmentId: Parameters<typeof restartMateWords>[1];
}

function useRestartWords({ name, projectId, environmentId }: RestartTarget): string {
  const threads = useThreadShells();
  const hq = useAtomValue(hqMatesAtom);
  const told = hq?.mates?.get(projectId);
  return restartMateWords(
    name,
    environmentId,
    threads,
    hq?.current && told?.presence.online && told.presence.overview === "live" ? told : undefined,
  );
}

/** Subscribe to work only while confirming, so streamed work never rerenders the Mate menus. */
export function RestartMateConfirmation({
  name,
  projectId,
  environmentId,
  ...dialog
}: Omit<Parameters<typeof ZeropsRestartMateDialog>[0], "body"> & RestartTarget) {
  const body = useRestartWords({ name, projectId, environmentId });
  const { items } = useRecoveryFeedback(projectId, "restart-confirmation");
  const latest = items.at(-1)?.outcome;
  return (
    <ZeropsRestartMateDialog
      {...dialog}
      name={name}
      body={body}
      pending={
        latest === undefined ? dialog.pending : !latest.terminal && latest.retry.action === null
      }
      error={latest === undefined ? dialog.error : null}
      confirmLabel={latest?.succeeded ? "Restart" : latest?.retry.label}
      feedback={items.length === 0 ? null : <RecoveryItems items={items} actions={false} />}
    />
  );
}

/** The update confirmation uses the same reading of running chats as the Mate's own menu. */
export function RestartMateWarning(props: RestartTarget) {
  const words = useRestartWords(props);
  return (
    <>{words === `Restart ${props.name}?` ? "Restarting interrupts work running in it." : words}</>
  );
}
