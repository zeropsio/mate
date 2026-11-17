/**
 * *Put it live* over whatever is on screen (`putLive.ts`): the sheet when a door asks for it, and
 * each project's run, driven from here so it outlives the sheet and the view the person moves to.
 * A run makes production with what the project already says — its name after the project, its recipe, no agent — and releases to it once HQ holds it;
 * its project's production draws where it got (`ProductionRun`).
 */
import { buildCanonicalGroupTree } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { hqNavigationAtom } from "~/state/zerops";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import { placedPressesIn, useMatePresses } from "~/zerops/matePress";
import { useCompactProjectFlows, useProjectFlows } from "~/zerops/projectFlows";
import { putLiveRunsIn, usePutLive, usePutLiveRun, type PutLiveAsk } from "~/zerops/putLive";
import {
  putLiveCreation,
  putLiveDeadline,
  putLiveFactsOf,
  putLiveLandedAt,
  putLiveNext,
  putLiveReviewed,
  putLiveServices,
  putLiveSettle,
  putLiveSheet,
  putLiveSheetUnderWay,
  SETUP_MISSING,
  SETUP_UNREADABLE,
  type PutLiveEvent,
  type PutLiveRun,
} from "~/zerops/putLive.logic";
import { useOpenReview } from "~/zerops/review";
import { useReleasePlanWait, useReleaseServicePlan } from "~/zerops/useReleaseServicePlan";
import { useAddEnvironment, useEnvironmentOffers } from "~/zerops/useAddEnvironment";
import { useEnvironmentCreation } from "~/zerops/useEnvironmentCreation";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Dialog } from "../ui/dialog";
import { emptyApplications } from "./projects/emptyApps.logic";
import { PutLiveSheet } from "./PutLiveSheet";
import { useDraftPeople } from "./projects/ProjectPeople";
import {
  PEOPLE_UNREADABLE,
  proposedEnvironmentName,
} from "./ZeropsEnvironmentCreationDialog.logic";

export function PutLiveHost() {
  const { status, activeOrganization } = useZeropsSession();
  const asked = usePutLive((state) => state.asked);
  const close = usePutLive((state) => state.close);
  const runs = usePutLive((state) => state.runs);
  const [shown, setShown] = useState(asked);
  if (asked !== null && asked !== shown) setShown(asked);
  // Production's own form opens once the sheet has gone, as from any other door: the focus goes
  // back to what opened the sheet first, and the form takes it from there.
  const then = useRef<(() => void) | null>(null);
  if (status !== "signed-in") return null;
  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          if (!open) close();
        }}
        onOpenChangeComplete={(open) => {
          if (open || usePutLive.getState().asked !== null) return;
          setShown(null);
          const next = then.current;
          then.current = null;
          next?.();
        }}
        open={asked !== null}
      >
        {shown === null ? null : (
          <PutLiveSheetContainer
            ask={shown}
            key={shown.groupId}
            onLeave={(next) => {
              then.current = next;
            }}
          />
        )}
      </Dialog>
      {putLiveRunsIn(runs, activeOrganization?.id).map((run) =>
        run.phase === "live" || run.phase === "failed" ? null : (
          <PutLiveDriver key={run.groupId} run={run} />
        ),
      )}
    </>
  );
}

/** The project as the menu draws it: its name, and its environments for the creation. */
function useGroupEntry(groupId: string) {
  const { activeOrganization } = useZeropsSession();
  const { listing } = useZeropsCandidates();
  const presses = useMatePresses();
  const hqStructure = useAtomValue(hqNavigationAtom);
  return useMemo(
    () =>
      buildCanonicalGroupTree(heldCandidates(listing).rows, {
        order: "name",
        births: placedPressesIn(presses, activeOrganization?.id),
        apps: emptyApplications(hqStructure, activeOrganization?.id),
      }).groups.find((candidate) => candidate.group.groupId === groupId),
    [activeOrganization?.id, groupId, hqStructure, listing, presses],
  );
}

