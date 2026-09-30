/**
 * `/zerops/new` — *Add project*: a group, and its first Mate (guide 4.1, 4.2).
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
 * the account. The Mate is born as *New Mate* makes one: its face on its
 * project, and asking, on behalf of the person who made it, for the project's
 * development to be stood up, which their first sign-in sends
 * (`mateStandUp.ts`). No brief and no agent pick: the container offers every
 * agent when `ZCP_AGENTS` is absent, which an empty selection is
 * (`newProject.ts`).
 *
 * ## One step
 *
 * Create lands the person on the first Mate's own view at once, as Add a Mate
 * does, with the project and the Mate in the left menu from the press
 * (`newProjectBirth.ts`, the owner, 2026-09-30): Git hosting where the account
 * has none, the project's registry entry and the Mate's project are its
 * progress's first steps, and a step that stops says why there, with *Try
 * again*. The rest is the Mate's birth (`zeropsBirths.ts`, DESIGN §4.5), begun
 * the moment the platform accepts its project: its registry entry, the
 * broker's grant, its harden and its health are the account's birth worker's,
 * so a reload, an organization switch or leaving the page never strands them.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import {
  selectLocationChoice,
  type OrganizationLocationsResourceRequest,
} from "@t3tools/client-runtime/zerops/data";
import {
  heldCandidates,
  takenBotNames,
  type TakenBotNames,
} from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  generateBotName,
  generateZeropsGroupId,
  newMateTint,
  resolveAddProjectVerb,
  type ZeropsMateFace,
  type ZeropsOrganization,
  toolProjectName,
} from "@t3tools/client-runtime/zerops";

import { cn } from "~/lib/utils";
import { useAccountGitea } from "~/zerops/giteaProject";
import { useNewMate } from "~/zerops/newMate";
import {
  beginNewProjectBirth,
  newProjectPlacement,
  newProjectView,
  type NewProjectAsk,
} from "~/zerops/newProjectBirth";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { creationAccepted } from "~/zerops/zeropsBirths";
import { runZeropsCommand, useKnown, useZeropsData } from "~/zerops/zeropsDataContext";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import type { ZeropsOrganizationStatus } from "~/zerops/ZeropsSessionProvider";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { MateFacePicker } from "./MateFacePicker";
import {
  faceName,
  newMateFace,
  newMateSubmit,
  newMateWords,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";

const CARD_CLASS = "rounded-[var(--zerops-card-radius)] border border-border/60 bg-card";

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

function ZeropsNewProjectContent() {
  const {
    activeOrganization,
    organizationStatus,
    organizations,
    selectOrganization,
    status,
    user,
  } = useZeropsSession();
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
  const locationError = offered.status === "failed" ? "Try again from the projects page." : null;

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

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="md" />
        Checking your Zerops session…
      </div>
    );
  }
  if (status === "signed-out") {
    return (
      <p className="text-sm text-muted-foreground">
        Sign in with your Zerops account to create a project.
      </p>
    );
  }
  if (status === "totp-required") {
    return (
      <p className="text-sm text-muted-foreground">Finish signing in with your two-factor code.</p>
    );
  }

  if (
    !activeOrganization ||
    zeropsNewProjectScopeStepVisible({ organizationStatus, activeOrganization })
  ) {
    return (
      <ZeropsOrganizationScope
        organizations={organizations}
        status={organizationStatus}
        onSelect={(membershipId) => {
          void selectOrganization(membershipId);
        }}
      />
    );
  }

  if (!addProject.offered) {
    return (
      <section className={`max-w-xl px-5 py-4 ${CARD_CLASS}`}>
        <h2 className="text-sm font-semibold text-foreground">Nothing to add here</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {addProject.reason} You can open every project of {activeOrganization.name} you have been
          given.
        </p>
      </section>
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
    // Its first Mate's own view, at once: the project and the Mate come up there.
    void navigate(newProjectView(birthId));
  };

  return (
    <ZeropsNewProjectForm
      creating={creating}
      defaultBotName={defaultBotName}
      defaultTintFor={(botName) => newMateTint(candidates, botName)}
      locationError={locationError}
      locationId={locationId}
      locationLoading={locationStatus === "loading"}
      locations={locations}
      onCreate={createProject}
      onLocation={(id) => {
        setLocationChoice({ key: locationKey, id });
      }}
      takenBotNames={taken}
    />
  );
}

/** What the form hands over: the project's name, its first Mate's, and the Mate's face. */
export interface NewProjectChoice {
  readonly name: string;
  readonly botName: string;
  readonly face: ZeropsMateFace;
}

export interface ZeropsNewProjectFormProps {
  /** The platform's locations; only more than one is a choice to offer. */
  readonly locations: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly locationId: string | null;
  readonly onLocation: (id: string) => void;
  /** The locations are still being read: the button waits, with a spinner. */
  readonly locationLoading: boolean;
  /** Why the locations could not be read; `null` when they were. */
  readonly locationError: string | null;
  /** The first Mate's name proposed, free on the account (`generateBotName`). */
  readonly defaultBotName: string;
  /** The account's Mates' names, and whether the listing read them all (`takenBotNames`). */
  readonly takenBotNames: TakenBotNames;
  /** The tint the account gives a new Mate of this name (`newMateTint`). */
  readonly defaultTintFor: (name: string) => MateTintId;
  /** Create was pressed: its first Mate's view is on its way, and a second press makes nothing. */
  readonly creating: boolean;
  readonly onCreate: (choice: NewProjectChoice) => void;
}

