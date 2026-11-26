import type { ReactNode } from "react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import type { CodeStandingView } from "~/zerops/useCodeStandings";

/** The offers already decided for a project's code, wherever that code is shown. */
export function CodeStandingActions({
  name,
  view,
  onAddMate,
  onDelete,
  onReview,
  answer,
  emphasis = false,
}: {
  readonly name: string;
  readonly view: CodeStandingView;
  readonly onAddMate?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  readonly onReview?: (() => void) | undefined;
  readonly answer?: ReactNode;
  readonly emphasis?: boolean;
}) {
  const { standing, offers, addMateWhy } = view;
  const deleteLabel = `Delete ${name}${standing.kind === "kept" && standing.holds === "code" ? " and its code" : ""}…`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {offers.answer ? answer : null}
      {offers.addMate === "off" && addMateWhy !== undefined ? (
        <Text variant="meta">{addMateWhy}</Text>
      ) : null}
      {offers.delete === "owner" ? (
        <Text variant="meta">An Owner or Admin can delete it.</Text>
      ) : null}
      {offers.addMate === "none" ? null : (
        <Button
          variant={emphasis ? "primary" : "secondary"}
          size="sm"
          disabled={offers.addMate === "off"}
          onClick={onAddMate}
        >
          Add a Mate
        </Button>
      )}
      {offers.delete === "offered" || offers.delete === "waits" ? (
        <Button
          variant="destructive-ghost"
          size="sm"
          disabled={offers.delete === "waits"}
          onClick={onDelete}
        >
          {deleteLabel}
        </Button>
      ) : null}
      {offers.review ? (
        <Button variant="secondary" size="sm" onClick={onReview}>
          Review deletion
        </Button>
      ) : null}
    </div>
  );
}

/** A repository's standing notice, made from the same sentence and offers as its project. */
export function CodeStandingBanner({
  sentence,
  ...actions
}: {
  readonly sentence: string | undefined;
} & Parameters<typeof CodeStandingActions>[0]) {
  if (sentence === undefined) return null;
  return (
    <Card size="sm" variant="wash">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text render={<p />} variant="description">
          {sentence}
        </Text>
        <CodeStandingActions {...actions} />
      </div>
    </Card>
  );
}