function PutLiveSheetContainer({
  ask,
  onLeave,
}: {
  readonly ask: PutLiveAsk;
  /** What runs once the sheet has gone. */
  readonly onLeave: (next: () => void) => void;
}) {
  const entry = useGroupEntry(ask.groupId);
  const recipe = useZeropsGroupRecipe({ appId: ask.groupId, tier: "production", enabled: true });
  const flow = useCompactProjectFlows(useMemo(() => [ask.groupId], [ask.groupId])).flows.get(
    ask.groupId,
  );
  const offers = useEnvironmentOffers()(ask.groupId);
  const addEnvironment = useAddEnvironment();
  const start = usePutLive((state) => state.start);
  const close = usePutLive((state) => state.close);
  const openReview = useOpenReview();
  const running = usePutLiveRun(ask.groupId);
  // Whether the run under way is the one this sheet's button started.
  const [pressed, setPressed] = useState(false);
  const orgId = useZeropsSession().activeOrganization?.id;
  const project = entry?.group.name ?? "The project";
  // Asked from the project: what is merged goes live, newest first — once the flow is read.
  const merged = useMemo(
    () =>
      flow === undefined
        ? undefined
        : flow.merged
            .filter((pull) => pull.kind === "code")
            .toSorted((left, right) => (right.mergedAt ?? "").localeCompare(left.mergedAt ?? "")),
    [flow],
  );
  const creates = useMemo(
    () => (recipe.tier === undefined ? undefined : putLiveServices(recipe.tier.yaml)),
    [recipe.tier],
  );
  const model = putLiveSheet({
    project,
    changes: merged,
    recipe: recipe.state,
    creates,
  });
  const seeCode = merged?.length === 1 ? merged[0] : undefined;
  return (
    <PutLiveSheet
      model={
        running !== undefined && running.phase !== "failed"
          ? putLiveSheetUnderWay(model, { pressedHere: pressed })
          : offers?.zerops?.production === false
            ? { ...model, hold: "Production can be added here only as a Git branch." }
            : model
      }
      onSetUpYourself={
        offers?.production === true
          ? () => {
              onLeave(() => {
                addEnvironment(ask.groupId, "production");
              });
              close();
            }
          : undefined
      }
      onPutLive={() => {
        if (orgId === undefined) return;
        setPressed(true);
        // The press approves what the sheet named, and nothing else (`putLiveReviewed`).
        start({
          orgId,
          groupId: ask.groupId,
          project,
          approves: model.where.creates?.map((service) => service.hostname),
        });
      }}
      onSeeCode={
        seeCode === undefined
          ? undefined
          : () => {
              close();
              openReview({
                kind: "change",
                groupId: ask.groupId,
                repository: seeCode.repository,
                number: seeCode.number,
              });
            }
      }
    />
  );
}

/** What a run reads of its project's flow. */
/**
 * One run, driven step by step: each step's write is sent once per time the run reaches it, and
 * what it came to moves the run on. Mounted while the run is under way; a failure unmounts it, and
 * *Try again* mounts it afresh at the step that failed.
 */
