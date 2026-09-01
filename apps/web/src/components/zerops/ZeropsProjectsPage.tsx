/**
 * `/zerops` — the project picker for a signed-in Zerops account, and the
 * "New project" path beside it (which is also what an exhausted pool falls
 * back to: create a project, import the container recipe, wait for it).
 */

import { useNavigate, useRouteContext } from "@tanstack/react-router";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  canCreateProjectsInOrganization,
  type ZeropsLocation,
  type ZeropsOrganization,
} from "@t3tools/client-runtime/zerops";

import { isElectron } from "../../env";
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
import {
  newestProvisioningCandidate,
  shouldAutoEnterProvisioning,
} from "@t3tools/client-runtime/zerops/autoEnterProvisioning";
import { normalizeOrigin, type ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { deriveProvisioningStart } from "@t3tools/client-runtime/zerops/registrationHandoff";
import { rememberZeropsEnvironment } from "~/zerops/firstPromptStorage";
import { useZeropsIdentityExchange } from "~/zerops/useZeropsIdentityExchange";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsCandidateHealth } from "~/zerops/useZeropsCandidateHealth";
import { useZeropsProvisioning } from "~/zerops/useZeropsProvisioning";
import {
  useZeropsSession,
  zeropsErrorMessage,
  type ZeropsSessionStatus,
} from "~/zerops/ZeropsSessionProvider";
import type { AuthGateState } from "~/environments/primary/auth";

import { MicroLabel } from "./primitives";
import { ZeropsProjectPicker } from "./ZeropsProjectPicker";
import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";
import { ZeropsProvisioningPanel } from "./ZeropsProvisioningPanel";

export function autoConnectServedZeropsEnvironment(input: {
  readonly attempted: { current: boolean };
  readonly status: ZeropsSessionStatus;
  readonly zeropsToken: string | null;
  readonly appOrigin: string;
  readonly authGate: AuthGateState;
  readonly candidates: ReadonlyArray<{
    readonly group: ZeropsCandidate["group"];
    readonly containerOrigin?: string;
    readonly connection?: { readonly phase: EnvironmentConnectionPhase };
  }>;
  readonly connect: (containerOrigin: string) => void;
}): void {
  if (
    input.attempted.current ||
    input.status !== "signed-in" ||
    !input.zeropsToken ||
    input.authGate.status !== "requires-auth" ||
    !input.authGate.auth.bootstrapMethods.includes("zerops-identity")
  ) {
    return;
  }
  const appOrigin = normalizeOrigin(input.appOrigin);
  const servedCandidate = input.candidates.find(
    (candidate) =>
      candidate.containerOrigin !== undefined &&
      normalizeOrigin(candidate.containerOrigin) === appOrigin,
  );
  if (
    appOrigin === null ||
    servedCandidate === undefined ||
    servedCandidate.group === "connected" ||
    servedCandidate.connection !== undefined
  ) {
    return;
  }

  input.attempted.current = true;
  input.connect(appOrigin);
}

export function retryZeropsProjectConnection(input: {
  readonly connectError: string | null;
  readonly readyOrigin: string | null;
  readonly retryIdentity: (containerOrigin: string) => void;
  readonly retryProvisioning: () => void;
}): void {
  if (input.connectError !== null && input.readyOrigin !== null) {
    input.retryIdentity(input.readyOrigin);
    return;
  }
  input.retryProvisioning();
}

