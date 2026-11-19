/**
 * *New project* — a group, and its first Mate (guide 4.1, 4.2) — as a dialog over whatever the
 * person is looking at (`newProjectAsk.ts`), of the family New Mate belongs to (board D1, the
 * owner, 2026-09-30): every door asks here, and nothing navigates until Create.
 *
 * ## A project is an application in HQ
 *
 * Nothing platform-side is created for the project itself. The group is an
 * application in the organization's HQ (ADR 0002), which HQ names, and which
 * stands before any project does (ADR 0001). The first Mate is an ordinary
 * Zerops project, attached to the application in HQ as it is born, so it never
 * exists ungrouped.
 *
 * That is why the registration comes first and the Mate second: a Mate
 * attached to a group the registry does not know about is a Mate in a project
 * nobody has heard of.
 *
 * ## Two questions
 *
 * The project's name, and who its first Mate is: a name, a colour and a
 * shape, asked with the picker *New Mate* uses (`MateFacePicker`) and the same
 * rules — the face follows the name until a pick sticks, the name is new on
 * the account (`ZeropsNewProjectForm`). The Mate is born as *New Mate* makes
 * one — its record in HQ, its one import — but asks for no stand-up:
 * a new project has no code to stand up, and its person says what to build.
 * No brief and no agent pick: the container offers
 * every agent when `ZCP_AGENTS` is absent, which an empty selection is
 * (`newProject.ts`). Where it lives is asked only where the account has more
 * than one place.
 *
 * ## One step
 *
 * HQ accepts one Create and finishes the birth. Its pushed navigation follows the same birth id
 * even when this dialog missed the answer.
 */
import { useNavigate } from "@tanstack/react-router";
import {
  organizationLocations,
  regionRecommendation,
  demandLocationLatency,
  initialStream,
  type LocationsRead,
} from "@t3tools/client-runtime/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useMemo, useState } from "react";

import {
  generateBotName,
  newMateTint,
  resolveAddProjectVerb,
} from "@t3tools/client-runtime/zerops";

