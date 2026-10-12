/**
 * What the organization's Mate proposes, on its card: what it would do as its title, why in the
 * Mate's words, what exactly — the service, the value (hidden when it is secret), or the words and
 * attachment another Mate would be sent — and Approve or Decline. Decided, the same card says how
 * it went in place: running, done, failed in the platform's words, or declined. Nothing ran before
 * the person approved it. Props only: the container carries out the approval.
 */
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  KeyRoundIcon,
  PlayIcon,
  RotateCwIcon,
  SendIcon,
  SquareIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { FlatCard, MateFace } from "../primitives";
import { proposalOutcomeWords, proposalWhere, type ProposalStage } from "./proposal.logic";

/** The Mate a message goes to, as the menu draws it; absent while the menu does not know it. */
export interface ProposalRecipient {
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
}

export interface ProposalCardProps {
  readonly proposal: ZeropsProposal;
  readonly stage: ProposalStage;
  /** A failed approval's reason, in the platform's words. */
  readonly failure?: string | undefined;
  /** Who proposed it: the reason reads as its words. */
  readonly mateName: string;
  /** `mate.message` only: the Mate it goes to, when the menu knows it. */
  readonly recipient?: ProposalRecipient | undefined;
  /** Why Approve cannot be pressed yet ("Reading the vault…"); absent when it can. */
  readonly approveBlocked?: string | undefined;
  readonly onApprove: () => void;
  readonly onDecline: () => void;
  /** `mate.message` only: opens the Mate it went to. */
  readonly onOpenRecipient?: (() => void) | undefined;
}

const KIND_ICON: Record<ZeropsProposal["kind"], LucideIcon> = {
  "service.restart": RotateCwIcon,
  "service.start": PlayIcon,
  "service.stop": SquareIcon,
  "env.set": KeyRoundIcon,
  "mate.message": SendIcon,
};

/** A secret value is never drawn: the card says it is hidden. */
const HIDDEN_VALUE = "••••••••";

export function ProposalCard(props: ProposalCardProps) {
  const { proposal, stage } = props;
  const Icon = KIND_ICON[proposal.kind];
  const where = proposalWhere(proposal);
  return (
    <FlatCard
      className="flex min-w-0 items-start gap-2.5 px-3.5 py-3"
      data-proposal={proposal.id}
      data-proposal-kind={proposal.kind}
      data-proposal-stage={stage}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1 gap-2.5">
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm font-medium text-foreground" data-proposal-summary>
            {proposal.summary}
          </p>
          {where === null ? null : (
            <p className="text-xs text-muted-foreground" data-proposal-where>
              {where}
            </p>
          )}
          {proposal.reason === undefined || proposal.reason.trim() === "" ? null : (
            <p className="text-xs leading-4.5 text-muted-foreground" data-proposal-reason>
              {props.mateName}: <q className="italic">{proposal.reason}</q>
            </p>
          )}
        </div>
        <ProposalBody proposal={proposal} recipient={props.recipient} />
        <ProposalFoot {...props} />
      </div>
    </FlatCard>
  );
}

function ProposalBody({
  proposal,
  recipient,
}: {
  readonly proposal: ZeropsProposal;
  readonly recipient: ProposalRecipient | undefined;
}) {
  if (proposal.kind === "env.set") {
    const { key, value, secret } = proposal.params;
    return (
      <div
        className="flex min-w-0 items-baseline gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs"
        data-proposal-value
      >
        <span className="shrink-0 font-medium text-foreground">{key}</span>
        <span className="shrink-0 text-muted-foreground">=</span>
        {secret ? (
          <span className="min-w-0 truncate text-muted-foreground" data-proposal-value-hidden>
            {HIDDEN_VALUE} <span className="font-sans">hidden</span>
          </span>
        ) : (
          <span className="min-w-0 break-all text-foreground">{value}</span>
        )}
      </div>
    );
  }
  if (proposal.kind !== "mate.message") return null;
  const { to, words, attachment } = proposal.params;
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-center gap-2 text-xs" data-proposal-recipient>
        <span className="text-muted-foreground">To</span>
        {recipient === undefined ? null : (
          // The Mate it goes to wears its own face, even where every face is the mark.
          <MateFace
            mark={false}
            shape={recipient.shape}
            size="sm"
            state="idle"
            tint={recipient.tint}
          />
        )}
        <span className="min-w-0 truncate font-medium text-foreground">
          {recipient?.name ?? to.mateName}
        </span>
      </div>
      {/* Quoted, not paraphrased: this is the text being authorised. */}
      <p
        className="min-w-0 rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere text-foreground"
        data-proposal-words
      >
        {words}
      </p>
      {attachment === undefined ? null : <Attachment {...attachment} />}
    </div>
  );
}

function Attachment({ title, text }: { readonly title: string; readonly text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid min-w-0 gap-1.5" data-proposal-attachment>
      <button
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1 text-start text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={open ? "size-3.5 shrink-0 rotate-90" : "size-3.5 shrink-0"}
        />
        <span className="min-w-0 truncate">{title}</span>
      </button>
      {open ? (
        <pre className="max-h-60 min-w-0 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-4.5 whitespace-pre text-foreground">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function ProposalFoot(props: ProposalCardProps) {
  const { proposal, stage } = props;
  if (stage === "open") {
    return (
      <div className="flex flex-wrap items-center gap-2" data-proposal-decide>
        <Button disabled={props.approveBlocked !== undefined} onClick={props.onApprove} size="xs">
          Approve
        </Button>
        <Button onClick={props.onDecline} size="xs" variant="ghost-muted">
          Decline
        </Button>
        {props.approveBlocked === undefined ? null : (
          <span className="text-xs text-muted-foreground">{props.approveBlocked}</span>
        )}
      </div>
    );
  }
  if (stage === "failed") {
    return (
      <p
        className="flex items-start gap-1.5 text-xs leading-4 text-destructive-foreground"
        data-proposal-outcome="failed"
        role="alert"
      >
        <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {props.failure ?? "Zerops did not do it."}
      </p>
    );
  }
  const words = proposalOutcomeWords(proposal, stage);
  return (
    <div
      className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground"
      data-proposal-outcome={stage}
      role="status"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {stage === "running" ? <Spinner size="xs" /> : null}
        {stage === "done" ? (
          <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok-text" />
        ) : null}
        {words}
      </span>
      {stage === "done" &&
      proposal.kind === "mate.message" &&
      props.onOpenRecipient !== undefined ? (
        <Button onClick={props.onOpenRecipient} size="xs" variant="outline">
          Open {props.recipient?.name ?? proposal.params.to.mateName}
        </Button>
      ) : null}
    </div>
  );
}