function PutLiveDriver({ run }: { readonly run: PutLiveRun }) {
  const step = usePutLive((state) => state.step);
  const verbs = useFlowVerbs();
  const create = useEnvironmentCreation();
  const entry = useGroupEntry(run.groupId);
  const recipe = useZeropsGroupRecipe({
    appId: run.groupId,
    tier: "production",
    enabled: run.phase === "creating" && run.productionId === undefined,
  });
  // Production gets the project's people at their level there, as a stage added from it does.
  const people = useDraftPeople(run.groupId, "production");
  const flow = useProjectFlows(useMemo(() => [run.groupId], [run.groupId])).flows.get(run.groupId);
  const forget = usePutLive((state) => state.forget);
  const openReview = useOpenReview();
  // Production takes its first release: HQ's review of it says what it creates there, which the
  // press approved only where the sheet named it (`putLiveReviewed`). Its wait is the review's own.
  const offered =
    run.phase === "creating" &&
    flow !== undefined &&
    putLiveNext(run, putLiveFactsOf(flow)).kind === "release";
  const review = useReleaseServicePlan(
    flow,
    offered ? flow?.release.suggestion : undefined,
    offered,
  );
  const reviewWait = useReleasePlanWait(offered && review.view.kind === "pending");
  // Its wait for the release is bounded: the run is read again once its patience runs out, even
  // where nothing else changes.
  const deadline = putLiveDeadline(run);
  const [woken, wake] = useState(0);
  useEffect(() => {
    if (deadline === undefined) return;
    const timer = setTimeout(() => wake(Date.now()), Math.max(0, deadline - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [deadline]);
  // The step whose write was sent: a re-render never sends it twice.
  const sent = useRef<string | null>(null);
  const key = `${run.phase}:${run.productionId ?? ""}:${run.tag ?? ""}`;

  useEffect(() => {
    if (sent.current === key) return;
    const { groupId } = run;
    const fail = (words: string, halfMade?: boolean) =>
      step(groupId, { kind: "failed", words, halfMade });
    // Every write ends the step it was sent for: its answer moves the run on, and one that never
    // came stops it with the way on — the step is sent afresh from there, never held as sent.
    const send = <T,>(
      write: () => Promise<T>,
      settle: (answer: T) => PutLiveEvent,
      thrown: "again" | "project",
    ) => {
      sent.current = key;
      void putLiveSettle(write, settle, thrown).then((event) => {
        if (event.kind === "failed" && sent.current === key) sent.current = null;
        step(groupId, event);
      });
    };
    const failed = (words: string, halfMade?: boolean): PutLiveEvent => ({
      kind: "failed",
      words,
      halfMade,
    });

    if (run.phase === "creating" && run.productionId === undefined) {
      if (entry === undefined || recipe.loading || recipe.state === "loading") return;
      if (people.kind === "reading") return;
      sent.current = key;
      if (people.kind === "failed") {
        fail(PEOPLE_UNREADABLE);
        return;
      }
      if (recipe.tier === undefined) {
        fail(recipe.state === "absent" ? SETUP_MISSING : SETUP_UNREADABLE);
        return;
      }
      const { group, environments } = entry;
      const request = {
        group,
        environments: environments.flatMap(({ item }) => (item === undefined ? [] : [{ item }])),
        role: "prod",
        choice: {
          name: proposedEnvironmentName({
            groupName: group.name,
            roleLabel: "production",
            taken: environments.flatMap(({ item }) =>
              item === undefined ? [] : [item.project.name],
            ),
          }),
          withAgent: false,
          recipe: recipe.tier,
          ...(people.userRoles.length === 0 ? {} : { userRoles: people.userRoles }),
        },
        // Production counts from the moment its project exists, while its services are awaited.
        onProjectAccepted: (productionId: string) => {
          step(groupId, { kind: "accepted", productionId });
        },
      } as const;
      send(
        () => create(request),
        (made) => putLiveCreation(made, Date.now()),
        // What a creation that never answered made is read from the project, never made twice.
        "project",
      );
      return;
    }

    if (flow === undefined) return;
    const next = putLiveNext(run, putLiveFactsOf(flow), Math.max(woken, Date.now()));
    if (next.kind === "wait") return;
    if (next.kind === "release") {
      const decided = putLiveReviewed({
        review: review.view,
        refused: flow.release.permission?.allowed === false,
        expired: reviewWait.stage === "expired",
        approves: run.approves,
      });
      if (decided.kind === "wait") return;
      if (decided.kind === "review") {
        // What the press did not approve is the person's, in the release's own review: the run
        // ends there, production made, and nothing says it failed.
        sent.current = key;
        forget(groupId);
        openReview({ kind: "release", groupId });
        return;
      }
      send(
        () => verbs.release(flow, undefined, decided.plan),
        (outcome) =>
          outcome.ok
            ? { kind: "released", tag: outcome.tag ?? flow.release.suggestion }
            : failed(outcome.reason),
        "again",
      );
      return;
    }
    sent.current = key;
    if (next.kind === "failed") {
      step(groupId, { kind: "failed", words: next.words, action: next.action });
      return;
    }
    if (next.kind === "adopt") {
      step(groupId, { kind: "released", tag: next.tag, adopted: true });
      return;
    }
    if (next.kind === "live") {
      step(groupId, { kind: "live", at: putLiveLandedAt(run, putLiveFactsOf(flow), Date.now()) });
    }
  }, [
    create,
    entry,
    flow,
    forget,
    key,
    openReview,
    people,
    recipe,
    review.view,
    reviewWait.stage,
    run,
    step,
    verbs,
    woken,
  ]);

  return null;
}