function SignedOutNotice({ message }: { readonly message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

export function ZeropsProjectScopeHeader() {
  return (
    <div className="space-y-1" data-zerops-project-scope="true">
      <MicroLabel className="text-muted-foreground">Project scope</MicroLabel>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl font-medium text-foreground">Projects</h1>
        <p className="text-xs text-muted-foreground">
          Choose the Zerops project this workspace should open.
        </p>
      </div>
    </div>
  );
}

function NewProjectForm({
  organization,
  onCreate,
  busy,
  error,
}: {
  readonly organization: ZeropsOrganization;
  readonly onCreate: (input: {
    readonly clientId: string;
    readonly name: string;
    readonly location?: string;
  }) => void;
  readonly busy: boolean;
  readonly error: string | null;
}) {
  const { client } = useZeropsSession();
  const [name, setName] = useState("zerops-code");
  const [locations, setLocations] = useState<ReadonlyArray<ZeropsLocation>>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [locationError, setLocationError] = useState<string | null>(null);
  const canCreate = canCreateProjectsInOrganization(organization);

  useEffect(() => {
    if (!canCreate) {
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
      .listClientLocations(organization.id)
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
  }, [canCreate, client, organization.id]);

  if (!canCreate) {
    return (
      <section className="rounded-xl border border-border/55 bg-card/20 px-4 py-4">
        <h2 className="text-sm font-semibold text-foreground">Project creation is unavailable</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This membership can open assigned projects but cannot create a new one in{" "}
          {organization.name}.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-border/55 bg-card/20 px-4 py-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">New project</h2>
        <p className="text-xs text-muted-foreground">
          Creates a Zerops project with a Zerops Code container in it.
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
            busy ||
            name.trim().length === 0 ||
            locationStatus === "loading" ||
            locationStatus === "failed" ||
            (locations.length > 0 && !locationId)
          }
          onClick={() => {
            onCreate({
              clientId: organization.id,
              name,
              ...(locationId ? { location: locationId } : {}),
            });
          }}
        >
          {busy || locationStatus === "loading" ? <Spinner className="size-4" /> : null}
          Create project
        </Button>
        <span className="text-xs text-muted-foreground">in {organization.name}</span>
      </div>
      {locationError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          Could not load project locations. {locationError}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ZeropsProjectsContent() {
  const authGate = useRouteContext({
    from: "__root__",
    select: (context) => context.authGateState,
  });
  const {
    activeOrganization,
    client,
    clearLastRegistration,
    lastRegistration,
    organizations,
    organizationStatus,
    selectOrganization,
    status,
  } = useZeropsSession();
  const { candidates, isLoading, error, refresh } = useZeropsCandidates();
  const candidateHealth = useZeropsCandidateHealth(candidates);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [enablingCandidateKey, setEnablingCandidateKey] = useState<string | null>(null);
  const provisioning = useZeropsProvisioning(creatingIn);
  const exchangeZeropsIdentity = useZeropsIdentityExchange();
  const navigate = useNavigate();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectingOrigin, setConnectingOrigin] = useState<string | null>(null);
  // One connect per settled provisioning wait, however many renders that takes.
  const connectingRef = useRef<string | null>(null);
  // The server that served this page gets one automatic identity exchange.
  // A failed exchange stays manual so rerenders cannot hammer the door.
  const autoConnectingRef = useRef(false);
  // Entering the wait on its own happens at most once per mount: a dismissed
  // wait must never be reopened behind the user's back.
  const autoEnteredRef = useRef(false);

  const connectContainer = useCallback(
    async (containerOrigin: string) => {
      setConnectError(null);
      setConnectingOrigin(containerOrigin);
      try {
        const result = await exchangeZeropsIdentity(containerOrigin);
        if (result._tag === "Failure") {
          setConnectError(result.error);
          return;
        }
        provisioning.cancel();
        setCreatingIn(null);
        await navigate({ to: "/" });
      } finally {
        setConnectingOrigin(null);
      }
    },
    [exchangeZeropsIdentity, navigate, provisioning],
  );

  const startWaitFor = useCallback(
    (candidate: ZeropsCandidate) => {
      if (!candidate.containerOrigin) return;
      setConnectError(null);
      connectingRef.current = null;
      setCreatingIn(candidate.project.clientId ?? null);
      provisioning.startForContainer({
        projectId: candidate.project.id,
        serviceId: candidate.service?.id ?? null,
        containerOrigin: candidate.containerOrigin,
      });
    },
    [provisioning],
  );

  const readyOrigin =
    provisioning.state?.phase === "ready" ? provisioning.state.containerOrigin : null;

  const retryProjectConnection = useCallback(() => {
    retryZeropsProjectConnection({
      connectError,
      readyOrigin,
      retryIdentity: (containerOrigin) => {
        void connectContainer(containerOrigin);
      },
      retryProvisioning: provisioning.retry,
    });
  }, [connectContainer, connectError, provisioning.retry, readyOrigin]);

  useEffect(() => {
    if (!readyOrigin || connectingRef.current === readyOrigin) return;
    connectingRef.current = readyOrigin;
    void connectContainer(readyOrigin);
  }, [connectContainer, readyOrigin]);

  useEffect(() => {
    autoConnectServedZeropsEnvironment({
      attempted: autoConnectingRef,
      status,
      zeropsToken: client.session?.accessToken ?? null,
      appOrigin: window.location.origin,
      authGate,
      candidates,
      connect: (containerOrigin) => {
        void connectContainer(containerOrigin);
      },
    });
  }, [authGate, candidates, client.session?.accessToken, connectContainer, status]);

  // Enters the provisioning wait without the user clicking anything, for the
  // two-hop registration flow: sign in here with nothing connected yet, but a
  // pool-claimed project already on its way in.
  useEffect(() => {
    if (autoEnteredRef.current || creatingIn) return;

    // The registration response is the platform's own word on what it
    // claimed — preferred over inferring it from a candidate's status.
    if (lastRegistration) {
      autoEnteredRef.current = true;
      const { clientId, zcpClaimed } = deriveProvisioningStart(lastRegistration);
      clearLastRegistration();
      if (clientId) {
        setCreatingIn(clientId);
        provisioning.start(zcpClaimed === undefined ? {} : { zcpClaimed });
      }
      return;
    }

    // Otherwise, wait for the first candidate load and fall back to reading
    // it off the candidate list — the plain sign-in path.
    if (isLoading) return;
    if (!shouldAutoEnterProvisioning(candidates)) return;
    const target = newestProvisioningCandidate(candidates);
    if (!target) return;
    autoEnteredRef.current = true;
    setCreatingIn(target.project.clientId ?? null);
    provisioning.start({ zcpClaimed: true });
  }, [candidates, clearLastRegistration, creatingIn, isLoading, lastRegistration, provisioning]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking your Zerops session…
      </div>
    );
  }
  if (status === "signed-out") {
    return <SignedOutNotice message="Sign in with your Zerops account to see your projects." />;
  }
  if (status === "totp-required") {
    return <SignedOutNotice message="Finish signing in with your two-factor code." />;
  }

  if (organizationStatus !== "selected" || !activeOrganization) {
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
            provisioning.cancel();
            setCreatingIn(null);
            refresh();
          }}
        >
          {provisioning.state.phase === "ready" ||
          provisioning.state.phase === "not-yet-available" ||
          (provisioning.state.phase === "timed-out" &&
            provisioning.state.expiredPhase === "awaiting-health" &&
            provisioning.state.enabled)
            ? "Back to projects"
            : "Stop waiting"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ZeropsOrganizationScope
        activeOrganization={activeOrganization}
        organizations={organizations}
        status={organizationStatus}
        onSelect={(membershipId) => {
          void selectOrganization(membershipId);
        }}
      />
      <ZeropsProjectPicker
        busyCandidateKeys={
          enablingCandidateKey === null ? undefined : new Set([enablingCandidateKey])
        }
        candidates={candidates}
        scopeName={activeOrganization.name}
        isLoading={isLoading}
        error={connectError ?? error}
        onRefresh={refresh}
        health={candidateHealth}
        onConnect={startWaitFor}
        onOpen={(candidate: ZeropsCandidate) => {
          if (candidate.environmentId) {
            rememberZeropsEnvironment(String(candidate.environmentId));
          }
          void navigate({ to: "/" });
        }}
        onWait={(candidate: ZeropsCandidate) => {
          if (candidate.containerOrigin) {
            startWaitFor(candidate);
            return;
          }
          setConnectError(null);
          setCreatingIn(candidate.project.clientId ?? null);
          provisioning.start({ zcpClaimed: true });
        }}
        onEnable={(candidate: ZeropsCandidate) => {
          const serviceId = candidate.service?.id;
          if (!serviceId) return;
          setConnectError(null);
          setEnablingCandidateKey(candidate.key);
          // Write the flag, then restart: the install step re-runs on boot and
          // comes back with the current zcp, which only installs Zerops Code
          // when it finds ZCP_Z3_ENABLED set. A restart on its own returns the
          // container to the identical state.
          void client
            .enableZeropsCode(serviceId)
            .then(() => {
              startWaitFor(candidate);
            })
            .catch((cause: unknown) => {
              setConnectError(zeropsErrorMessage(cause));
            })
            .finally(() => {
              setEnablingCandidateKey(null);
            });
        }}
      />
      <NewProjectForm
        organization={activeOrganization}
        busy={creating}
        error={createError}
        onCreate={({ clientId, location, name }) => {
          setCreating(true);
          setCreateError(null);
          void client
            .createProjectWithZeropsCode({ clientId, name, ...(location ? { location } : {}) })
            .then(() => {
              setCreatingIn(clientId);
              provisioning.start({ zcpClaimed: true });
            })
            .catch((cause: unknown) => {
              setCreateError(zeropsErrorMessage(cause));
            })
            .finally(() => {
              setCreating(false);
            });
        }}
      />
    </div>
  );
}

export function ZeropsProjectsPage() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
            <WorkspaceBreadcrumbItem current>Zerops</WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            <ZeropsProjectScopeHeader />
            <ZeropsProjectsContent />
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
