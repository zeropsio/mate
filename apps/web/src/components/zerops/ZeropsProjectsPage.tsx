/**
 * `/zerops` — the project picker for a signed-in Zerops account: an existing
 * candidate to connect to or wait on, and a way to `/zerops/new` (also where
 * an exhausted pool falls back to, since that phase has nothing ready-made to
 * pick). Creating a project happens at that route, not here.
 */

import { useNavigate, useRouteContext } from "@tanstack/react-router";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RotateCcwIcon } from "lucide-react";

import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
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
import { rememberEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { deriveProvisioningStart } from "@t3tools/client-runtime/zerops/registrationHandoff";
import { rememberZeropsEnvironment } from "~/zerops/firstPromptStorage";
import { browserZeropsStorage } from "~/zerops/storage";
import { useZeropsIdentityExchange } from "~/zerops/useZeropsIdentityExchange";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsCandidateHealth } from "~/zerops/useZeropsCandidateHealth";
import { useZeropsProvisioning } from "~/zerops/useZeropsProvisioning";
import { useZeropsSession, type ZeropsSessionStatus } from "~/zerops/ZeropsSessionProvider";
import type { AuthGateState } from "~/environments/primary/auth";

import {
  buildZeropsGroupTree,
  defaultAgentForRole,
  generateBotName,
  planEnvironmentCreation,
  readZeropsGroupTags,
  runEnvironmentCreation,
  type EnvironmentCreationStepProgress,
  type ZeropsEnvironmentRole,
} from "@t3tools/client-runtime/zerops";
import { refreshZeropsCandidates } from "~/zerops/candidatesRefresh";
import { zeropsRecipeStore } from "~/zerops/recipeStore";

import { MicroLabel, Pill, StatusDot } from "./primitives";
import { ZeropsEnvironmentCreation } from "./ZeropsEnvironmentCreation";
import { ZeropsGroupTree } from "./ZeropsGroupTree";
import { environmentRoleLabel } from "./ZeropsGroupTree.logic";
import {
  deriveZeropsRowAction,
  deriveZeropsRowPresentation,
  isZeropsToolCandidate,
  type ZeropsRowAction,
  type ZeropsRowInput,
} from "./ZeropsProjectRow.logic";
import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";
import { ZeropsProvisioningPanel } from "./ZeropsProvisioningPanel";

/** One creation in flight, or just finished, on this screen. */
interface EnvironmentCreationView {
  readonly name: string;
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress>;
  readonly outcome?: NonNullable<React.ComponentProps<typeof ZeropsEnvironmentCreation>["outcome"]>;
}

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
      <MicroLabel className="text-muted-foreground">Zerops</MicroLabel>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl font-medium text-foreground">Environments</h1>
        <p className="text-xs text-muted-foreground">
          Every project in the account, the agent in each one, and what it needs next.
        </p>
      </div>
    </div>
  );
}

/**
 * The wait → connect machinery shared by this page (waiting on an existing
 * candidate) and the `/zerops/new` wizard (waiting on the project it just
 * created — the only project-creating caller). Everything before "start
 * waiting" — picking a candidate, filling in the create form — is
 * caller-specific and stays with the caller.
 */
/**
 * @param orgId The organization scope this connection runs in, so a
 * successful exchange can remember which project and organization the new
 * environment resolves to (`environmentProjectRef.ts`, source `"connect"`) —
 * the client-side service map has no other way to learn this once the read
 * moves off the mate server. `null` while the scope is not yet resolved
 * simply skips remembering; the environment falls back to the one-time
 * origin match later.
 */
