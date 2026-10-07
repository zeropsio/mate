import { runFixMate, useFixMates } from "../../zerops/fixMates";
import { useAskMateToFix, type FixProblem } from "../../zerops/fixRequest";
import { useZeropsSessionOptional } from "../../zerops/sessionContext";

type FixOrigin = { readonly projectId: string; readonly groupId: string | undefined } | undefined;

/**
 * "Ask Nova to fix it" (S6): the run's own Mate, with the problem written into
 * its composer — not sent. Only while it is the person's: a colleague's Mate is
 * theirs to ask (D6), and another of the person's would be pointed at a service
 * that is not its own (`runFixMate`). Outside a Zerops session there is no Mate
 * to ask.
 */
export function FixAction({
  problem,
  mate,
}: {
  readonly problem: FixProblem;
  readonly mate: FixOrigin;
}) {
  const session = useZeropsSessionOptional();
  if (session === null || mate === undefined) return null;
  return <FixActionOffer mate={mate} problem={problem} />;
}

function FixActionOffer({
  problem,
  mate,
}: {
  readonly problem: FixProblem;
  readonly mate: NonNullable<FixOrigin>;
}) {
  const fixer = runFixMate(useFixMates(mate), mate.projectId);
  const askToFix = useAskMateToFix();
  if (fixer === undefined) return null;
  return (
    <button
      className="run-result-action"
      onClick={() => askToFix(fixer.mateProjectId, problem)}
      type="button"
    >
      Ask {fixer.name} to fix it
    </button>
  );
}
