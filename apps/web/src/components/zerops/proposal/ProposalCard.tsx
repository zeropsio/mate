/**
 * What a Mate proposes, on the ask card: where it acts (Stage or Production where its project is
 * one), what it would do as its title, why in the Mate's words, what exactly — the service, the
 * value (hidden when it is secret), the words and attachment another Mate, or the person's own
 * Chief, would be sent, or the domain's names — and its main press, named for what it does, beside
 * Not now. Decided, the same card says how it went in place, from HQ's decision record: running,
 * done with who and when, failed in the platform's words, or Not now with who and when; an
 * approved domain says how far it is from answering, and opens the project's addresses. Nothing
 * ran before the person approved it. Props only: the container carries out the approval.
 */
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { CheckIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import { AskCard, AskFooter } from "../../ask/AskCard";
import { MateMark } from "../../MateMark";
import { DnsRecords } from "../addresses/DnsRecords";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { MateFace } from "../primitives";
import {
  chiefMessageTarget,
  proposalAskState,
  proposalAskWhere,
  proposalPress,
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
  /** Stage or Production, where the proposal's project is one of its application's environments. */
  readonly tier?: "stage" | "production" | null;
  /** The conversation's own project: a proposal acting there acts in this Mate. */
  readonly homeProjectId?: string | null;
  /** Who decided it, by name, and when, as HQ's decision record says. */
  readonly decidedBy?: string | null;
  readonly decidedAt?: string | null;
}

/** A secret value is never drawn: the card says it is hidden. */
const HIDDEN_VALUE = "••••••••";

export function ProposalCard(props: ProposalCardProps) {
  const { proposal, stage } = props;
  const tier = props.tier ?? null;
  const chiefTarget =
    proposal.kind === "chief.message"
      ? (props.chiefTarget ?? { kind: "unknown" as const })
      : undefined;
  const where = proposalAskWhere(proposal, tier, props.homeProjectId ?? null);
  const state = proposalAskState({
    proposal,
    stage,
    failure: props.failure,
    readOnlyReason: props.readOnlyReason,
    by: props.decidedBy ?? null,
    at: props.decidedAt ?? null,
  });
  const title =
    stage === "open" && proposal.kind === "chief.message" && chiefTarget?.kind === "none"
      ? "This Mate has no Chief to ask."
      : stage === "open" && proposal.kind === "chief.message" && chiefTarget?.kind === "unknown"
        ? "Finding this Mate's Chief…"
        : proposalTitle(proposal);
  const main =
    props.onSetUpChief !== undefined
      ? { label: "Set up Chief", onPress: props.onSetUpChief }
      : chiefTarget !== undefined && chiefTarget.kind !== "chief"
        ? null
        : {
            label: proposalPress(proposal, tier),
            onPress: props.onApprove,
            disabled: props.approveBlocked !== undefined,
          };
  const decided = stage === "done" || stage === "unseen";
  const action =
    stage === "done" && props.onOpenRecipient !== undefined ? (
      proposal.kind === "mate.message" ? (
        <Button onClick={props.onOpenRecipient} variant="secondary">
          Open {props.recipient?.name ?? proposal.params.to.mateName}
        </Button>
      ) : proposal.kind === "chief.message" ? (
        <Button onClick={props.onOpenRecipient} variant="secondary">
          Open Chief
        </Button>
      ) : undefined
    ) : proposal.kind === "domain.add" && decided && props.onOpenAddresses !== undefined ? (
      <Button onClick={props.onOpenAddresses} variant="secondary">
        Open addresses
      </Button>
    ) : undefined;
  return (
    <div data-proposal={proposal.id} data-proposal-kind={proposal.kind} data-proposal-stage={stage}>
      <AskCard
        askId={proposal.id}
        density="full"
        footer={
          <AskFooter
            action={action}
            density="full"
            // Production carries the risk; stopping takes a service offline anywhere.
            destructive={tier === "production" || proposal.kind === "service.stop"}
            main={stage === "open" ? main : null}
            note={
              stage === "open" && props.onSetUpChief === undefined
                ? props.approveBlocked
                : undefined
            }
            onNotNow={stage === "open" ? props.onDecline : undefined}
            state={state}
          />
        }
        kind="proposal"
        state={state.kind}
        title={title}
        where={where}
        why={
          proposal.reason === undefined || proposal.reason.trim() === ""
            ? null
            : { who: props.mateName, words: proposal.reason }
        }
      >
        {proposalBody({
          access: props.access,
          proposal,
          recipient: props.recipient,
          chiefTarget: stage === "open" ? chiefTarget : undefined,
        })}
        {stage === "open" && props.domainAlso !== undefined ? (
          <p className="text-caption text-muted-foreground" data-proposal-also>
            {props.domainAlso}
          </p>
        ) : null}
        {stage === "open" && props.refusal !== undefined ? (
          <p className="text-caption text-destructive-foreground" role="alert">
            {props.refusal}
          </p>
        ) : null}
        {proposal.kind === "domain.add" && decided ? (
          <DomainProgress {...props} stage={stage} />
        ) : null}
      </AskCard>
    </div>
  );
}

/** What exactly it would do, where there is more to show than its title; `null` where not. */
function proposalBody({
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
  if (proposal.kind === "domain.add") {
    return (
      <p className="text-caption text-muted-foreground" data-proposal-where>
        {proposalWhere(proposal)}
      </p>
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

/**
 * An approved domain: how far it is from answering, as the project's addresses show it, and the
 * records it still needs at the DNS provider.
 */
function DomainProgress(props: ProposalCardProps & { readonly stage: "done" | "unseen" }) {
  const { domainState, domainRecords } = props;
  if (domainState === undefined && domainRecords === undefined) return null;
  const tone = domainState?.tone;
  return (
    <div className="grid gap-3">
      {domainState === undefined ? null : (
        <p
          className={
            tone === "problem"
              ? "flex min-w-0 items-start gap-1.5 text-body text-destructive-foreground"
              : "flex min-w-0 items-center gap-1.5 text-body text-muted-foreground"
          }
          data-proposal-domain={tone}
          role="status"
        >
          {tone === "working" ? <Spinner size="xs" /> : null}
          {tone === "live" ? (
            <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok-text" />
          ) : null}
          {tone === "problem" ? (
            <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
          ) : null}
          {domainState.words}
        </p>
      )}
      {domainRecords === undefined ? null : <DnsRecords {...domainRecords} />}
    </div>
  );
}