export function useZeropsProjectConnection(orgId: string | null): {
  readonly creatingIn: string | null;
  readonly setCreatingIn: (clientId: string | null) => void;
  readonly provisioning: ReturnType<typeof useZeropsProvisioning>;
  readonly connectError: string | null;
  readonly setConnectError: (error: string | null) => void;
  readonly connectingOrigin: string | null;
  readonly retryProjectConnection: () => void;
  readonly connectContainer: (containerOrigin: string) => Promise<void>;
  /** Forgets the last container this hook auto-connected to, so starting a
   * fresh wait that settles back on that same origin connects again instead
   * of being read as already handled. */
  readonly resetConnectingTarget: () => void;
} {
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const provisioning = useZeropsProvisioning(creatingIn);
  const exchangeZeropsIdentity = useZeropsIdentityExchange();
  const navigate = useNavigate();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectingOrigin, setConnectingOrigin] = useState<string | null>(null);
  // One connect per settled provisioning wait, however many renders that takes.
  const connectingRef = useRef<string | null>(null);

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
        // The environment is real now. When the lists last reloaded — right
        // after the creation writes — the project was still NEW with no
        // container, which the left menu rightly leaves out; here it is ACTIVE
        // with a zcp, so every mounted list reloads and the row appears.
        refreshZeropsCandidates();
        const projectId = provisioning.state?.projectId;
        if (projectId && orgId) {
          await rememberEnvironmentProjectRef(browserZeropsStorage, result.environmentId, {
            projectId,
            orgId,
            source: "connect",
          });
        }
        provisioning.cancel();
        setCreatingIn(null);
        await navigate({ to: "/", search: { environmentId: String(result.environmentId) } });
      } finally {
        setConnectingOrigin(null);
      }
    },
    [exchangeZeropsIdentity, navigate, orgId, provisioning],
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

  const resetConnectingTarget = useCallback(() => {
    connectingRef.current = null;
  }, []);

  return {
    creatingIn,
    setCreatingIn,
    provisioning,
    connectError,
    setConnectError,
    connectingOrigin,
    retryProjectConnection,
    connectContainer,
    resetConnectingTarget,
  };
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
  const {
    creatingIn,
    setCreatingIn,
    provisioning,
    connectError,
    setConnectError,
    connectingOrigin,
    retryProjectConnection,
    connectContainer,
    resetConnectingTarget,
  } = useZeropsProjectConnection(activeOrganization?.id ?? null);
  const [enablingCandidateKey, setEnablingCandidateKey] = useState<string | null>(null);
  const navigate = useNavigate();
  // The server that served this page gets one automatic identity exchange.
  // A failed exchange stays manual so rerenders cannot hammer the door.
  const autoConnectingRef = useRef(false);
  // Entering the wait on its own happens at most once per mount: a dismissed
  // wait must never be reopened behind the user's back.
  const autoEnteredRef = useRef(false);

  const startWaitFor = useCallback(
    (candidate: ZeropsCandidate) => {
      if (!candidate.containerOrigin) return;
      setConnectError(null);
      resetConnectingTarget();
      setCreatingIn(candidate.project.clientId ?? null);
      provisioning.startForContainer({
        projectId: candidate.project.id,
        serviceId: candidate.service?.id ?? null,
        containerOrigin: candidate.containerOrigin,
      });
    },
    [provisioning, resetConnectingTarget, setConnectError, setCreatingIn],
  );

  const [toolError, setToolError] = useState<string | null>(null);
  const [creation, setCreation] = useState<EnvironmentCreationView | null>(null);
  // Ticks once a second while a creation runs, so the checklist's durations
  // move; stops the moment it settles.
  const [creationNowMs, setCreationNowMs] = useState(() => Date.now());
  const creationRunning = creation !== null && creation.outcome === undefined;
  useEffect(() => {
    if (!creationRunning) return;
    const timer = setInterval(() => {
      setCreationNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [creationRunning]);
  const groupTree = buildZeropsGroupTree(candidates);
  const environmentCount = candidates.filter((candidate) => candidate.service !== undefined).length;
  const pageError = connectError ?? error;
  const rowInput = (candidate: ZeropsCandidate): ZeropsRowInput => ({
    candidate,
    health: candidateHealth.get(candidate.key),
    can: { open: true, connect: true, enable: true, wait: true, setUpMate: true },
  });

  const [settingUpKey, setSettingUpKey] = useState<string | null>(null);

  /**
   * Gives a project that has none a Mate container — and an agent's name, so
   * the row it earns in the left menu is somebody — then hands the wait to
   * the provisioning machinery from the project's known id.
   */
  const setUpMate = useCallback(
    async (candidate: ZeropsCandidate) => {
      if (!activeOrganization || settingUpKey !== null) return;
      setSettingUpKey(candidate.key);
      setConnectError(null);
      try {
        const projectId = candidate.project.id;
        const taken = candidates.flatMap((entry) => {
          const bot = readZeropsGroupTags(entry.project.tagList).bot;
          return bot === undefined ? [] : [bot];
        });
        await client.importDevelopmentContainer({ projectId });
        await client.nameProjectAgent(
          projectId,
          generateBotName(taken, (bytes) => crypto.getRandomValues(bytes)),
        );
        resetConnectingTarget();
        setCreatingIn(activeOrganization.id);
        provisioning.startForProject({ projectId });
      } catch (cause) {
        setConnectError(zeropsErrorMessage(cause));
      } finally {
        setSettingUpKey(null);
      }
    },
    [
      activeOrganization,
      candidates,
      client,
      provisioning,
      resetConnectingTarget,
      setConnectError,
      setCreatingIn,
      settingUpKey,
    ],
  );

  const busyKeys = useMemo(
    () => new Set([enablingCandidateKey, settingUpKey].filter((key) => key !== null)),
    [enablingCandidateKey, settingUpKey],
  );

  /** Runs a row's one verb; the words come from `ZeropsProjectRow.logic`. */
  const runRowAction = (candidate: ZeropsCandidate, kind: ZeropsRowAction["kind"]): void => {
    switch (kind) {
      case "open":
        if (candidate.environmentId) {
          rememberZeropsEnvironment(String(candidate.environmentId));
          void navigate({ to: "/", search: { environmentId: String(candidate.environmentId) } });
        }
        return;
      case "connect":
        startWaitFor(candidate);
        return;
      case "wait":
        if (candidate.containerOrigin) {
          startWaitFor(candidate);
          return;
        }
        setConnectError(null);
        setCreatingIn(candidate.project.clientId ?? null);
        provisioning.start({ zcpClaimed: true });
        return;
      case "set-up-mate":
        void setUpMate(candidate);
        return;
      case "enable": {
        const serviceId = candidate.service?.id;
        if (!serviceId) return;
        setConnectError(null);
        setEnablingCandidateKey(candidate.key);
        // Write the flag, then restart: the install step re-runs on boot and
        // comes back with the current zcp, which only installs Zerops Mate
        // when it finds ZCP_MATE_ENABLED set. A restart on its own returns the
        // container to the identical state.
        void client
          .enableZeropsMate(serviceId)
          .then(() => {
            startWaitFor(candidate);
          })
          .catch((cause: unknown) => {
            setConnectError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setEnablingCandidateKey(null);
          });
        return;
      }
      case "starting":
      case "pending":
      case "none":
        return;
    }
  };

  /**
   * Stands up one environment in a group: the plan is `planEnvironmentCreation`,
   * the calls are `runEnvironmentCreation`, and this only chooses the inputs —
   * the name, whether it gets an agent, and what that agent is called.
   */
  const createEnvironment = useCallback(
    async (groupId: string, role: ZeropsEnvironmentRole) => {
      if (!activeOrganization || creationRunning) return;
      const entry = groupTree.groups.find((candidate) => candidate.group.groupId === groupId);
      if (entry === undefined) return;
      const { group } = entry;
      const roleLabel = environmentRoleLabel(role)?.toLowerCase() ?? role;
      const name = `${group.name} - ${roleLabel}`;
      const withAgent = defaultAgentForRole(role);
      // An agent's name must be new on the account, not just in the group: it
      // is what the left menu calls the row, and two Adas is two of nothing.
      const takenBotNames = candidates.flatMap((candidate) => {
        const bot = readZeropsGroupTags(candidate.project.tagList).bot;
        return bot === undefined ? [] : [bot];
      });
      const botName = withAgent
        ? generateBotName(takenBotNames, (bytes) => crypto.getRandomValues(bytes))
        : undefined;

      const plan = planEnvironmentCreation({
        clientId: activeOrganization.id,
        groupId,
        // A group named by its id has no name to mirror.
        ...(group.nameSource === "id" ? {} : { groupName: group.name }),
        role,
        name,
        record: await zeropsRecipeStore.readGroup(groupId),
        ...(botName === undefined ? {} : { botName }),
      });
      if (!plan.ok) {
        setToolError(plan.reason);
        return;
      }

      setToolError(null);
      setCreationNowMs(Date.now());
      setCreation({ name, progress: plan.steps.map((step) => ({ step, state: "queued" })) });
      const outcome = await runEnvironmentCreation({
        clientId: activeOrganization.id,
        steps: plan.steps,
        platform: {
          createProject: (input) => client.createProject(input),
          importDevelopmentContainer: (input) => client.importDevelopmentContainer(input),
          importServices: (projectId, yaml) => client.importServicesIntoProject(projectId, yaml),
          listServices: (projectId) => client.listProjectServices(projectId),
        },
        describeError: zeropsErrorMessage,
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
          }),
        onProgress: (progress) => {
          setCreation((current) => (current === null ? current : { ...current, progress }));
        },
      });

      if (!outcome.ok) {
        setCreation((current) =>
          current === null
            ? current
            : {
                ...current,
                outcome: {
                  kind: "failed",
                  error: outcome.error,
                  projectExists: outcome.projectId !== undefined,
                },
              },
        );
        refresh();
        return;
      }

      refresh();
      if (outcome.awaitingAgent) {
        // The imports were accepted; the container wait is the provisioning
        // machinery's, which also does the connect and the hand-over to `/`.
        setCreation(null);
        setConnectError(null);
        resetConnectingTarget();
        setCreatingIn(activeOrganization.id);
        provisioning.startForProject({ projectId: outcome.projectId });
        return;
      }
      setCreation((current) =>
        current === null ? current : { ...current, outcome: { kind: "done" } },
      );
    },
    [
      activeOrganization,
      candidates,
      client,
      creationRunning,
      groupTree.groups,
      provisioning,
      refresh,
      resetConnectingTarget,
      setConnectError,
      setCreatingIn,
    ],
  );

  /**
   * Stands Gitea up as its own tagged project. Two platform calls with the
   * user's own token and no container is read — the same shape every other
   * creation in this model has.
   */
  const createTool = useCallback(async () => {
    if (!activeOrganization) return;
    setToolError(null);
    try {
      await client.createToolProject({
        clientId: activeOrganization.id,
        kind: "gitea",
        name: "Gitea",
      });
      refresh();
    } catch (cause) {
      setToolError(zeropsErrorMessage(cause));
    }
  }, [activeOrganization, client, refresh]);

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
            // No ready-made project exists, so "back to projects" would only
            // show the picker again with nothing new to pick — the create
            // form the picker used to hold beneath it now lives at its own
            // route, so that is where this phase's only way forward leads.
            if (provisioning.state?.phase === "pool-exhausted") {
              void navigate({ to: "/zerops/new" });
              return;
            }
            refresh();
          }}
        >
          {provisioning.state.phase === "ready" ||
          provisioning.state.phase === "not-yet-available" ||
          (provisioning.state.phase === "timed-out" &&
            provisioning.state.expiredPhase === "awaiting-health" &&
            provisioning.state.enabled)
            ? "Back to projects"
            : provisioning.state.phase === "pool-exhausted"
              ? "Create a project"
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isLoading ? (
            <>
              <Spinner className="size-3.5" />
              <span>Reading your Zerops projects…</span>
            </>
          ) : (
            <span>
              {environmentCount} {environmentCount === 1 ? "environment" : "environments"} in{" "}
              {activeOrganization.name}
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={isLoading}>
          <RotateCcwIcon className="size-4" />
          Refresh
        </Button>
      </div>
      {pageError === null ? null : (
        <div
          className="rounded-md border border-[var(--zerops-status-failed)]/40 bg-[var(--zerops-status-failed-surface)] px-3 py-2 text-sm text-[var(--zerops-status-failed-text)]"
          role="alert"
        >
          {pageError}
        </div>
      )}
      <ZeropsGroupTree
        getKey={(candidate: ZeropsCandidate) => candidate.key}
        getName={(candidate: ZeropsCandidate) => candidate.project.name}
        getAgentName={(candidate: ZeropsCandidate) => {
          const bot = readZeropsGroupTags(candidate.project.tagList).bot?.trim();
          return bot === undefined || bot.length === 0 ? undefined : bot;
        }}
        creating={creationRunning}
        onCreateEnvironment={(groupId, role) => {
          void createEnvironment(groupId, role);
        }}
        onCreateTool={() => {
          void createTool();
        }}
        isBusy={(candidate: ZeropsCandidate) => busyKeys.has(candidate.key)}
        renderStatus={(candidate: ZeropsCandidate) => {
          const { status } = deriveZeropsRowPresentation(rowInput(candidate));
          return (
            <StatusDot
              label={status.label}
              tone={status.tone}
              {...(status.pulse === undefined ? {} : { pulse: status.pulse })}
            />
          );
        }}
        renderDetail={(candidate: ZeropsCandidate) => {
          if (isZeropsToolCandidate(candidate)) return null;
          const presentation = deriveZeropsRowPresentation(rowInput(candidate));
          if (presentation.detail === undefined) return null;
          return (
            <span
              className={
                presentation.detailIsError ? "text-[var(--zerops-status-failed-text)]" : undefined
              }
            >
              {presentation.detail}
            </span>
          );
        }}
        renderAction={(candidate: ZeropsCandidate) => {
          const action = deriveZeropsRowAction(rowInput(candidate));
          switch (action.kind) {
            case "none":
              return null;
            case "pending":
              return <Spinner className="size-4 text-muted-foreground" />;
            case "starting":
              return <span className="text-xs text-muted-foreground">{action.label}</span>;
            default:
              return (
                <Pill
                  data-zerops-primary-action={action.label}
                  disabled={busyKeys.has(candidate.key)}
                  label={action.label}
                  onClick={() => {
                    runRowAction(candidate, action.kind);
                  }}
                />
              );
          }
        }}
        renderToolStatus={(candidate: ZeropsCandidate) => {
          // A tool has no Mate container and never will, so the environment
          // classifier's verdict is meaningless here. The platform's own
          // project status is the honest answer.
          const active = candidate.project.status === "ACTIVE";
          return (
            <StatusDot
              label={active ? "Ready" : candidate.project.status}
              tone={active ? "ok" : "attention"}
            />
          );
        }}
        view={groupTree}
      />
      {!isLoading && candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects in this account yet.</p>
      ) : null}
      {creation === null ? null : (
        <ZeropsEnvironmentCreation
          name={creation.name}
          nowMs={creationNowMs}
          onDismiss={() => {
            setCreation(null);
          }}
          progress={creation.progress}
          {...(creation.outcome === undefined ? {} : { outcome: creation.outcome })}
        />
      )}
      {toolError === null ? null : (
        <p className="text-sm text-[var(--zerops-status-failed-text)]">{toolError}</p>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigate({ to: "/zerops/new" });
          }}
        >
          New project
        </Button>
      </div>
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
