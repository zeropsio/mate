/**
 * A Mate's release offer lists the changes since the live release and the services the release
 * creates first. Its *Review release* action opens the application's release review. The chip
 * names production, and the Mate's reason appears when the card cannot list the changes.
 */
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { REVIEW_RELEASE_LABEL } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { AskCard, AskFooter } from "../../ask/AskCard";
import { Button } from "../../ui/button";
import {
  releaseOfferCardTitle,
  releaseOfferSummary,
  type ReleaseOfferView,
} from "./productionAsk.logic";
import { Text } from "~/components/ui/text";

const PRODUCTION = { scope: "production", detail: null } as const;

const whyOf = (proposal: ZeropsProposal, mateName: string) =>
  proposal.reason === undefined || proposal.reason.trim() === ""
    ? null
    : { who: mateName, words: proposal.reason };

/** Why the person's last decision was not kept. A plain element or nothing: no body, no gap. */
const refusalOf = (words: string | undefined) =>
  words === undefined ? null : (
    <Text render={<p />} variant="error" role="alert">
      {words}
    </Text>
  );

/** A change that would go out, as the card lists it. */
export interface ReleaseOfferChange {
  readonly key: string;
  readonly title: string;
  /** Its Mate's mark, as change rows wear it; none for a change of nobody's Mate here. */
  readonly face?: ReactNode;
}

interface ReleaseOfferAskCardProps {
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
          <Text render={<p />} variant="description" data-release-summary>
            {summary}
          </Text>
        )}
        {view.collapsed || view.moved === undefined ? null : (
          <Text render={<p />} variant="note" data-release-moved>
            {view.moved}
          </Text>
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
              <Text className="ps-6" render={<li />} variant="note">
                and {props.more} more
              </Text>
            )}
          </ul>
        )}
        {refusalOf(props.refusal)}
      </AskCard>
    </div>
  );
}
