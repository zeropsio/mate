/**
 * *Put it live* over whatever is on screen (`putLive.ts`): the sheet when a door asks for it, and its
 * press, one start at HQ (`start-put-live`). HQ makes production with what the project already
 * says — its name after the project, who reaches it, no agent — and the one thing it cannot know,
 * who production is for, then releases to it as its `put_live` operation on the person's token;
 * closing the tab changes nothing. Production's line draws where HQ got (`ProductionRun`), on every
 * device. Where HQ ends it at the release's review, the review opens in every tab that watched it
 * run.
 */
import { applicationEnvironments } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useAtomValue } from "@effect/atom-react";
import { hqOperationOf } from "@t3tools/client-runtime/data";
import { useEffect, useMemo, useRef, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useCompactProjectFlows } from "~/zerops/projectFlows";
import { useProjectsInventory } from "~/zerops/projectsInventory";
import { usePutLive, usePutLiveStanding, type PutLiveAsk } from "~/zerops/putLive";
import {
  putLiveCorePackage,
  putLiveOf,
  putLiveServices,
  putLiveShapes,
  putLiveSheet,
  putLiveSheetUnderWay,
} from "~/zerops/putLive.logic";
import type { ProductionShape } from "@t3tools/shared/hqRelease";
import { useOpenReview } from "~/zerops/review";
import {
  useAddEnvironment,
  useApplicationEnvironmentFacts,
  useEnvironmentOffers,
} from "~/zerops/useAddEnvironment";
import {
  applicationOperationAtom,
  applicationOperationsAtom,
} from "~/zerops/useEnvironmentOperation";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { writeTrouble } from "~/zerops/zeropsWrite";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Dialog } from "../ui/dialog";
import { PutLiveSheet } from "./PutLiveSheet";
import { useDraftPeople } from "./projects/ProjectPeople";
import {
  PEOPLE_UNREADABLE,
  proposedEnvironmentName,
} from "./ZeropsEnvironmentCreationDialog.logic";

export function PutLiveHost() {
  const { status } = useZeropsSession();
  const asked = usePutLive((state) => state.asked);
  const close = usePutLive((state) => state.close);
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
      <PutLiveReviews />
    </>
  );
}

/**
 * A *Put it live* HQ ended at the release's review opens that review, once, in a tab that watched
 * it run: its press approved only what its sheet named, and the rest is the person's decision.
 */
function PutLiveReviews() {
  const operations = useAtomValue(applicationOperationsAtom);
  const openReview = useOpenReview();
  // The operations this tab saw running, and those whose review it opened.
  const watched = useRef(new Set<string>());
  const opened = useRef(new Set<string>());
  useEffect(() => {
    for (const [appId, operation] of operations) {
      const standing = putLiveOf(operation).kind;
      if (standing === "going") watched.current.add(operation.id);
      else if (
        standing === "review" &&
        watched.current.has(operation.id) &&
        !opened.current.has(operation.id)
      ) {
        opened.current.add(operation.id);
        openReview({ kind: "release", groupId: appId });
      }
    }
  }, [openReview, operations]);
  return null;
}

const BY_NAME = { order: "name" } as const;

/** The project as the menu's tree draws it (`useProjectsInventory`): its name, and its environments. */
function useGroupEntry(groupId: string) {
  const { listing } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const { groups } = useProjectsInventory(candidates, BY_NAME);
  return useMemo(
    () => groups.find((candidate) => candidate.group.groupId === groupId),
    [groupId, groups],
  );
}

