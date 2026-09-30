/**
 * *New project* — a group, and its first Mate (guide 4.1, 4.2) — as a dialog over whatever the
 * person is looking at (`newProjectAsk.ts`), of the family New Mate belongs to (board D1, the
 * owner, 2026-09-30): every door asks here, and nothing navigates until Create.
 *
 * ## A project is a registry entry
 *
 * Nothing platform-side is created for the project itself. The group is one
 * `mate:gn:{groupId}:{slug}` tag written on the account's Gitea project
 * (`groupCreation.ts`), and the account's broker builds the Gitea side from
 * it — the org, its teams, the group repo, its runner — in about eighty
 * seconds. The first Mate is an ordinary Zerops project created inside it and
 * tagged with the group at birth, so it never exists ungrouped.
 *
 * That is why the registry write comes first and the Mate second: a Mate
 * tagged into a group the registry does not know about is a Mate with no reach
 * and no bot (guide 4.2).
 *
 * ## Two questions
 *
 * The project's name, and who its first Mate is: a name, a colour and a
 * shape, asked with the picker *New Mate* uses (`MateFacePicker`) and the same
 * rules — the face follows the name until a pick sticks, the name is new on
 * the account (`ZeropsNewProjectForm`). The Mate is born as *New Mate* makes
 * one: its face on its project, and asking, on behalf of the person who made
 * it, for the project's development to be stood up, which their first sign-in
 * sends (`mateStandUp.ts`). No brief and no agent pick: the container offers
 * every agent when `ZCP_AGENTS` is absent, which an empty selection is
 * (`newProject.ts`). Where it lives is asked only where the account has more
 * than one place.
 *
 * ## One step
 *
 * Create closes the dialog and lands the person on the first Mate's own view
 * at once, as Add a Mate does, with the project and the Mate in the left menu
 * from the press (`newProjectBirth.ts`, the owner, 2026-09-30): Git hosting
 * where the account has none, the project's registry entry and the Mate's
 * project are its progress's first steps, and a step that stops says why
 * there, with *Try again*. The rest is the Mate's birth (`zeropsBirths.ts`,
 * DESIGN §4.5), begun the moment the platform accepts its project: its
 * registry entry, the broker's grant, its harden and its health are the
 * account's birth worker's, so a reload, an organization switch or leaving the
 * page never strands them.
 */
import { useNavigate } from "@tanstack/react-router";
import {
  selectLocationChoice,
  type OrganizationLocationsResourceRequest,
} from "@t3tools/client-runtime/zerops/data";
import { heldCandidates, takenBotNames } from "@t3tools/client-runtime/zerops/projections";
import { useEffect, useMemo, useState } from "react";

import {
  generateBotName,
  generateZeropsGroupId,
  newMateTint,
  resolveAddProjectVerb,
  type ZeropsOrganization,
  toolProjectName,
} from "@t3tools/client-runtime/zerops";

import { useAccountGitea, useAccountHoldsGitea } from "~/zerops/giteaProject";
import { useNewMate } from "~/zerops/newMate";
import {
  beginNewProjectBirth,
  newProjectPlacement,
  newProjectView,
  type NewProjectAsk,
} from "~/zerops/newProjectBirth";
import { useNewProjectAsk } from "~/zerops/newProjectAsk";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { creationAccepted } from "~/zerops/zeropsBirths";
import { runZeropsCommand, useKnown, useZeropsData } from "~/zerops/zeropsDataContext";
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
export function ZeropsNewProjectHost() {
  const asked = useNewProjectAsk((state) => state.asked);
  const { status } = useZeropsSession();
  if (status !== "signed-in" || asked === null) return null;
  return <NewProjectDialog key={asked} />;
}

