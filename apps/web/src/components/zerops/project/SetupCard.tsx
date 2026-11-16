/**
 * The project page's side column: what is set up once — addresses, code, automation, who has
 * access, spend — each its own card under its label. A setup with nothing to say is not drawn, so
 * the column holds only what is there.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, StandUpHeadline } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState, type ReactNode } from "react";

import { zeropsEnvironmentsAtom } from "../../../state/zerops";
import { useMateOfEnvironment } from "../../../zerops/accountEnvironments";
import { zeropsFeeds } from "../../../zerops/feeds";
import { useAtomCommand } from "../../../state/use-atom-command";
import { zeropsCommands } from "../../../state/zeropsCommands";
import { StandupVerdictRows } from "../../chat/StandupDetail";
import { SectionAction, SectionLabel } from "../system";

export function SetupCard({ children }: { readonly children: ReactNode }) {
  return (
    <div aria-label="Setup" className="pp-setup" data-zerops-surface="project-setup" role="group">
      {children}
    </div>
  );
}

/**
 * One setup: its label, its one action at the label's end, then its card. `rows`: the card holds
 * rows with padding of their own. `empty`: nothing is set up yet — a dashed slot saying what it is
 * for, its one verb inside it.
 */
export function SetupRow({
  label,
  action,
  busy = false,
  rows = false,
  empty = false,
  children,
  surface,
}: {
  readonly label: string;
  readonly action?: ReactNode;
  /** Read still: its line holds its room. */
  readonly busy?: boolean;
  readonly rows?: boolean;
  readonly empty?: boolean;
  readonly children: ReactNode;
  /** Its `data-zerops-surface`, where a scenario or a harness finds it. */
  readonly surface?: string;
}) {
  return (
    <section
      aria-busy={busy ? "true" : undefined}
      aria-label={label}
      className="pp-group"
      data-zerops-surface={surface}
    >
      <SectionLabel action={action}>{label}</SectionLabel>
      <div
        className="pp-card pp-setup-card"
        data-empty={empty ? "" : undefined}
        data-rows={rows ? "" : undefined}
      >
        {children}
      </div>
    </section>
  );
}

const HEADLINE: Readonly<Record<StandUpHeadline, string>> = {
  building: "Building",
  ready: "Ready to work — leases available",
  done: "Done",
  failed: "Failed",
};

/**
 * A Mate's stand-up as zcp's verdict says it, read from the Mate's own socket by a signed-in
 * person: its headline, a row per pooled service, and on a failed one its one action — the
 * verdict handed to an agent turn (the setup's retry). Nothing where zcp wrote no verdict: a tier
 * without a pooled part stands up as before.
 */
export function SetupStandUp({
  projectId,
  name,
}: {
  /** The Mate's Zerops project. */
  readonly projectId: string;
  readonly name: string;
}) {
  // Its socket, where this tab holds one: the verdict is read only from the Mate itself.
  const environmentId = useAtomValue(zeropsEnvironmentsAtom).find(
    (environment) => environment.zeropsProjectId === projectId,
  )?.environmentId;
  return environmentId === undefined ? null : (
    <SetupStandUpOf environmentId={environmentId} name={name} />
  );
}

function SetupStandUpOf({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
}) {
  const reading = useAtomValue(zeropsFeeds.standUpVerdict(environmentId));
  const mate = useMateOfEnvironment(environmentId);
  const send = useAtomCommand(zeropsCommands.standUpRetry, "stand-up verdict to agent");
  const [answer, setAnswer] = useState<"sending" | "went" | "refused" | "unreachable" | null>(null);
  const handOver = useCallback(async () => {
    if (answer === "sending") return;
    if (mate?.orgId == null || mate.origin === null) {
      setAnswer("unreachable");
      return;
    }
    setAnswer("sending");
    const result = await send({
      environmentId,
      input: { orgId: mate.orgId, origin: mate.origin },
    });
    setAnswer(!AsyncResult.isSuccess(result) ? "unreachable" : result.value ? "went" : "refused");
  }, [answer, environmentId, mate, send]);
  if (reading.state !== "known" || reading.value.verdict === null) return null;
  const { verdict } = reading.value;
  const failed = verdict.headline === "failed";
  return (
    <SetupRow
      action={
        failed && answer !== "went" ? (
          <SectionAction onClick={() => void handOver()}>Hand to agent</SectionAction>
        ) : undefined
      }
      busy={answer === "sending"}
      label={`Stand-up · ${name}`}
      rows
      surface="project-setup-standup"
    >
      <p data-zerops-standup-headline={verdict.headline}>{HEADLINE[verdict.headline]}</p>
      <StandupVerdictRows verdict={verdict} />
      {answer === "went" ? (
        <p className="text-muted-foreground">The agent has the verdict.</p>
      ) : answer === "refused" ? (
        <p className="text-muted-foreground">No agent of yours can take it: sign one in.</p>
      ) : answer === "unreachable" ? (
        <p className="text-muted-foreground">The Mate did not answer. Try again.</p>
      ) : null}
    </SetupRow>
  );
}
