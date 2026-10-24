/**
 * What a Mate proposes, on its card: what it would do as its title, why in the Mate's words, what
 * exactly — the service, the value (hidden when it is secret), the words and attachment another
 * Mate, or the organization's Chief, would be sent, or the service and port a domain points at — and
 * Approve or Decline. Decided, the same card says how it went in place: running, done, failed in
 * the platform's words, or declined; an approved domain says how far it is from answering, and
 * opens the project's addresses. Nothing ran before the person approved it. Props only: the
 * container carries out the approval.
 */
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  GlobeIcon,
  KeyRoundIcon,
  PlayIcon,
  RotateCwIcon,
  SendIcon,
  SquareIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { MateMark } from "../../MateMark";
import { DnsRecords } from "../addresses/DnsRecords";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { Card } from "../../ui/card";
import { MateFace } from "../primitives";
import {
  chiefMessageTarget,
  proposalOutcomeWords,
  proposalTitle,
  proposalWhere,
  type DomainProposalState,
  type domainProposalRecords,
  type ProposalStage,
} from "./proposal.logic";

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
  /** The source Mate person’s Chief, as the account projection resolved it. */
  readonly chiefTarget?: ReturnType<typeof chiefMessageTarget> | undefined;
  /** Why Approve cannot be pressed yet ("Reading the vault…"); absent when it can. */
  readonly approveBlocked?: string | undefined;
  /** Chief ownership is read from the source Mate, before offering any decision. */
  readonly readOnlyReason?: string | undefined;
  readonly onApprove: () => void;
  readonly onDecline: () => void;
  /** `mate.message` and `chief.message`: opens the Mate it went to. */
  readonly onOpenRecipient?: (() => void) | undefined;
  /** `chief.message` where the person has no Chief: setting one up stands in for Approve. */
  readonly onSetUpChief?: (() => void) | undefined;
  /** Why the person's last decision was not kept, in HQ's or the platform's words. */
  readonly refusal?: string | undefined;
  /** `domain.add`, undecided: the other changes approving it puts in place. */
  readonly domainAlso?: string | undefined;
  /** `domain.add`, approved: how far its domains are from answering, once the project shows them. */
  readonly domainState?: DomainProposalState | undefined;
  /** `domain.add`, approved: the records its domains still need at the DNS provider. */
  readonly domainRecords?: ReturnType<typeof domainProposalRecords> | undefined;
  /** `domain.add`, approved: opens the project's addresses. */
  readonly onOpenAddresses?: (() => void) | undefined;
  /**
   * `access.set`: who gets which level on which project, one line each with what changes from
   * today, and the projects it never writes, each saying why.
   */
  readonly access?:
    | { readonly lines: ReadonlyArray<string>; readonly dropped: ReadonlyArray<string> }
    | undefined;
}

const KIND_ICON: Record<ZeropsProposal["kind"], LucideIcon> = {
  "service.restart": RotateCwIcon,
  "service.start": PlayIcon,
  "service.stop": SquareIcon,
  "env.set": KeyRoundIcon,
  "mate.message": SendIcon,
  "chief.message": SendIcon,
  "domain.add": GlobeIcon,
  "access.set": UsersIcon,
};

/** A secret value is never drawn: the card says it is hidden. */
const HIDDEN_VALUE = "••••••••";

export function ProposalCard(props: ProposalCardProps) {
  const { proposal, stage } = props;
  const Icon = KIND_ICON[proposal.kind];
  const chiefTarget =
    proposal.kind === "chief.message"
      ? (props.chiefTarget ?? { kind: "unknown" as const })
      : undefined;
  const where = proposalWhere(proposal);
  return (
    <Card
      data-proposal={proposal.id}
      data-proposal-kind={proposal.kind}
      data-proposal-stage={stage}
      size="sm"
      variant="flat"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 gap-2.5">
          <div className="grid min-w-0 gap-0.5">
            <p className="text-sm font-medium text-foreground" data-proposal-summary>
              {stage === "open" && proposal.kind === "chief.message" && chiefTarget?.kind === "none"
                ? "This Mate has no Chief to ask."
                : stage === "open" &&
                    proposal.kind === "chief.message" &&
                    chiefTarget?.kind === "unknown"
                  ? "Finding this Mate's Chief…"
                  : proposalTitle(proposal)}
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
          <ProposalBody
            access={props.access}
            proposal={proposal}
            recipient={props.recipient}
            chiefTarget={stage === "open" ? chiefTarget : undefined}
          />
          <ProposalFoot {...props} chiefTarget={chiefTarget} />
        </div>
      </div>
    </Card>
  );
}