function NewProjectDialog() {
  const dismiss = useNewProjectAsk((state) => state.dismiss);
  const { activeOrganization, organizationStatus, organizations, selectOrganization, user } =
    useZeropsSession();
  const { organizationRef, projectRef, runtime } = useZeropsData();
  const navigate = useNavigate();
  // The account's Mates: the names a new one may not take, and the tints its face walks past.
  const { listing } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const taken = useMemo(() => takenBotNames(listing), [listing]);
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
  const created = useNewMate((state) => state.created);

  // The registry lives on the account's Gitea project, and only its owners and
  // admins may write it (D3) — a stricter gate than *can create projects*, and
  // the one the platform will actually apply.
  const gitea = useAccountGitea(activeOrganization?.id);
  // Git hosting comes along only for an account that holds none (`newProjectNext`).
  const holdsGitea = useAccountHoldsGitea(activeOrganization?.id);
  const addProject = resolveAddProjectVerb({
    viewer: {
      id: activeOrganization?.id ?? "",
      membershipId: activeOrganization?.membershipId ?? "",
      roleCode: activeOrganization?.roleCode,
      canCreateProjects: activeOrganization?.canCreateProjects,
    },
  });
  const canCreate = addProject.offered;
  const locationRequest = useMemo<OrganizationLocationsResourceRequest | null>(
    () =>
      activeOrganization && canCreate
        ? {
            kind: "organization-locations",
            account: runtime.scope,
            organization: organizationRef(activeOrganization.id),
          }
        : null,
    [activeOrganization, canCreate, organizationRef, runtime.scope],
  );
  const offered = selectLocationChoice(
    useKnown(locationRequest === null ? null : runtime.resources.known(locationRequest)),
  );
  const locations = offered.locations;
  const locationKey = activeOrganization?.id ?? "";
  const locationId =
    locationChoice?.key === locationKey &&
    locations.some((location) => location.id === locationChoice.id)
      ? locationChoice.id
      : (locations[0]?.id ?? null);
  const locationStatus = !activeOrganization || !canCreate ? "ready" : offered.status;
  const locationError = offered.status === "failed" ? "Couldn't load the locations." : null;

  useEffect(() => {
    if (locations.length <= 1) return;
    let cancelled = false;
    // Match the Zerops GUI's default: measure all locations in parallel
    // and preselect the lowest observed latency. This is a bounded health
    // probe, independent of the platform configuration read.
    void Promise.all(
      locations.map(async (location) => {
        const startedAt = performance.now();
        try {
          const response = await fetch(location.pingUrl, { cache: "no-store" });
          if (!response.ok) return null;
          return { id: location.id, latency: performance.now() - startedAt };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const fastest = results
        .filter((result): result is { readonly id: string; readonly latency: number } =>
          Boolean(result),
        )
        .sort((left, right) => left.latency - right.latency)[0];
      if (fastest) setLocationChoice({ key: locationKey, id: fastest.id });
    });
    return () => {
      cancelled = true;
    };
  }, [locationKey, locations]);

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
    if (creating) return;
    setCreating(true);
    const organizationId = activeOrganization.id;
    const organization = organizationRef(organizationId);
    const ask: NewProjectAsk = {
      organizationId,
      groupId: generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes)),
      name,
      botName,
      face,
      locationId,
      // Every agent: an empty selection omits `ZCP_AGENTS` (`newProject.ts`).
      agents: [],
      // Its person's first sign-in sends the Mate "Stand up development of the project." (D6).
      ...(user?.id ? { standUpBy: user.id } : {}),
    };
    const birthId = beginNewProjectBirth({
      ask,
      gitea: gitea === undefined ? undefined : { projectId: gitea.projectId },
      now: Date.now(),
      ports: {
        // The first project brings Git hosting along: the same stand-up the
        // projects page offers an older account.
        ensureGitea: async () => {
          const { project } = await runZeropsCommand(
            runtime.commands.createToolProject({
              organization,
              toolKind: "gitea",
              name: toolProjectName("gitea"),
              appUrl: window.location.origin,
            }),
          );
          return { projectId: project.id };
        },
        registerGroup: ({ giteaProjectId, groupId, name: groupName }) =>
          runZeropsCommand(
            runtime.commands.updateProjectTags(projectRef(organizationId, giteaProjectId), {
              kind: "registry-group",
              groupId,
              name: groupName,
            }),
          ),
        createProject: (creation) =>
          runZeropsCommand(runtime.commands.createProjectWithMate({ organization, ...creation })),
        accepted: (projectId, giteaProjectId) => {
          // The birth owes the Mate's registry entry and the broker's grant,
          // then its harden and its health; the listing is read again so the
          // project's group catches up with it. Its row stands where the
          // creation's stood, with the same face and name.
          const placement = newProjectPlacement(ask);
          creationAccepted(
            {
              projectId,
              organizationId,
              registration: {
                giteaProjectId,
                giteaOrigin: null,
                groupId: ask.groupId,
                kind: "mate",
                displayName: placement.displayName,
              },
              container: true,
              placement,
            },
            organization,
          );
          // Who it is until the listing names it, as Add a Mate's are: its
          // view's face, name and stand-up.
          created({ projectId, groupId: ask.groupId, groupName: name, botName, face });
        },
      },
    });
    // The dialog gives way to its first Mate's own view, at once: the project and the Mate come
    // up there.
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
      locationLoading={locationStatus === "loading"}
      locations={locations}
      onCancel={dismiss}
      onCreate={createProject}
      onLocation={(id) => {
        setLocationChoice({ key: locationKey, id });
      }}
      onOpenChange={onOpenChange}
      organizationName={activeOrganization.name}
      proposeAnotherName={(current) =>
        generateBotName([...taken.names, current], (bytes) => crypto.getRandomValues(bytes))
      }
      takenBotNames={taken}
      withGitHosting={!holdsGitea}
    />
  );
}