/**
 * The project's name, and its first Mate: a name, a colour and a shape, beside the face they
 * make — the picker and the rules *New Mate* uses. Until its person picks, the face follows the
 * name as it is typed (the tint the account would give it, and that tint's shape); a pick sticks.
 * A name that will not do is said beside the button once it is pressed; while the account's
 * Mates' names are still being read, the button waits and says so.
 */
export function ZeropsNewProjectForm({
  locations,
  locationId,
  onLocation,
  locationLoading,
  locationError,
  defaultBotName,
  takenBotNames: taken,
  defaultTintFor,
  creating,
  onCreate,
}: ZeropsNewProjectFormProps) {
  const [name, setName] = useState("");
  const [botName, setBotName] = useState(defaultBotName);
  // The last name typed: a blank field keeps the face it had rather than flashing another.
  const [heldName, setHeldName] = useState(defaultBotName);
  const [picked, setPicked] = useState<{
    readonly tint?: MateTintId | undefined;
    readonly shape?: MateShapeId | undefined;
  }>({});
  // Create was pressed: from then on what is wrong with the Mate's name is said, as it is typed.
  const [pressed, setPressed] = useState(false);
  const [selected, setSelected] = useState(false);

  const face = newMateFace({
    name: faceName(botName, heldName),
    picked,
    defaultTint: defaultTintFor,
  });
  // A new project has no recipe to wait on: only the name, new on the account.
  const submit = newMateSubmit({
    botName,
    takenBotNames: taken,
    tier: undefined,
    tierLoading: false,
  });
  const error = pressed && submit.kind === "refuse" ? submit.error : undefined;
  const line =
    error ??
    newMateWords({
      groupName: name,
      botName,
      recipe: "none",
      waitingOn: submit.kind === "wait" ? submit.on : null,
    }).line;

  const press = () => {
    setPressed(true);
    if (submit.kind !== "create") return;
    onCreate({ name: name.trim(), botName: botName.replace(/\s+/g, " ").trim(), face });
  };

  return (
    <section className={`max-w-xl space-y-4 px-5 py-5 ${CARD_CLASS}`}>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-new-project">Name</Label>
        <Input
          id="zerops-new-project"
          value={name}
          placeholder="Acme CRM"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      {locations.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="zerops-new-project-location">Location</Label>
          <Select
            value={locationId}
            onValueChange={(value) => {
              if (value !== null) onLocation(value);
            }}
          >
            <SelectTrigger id="zerops-new-project-location" aria-label="Project location">
              <SelectValue placeholder="Choose a location">
                {locations.find((location) => location.id === locationId)?.name ??
                  "Choose a location"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="zerops-new-project-mate">First Mate</Label>
        <MateFacePicker
          face={face}
          onPickShape={(shape) => {
            setPicked((current) => ({ ...current, shape }));
          }}
          onPickTint={(tint) => {
            setPicked((current) => ({ ...current, tint }));
          }}
        >
          <Input
            aria-describedby="zerops-new-project-line"
            aria-invalid={error === undefined ? undefined : true}
            autoComplete="off"
            id="zerops-new-project-mate"
            onChange={(event) => {
              const typed = event.target.value;
              setBotName(typed);
              const typedName = typed.replace(/\s+/g, " ").trim();
              if (typedName.length > 0) setHeldName(typedName);
            }}
            onFocus={(event) => {
              // The proposed name is taken whole by the first key typed over it.
              if (selected) return;
              setSelected(true);
              event.currentTarget.select();
            }}
            placeholder="Name"
            spellCheck={false}
            value={botName}
          />
        </MateFacePicker>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          data-zerops-new-project="create"
          disabled={
            creating ||
            name.trim().length === 0 ||
            locationLoading ||
            locationError !== null ||
            (locations.length > 0 && !locationId) ||
            submit.kind === "wait"
          }
          onClick={press}
        >
          {creating || locationLoading ? <Spinner size="md" /> : null}
          Create project
        </Button>
        {/* The one quiet line, beside the button it is about: what it waits on, or why the
            Mate's name will not do. */}
        <p
          aria-live="polite"
          className={cn(
            "min-h-4 text-line leading-4",
            error === undefined ? "text-muted-foreground" : "text-status-failed-text",
          )}
          id="zerops-new-project-line"
        >
          {line}
        </p>
      </div>
      {locationError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          Could not load project locations. {locationError}
        </p>
      ) : null}
    </section>
  );
}

/** The page around the form: its breadcrumb, its one line, and the bar's right side. */
export function ZeropsNewProjectFrame({
  actions,
  children,
}: {
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <ZeropsHostedFrame
      actions={actions}
      breadcrumb={
        <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
          <WorkspaceBreadcrumbItem>
            <Link className="hover:text-foreground" to="/zerops">
              Projects
            </Link>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current>New project</WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      }
    >
      <p className="text-sm text-muted-foreground" data-zerops-project-scope="true">
        Name it and its first Mate. The Mate is up in a few minutes, with Git hosting alongside.
      </p>
      {children}
    </ZeropsHostedFrame>
  );
}

export function ZeropsNewProjectWizard() {
  return (
    <ZeropsNewProjectFrame actions={<ZeropsSessionAccountControl />}>
      <ZeropsNewProjectContent />
    </ZeropsNewProjectFrame>
  );
}
