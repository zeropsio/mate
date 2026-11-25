import { useRecoveryFeedback } from "~/zerops/recoveryOutcomes";
import { RecoveryItems } from "../RecoveryOutcomes";
import { useAtomValue } from "@effect/atom-react";

import { ZeropsMateVerbDialog } from "../ZeropsMateVerbDialog";
import {
  idleRestartWords,
  mateVerbWords,
  type MateComputerVerb,
} from "../ZeropsMateVerbDialog.logic";
import { useThreadShells } from "~/state/entities";
import { hqMatesAtom } from "~/state/zerops";

interface VerbTarget {
  readonly name: string;
  readonly projectId: string;
  readonly environmentId: Parameters<typeof mateVerbWords>[2];
}

function useVerbWords(
  verb: MateComputerVerb,
  { name, projectId, environmentId }: VerbTarget,
): string {
  const threads = useThreadShells();
  const hq = useAtomValue(hqMatesAtom);
  const told = hq?.mates?.get(projectId);
  return mateVerbWords(
    verb,
    name,
    environmentId,
    threads,
    told?.presence.online && told.presence.overview === "live" ? told : undefined,
  );
}

type ConfirmationProps = Omit<Parameters<typeof ZeropsMateVerbDialog>[0], "body" | "verb"> &
  VerbTarget;

/** Subscribe to work only while confirming, so streamed work never rerenders the Mate menus. */
export function RestartMateConfirmation({
  name,
  projectId,
  environmentId,
  ...dialog
}: ConfirmationProps) {
  const body = useVerbWords("restart", { name, projectId, environmentId });
  const { items } = useRecoveryFeedback(projectId, "restart-confirmation");
  const latest = items.at(-1)?.outcome;
  return (
    <ZeropsMateVerbDialog
      {...dialog}
      verb="restart"
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

/** Stopping the Mate's whole project, with the work it would end named. */
export function StopMateConfirmation({
  name,
  projectId,
  environmentId,
  ...dialog
}: ConfirmationProps) {
  const body = useVerbWords("stop", { name, projectId, environmentId });
  return <ZeropsMateVerbDialog {...dialog} verb="stop" name={name} body={body} />;
}

/** The update confirmation uses the same reading of running chats as the Mate's own menu. */
export function RestartMateWarning(props: VerbTarget) {
  const words = useVerbWords("restart", props);
  return (
    <>
      {words === idleRestartWords(props.name) ? "Restarting interrupts work running in it." : words}
    </>
  );
}
