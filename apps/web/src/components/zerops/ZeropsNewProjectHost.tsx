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
 * one — its record in HQ, its project closed off — but asks for no stand-up:
 * a new project has no code to stand up, and its person says what to build.
 * No brief and no agent pick: the container offers
 * every agent when `ZCP_AGENTS` is absent, which an empty selection is
 * (`newProject.ts`). Where it lives is asked only where the account has more
 * than one place.
 *
 * ## One step
 *
 * Create closes the dialog and lands on the first Mate's own view at once (`/mate/new/$birthId`,
 * the owner, 2026-10-03: "why are these two screens separate?"). The steps this tab runs with the
 * person's session — the application and its birth intent in HQ, the
 * Mate's project, its close-off and its registration (`newProjectBirth.ts`, `matePress.ts`) — run
 * on in the account's creations, whatever the person opens next, and the view draws them under
 * the project's row, saying to keep the tab open only while they run. A step that stops says why
 * there, with *Try again*; a tab closed before the close-off is the person's choice, and the Mate's
 * ⋯ menu finishes it (*Finish setup*).
 */
import { useNavigate } from "@tanstack/react-router";
import {
  organizationLocations,
  regionRecommendation,
  demandLocationLatency,
  type LocationsRead,
} from "@t3tools/client-runtime/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { Atom } from "effect/unstable/reactivity";
import { useContext, useEffect, useMemo, useState } from "react";

import {
  generateBotName,
  generateZeropsGroupId,
  newMateTint,
  resolveAddProjectVerb,
  type ZeropsOrganization,
} from "@t3tools/client-runtime/zerops";

import { officialHq, useAccountHq } from "~/zerops/accountHq";
import { beginCreation } from "~/zerops/creations";
import { newProjectView, type NewProjectAsk } from "~/zerops/newProjectBirth";
import { useRunNewProject } from "~/zerops/useRunNewProject";
import { useNewProjectAsk } from "~/zerops/newProjectAsk";
import { useHqOffers, useOrgOffers } from "~/zerops/useHqOffers";
import { useTakenBotNames, useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import {
  AccountStoreContext,
  useAccountDataOptional,
  useProjection,
} from "~/zerops/ZeropsAccountData";
import type { ZeropsOrganizationStatus } from "~/zerops/ZeropsSessionProvider";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { ZeropsNewProjectDialog, type NewProjectChoice } from "./ZeropsNewProjectForm";
import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";

/**
 * A single membership auto-resolves to `organizationStatus: "selected"`
 * (`resolveActiveZeropsOrganization`), so this is false as soon as it can be
 * — the scope step never renders a one-option chooser.
 */
export function zeropsNewProjectScopeStepVisible(input: {
  readonly organizationStatus: ZeropsOrganizationStatus;
  readonly activeOrganization: ZeropsOrganization | null;
}): boolean {
  return input.organizationStatus !== "selected" || !input.activeOrganization;
}

/** Mounted once, above every view: the dialog while New project is asked for. */
const NO_RECOMMENDATION = Atom.make<string | null>(null);
const UNREAD_LOCATIONS = Atom.make<LocationsRead>({ status: "loading", locations: [] });

export function ZeropsNewProjectHost() {
  const asked = useNewProjectAsk((state) => state.asked);
  const { status } = useZeropsSession();
  if (status !== "signed-in" || asked === null) return null;
  return <NewProjectDialog key={asked} />;
}

function NewProjectDialog() {
  const dismiss = useNewProjectAsk((state) => state.dismiss);
  const runNewProject = useRunNewProject();
  const { activeOrganization, organizationStatus, organizations, selectOrganization } =
    useZeropsSession();
  const navigate = useNavigate();
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
  // Create was pressed: its first Mate's view is on its way, and a second press makes nothing.
  const [creating, setCreating] = useState(false);

  // The registry lives in the organization's HQ, where only its owners and admins create an
  // application — a stricter gate than *can create projects*, and HQ's offer (`create_app`).
  const accountHq = useAccountHq(activeOrganization?.id);
  const { at } = useHqOffers();
  const addProject = resolveAddProjectVerb({
    offer: useOrgOffers()("create_app"),
    admins: accountHq.admins,
    at,
  });
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
  const locationError = offered.status === "failed" ? "Couldn't load the locations." : null;

  const onOpenChange = (open: boolean) => {
    if (!open) dismiss();
  };

  if (
    !activeOrganization ||
    zeropsNewProjectScopeStepVisible({ organizationStatus, activeOrganization })
  ) {
    return (
      <Dialog onOpenChange={onOpenChange} open>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <ZeropsOrganizationScope
              organizations={organizations}
              status={organizationStatus}
              onSelect={(membershipId) => {
                void selectOrganization(membershipId);
              }}
            />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    );
  }

  const createProject = ({ name, botName, face }: NewProjectChoice) => {
    if (creating || !canCreate) return;
    setCreating(true);
    const organizationId = activeOrganization.id;
    const ask: NewProjectAsk = {
      organizationId,
      birthId: generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes)),
      name,
      botName,
      face,
      locationId,
      // Every agent: an empty selection omits `ZCP_AGENTS` (`newProject.ts`).
      agents: [],
    };
    // The creation's id is its group's: its view is there from the press.
    const birthId = ask.birthId;
    beginCreation({
      ask,
      hq: officialHq(accountHq),
      now: Date.now(),
      run: runNewProject,
    });
    // The dialog gives way to the first Mate's view at once: the steps run on without it.
    dismiss();
    void navigate(newProjectView(birthId));
  };

  return (
    <ZeropsNewProjectDialog
      closed={
        addProject.offered
          ? undefined
          : `${addProject.reason} You can open every project of ${activeOrganization.name} you have been given.`
      }
      creating={creating}
      defaultBotName={defaultBotName}
      defaultTintFor={(botName) => newMateTint(candidates, botName)}
      locationError={locationError}
      locationId={locationId}
      loading={locationStatus === "loading"}
      locations={locations}
      onCancel={dismiss}
      onCreate={createProject}
      onLocation={(id) => {
        setLocationChoice({ key: locationKey, id });
      }}
      onOpenChange={onOpenChange}

      proposeAnotherName={(current) =>
        generateBotName([...taken.names, current], (bytes) => crypto.getRandomValues(bytes))
      }
      takenBotNames={taken}
    />
  );
}
