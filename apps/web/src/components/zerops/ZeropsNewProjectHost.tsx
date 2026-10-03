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
 * Create turns the dialog into the press, and it stays on it until the first Mate needs no
 * browser (`newProjectBirth.ts`, the owner, 2026-10-01): HQ where the organization has none, the
 * project's application, the Mate's project — its creation's wait part of the press — then
 * its close-off (`matePress.ts`); its registration follows, the dialog gone. A step that stops
 * says why there, with *Try again*. Once its project is marked closed off the dialog gives way to
 * the first Mate's own view and the container needs no browser at all; a tab closed before that
 * is the person's choice, and the Mate's ⋯ menu finishes it (*Finish setup*).
 */
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentCreationStepProgress } from "@t3tools/client-runtime/zerops";
import {
  selectLocationChoice,
  type LocationsCellRequest,
} from "@t3tools/client-runtime/zerops/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useEffect, useMemo, useState } from "react";

import {
  generateBotName,
  generateZeropsGroupId,
  newMateTint,
  resolveAddProjectVerb,
  mateBirthTag,
  withZeropsMateTag,
  type ZeropsOrganization,
} from "@t3tools/client-runtime/zerops";

import { accountHqApi, officialHq, useAccountHq } from "~/zerops/accountHq";
import { useNewMate } from "~/zerops/newMate";
import {
  beginNewProjectBirth,
  newProjectPlacement,
  newProjectPressFailure,
  newProjectPressSteps,
  newProjectPressThrough,
  newProjectView,
  retryNewProjectBirth,
  useNewProjectBirths,
  type NewProjectAsk,
} from "~/zerops/newProjectBirth";
import { useNewProjectAsk } from "~/zerops/newProjectAsk";
import { sessionOfferViewer } from "~/zerops/offerViewer";
import { useTakenBotNames, useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { invalidateZerops } from "~/zerops/accountInvalidations";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import {
  beginPress,
  finishMateSetup,
  useMatePress,
  whilePressing,
  type MatePress,
} from "~/zerops/matePress";
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
  const {
    activeOrganization,
    client,
    organizationStatus,
    organizations,
    selectOrganization,
    user,
  } = useZeropsSession();
  const { organizationRef, projectRef, runtime } = useZeropsData();
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
  const created = useNewMate((state) => state.created);
  // The press under way: the dialog stays on it until the first Mate needs no browser.
  const [pressed, setPressed] = useState<{
    readonly birthId: string;
    readonly progress: ReadonlyArray<EnvironmentCreationStepProgress> | null;
  } | null>(null);
  const birth = useNewProjectBirths((state) =>
    pressed === null ? undefined : state.births[pressed.birthId],
  );
  const press = useMatePress(birth?.projectId ?? undefined);

  // The registry lives in the organization's HQ, where only its owners and admins create an
  // application — a stricter gate than *can create projects*, and the one HQ applies.
  const accountHq = useAccountHq(activeOrganization?.id);
  const addProject = resolveAddProjectVerb({
    viewer: sessionOfferViewer(user, activeOrganization),
    admins: accountHq.admins,
  });
  const canCreate = addProject.offered;
  const locationRequest = useMemo<LocationsCellRequest | null>(
    () =>
      activeOrganization && canCreate
        ? {
            kind: "locations",
            account: runtime.scope,
            organization: organizationRef(activeOrganization.id),
          }
        : null,
    [activeOrganization, canCreate, organizationRef, runtime.scope],
  );
  const offered = selectLocationChoice(
    useKnown(locationRequest === null ? null : runtime.cells.known(locationRequest)),
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
      birthId: generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes)),
      name,
      botName,
      face,
      locationId,
      // Every agent: an empty selection omits `ZCP_AGENTS` (`newProject.ts`).
      agents: [],
    };
    const isCurrent = captureAccountLifetime();
    let landed = false;
    // The first Mate needs no browser once its project is marked closed off: only then does the
    // dialog give way to its view. A tab closed before is the person's choice; *Finish setup*
    // completes it, in any browser.
    const land = () => {
      if (landed || !isCurrent()) return;
      landed = true;
      dismiss();
      void navigate(newProjectView(birthId));
    };
    const birthId = beginNewProjectBirth({
      ask,
      hq: officialHq(accountHq),
      now: Date.now(),
      ports: {
        registerGroup: async ({ hq, name: groupName }) => ({
          appId: (await accountHqApi(client, organizationId, hq).createApp(groupName)).id,
        }),
        recordBirth: ({ hq, ...birth }) =>
          accountHqApi(client, organizationId, hq).recordBirth(birth),
        // The project alone, born a Mate under its birth intent (its marker on before anything
        // else): its press attaches it to its application, then imports its container (F6b). In
        // flight as a press: the background mints no throwaway while it reads the token list.
        createProject: ({ name: projectName, location, birth }) =>
          whilePressing(() =>
            runZeropsCommand(
              runtime.commands.createProject({
                organization,
                name: projectName,
                tagList: withZeropsMateTag([mateBirthTag(birth)]),
                ...(location === undefined ? {} : { location }),
              }),
            ),
          ).then((project) => ({ project })),
        accepted: (projectId, { hq, appId, intent }, startedAt) => {
          // The press goes on: the Mate attached to its application in HQ, its container imported
          // and the project closed off. The listing is read again so the project's group catches
          // up with it. Its row stands where the creation's stood, with the same face and name.
          const placement = newProjectPlacement({ ...ask, appId });
          beginPress({
            projectId,
            organizationId,
            startedAt,
            container: true,
            placement,
          });
          invalidateZerops({ topic: "inventory", organization });
          void finishMateSetup({
            inputs: { client, data: { runtime, organizationRef, projectRef }, organizationId },
            projectId,
            projectName: placement.displayName,
            // After its attach: a press that stops before it leaves a Mate HQ holds in its
            // application, which any browser finishes under its name.
            container: { agents: ask.agents },
            registration: {
              hq,
              groupId: appId,
              kind: "mate",
              mate: { name: botName, face },
              birth: { standUp: false },
              intent,
            },
            hq,
            isCurrent,
            onProgress: (progress) => {
              setPressed((current) => (current === null ? current : { ...current, progress }));
              if (newProjectPressThrough(progress)) land();
            },
          }).then((outcome) => {
            if (outcome.ok) land();
          });
          // Who it is until the listing names it, as Add a Mate's are: its
          // view's face, name and stand-up.
          created({ projectId, groupId: appId, groupName: name, botName, face });
        },
      },
    });
    setPressed({ birthId, progress: null });
  };

  const failure = birth === undefined ? null : newProjectPressFailure(birth, pressStop(press));

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
      onOpenChange={(open) => {
        // Half way through a press there is nothing to close: the first Mate needs this tab a few
        // seconds more. A press that stopped may be left, for *Finish setup* to complete.
        if (!open && birth !== undefined && failure === null) return;
        onOpenChange(open);
      }}
      {...(birth === undefined || pressed === null
        ? {}
        : {
            pressing: {
              name: birth.botName,
              steps: newProjectPressSteps(birth, pressed.progress),
              ...(failure === null ? {} : { failed: failure.reason }),
              ...(failure?.tryAgain === "creation"
                ? { onTryAgain: () => retryNewProjectBirth(pressed.birthId) }
                : failure?.tryAgain === "press" && press?.state.kind === "failed"
                  ? { onTryAgain: tryAgain(press.state.retry) }
                  : {}),
            },
          })}
      proposeAnotherName={(current) =>
        generateBotName([...taken.names, current], (bytes) => crypto.getRandomValues(bytes))
      }
      takenBotNames={taken}
    />
  );
}

/** A press's stop, as the dialog reads it. */
function pressStop(press: MatePress | undefined) {
  if (press?.state.kind !== "failed") return null;
  return {
    kind: "failed" as const,
    reason: press.state.reason,
    retryable: press.state.retry !== null,
  };
}

function tryAgain(retry: (() => Promise<void>) | null): () => void {
  return () => {
    if (retry !== null) void retry();
  };
}
