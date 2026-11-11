/**
 * A Mate's two asks about its application's production, on the ask card. Creating what production
 * lacks: each service as HQ's plan settles it, that it is billed and deploys nothing, the import
 * itself on request, and the press in production's colour — it runs with the person's access.
 * Releasing what waits: one quiet line (how many changes since the live release, what the release
 * creates first), the changes themselves, and *Review release*, which opens the review every other
 * door opens: the card never releases. Each fact once: the chip says where, so the title does not;
 * the changes say why, so the Mate's reason shows only where the card cannot list them. Props
 * only: the containers read HQ's plan, the flow and the decision record.
 */
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { REVIEW_RELEASE_LABEL } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { AskCard, AskFacts, AskFooter } from "../../ask/AskCard";
import { Button } from "../../ui/button";
import {
  releaseOfferCardTitle,
  releaseOfferSummary,
  serviceCreateCardTitle,
  type ReleaseOfferView,
  type ServiceCreateView,
} from "./productionAsk.logic";
import { Attachment } from "./ProposalCard";
import { CREATE_IN_PRODUCTION } from "./proposal.logic";

const PRODUCTION = { scope: "production", detail: null } as const;

const whyOf = (proposal: ZeropsProposal, mateName: string) =>
  proposal.reason === undefined || proposal.reason.trim() === ""
    ? null
    : { who: mateName, words: proposal.reason };

/** Why the person's last decision was not kept. A plain element or nothing: no body, no gap. */
const refusalOf = (words: string | undefined) =>
  words === undefined ? null : (
    <p className="text-caption text-destructive-foreground" role="alert">
      {words}
    </p>
  );

export interface ServiceCreateAskCardProps {
  readonly proposal: Extract<ZeropsProposal, { kind: "service.create" }>;
  readonly view: ServiceCreateView;
  /** Who asked: the why reads as its words. */
  readonly mateName: string;
  /** The import that creates what is left, as HQ's plan settles it; absent until it is read. */
  readonly yaml: string | undefined;
  readonly onCreate: () => void;
  readonly onNotNow: () => void;
  /** Why the person's last decision was not kept, in HQ's words. */
  readonly refusal?: string | undefined;
}

export function ServiceCreateAskCard(props: ServiceCreateAskCardProps) {
  const { proposal, view } = props;
  const { state } = view;
  return (
    <div data-proposal={proposal.id} data-proposal-kind={proposal.kind}>
      <AskCard
        askId={proposal.id}
        density="full"
        footer={
          <AskFooter
            action={
              state.kind === "failed" && view.retry ? (
                <Button
                  disabled={view.blocked !== undefined || props.yaml === undefined}
                  onClick={props.onCreate}
                  variant="secondary"
                >
                  Try again
                </Button>
              ) : undefined
            }
            density="full"
            destructive
            main={{
              label: CREATE_IN_PRODUCTION,
              onPress: props.onCreate,
              disabled: view.blocked !== undefined || props.yaml === undefined,
            }}
            note={view.blocked ?? "Runs with your access, never the Mate's"}
            onNotNow={props.onNotNow}
            state={state}
          />
        }
        kind="proposal"
        state={state.kind}
        title={serviceCreateCardTitle(proposal.params.services)}
        where={PRODUCTION}
        why={whyOf(proposal, props.mateName)}
      >
        {view.rows.length === 0 ? null : <AskFacts rows={view.rows} />}
        {props.yaml === undefined || view.rows.length === 0 ? null : (
          <Attachment text={props.yaml} title="Show the import" />
        )}
        {refusalOf(props.refusal)}
      </AskCard>
    </div>
  );
}

/** A change that would go out, as the card lists it. */
export interface ReleaseOfferChange {
  readonly key: string;
  readonly title: string;
  /** Its Mate's mark, as change rows wear it; none for a change of nobody's Mate here. */
  readonly face?: ReactNode;
}

export interface ReleaseOfferAskCardProps {
  readonly proposal: Extract<ZeropsProposal, { kind: "release.offer" }>;
  readonly view: ReleaseOfferView;
  readonly mateName: string;
  /** The changes that would go out, newest first, and how many more there are than listed. */
  readonly changes: ReadonlyArray<ReleaseOfferChange>;
  readonly more: number;
  /** The services the release creates in production first, as HQ's plan says; none where none. */
  readonly creates: ReadonlyArray<string>;
  /** What production runs now: its release. */
  readonly now: { readonly tag: string } | undefined;
  readonly onReview: () => void;
  readonly onNotNow: () => void;
  readonly refusal?: string | undefined;
}

export function ReleaseOfferAskCard(props: ReleaseOfferAskCardProps) {
  const { proposal, view } = props;
  const { state } = view;
  const summary = releaseOfferSummary({
    changes: props.changes.length + props.more,
    live: props.now?.tag,
    creates: props.creates,
  });
  // The changes are the why: the Mate's reason stands in only where the card knows none of them.
  const known = props.changes.length + props.more > 0;
  return (
    <div data-proposal={proposal.id} data-proposal-kind={proposal.kind}>
      <AskCard
        askId={proposal.id}
        density="full"
        footer={
          <AskFooter
            action={
              state.kind === "failed" && view.again ? (
                <Button onClick={props.onReview} variant="secondary">
                  {REVIEW_RELEASE_LABEL}
                </Button>
              ) : undefined
            }
            density="full"
            main={{
              label: REVIEW_RELEASE_LABEL,
              onPress: props.onReview,
              disabled: view.blocked !== undefined,
            }}
            note={view.blocked}
            onNotNow={props.onNotNow}
            state={state}
          />
        }
        kind="proposal"
        state={state.kind}
        title={releaseOfferCardTitle(view.suggestion)}
        where={PRODUCTION}
        why={view.collapsed || known ? null : whyOf(proposal, props.mateName)}
      >
        {view.collapsed || summary === null ? null : (
          <p className="text-body text-muted-foreground" data-release-summary>
            {summary}
          </p>
        )}
        {view.collapsed || view.moved === undefined ? null : (
          <p className="text-caption text-muted-foreground" data-release-moved>
            {view.moved}
          </p>
        )}
        {view.collapsed || props.changes.length === 0 ? null : (
          <ul className="grid min-w-0 gap-1.5" data-release-changes>
            {props.changes.map((change) => (
              <li className="flex min-w-0 items-center gap-2 text-body" key={change.key}>
                <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
                  {change.face}
                </span>
                <span className="min-w-0 truncate text-foreground">{change.title}</span>
              </li>
            ))}
            {props.more === 0 ? null : (
              <li className="ps-6 text-caption text-muted-foreground">and {props.more} more</li>
            )}
          </ul>
        )}
        {refusalOf(props.refusal)}
      </AskCard>
    </div>
  );
}
