/**
 * *New project* — a group, and its first Mate (guide 4.1, 4.2) — as a page in the main column
 * beside the menu (`/zerops/new`, the owner, 2026-11-23): every door asks (`newProjectAsk.ts`), and
 * the host takes the person there. An account's first run draws the same form as its whole window
 * instead (`FirstRunScreen`), on the same reads and Create (`useNewProjectAnswer`).
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
 * even when this page missed the answer.
 */
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  locationChoices,
  organizationLocations,
  regionRecommendation,
  demandLocationLatency,
  initialStream,
  type LocationChoice,
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

import { PageStandIn } from "../RoutePending";
import { SidebarInset } from "../ui/sidebar";
import { ProjectAccessDraft } from "./projects/ProjectPeople";
import { CreditForecastLine } from "./ZeropsCreditForecast";
import {
  NewProjectPageFrame,
  ZeropsNewProjectPage,
  type NewProjectChoice,
  type NewProjectFormInput,
} from "./ZeropsNewProjectForm";
import { ZeropsOrganizationWait } from "./ZeropsOrganizationScope";

/** How long New project waits for its reads before it opens with whatever is still out. */
export const NEW_PROJECT_OPEN_WAIT_MS = 600;

const NO_RECOMMENDATION = Atom.make<string | null>(null);
const NO_CHOICES = Atom.make<ReadonlyArray<LocationChoice>>([]);
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

/** Mounted once, above every view: an ask for New project takes the person to its page. */
export function ZeropsNewProjectHost() {
  const asked = useNewProjectAsk((state) => state.asked);
  const dismiss = useNewProjectAsk((state) => state.dismiss);
  const navigate = useNavigate();
  const births = useSharedBirths();
  useEffect(() => {
    for (const birth of births) dismissSharedCreation(birth);
  }, [births]);
  useEffect(() => {
    if (asked === null) return;
    dismiss();
    void navigate({ to: "/zerops/new" });
  }, [asked, dismiss, navigate]);
  return null;
}

/** `/zerops/new`: the page, one per organization, once the person is signed in. */
export function ZeropsNewProjectRoute() {
  const { status, activeOrganization } = useZeropsSession();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      {status === "signed-in" ? <NewProjectPage key={activeOrganization?.id ?? ""} /> : null}
    </SidebarInset>
  );
}

function NewProjectPage() {
  const answer = useNewProjectAnswer();
  // Until one is chosen the root draws the choice alone: here only its read back can be awaited.
  if (answer.kind === "organization-wait")
    return (
      <NewProjectPageFrame>
        <ZeropsOrganizationWait />
      </NewProjectPageFrame>
    );
  // The page leaves in the very render that draws the first Mate's view.
  if (answer.landed) return null;
  // Held until what it says is read, so it opens whole.
  if (!answer.opens) return <PageStandIn />;
  return <ZeropsNewProjectPage {...answer.form} />;
}

/** What New project answers with, wherever its form is drawn. */
type NewProjectAnswer =
  | { readonly kind: "organization-wait" }
  | {
      readonly kind: "form";
      readonly form: NewProjectFormInput;
      /** What the form says is read, or its short wait is over: it opens whole. */
      readonly opens: boolean;
      /** The first Mate's view is the one on screen: the form has done its job. */
      readonly landed: boolean;
    };

/**
 * New project's reads and its Create, for a form drawn anywhere — the dialog over the view on
 * screen, or an account's first run (`FirstRunScreen`), whose page is the form. One birth id per
 * form, a repeat after HQ's answer was lost included; once HQ accepts it the person lands on the
 * first Mate's view.
 */
export function useNewProjectAnswer(): NewProjectAnswer {
  const births = useSharedBirths();
  const createBirth = useCreateBirth();
  const { activeOrganization, organizationStatus } = useZeropsSession();
  const navigate = useNavigate();
  usePreloadMateViews();
  // The account's Mates: the names a new one may not take, and the tints its face walks past.
  const { listing } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const taken = useTakenBotNames();
  // Only a first candidate: the form offers it once every name is read and it is still free.
  const [defaultBotName] = useState(() =>
    generateBotName(taken.names, (bytes) => crypto.getRandomValues(bytes)),
  );

  const [locationChoice, setLocationChoice] = useState<{
    readonly key: string;
    readonly id: string;
  } | null>(null);
  const [birthId] = useState(randomUUID);
  const creation = useCreation(birthId);
  const creating = creation !== undefined && creation.failed === null;
  const accepted = creation?.intent === birthId || births.some((birth) => birth.id === birthId);
  const landed = useRouterState({
    select: (state) => state.location.pathname === `/mate/new/${birthId}`,
  });
  useEffect(() => {
    if (!accepted) return;
    void navigate(newProjectView(birthId));
  }, [accepted, birthId, navigate]);

  // HQ offers application creation to the people Zerops allows to create projects.
  const addProject = resolveAddProjectVerb({ offer: useOrgOffers()("create_app") });
  const canCreate = addProject.offered;
  // Where it may live is read while the form can create: once on opening, and again while open.
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
  // Each place with this browser's latency to it, as its tile says it.
  const choices = useProjection(
    locationChoices,
    placesFor === null ? null : { orgId: placesFor, locations },
    NO_CHOICES,
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
  // The credit forecast is read from the form's opening, and the form opens once it and the
  // places have answered — whole, never growing a line a frame later — or once its short wait is
  // over, whatever is still out.
  const credit = useCreditForecastRead(canCreate ? (activeOrganization?.id ?? null) : null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), NEW_PROJECT_OPEN_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const opens = waited || !canCreate || (credit.settled && !locationsLoading);

  if (organizationStatus !== "selected" || activeOrganization === null)
    return { kind: "organization-wait" };

  const createProject = ({ name, botName, face, userRoles }: NewProjectChoice) => {
    if (creating || !canCreate) return;
    const ask: NewProjectAsk = {
      organizationId: activeOrganization.id,
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
    beginCreation({
      ask,
      hq: configuredHq(),
      now: Date.now(),
      run: createBirth,
    });
  };

  return {
    kind: "form",
    opens,
    landed,
    form: {
      // A brand new app: its creator, and whom the organization's roles give it.
      access: (onChange) => (
        <ProjectAccessDraft
          groupId={null}
          kind="mate"
          label="Who gets access to this project"
          look="page"
          onChange={onChange}
        />
      ),
      forecast: credit.forecast ? (
        <CreditForecastLine organizationId={activeOrganization.id} />
      ) : null,
      closed:
        addProject.offered || creation !== undefined
          ? undefined
          : `${addProject.reason} You can open every project of ${activeOrganization.name} you have been given.`,
      creating,
      retry: creation?.failed
        ? { reason: creation.failed.reason, send: () => tryCreationAgain(creation) }
        : undefined,
      defaultBotName,
      defaultTintFor: (botName) => newMateTint(candidates, botName),
      locationError,
      locationId,
      loading: locationsLoading,
      locations: choices,
      onCreate: createProject,
      onLocation: (id) => {
        setLocationChoice({ key: locationKey, id });
      },
      proposeAnotherName: (current) =>
        generateBotName([...taken.names, current], (bytes) => crypto.getRandomValues(bytes)),
      takenBotNames: taken,
    },
  };
}
