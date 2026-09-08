import { ZeropsApiError, type ZeropsLocation } from "@t3tools/client-runtime/zerops";
/**
 * `/zerops/new` — creates a Zerops project with a Zerops Mate container in
 * it, in the shape of the platform's own "add project" flow: scope (skipped
 * for a single membership) → project (name + location) → agents → wait.
 *
 * The wait itself — polling, the ready → connect identity exchange, retry —
 * is `useZeropsProjectConnection` from `ZeropsProjectsPage`, shared with the
 * picker page rather than duplicated here.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import type { OrganizationLocationsResourceRequest } from "@t3tools/client-runtime/zerops/data";
import { useEffect, useMemo, useState } from "react";

import {
  canCreateProjectsInOrganization,
  generateBotName,
  generateZeropsGroupId,
  type ZeropsAgentType,
  type ZeropsEnvironmentRole,
  type ZeropsOrganization,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { rememberCreationHandoff } from "~/zerops/creationHandoffStorage";
import { runZeropsCommand, useZeropsData, useZeropsResource } from "~/zerops/zeropsDataContext";

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
import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";
import { ZeropsProvisioningPanel } from "./ZeropsProvisioningPanel";
import { useZeropsProjectConnection } from "./ZeropsProjectsPage";
import {
  ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION,
  ZeropsNewProjectAgents,
} from "./ZeropsNewProjectAgents";

type ZeropsNewProjectStep = "project" | "agents";

const EMPTY_LOCATIONS: ReadonlyArray<ZeropsLocation> = [];

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

function isUncertainCreateFailure(cause: unknown): boolean {
  if (cause instanceof ZeropsApiError) return cause.kind === "uncertain";
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ZeropsDataAdapterError" &&
    "kind" in cause &&
    cause.kind === "uncertain"
  );
}

/**
 * Runs the create call and reports which way it went. Kept free of React so
 * the create → wait / create → error branch is directly testable, and the
 * component only wires it to state.
 */
export async function submitZeropsNewProject(input: {
  readonly createProject: (args: {
    readonly clientId: string;
    readonly name: string;
    readonly location?: string;
    readonly agents?: ReadonlyArray<ZeropsAgentType>;
    readonly group?: {
      readonly groupId: string;
      readonly role?: ZeropsEnvironmentRole;
      readonly label?: string;
    };
    readonly botName?: string;
  }) => Promise<{ readonly project: ZeropsProject; readonly serviceName: string }>;
  readonly clientId: string;
  readonly name: string;
  readonly locationId: string | null;
  readonly agents: ReadonlyArray<ZeropsAgentType>;
  /** The group this project starts as, and the name of the Mate in it. */
  readonly groupId: string;
  readonly botName: string;
  readonly onStartWaiting: (clientId: string) => void;
  /**
   * The project exists. Called before the wait starts, so what this project is
   * for can be written down while its id is in hand (`creationHandoff.ts`).
   */
  readonly onCreated?: (projectId: string) => void;
  readonly onError: (message: string) => void;
  readonly onUncertain?: () => void;
}): Promise<void> {
  const groupName = input.name.trim();
  try {
    const created = await input.createProject({
      clientId: input.clientId,
      // A project IS a group, and what is created inside it is its first dev
      // environment — so the environment carries the role in its name, the way
      // every environment added afterwards does.
      name: `${groupName} - dev`,
      ...(input.locationId ? { location: input.locationId } : {}),
      agents: input.agents,
      group: { groupId: input.groupId, role: "dev", label: groupName },
      botName: input.botName,
    });
    input.onCreated?.(created.project.id);
    input.onStartWaiting(input.clientId);
  } catch (cause) {
    if (isUncertainCreateFailure(cause)) input.onUncertain?.();
    input.onError(zeropsErrorMessage(cause));
  }
}

/**
 * The wait's only exit, whatever phase it settles or times out in: cancel it
 * and return to the project list. `provisioning.state` is non-null only
 * AFTER a create already succeeded, so — unlike the picker page, which can
 * legitimately have nothing to create yet — there is no phase here that
 * should exit back into an armed create step. Re-arming "Create project"
 * from the agents step would create a SECOND project for the same account.
 */
export function exitZeropsNewProjectWait(input: {
  readonly cancel: () => void;
  readonly clearCreatingIn: () => void;
  readonly navigateToProjects: () => void;
}): void {
  input.cancel();
  input.clearCreatingIn();
  input.navigateToProjects();
}

