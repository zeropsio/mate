import { memo, use } from "react";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { TimelineRowCtx } from "./timelineContext";
import { ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { ProposalCardContainer } from "../zerops/proposal/ProposalCardContainer";
import { MirrorAskCardContainer } from "../zerops/mirror/MirrorAskCardContainer";
import { OriginAskCardContainer } from "../zerops/origin/OriginAskCardContainer";
import { VaultRequestCardContainer } from "../zerops/vault/VaultAskContainer";
import { vaultAskOf } from "../zerops/vault/vaultRequest.logic";
import { useOperationCard } from "../zerops/operation/useOperationCard";
import type { MessagesTimelineRow as TimelineRow } from "./MessagesTimeline.logic";

export function ProposedPlanTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposed-plan" }>;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div className="min-w-0 px-1 py-0.5">
      <ProposedPlanCard
        planMarkdown={row.proposedPlan.planMarkdown}
        environmentId={ctx.activeThreadEnvironmentId}
        threadRef={ctx.threadRef ?? undefined}
        cwd={ctx.markdownCwd}
        workspaceRoot={ctx.workspaceRoot}
      />
    </div>
  );
}

/** One `ZeropsOperation` card, anchored at the transcript position the reducer gave it. */
export const OperationTimelineRow = memo(function OperationTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "operation" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const regions = useOperationCard(
    row.operation,
    ctx.activeThreadEnvironmentId,
    undefined,
    true,
    ctx.threadRef?.threadId ?? null,
  );
  const card = (
    <ZeropsOperationCard operation={row.operation} threadRef={ctx.threadRef} {...regions} />
  );
  return (
    <div className="min-w-0 px-1 py-0.5">
      {/* A request for a vault value is the person's to answer: its card is the ask. */}
      {vaultAskOf(row.operation) === null ? (
        card
      ) : (
        <VaultRequestCardContainer
          environmentId={ctx.activeThreadEnvironmentId}
          fallback={card}
          operation={row.operation}
          threadRef={ctx.threadRef}
        />
      )}
    </div>
  );
});

/** A value the Mate asked the person for, after its run: the card that takes it into the vault. */
export const VaultRequestTimelineRow = memo(function VaultRequestTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "vault-request" }>;
}) {
  const ctx = use(TimelineRowCtx);
  // Without the engine's record (older history) the run's own line is all it shows: no frame here.
  return (
    <div className="min-w-0 px-1 py-0.5 empty:hidden">
      <VaultRequestCardContainer
        environmentId={ctx.activeThreadEnvironmentId}
        fallback={null}
        operation={row.operation}
        threadRef={ctx.threadRef}
      />
    </div>
  );
});

/** An origin the Mate asked the person for, after its run: the card that connects it. */
export const OriginRequestTimelineRow = memo(function OriginRequestTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "origin-request" }>;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <div className="min-w-0 px-1 py-0.5">
      <OriginAskCardContainer
        environmentId={ctx.activeThreadEnvironmentId}
        requestIds={row.requestIds}
        threadRef={ctx.threadRef}
      />
    </div>
  );
});

/** A repository the Mate asked the person to connect to GitHub, after its run: the card that does. */
export const MirrorRequestTimelineRow = memo(function MirrorRequestTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "mirror-request" }>;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <div className="min-w-0 px-1 py-0.5">
      <MirrorAskCardContainer
        environmentId={ctx.activeThreadEnvironmentId}
        requestId={row.requestId}
        threadRef={ctx.threadRef}
      />
    </div>
  );
});

/** What the organization's Mate proposes, after its run: the card the person decides it on. */
export const ProposalTimelineRow = memo(function ProposalTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposal" }>;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <div className="min-w-0 px-1 py-0.5">
      <ProposalCardContainer
        driver={ctx.driver ?? null}
        environmentId={ctx.activeThreadEnvironmentId}
        operation={row.operation}
        threadId={ctx.threadRef?.threadId ?? null}
      />
    </div>
  );
});