function ProposalBody({
  access,
  proposal,
  recipient,
  chiefTarget,
}: {
  readonly access: ProposalCardProps["access"];
  readonly proposal: ZeropsProposal;
  readonly recipient: ProposalRecipient | undefined;
  readonly chiefTarget: ProposalCardProps["chiefTarget"];
}) {
  if (proposal.kind === "access.set") {
    if (access === undefined) return null;
    return (
      <div className="grid min-w-0 gap-1.5 text-xs">
        <ul className="grid min-w-0 gap-1 rounded-md bg-muted px-3 py-2" data-proposal-access>
          {access.lines.map((line) => (
            <li className="min-w-0 wrap-anywhere text-foreground" key={line}>
              {line}
            </li>
          ))}
        </ul>
        {access.dropped.length === 0 ? null : (
          <ul className="grid min-w-0 gap-0.5 text-muted-foreground" data-proposal-left-out>
            {access.dropped.map((line) => (
              <li className="min-w-0 wrap-anywhere" key={line}>
                Left out: {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
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
  if (proposal.kind === "chief.message") {
    const { words, attachment } = proposal.params;
    return (
      <div className="grid min-w-0 gap-2">
        {chiefTarget !== undefined && chiefTarget.kind !== "chief" ? null : (
          <div className="flex min-w-0 items-center gap-2 text-xs" data-proposal-recipient>
            <MateMark className="h-4 w-3.5 shrink-0" />
            <span className="min-w-0 truncate font-medium text-foreground">Ask your Chief</span>
          </div>
        )}
        <Words words={words} />
        {attachment === undefined ? null : <Attachment {...attachment} />}
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
            size={20}
            state="idle"
            tint={recipient.tint}
          />
        )}
        <span className="min-w-0 truncate font-medium text-foreground">
          {recipient?.name ?? to.mateName}
        </span>
      </div>
      <Words words={words} />
      {attachment === undefined ? null : <Attachment {...attachment} />}
    </div>
  );
}

/** Quoted, not paraphrased: this is the text being authorised. */
function Words({ words }: { readonly words: string }) {
  return (
    <p
      className="min-w-0 rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere text-foreground"
      data-proposal-words
    >
      {words}
    </p>
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
  if (stage === "open" && props.readOnlyReason !== undefined) {
    return <p className="text-xs text-muted-foreground">{props.readOnlyReason}</p>;
  }
  if (stage === "open") {
    return (
      <div className="grid gap-1.5">
        {props.domainAlso === undefined ? null : (
          <p className="text-xs leading-4 text-muted-foreground" data-proposal-also>
            {props.domainAlso}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2" data-proposal-decide>
          {props.onSetUpChief === undefined ? (
            props.chiefTarget !== undefined && props.chiefTarget.kind !== "chief" ? null : (
              <Button
                disabled={props.approveBlocked !== undefined}
                onClick={props.onApprove}
                size="sm"
              >
                Approve
              </Button>
            )
          ) : (
            <Button onClick={props.onSetUpChief} size="sm">
              Set up Chief
            </Button>
          )}
          <Button onClick={props.onDecline} size="sm" variant="ghost">
            Decline
          </Button>
          {props.approveBlocked === undefined || props.onSetUpChief !== undefined ? null : (
            <span className="text-xs text-muted-foreground">{props.approveBlocked}</span>
          )}
        </div>
        {props.refusal === undefined ? null : (
          <p className="text-xs leading-4 text-destructive-foreground" role="alert">
            {props.refusal}
          </p>
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
  if (proposal.kind === "domain.add" && (stage === "done" || stage === "unseen")) {
    return <DomainFoot {...props} stage={stage} />;
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
      {stage === "done" && props.onOpenRecipient !== undefined ? (
        proposal.kind === "mate.message" ? (
          <Button onClick={props.onOpenRecipient} size="sm" variant="secondary">
            Open {props.recipient?.name ?? proposal.params.to.mateName}
          </Button>
        ) : proposal.kind === "chief.message" ? (
          <Button onClick={props.onOpenRecipient} size="sm" variant="secondary">
            Open Chief
          </Button>
        ) : null
      ) : null}
    </div>
  );
}

/**
 * An approved domain: how far it is from answering, as the project's addresses show it — until
 * they show it, that it was added — and the way to its records.
 */
function DomainFoot(props: ProposalCardProps & { readonly stage: "done" | "unseen" }) {
  const { domainState, domainRecords, proposal, stage } = props;
  const tone = domainState?.tone ?? (stage === "done" ? "live" : "waiting");
  return (
    <div className="grid gap-3">
      <div
        className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground"
        data-proposal-outcome={stage}
        data-proposal-domain={domainState?.tone}
        role="status"
      >
        <span
          className={
            tone === "problem"
              ? "flex min-w-0 items-start gap-1.5 text-destructive-foreground"
              : "flex min-w-0 items-center gap-1.5"
          }
        >
          {tone === "working" ? <Spinner size="xs" /> : null}
          {tone === "live" ? (
            <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok-text" />
          ) : null}
          {tone === "problem" ? (
            <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
          ) : null}
          {domainState?.words ?? proposalOutcomeWords(proposal, stage)}
        </span>
        {props.onOpenAddresses === undefined ? null : (
          <Button onClick={props.onOpenAddresses} size="sm" variant="secondary">
            Open addresses
          </Button>
        )}
      </div>
      {domainRecords === undefined ? null : <DnsRecords {...domainRecords} />}
    </div>
  );
}