const OTHER_SETUP = "Another setup on this application is running.";
const NOTHING_ON_MAIN = "The project has nothing on main to put live yet.";

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
  const environmentFacts = useApplicationEnvironmentFacts();
  // What the application holds of each tier, the one answer every door reads.
  const held = useMemo(
    () =>
      applicationEnvironments(
        environmentFacts(
          ask.groupId,
          flow === undefined
            ? undefined
            : {
                environments: flow.environmentInputs,
                recipeRead: flow.recipeRead,
                recipeTiers: flow.recipeTiers,
                merged: flow.merged,
                pullRequests: flow.pullRequests,
                outside: flow.outside,
              },
        ),
      ).held,
    [ask.groupId, environmentFacts, flow],
  );
  const addEnvironment = useAddEnvironment();
  const close = usePutLive((state) => state.close);
  const openReview = useOpenReview();
  const operations = useAccountOperations();
  // Production gets the project's people at their level there, as a stage added from it does.
  const people = useDraftPeople(ask.groupId, "production");
  const standing = usePutLiveStanding(ask.groupId);
  // Another operation HQ runs on the application refuses this start (`operation_in_flight`).
  const operation = useAtomValue(applicationOperationAtom(ask.groupId));
  const otherSetup =
    operation !== undefined &&
    operation.kind !== "put_live" &&
    hqOperationOf(operation, operation.kind).kind === "going";
  // The operation's id, the same for every send of one press: a lost answer is sent again under it.
  const startId = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<string>();
  // Who production is for: never picked for the person.
  const [shape, setShape] = useState<ProductionShape | undefined>(undefined);
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
  const shapes = useMemo(
    () => (recipe.tier === undefined ? undefined : putLiveShapes(recipe.tier.yaml)),
    [recipe.tier],
  );
  const model = putLiveSheet({
    project,
    changes: merged,
    recipe: recipe.state,
    creates,
    shapes,
    shape,
    stageHeld:
      flow?.declarationsRead === true ? held.some(({ tier }) => tier === "stage") : undefined,
  });
  const release = flow?.release;
  const waits =
    flow !== undefined && (release?.groupHead === undefined || release.entries.length === 0)
      ? NOTHING_ON_MAIN
      : people.kind === "failed"
        ? PEOPLE_UNREADABLE
        : undefined;
  const seeCode = merged?.length === 1 ? merged[0] : undefined;
  const putLive = async () => {
    if (orgId === undefined || entry === undefined || sending) return;
    if (people.kind !== "ready" || release?.groupHead === undefined) return;
    const { group, environments } = entry;
    const id = startId.current ?? randomUUID();
    startId.current = id;
    setSending(true);
    setRefused(undefined);
    const { progress, evidence } = await operations
      .submit({
        kind: "start-put-live",
        orgId,
        appId: ask.groupId,
        start: {
          id,
          production: {
            name: proposedEnvironmentName({
              groupName: group.name,
              roleLabel: "production",
              taken: environments.flatMap(({ item }) =>
                item === undefined ? [] : [item.project.name],
              ),
            }),
            access: people.userRoles,
            ...(shape === undefined ? {} : { corePackage: putLiveCorePackage(shape) }),
          },
          release: {
            tag: release.suggestion,
            groupHead: release.groupHead,
            entries: release.entries.map(({ service, commit }) => ({ service, sha: commit })),
            ...(shape === undefined ? {} : { shape }),
          },
          // The press approves what the sheet named, and nothing else: HQ ends at the release's
          // review where the release creates anything more.
          approves: model.where.creates?.map((service) => service.hostname) ?? [],
        },
      })
      .finally(() => setSending(false));
    const trouble = writeTrouble(progress, evidence);
    if (trouble === null) {
      close();
      return;
    }
    // A refused start took nothing: the next press is a new operation. One whose answer was lost
    // is sent again under its id, which HQ answers as taken.
    if (progress.stage !== "uncertain") startId.current = null;
    setRefused(trouble);
  };
  return (
    <PutLiveSheet
      model={
        sending
          ? putLiveSheetUnderWay(model, { pressedHere: true })
          : standing.kind === "going"
            ? putLiveSheetUnderWay(model, { pressedHere: false })
            : otherSetup
              ? { ...model, hold: OTHER_SETUP }
              : offers?.zerops?.production === false
                ? { ...model, hold: "Production can be added here only as a Git branch." }
                : waits !== undefined && model.hold === undefined
                  ? { ...model, hold: waits }
                  : { ...model, refused }
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
      onShape={setShape}
      onPutLive={() => {
        void putLive();
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
