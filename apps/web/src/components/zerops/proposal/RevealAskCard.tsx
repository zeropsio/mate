/**
 * A reveal on the ask card: a hidden value the Mate cannot see — "Show DATABASE_PASSWORD from
 * production" — with the Mate's why, and the press that shows it on this screen only ("Reveal
 * production value" in production's colour, plain "Reveal" elsewhere) beside Not now. Revealed,
 * the value stands in the card with Copy until it hides, after half a minute or as the person
 * leaves; afterwards the card says to whom it was revealed and when, from HQ's record. Someone
 * without access sees who has it. Props only: the container reveals and records.
 */
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { ReactNode } from "react";

import { AskCard, AskFooter } from "../../ask/AskCard";
import type { AskState } from "../../ask/ask.logic";
import { AskRevealed } from "../../ask/AskSecret";
import { Button } from "../../ui/button";
import { proposalAskWhere } from "./proposal.logic";
import { revealPress } from "./reveal.logic";

export interface RevealAskCardProps {
  readonly proposal: Extract<ZeropsProposal, { kind: "env.reveal" }>;
  readonly state: AskState;
  /** Stage or Production, where the value's project is one of its application's environments. */
  readonly tier: "stage" | "production" | null;
  /** The conversation's own project: a value there is this Mate's. */
  readonly homeProjectId: string | null;
  /** Who asked: the why reads as its words. */
  readonly mateName: string;
  /** The value, while it is shown on this screen; `null` otherwise. */
  readonly value: string | null;
  /** Why the press cannot be pressed yet ("Reaching your organization's HQ…"). */
  readonly blocked?: string | undefined;
  /** Whether the viewer may reveal it again once it hid. */
  readonly mayReveal: boolean;
  readonly onReveal: () => void;
  readonly onNotNow: () => void;
  readonly onHide: () => void;
  /** While Zerops wants the person to confirm it's them: the press that opens its window. */
  readonly confirm?: ReactNode;
  /** Why the person's Not now was not kept, in HQ's words. */
  readonly refusal?: string | undefined;
}

export function RevealAskCard(props: RevealAskCardProps) {
  const { proposal, state, tier } = props;
  const action =
    state.kind === "working" && state.pressed === null ? (
      props.confirm
    ) : props.value !== null ? (
      <Button onClick={props.onHide} variant="ghost">
        Hide
      </Button>
    ) : state.kind === "failed" ? (
      <Button onClick={props.onReveal} variant="secondary">
        Try again
      </Button>
    ) : state.kind === "done" && props.mayReveal ? (
      <Button disabled={props.blocked !== undefined} onClick={props.onReveal} variant="secondary">
        Reveal again
      </Button>
    ) : undefined;
  return (
    <div data-proposal={proposal.id} data-proposal-kind={proposal.kind}>
      <AskCard
        askId={proposal.id}
        density="full"
        footer={
          <AskFooter
            action={action}
            density="full"
            destructive={tier === "production"}
            main={{
              label: revealPress(tier),
              onPress: props.onReveal,
              disabled: props.blocked !== undefined,
            }}
            note={props.blocked ?? "Only on your screen"}
            onNotNow={props.onNotNow}
            state={state}
          />
        }
        kind="reveal"
        state={state.kind}
        title={proposal.summary}
        where={proposalAskWhere(proposal, tier, props.homeProjectId)}
        why={
          proposal.reason === undefined || proposal.reason.trim() === ""
            ? null
            : { who: props.mateName, words: proposal.reason }
        }
      >
        {props.value === null ? null : <AskRevealed onHide={props.onHide} value={props.value} />}
        {props.refusal === undefined ? null : (
          <p className="text-caption text-destructive-foreground" role="alert">
            {props.refusal}
          </p>
        )}
      </AskCard>
    </div>
  );
}
