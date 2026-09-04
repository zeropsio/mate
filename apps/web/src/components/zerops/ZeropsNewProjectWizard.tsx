/**
 * `/zerops/new` — creates a Zerops project with a Zerops Mate container in
 * it, in the shape of the platform's own "add project" flow: scope (skipped
 * for a single membership) → project (name + location) → agents → wait.
 *
 * The wait itself — polling, the ready → connect identity exchange, retry —
 * is `useZeropsProjectConnection` from `ZeropsProjectsPage`, shared with the
 * picker page rather than duplicated here.
 */

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  canCreateProjectsInOrganization,
  type ZeropsAgentType,
  type ZeropsLocation,
  type ZeropsOrganization,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { isElectron } from "../../env";
import type { ZeropsOrganizationStatus } from "~/zerops/ZeropsSessionProvider";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { MicroLabel } from "./primitives";
import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";
import { ZeropsProvisioningPanel } from "./ZeropsProvisioningPanel";
import { useZeropsProjectConnection } from "./ZeropsProjectsPage";
import {
  ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION,
  ZeropsNewProjectAgents,
} from "./ZeropsNewProjectAgents";

type ZeropsNewProjectStep = "project" | "agents";

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
  }) => Promise<{ readonly project: ZeropsProject; readonly serviceName: string }>;
  readonly clientId: string;
  readonly name: string;
  readonly locationId: string | null;
  readonly agents: ReadonlyArray<ZeropsAgentType>;
  readonly onStartWaiting: (clientId: string) => void;
  readonly onError: (message: string) => void;
}): Promise<void> {
  try {
    await input.createProject({
      clientId: input.clientId,
      name: input.name,
      ...(input.locationId ? { location: input.locationId } : {}),
      agents: input.agents,
    });
    input.onStartWaiting(input.clientId);
  } catch (cause) {
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
  const {
    activeOrganization,
    client,
    organizationStatus,
    organizations,
    selectOrganization,
    status,
  } = useZeropsSession();
  const navigate = useNavigate();
  const { provisioning, connectError, connectingOrigin, retryProjectConnection, setCreatingIn } =
    useZeropsProjectConnection(activeOrganization?.id ?? null);

  const [step, setStep] = useState<ZeropsNewProjectStep>("project");
  const [name, setName] = useState("zerops-mate");
  const [locations, setLocations] = useState<ReadonlyArray<ZeropsLocation>>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<ReadonlyArray<ZeropsAgentType>>(
    ZEROPS_NEW_PROJECT_AGENTS_DEFAULT_SELECTION,
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const canCreate = activeOrganization
    ? canCreateProjectsInOrganization(activeOrganization)
    : false;

  useEffect(() => {
    if (!activeOrganization || !canCreate) {
      setLocations([]);
      setLocationId(null);
      setLocationError(null);
      setLocationStatus("ready");
      return;
    }
    let cancelled = false;
    setLocations([]);
    setLocationId(null);
    setLocationError(null);
    setLocationStatus("loading");
    void client
      .listClientLocations(activeOrganization.id)
      .then((available) => {
        if (cancelled) return;
        setLocations(available);
        setLocationId(available[0]?.id ?? null);
        setLocationStatus("ready");

        if (available.length <= 1) return;
        // Match the Zerops GUI's default: measure all locations in parallel
        // and preselect the lowest observed latency. The choice remains
        // explicit and editable; failed probes keep the first API location.
        void Promise.all(
          available.map(async (location) => {
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
          if (fastest) setLocationId(fastest.id);
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLocationStatus("failed");
        setLocationError(zeropsErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganization, canCreate, client]);

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
        activeOrganization={activeOrganization}
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
      createProject: (args) => client.createProjectWithZeropsMate(args),
      clientId: activeOrganization.id,
      name,
      locationId,
      agents: selectedAgents,
      onStartWaiting: (clientId) => {
        setCreatingIn(clientId);
        provisioning.start({ zcpClaimed: true });
      },
      onError: setCreateError,
    }).finally(() => {
      setCreating(false);
    });
  };

  return (
    <div className="space-y-6" data-zerops-new-project-step={step}>
      {step === "project" ? (
        <section className="space-y-3 rounded-xl border border-border/55 bg-card/20 px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">New project</h2>
            <p className="text-xs text-muted-foreground">
              Creates a Zerops project with a Zerops Mate container in it.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zerops-new-project">Project name</Label>
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
                  setLocationId(value);
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
            <Button size="sm" disabled={creating} onClick={createProject}>
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
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
            <WorkspaceBreadcrumbItem>Zerops</WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbItem current>New project</WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            <div className="space-y-1" data-zerops-project-scope="true">
              <MicroLabel className="text-muted-foreground">New project</MicroLabel>
              <h1 className="text-xl font-medium text-foreground">Create a Zerops project</h1>
            </div>
            <ZeropsNewProjectContent />
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
