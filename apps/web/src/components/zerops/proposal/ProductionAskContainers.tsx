/**
 * The release offer reads HQ's plan and how releases made since the ask ended. Its action opens
 * the release review. HQ keeps the person's decision by proposal id (`proposalRecord.ts`).
 */
import { projectOperator } from "@t3tools/client-runtime/data";
import { productionRelease } from "@t3tools/client-runtime/zerops";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { EnvironmentId } from "@t3tools/contracts";
import { releasePlanCreates } from "@t3tools/shared/hqRelease";
import { Atom } from "effect/reactivity";
import { useMemo, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useProjection } from "~/zerops/accountData";
import { useProjectFlows } from "~/zerops/projectFlows";
import { useProposalDecision } from "~/zerops/proposalRecord";
import { useOpenReview } from "~/zerops/review";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useReleaseServicePlan } from "~/zerops/useReleaseServicePlan";
import { useAppOfProject, useAppReleaseEnded } from "~/zerops/useZeropsChangeLandedEvents";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsReviewMates } from "~/zerops/useZeropsReviewMates";
import { changesWaitingForRelease } from "../place/placePage.logic";
import { MateFace } from "../primitives";
import { changeTitle } from "../projects/projectHistory.logic";
import { useProductionAddresses } from "~/zerops/useProductionAddresses";
import { releaseOfferView } from "./productionAsk.logic";
import { ReleaseOfferAskCard, type ReleaseOfferChange } from "./ProductionAskCards";
import { approveAuthority } from "./proposal.logic";
import type { ProposalDecision } from "~/zerops/proposalRecord";

const UNDECIDED = Atom.make<boolean | undefined>(undefined);
const NO_APPS: ReadonlyArray<string> = [];

/** How many changes the release card lists before it counts the rest. */
const CHANGES_LISTED = 5;

/** The application's flow as the review reads it, while the card still has something to say of it. */
function useAskFlow(groupId: string | undefined, reading: boolean) {
  const apps = useMemo(
    () => (groupId === undefined || !reading ? NO_APPS : [groupId]),
    [groupId, reading],
  );
  return useProjectFlows(apps, { plan: true }).flows.get(groupId ?? "");
}

/** The offer's decision record with the viewer's authority and the names it shows. */
function useAskDecision(proposal: ZeropsProposal, environmentId: EnvironmentId) {
  const home = useZeropsEnvironmentProject(environmentId);
  const handle = useProposalDecision(proposal.id, home?.projectId, proposal.kind);
  const nameOf = usePersonNames(home?.orgId);
  const viewer = useZeropsSessionOptional()?.user?.id;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const proposer = useKnownMate(environmentId);
  const operatesHome = useProjection(projectOperator, home ?? null, UNDECIDED);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const { decision, record } = handle;
  /** Records the person's decision at HQ: false, saying why, where HQ did not keep it. */
  const decide = async (next: ProposalDecision): Promise<boolean> => {
    setRefusal(undefined);
    const refused = await record(viewer === undefined ? next : { ...next, by: viewer });
    if (refused !== null) setRefusal(refused);
    return refused === null;
  };
  return {
    home,
    decision,
    known: handle.known && !handle.unreachable,
    decide,
    refusal,
    mateName: proposer?.name ?? "Your Mate",
    /** Why the viewer may not decide it at all; absent where they may. */
    notTheirs: approveAuthority(proposal, operatesHome, undefined),
    by: decision?.by === undefined ? null : (nameOf(decision.by) ?? null),
    at: decision === undefined ? null : formatDayAwareTimestamp(decision.at, timestampFormat),
  };
}

export function ReleaseOfferAsk({
  proposal,
  environmentId,
  askedAt,
  newerAsk,
}: {
  readonly proposal: Extract<ZeropsProposal, { kind: "release.offer" }>;
  readonly environmentId: EnvironmentId;
  /** When the Mate asked: the card's own moment in the conversation. */
  readonly askedAt: string;
  /** A newer release ask stands in the conversation. */
  readonly newerAsk: boolean;
}) {
  const ask = useAskDecision(proposal, environmentId);
  const { home, decision } = ask;
  const groupId = useAppOfProject(home?.projectId);
  // Not now, or another ask in its place: the card reads nothing more of production.
  const reading = decision?.state !== "declined" && !newerAsk;
  const flow = useAskFlow(groupId, reading);
  const ended = useAppReleaseEnded(reading ? groupId : undefined);
  const mates = useZeropsReviewMates(groupId);
  const openReview = useOpenReview();
  const live = productionRelease(flow);
  const address = useProductionAddresses(live?.projectId)[0]?.url;
  const offer = flow?.release;
  const waiting =
    offer?.summary === undefined || offer.summaryRead === "pending"
      ? undefined
      : (offer.summary.changeCount ?? offer.summary.total);
  const view = releaseOfferView({
    params: proposal.params,
    askedAt,
    live:
      offer === undefined
        ? undefined
        : {
            head: offer.groupHead,
            suggestion: offer.suggestion,
            gate: offer.gate,
            permission:
              ask.notTheirs !== undefined
                ? { allowed: false, reason: ask.notTheirs }
                : offer.permission,
            inFlight: offer.inFlight,
            waiting,
          },
    ended,
    releases: flow?.releases ?? [],
    newerAsk,
    decision,
    decisionKnown: ask.known,
    address,
    by: ask.by,
    at: ask.at,
  });
  // What the release creates first is HQ's plan's to say, read while the card offers the review.
  const plan = useReleaseServicePlan(
    flow,
    view.suggestion.trim() === "" ? undefined : view.suggestion,
    view.state.kind === "waiting",
  );
  const creates =
    plan.view.kind === "ready" && releasePlanCreates(plan.view.plan)
      ? plan.view.plan.operations.flatMap((operation) =>
          operation.kind === "create" ? [operation.service] : [],
        )
      : [];
  // The changes that would go out: the Mates' merged changes production does not run, else the
  // titles HQ's offer lists.
  const merged =
    flow === undefined || !flow.changesKnown || !flow.releasesKnown
      ? []
      : changesWaitingForRelease(flow.merged, flow.releases);
  const titled: ReadonlyArray<ReleaseOfferChange> =
    merged.length > 0
      ? merged.map((pull) => {
          const mate = mates.get(pull.mateProjectId);
          return {
            key: `${pull.repository}#${String(pull.number)}`,
            title: changeTitle(pull.title),
            ...(mate === undefined
              ? {}
              : { face: <MateFace shape={mate.shape} size={16} state="idle" tint={mate.tint} /> }),
          };
        })
      : offer?.summary?.changeCount === undefined
        ? []
        : offer.summary.subjects.map((subject, index) => ({
            key: `${String(index)}:${subject}`,
            title: changeTitle(subject),
          }));
  const listed = titled.slice(0, CHANGES_LISTED);

  return (
    <ReleaseOfferAskCard
      changes={view.state.kind === "waiting" || view.state.kind === "othersToAnswer" ? listed : []}
      creates={creates}
      mateName={ask.mateName}
      more={Math.max(titled.length, offer?.summary?.changeCount ?? 0) - listed.length}
      now={live === undefined || view.state.kind === "done" ? undefined : { tag: live.tag }}
      onNotNow={() => void ask.decide({ state: "declined", at: new Date().toISOString() })}
      onReview={() => {
        if (groupId === undefined) return;
        const pressed = document.activeElement;
        openReview(
          { kind: "release", groupId },
          { from: pressed instanceof HTMLElement ? pressed : null },
        );
      }}
      proposal={proposal}
      refusal={ask.refusal}
      view={view}
    />
  );
}