function ZeropsNewProjectContent() {
  const { activeOrganization, organizationStatus, organizations, selectOrganization, status } =
    useZeropsSession();
  const { organizationRef, runtime } = useZeropsData();
  const navigate = useNavigate();
  const {
    provisioning,
    connectError,
    upgradeRecovery,
    serverVersion,
    connectingOrigin,
    retryProjectConnection,
    setCreatingIn,
  } = useZeropsProjectConnection(activeOrganization?.id ?? null);

  const [step, setStep] = useState<ZeropsNewProjectStep>("project");
  const [name, setName] = useState("zerops-mate");
  const [locationChoice, setLocationChoice] = useState<{
    readonly key: string;
    readonly id: string;
  } | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<ReadonlyArray<ZeropsAgentType>>(
    ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION,
  );
  const [creating, setCreating] = useState(false);
  const [createUncertain, setCreateUncertain] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const canCreate = activeOrganization
    ? canCreateProjectsInOrganization(activeOrganization)
    : false;
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
  const locationResource = useZeropsResource(locationRequest);
  const locations =
    locationResource.status === "success" ? locationResource.value : EMPTY_LOCATIONS;
  const locationKey = activeOrganization?.id ?? "";
  const locationId =
    locationChoice?.key === locationKey &&
    locations.some((location) => location.id === locationChoice.id)
      ? locationChoice.id
      : (locations[0]?.id ?? null);
  const locationStatus =
    !activeOrganization || !canCreate
      ? "ready"
      : locationResource.status === "success"
        ? "ready"
        : locationResource.status === "failure"
          ? "failed"
          : "loading";
  const locationError =
    locationResource.status === "failure" ? "Try again from the projects page." : null;

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
        <Spinner className="size-4" />
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

  if (!canCreate) {
    return (
      <section className="rounded-xl border border-border/55 bg-card/20 px-4 py-4">
        <h2 className="text-sm font-semibold text-foreground">Project creation is unavailable</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This membership can open assigned projects but cannot create a new one in{" "}
          {activeOrganization.name}.
        </p>
      </section>
    );
  }

  if (provisioning.state) {
    return (
      <div className="space-y-4">
        <ZeropsProvisioningPanel
          state={provisioning.state}
          busy={provisioning.busy || connectingOrigin !== null}
          error={connectError ?? provisioning.error}
          onRetry={retryProjectConnection}
          onEnable={provisioning.enable}
          upgradeRecovery={upgradeRecovery}
          serverVersion={serverVersion}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            exitZeropsNewProjectWait({
              cancel: provisioning.cancel,
              clearCreatingIn: () => {
                setCreatingIn(null);
              },
              navigateToProjects: () => {
                void navigate({ to: "/zerops" });
              },
            });
          }}
        >
          Back to projects
        </Button>
      </div>
    );
  }

  const createProject = () => {
    setCreating(true);
    setCreateError(null);
    void submitZeropsNewProject({
      createProject: ({ clientId: _clientId, ...args }) =>
        runZeropsCommand(
          runtime.commands.createProjectWithMate({
            organization: organizationRef(activeOrganization.id),
            ...args,
          }),
        ),
      clientId: activeOrganization.id,
      name,
      locationId,
      agents: selectedAgents,
      groupId: generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes)),
      botName: generateBotName([], (bytes) => crypto.getRandomValues(bytes)),
      onCreated: (projectId) => {
        // The first Mate of a project is the one that most needs a job: there
        // is nothing in the environment yet, and setting that up is the whole
        // reason it exists.
        rememberCreationHandoff(projectId, {
          environmentName: `${name.trim()} - dev`,
          groupName: name.trim(),
          role: "dev",
          source: { kind: "none" },
        });
      },
      onStartWaiting: (clientId) => {
        setCreatingIn(clientId);
        provisioning.start({ zcpClaimed: true });
      },
      onError: setCreateError,
      onUncertain: () => setCreateUncertain(true),
    }).finally(() => {
      setCreating(false);
    });
  };

  return (
    <div className="space-y-6" data-zerops-new-project-step={step}>
      {step === "project" ? (
        <section className="space-y-3 rounded-xl border border-border/55 bg-card/20 px-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="zerops-new-project">Name</Label>
            <Input
              id="zerops-new-project"
              value={name}
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
                  if (value !== null) setLocationChoice({ key: locationKey, id: value });
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
              <p className="text-xs text-muted-foreground">
                The lowest-latency location is preselected. You can choose another region.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={
                name.trim().length === 0 ||
                locationStatus === "loading" ||
                locationStatus === "failed" ||
                (locations.length > 0 && !locationId)
              }
              onClick={() => {
                setStep("agents");
              }}
            >
              {locationStatus === "loading" ? <Spinner className="size-4" /> : null}
              Continue
            </Button>
            <span className="text-xs text-muted-foreground">in {activeOrganization.name}</span>
          </div>
          {locationError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
              Could not load project locations. {locationError}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="space-y-4 rounded-xl border border-border/55 bg-card/20 px-4 py-4">
          <ZeropsNewProjectAgents
            selected={selectedAgents}
            onChange={setSelectedAgents}
            disabled={creating}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={creating}
              onClick={() => {
                setStep("project");
              }}
            >
              Back
            </Button>
            <Button size="sm" disabled={creating || createUncertain} onClick={createProject}>
              {creating ? <Spinner className="size-4" /> : null}
              Create project
            </Button>
          </div>
          {createError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
              {createError}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

export function ZeropsNewProjectWizard() {
  return (
    <ZeropsHostedFrame
      actions={<ZeropsSessionAccountControl />}
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
      <div className="space-y-1" data-zerops-project-scope="true">
        <h1 className="text-xl font-medium text-foreground">New project</h1>
        <p className="text-sm text-muted-foreground">
          A project, with its first Mate in it. More Mates, a stage and a production come later,
          from here.
        </p>
      </div>
      <ZeropsNewProjectContent />
    </ZeropsHostedFrame>
  );
}