import { configuredHq } from "~/zerops/accountHq";
import { randomUUID } from "~/lib/utils";
import {
  beginCreation,
  dismissSharedCreation,
  tryCreationAgain,
  useCreation,
} from "~/zerops/creations";
import { newProjectView, type NewProjectAsk } from "~/zerops/newProjectBirth";
import { useSharedBirths } from "~/zerops/sharedBirths";
import { useCreateBirth } from "~/zerops/useRunNewProject";
import { useCreditForecastRead } from "~/zerops/useCreditForecast";
import { usePreloadMateViews } from "~/zerops/usePreloadMateViews";
import { useNewProjectAsk } from "~/zerops/newProjectAsk";
import { useOrgOffers } from "~/zerops/useHqOffers";
import { useTakenBotNames, useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import {
  AccountStoreContext,
  useAccountDataOptional,
  useProjection,
} from "~/zerops/ZeropsAccountData";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { ProjectAccessDraft } from "./projects/ProjectPeople";
import { CreditForecastLine } from "./ZeropsCreditForecast";
import { ZeropsNewProjectDialog, type NewProjectChoice } from "./ZeropsNewProjectForm";
import { ZeropsOrganizationWait } from "./ZeropsOrganizationScope";

/** How long New project waits for its reads before it opens with whatever is still out. */
export const NEW_PROJECT_OPEN_WAIT_MS = 600;

/** Mounted once, above every view: the dialog while New project is asked for. */
const NO_RECOMMENDATION = Atom.make<string | null>(null);
const UNREAD_LOCATIONS = Atom.make<LocationsRead>({
  fact: { kind: "unknown" },
  coverage: "unknown",
  stream: initialStream({ parent: null, mode: "sampled" }),
  link: null,
  status: "loading",
  settled: false,
  refused: false,
  locations: [],
});

export function ZeropsNewProjectHost() {
  const asked = useNewProjectAsk((state) => state.asked);
  const { status, activeOrganization } = useZeropsSession();
  const births = useSharedBirths();
  useEffect(() => {
    for (const birth of births) dismissSharedCreation(birth.id);
  }, [births]);
  return status === "signed-in" && asked !== null ? (
    <NewProjectDialog key={`${activeOrganization?.id}/${asked}`} births={births} />
  ) : null;
}

function NewProjectDialog({ births }: { births: ReturnType<typeof useSharedBirths> }) {
  const dismiss = useNewProjectAsk((state) => state.dismiss);
  const createBirth = useCreateBirth();
  const { activeOrganization, organizationStatus } = useZeropsSession();
  const navigate = useNavigate();
  usePreloadMateViews();
  // The account's Mates: the names a new one may not take, and the tints its face walks past.
  const { listing } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const taken = useTakenBotNames();
  // Proposed once, free among the names read by then; a clash read later is refused by name.
  const [defaultBotName] = useState(() =>
    generateBotName(taken.names, (bytes) => crypto.getRandomValues(bytes)),
  );

  const [locationChoice, setLocationChoice] = useState<{
    readonly key: string;
    readonly id: string;
  } | null>(null);
  // One id for this form, including a repeat after HQ's answer was lost.
  const [birthId] = useState(randomUUID);
  const creation = useCreation(birthId);
  const creating = creation !== undefined && creation.failed === null;
  const accepted = creation?.intent === birthId || births.some((birth) => birth.id === birthId);
  useEffect(() => {
    if (!accepted) return;
    dismiss();
    void navigate(newProjectView(birthId));
  }, [accepted, birthId, dismiss, navigate]);

  // HQ offers application creation to the people Zerops allows to create projects.
  const addProject = resolveAddProjectVerb({ offer: useOrgOffers()("create_app") });
  const canCreate = addProject.offered;
  // Where it may live is read while the dialog can create: once on opening, and again while open.
  const account = useAccountDataOptional();
  const demandDetail = account?.demandDetail;
  const orgId = account?.orgId ?? null;
  const placesFor =
    activeOrganization && canCreate && orgId === activeOrganization.id ? orgId : null;
  useEffect(() => {
    if (demandDetail === undefined || placesFor === null) return;
    return demandDetail({ family: "organizationLocations", ownerId: placesFor });
  }, [demandDetail, placesFor]);
  const offered = useProjection(organizationLocations, placesFor, UNREAD_LOCATIONS);
  const locations = offered.locations;
  const locationKey = activeOrganization?.id ?? "";
  const store = useContext(AccountStoreContext);
  useEffect(() => {
    if (store === null || placesFor === null || locations.length <= 1) return;
    const release = locations.map((location) =>
      demandLocationLatency({ store, orgId: placesFor, location }),
    );
    return () => {
      for (const stop of release) stop();
    };
  }, [store, placesFor, locations]);
  const recommendation = useProjection(
    regionRecommendation,
    placesFor === null ? null : { orgId: placesFor, locations },
    NO_RECOMMENDATION,
  );
  const locationId =
    locationChoice?.key === locationKey &&
    locations.some((location) => location.id === locationChoice.id)
      ? locationChoice.id
      : (recommendation ?? locations[0]?.id ?? null);
  const locationStatus = !activeOrganization || !canCreate ? "ready" : offered.status;
  // Create waits for the first answer only: the reads made again while it is open keep the places
  // they had, and say nothing on the button.
  const locationsLoading = locationStatus === "loading" && offered.fact.kind !== "known";
  const locationError = offered.status === "failed" ? "Couldn't load the locations." : null;
  // The credit forecast is read from the dialog's opening, and the dialog opens once it and the
  // places have answered — whole, never growing a line a frame later — or once its short wait is
  // over, whatever is still out.
  const credit = useCreditForecastRead(canCreate ? (activeOrganization?.id ?? null) : null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), NEW_PROJECT_OPEN_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const opens = waited || !canCreate || (credit.settled && !locationsLoading);

  const onOpenChange = (open: boolean) => {
    if (!open) dismiss();
  };

  // Until one is chosen the root draws the choice alone: here only its read back can be awaited.
  if (organizationStatus !== "selected" || activeOrganization === null) {
    return (
      <Dialog onOpenChange={onOpenChange} open>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <ZeropsOrganizationWait />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    );
  }

  const createProject = ({ name, botName, face, userRoles }: NewProjectChoice) => {
    if (creating || !canCreate) return;
    const organizationId = activeOrganization.id;
    const ask: NewProjectAsk = {
      organizationId,
      creator: activeOrganization.membershipId,
      creatorRole: activeOrganization.roleCode,
      birthId,
      name,
      botName,
      face,
      locationId,
      // Every agent: an empty selection omits `ZCP_AGENTS` (`newProject.ts`).
      agents: [],
      ...(userRoles === undefined ? {} : { userRoles }),
    };
    // The creation's id is its group's: its view is there from the press.
    beginCreation({
      ask,
      hq: configuredHq(),
      now: Date.now(),
      run: createBirth,
    });
  };

  return (
    <ZeropsNewProjectDialog
      // A brand new app: its creator, and whom the organization's roles give it.
      access={(onChange) => (
        <ProjectAccessDraft groupId={null} kind="mate" label="Project access" onChange={onChange} />
      )}
      forecast={
        credit.forecast ? <CreditForecastLine organizationId={activeOrganization.id} /> : null
      }
      closed={
        addProject.offered || creation !== undefined
          ? undefined
          : `${addProject.reason} You can open every project of ${activeOrganization.name} you have been given.`
      }
      creating={creating}
      retry={
        creation?.failed
          ? { reason: creation.failed.reason, send: () => tryCreationAgain(creation) }
          : undefined
      }
      defaultBotName={defaultBotName}
      defaultTintFor={(botName) => newMateTint(candidates, botName)}
      locationError={locationError}
      locationId={locationId}
      loading={locationsLoading}
      locations={locations}
      onCancel={dismiss}
      onCreate={createProject}
      onLocation={(id) => {
        setLocationChoice({ key: locationKey, id });
      }}
      onOpenChange={onOpenChange}
      open={opens}

      proposeAnotherName={(current) =>
        generateBotName([...taken.names, current], (bytes) => crypto.getRandomValues(bytes))
      }
      takenBotNames={taken}
    />
  );
}
