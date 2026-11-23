/**
 * A Mate's two asks about its application's production, read from their sources and carried out
 * as the person. Creating what production lacks: the services come from HQ's plan of the next
 * release (`useReleaseServicePlan`), never from the proposal; the press is one approval at HQ
 * naming the asked services the plan still creates under the plan's hash, and HQ imports them on
 * the person's own Zerops access and records how it ended, every tab drawing that; who may is
 * HQ's offer of the release to the viewer. Releasing: the card reads the live release offer and
 * how the releases made since ended, and its press opens the release review — it never releases.
 * What the person decided is kept at HQ by proposal id (`proposalRecord.ts`).
 */
import {
  hqOperationOf,
  projectOperator,
  PROPOSAL_EFFECT,
  proposalEffectMoved,
  proposalEffectOf,
} from "@t3tools/client-runtime/data";
import type { HqOperation } from "@t3tools/client-runtime/zerops/hq";
import { productionRelease } from "@t3tools/client-runtime/zerops";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import type { EnvironmentId } from "@t3tools/contracts";
import { releasePlanCreates } from "@t3tools/shared/hqRelease";
import { Atom } from "effect/reactivity";
import { useMemo, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { randomUUID } from "~/lib/utils";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useProjection } from "~/zerops/accountData";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useProjectFlows } from "~/zerops/projectFlows";
import { useProposalDecision } from "~/zerops/proposalRecord";
import { servicePlanImportYaml } from "~/zerops/releaseImport.logic";
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
import {
  askedCreations,
  releaseOfferView,
  serviceCreateEffect,
  serviceCreateView,
  type ServiceCreatePlan,
} from "./productionAsk.logic";
import {
  ReleaseOfferAskCard,
  ServiceCreateAskCard,
  type ReleaseOfferChange,
} from "./ProductionAskCards";
import { approveAuthority } from "./proposal.logic";
import type { ProposalDecision } from "~/zerops/proposalRecord";

const UNDECIDED = Atom.make<boolean | undefined>(undefined);
const NO_EFFECT = Atom.make<HqOperation | undefined>(undefined);
/** HQ refused the approval: the plan this person read no longer creates every named service. */
const SERVICE_NOT_PLANNED = "service_not_planned";
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

/** HQ's plan of the next release, as the create card reads it. */
function planRead(
  flow: ReturnType<typeof useAskFlow>,
  view: ReturnType<typeof useReleaseServicePlan>["view"],
): ServiceCreatePlan {
  if (flow === undefined) return { kind: "reading" };
  const offer = flow.release;
  if (offer.git !== undefined)
    return {
      kind: "unreadable",
      words: "Production is delivered by Git: nothing to create there.",
    };
  if (!offer.gate.allowed)
    // A gate still being read ends in an ellipsis: it is not a refusal yet.
    return offer.gate.reason.endsWith("…")
      ? { kind: "reading" }
      : { kind: "unreadable", words: offer.gate.reason };
  if (offer.permission?.allowed !== true || offer.groupHead === undefined)
    return { kind: "reading" };
  switch (view.kind) {
    case "pending":
      return { kind: "reading" };
    case "failed":
      return { kind: "unreadable", words: view.reason };
    case "ready":
      return { kind: "ready", plan: view.plan };
  }
}

/**
 * What the card's decision record needs around it: who decides, and their names; and the operation
 * HQ carries an approval out in on the conversation's project, each move of which reads HQ's
 * decision again.
 */
function useAskDecision(proposal: ZeropsProposal, environmentId: EnvironmentId) {
  const home = useZeropsEnvironmentProject(environmentId);
  const effect = useProjection(proposalEffectOf, home ?? null, NO_EFFECT);
  const handle = useProposalDecision(
    proposal.id,
    home?.projectId,
    proposal.kind,
    proposalEffectMoved(effect),
  );
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
  /** Starts the approval HQ carries out: null once HQ took it, else HQ's code where it refused. */
  const approve = async (
    effectToRun: Parameters<typeof handle.approve>[1],
  ): Promise<string | undefined | null> => {
    setRefusal(undefined);
    const refused = await handle.approve(randomUUID(), effectToRun);
    if (refused === null) return null;
    setRefusal(refused.words);
    return refused.code;
  };
  return {
    home,
    decision,
    known: handle.known && !handle.unreachable,
    sending: handle.sending,
    /** HQ's operation carrying the approval out, as it stands for the viewer. */
    effect: hqOperationOf(effect, PROPOSAL_EFFECT, viewer),
    effectId: effect?.id,
    decide,
    approve,
    refusal,
    mateName: proposer?.name ?? "Your Mate",
    /** Why the viewer may not decide it at all; absent where they may. */
    notTheirs: approveAuthority(proposal, operatesHome, undefined),
    by: decision?.by === undefined ? null : (nameOf(decision.by) ?? null),
    at: decision === undefined ? null : formatDayAwareTimestamp(decision.at, timestampFormat),
  };
}

export function ServiceCreateAsk({
  proposal,
  environmentId,
}: {
  readonly proposal: Extract<ZeropsProposal, { kind: "service.create" }>;
  readonly environmentId: EnvironmentId;
}) {
  const ask = useAskDecision(proposal, environmentId);
  const { home, decision } = ask;
  const groupId = useAppOfProject(home?.projectId);
  // Settled for good, the card reads nothing more of production.
  const reading = decision?.state !== "declined" && decision?.state !== "done";
  const flow = useAskFlow(groupId, reading);
  const tag = flow?.release.suggestion.trim();
  const plan = useReleaseServicePlan(
    flow,
    tag === undefined || tag === "" ? undefined : tag,
    reading,
  );
  const operations = useAccountOperationsOptional();

  const planned = planRead(flow, plan.view);
  const permission =
    ask.notTheirs !== undefined
      ? { allowed: false, reason: ask.notTheirs }
      : flow?.release.permission === undefined
        ? undefined
        : flow.release.permission.allowed
          ? { allowed: true }
          : { allowed: false, reason: flow.release.permission.reason };
  const view = serviceCreateView({
    services: proposal.params.services,
    plan: planned,
    permission,
    decision,
    decisionKnown: ask.known,
    sending: ask.sending,
    effect: ask.effect,
    liveTag: productionRelease(flow)?.tag,
    by: ask.by,
    at: ask.at,
  });
  const yaml =
    planned.kind === "ready"
      ? servicePlanImportYaml(askedCreations(planned.plan, proposal.params.services))
      : undefined;
  const effect =
    planned.kind === "ready"
      ? serviceCreateEffect(planned.plan, proposal.params.services)
      : undefined;

  const create = async () => {
    if (
      home === undefined ||
      effect === undefined ||
      view.blocked !== undefined ||
      view.state.kind !== "waiting"
    )
      return;
    // One approval: HQ imports what it names and records how it ended.
    const refused = await ask.approve(effect);
    // The plan this was read from no longer creates them all: HQ's plan is read again, once.
    if (refused === SERVICE_NOT_PLANNED) plan.again();
  };

  const continueId = view.resume ? ask.effectId : undefined;
  const onContinue =
    continueId === undefined || operations === null || home === undefined
      ? undefined
      : () =>
          void operations.submit({
            kind: "continue-operation",
            orgId: home.orgId,
            id: continueId,
            projectId: home.projectId,
          });

  return (
    <ServiceCreateAskCard
      mateName={ask.mateName}
      onContinue={onContinue}
      onCreate={() => void create()}
      onNotNow={() => void ask.decide({ state: "declined", at: new Date().toISOString() })}
      proposal={proposal}
      refusal={ask.refusal}
      view={view}
      yaml={yaml}
    />
  );
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
