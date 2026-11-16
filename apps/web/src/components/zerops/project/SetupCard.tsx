/**
 * The project page's side column: what is set up once — addresses, code, automation, who has
 * access, spend — each its own card under its label. A setup with nothing to say is not drawn, so
 * the column holds only what is there.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  standUpVerdictHandsOver,
  type EnvironmentId,
  type StandUpHeadline,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState, type ReactNode } from "react";

import { zeropsEnvironmentsAtom } from "../../../state/zerops";
import { useEnvironmentSessionState } from "../../../state/session";
import { resolveRemoteOperateAccess } from "../../settings/ProviderSettingsPanel.logic";
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
 * person: its headline, a row per pooled service, and — once zcp says it failed and nothing still
 * builds, for a person who may operate the Mate — its one action: the verdict handed to an agent
 * turn (the setup's retry, without the setup document's settlement). Nothing where zcp wrote no verdict: a tier
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

type HandOverAnswer = "sending" | "went" | "refused" | "unreachable";

const ANSWER: Readonly<Record<Exclude<HandOverAnswer, "sending">, string>> = {
  went: "The agent has the verdict.",
  refused: "Not handed over: no agent of yours is signed in to take it.",
  unreachable: "The Mate did not answer. Try again.",
};

function SetupStandUpOf({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
}) {
  const reading = useAtomValue(zeropsFeeds.standUpVerdict(environmentId));
  const session = useEnvironmentSessionState(environmentId);
  const mayOperate =
    resolveRemoteOperateAccess({
      session: session.data,
      isPending: session.isPending,
      hasError: session.hasError,
    }) === "granted";
  const send = useAtomCommand(zeropsCommands.standUpHandOver, "stand-up verdict to agent");
  const verdict =
    reading.state === "known" && reading.value.verdict !== null ? reading.value.verdict : null;
  // An answer is the verdict's it was given for: a changed verdict starts with none.
  const shown = verdict === null ? "" : JSON.stringify(verdict);
  const [answer, setAnswer] = useState<{ readonly for: string; readonly is: HandOverAnswer }>();
  const current = answer?.for === shown ? answer.is : undefined;
  const handOver = useCallback(async () => {
    if (current === "sending") return;
    setAnswer({ for: shown, is: "sending" });
    const result = await send({ environmentId, input: {} });
    setAnswer({
      for: shown,
      is: !AsyncResult.isSuccess(result) ? "unreachable" : result.value ? "went" : "refused",
    });
  }, [current, environmentId, send, shown]);
  if (verdict === null) return null;
  return (
    <SetupRow
      action={
        mayOperate && standUpVerdictHandsOver(verdict) && current !== "went" ? (
          <SectionAction onClick={() => void handOver()}>Hand to agent</SectionAction>
        ) : undefined
      }
      busy={current === "sending"}
      label={`Stand-up · ${name}`}
      rows
      surface="project-setup-standup"
    >
      <p data-zerops-standup-headline={verdict.headline}>{HEADLINE[verdict.headline]}</p>
      <StandupVerdictRows verdict={verdict} />
      {current === undefined || current === "sending" ? null : (
        <p className="text-muted-foreground">{ANSWER[current]}</p>
      )}
    </SetupRow>
  );
}
