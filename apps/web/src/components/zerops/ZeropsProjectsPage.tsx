import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useZeropsUpgradeRestart, type UpgradeRecovery } from "~/zerops/useZeropsUpgradeRestart";
/**
 * `/zerops` — the project picker for a signed-in Zerops account: an existing
 * candidate to connect to or wait on, and a way to `/zerops/new` (also where
 * an exhausted pool falls back to, since that phase has nothing ready-made to
 * pick). Creating a project happens at that route, not here.
 */

import { useNavigate, useRouteContext } from "@tanstack/react-router";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  ZeropsServiceId,
  type ServiceAuthorizedAgentsResourceRequest,
} from "@t3tools/client-runtime/zerops/data";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MateMarkState } from "@t3tools/shared/brand";
import { PlayIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  applyProjectCreationVerdict,
  normalizeOrigin,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import {
  resolveMateOwnerName,
  resolveMateVerbs,
  resolveMateVisibility,
  type MateVerbs,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import { rememberEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { deriveProvisioningStart } from "@t3tools/client-runtime/zerops/registrationHandoff";
import { rememberZeropsEnvironment } from "~/zerops/firstPromptStorage";
import {
  forgetPendingCreation,
  pendingCreationProjects,
  rememberCreationHandoff,
} from "~/zerops/creationHandoffStorage";
import { browserZeropsStorage } from "~/zerops/storage";
import { useZeropsIdentityExchange } from "~/zerops/useZeropsIdentityExchange";
import {
  useZeropsCandidates,
  type ZeropsCandidatePresentation,
} from "~/zerops/useZeropsCandidates";
import { useZeropsCandidateHealth } from "~/zerops/useZeropsCandidateHealth";
import {
  integrationTokensFromGrantMetadata,
  useZeropsGroupReach,
} from "~/zerops/useZeropsGroupReach";
import { useZeropsThrowawaySweep } from "~/zerops/useZeropsThrowawaySweep";
import { useZeropsOrganizationMembers } from "~/zerops/useZeropsMateOwners";
import { useZeropsProvisioning } from "~/zerops/useZeropsProvisioning";
import { useZeropsSession, type ZeropsSessionStatus } from "~/zerops/ZeropsSessionProvider";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { useZeropsCreationVerdicts } from "~/zerops/useZeropsCreationVerdicts";
import { useZeropsDeployTokenGaps } from "~/zerops/useZeropsDeployTokenGaps";
import { runZeropsCommand, useZeropsData } from "~/zerops/zeropsDataContext";
import type { AuthGateState } from "~/environments/primary/auth";
import { mateFaceFor, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import type { ZeropsRowPresentation } from "./ZeropsProjectRow.logic";

import {
  changeState,
  environmentNameUnderGroup,
  halfMadeGroupEnvironments,
  assignCandidateMateTints,
  botDisplayName,
  buildZeropsGroupTree,
  toolProjectName,
  flowVerbKey,
  flowVerbLabel,
  deployWord,
  rankZeropsCandidateForListing,
  defaultAgentForRole,
  generateBotName,
  GROUP_BEING_SET_UP_LINE,
  hasMate,
  planEnvironmentCreation,
  canWriteRegistry,
  pullRequestLineWith,
  type FlowPullRequest,
  readZeropsGroupTags,
  resolveGroupGitea,
  runEnvironmentCreation,
  unionAgents,
  type EnvironmentCreationStepProgress,
  type ZeropsAgentType,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsGroupTags,
} from "@t3tools/client-runtime/zerops";
import { refreshZeropsCandidates } from "~/zerops/candidatesRefresh";
import { creationRefreshWanted, useCreationInventoryRefresh } from "~/zerops/creationRefresh";

import { StatusDot } from "./primitives";
import { ZeropsEnvironmentRow } from "./ZeropsEnvironmentRow";
import { ZeropsMateCard, ZeropsMateVerb, ZeropsToolCard } from "./ZeropsMateCard";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useZeropsAgentActivity } from "~/zerops/useZeropsAgentActivity";
import { ZeropsEnvironmentCreation } from "./ZeropsEnvironmentCreation";
import {
  ZeropsEnvironmentCreationDialog,
  type EnvironmentCreationChoice,
} from "./ZeropsEnvironmentCreationDialog";
import { proposedEnvironmentName } from "./ZeropsEnvironmentCreationDialog.logic";
import { ZeropsProjectMenu, type ZeropsMenuAction } from "./ZeropsProjectMenu";
import { ZeropsRenameDialog } from "./ZeropsRenameDialog";
import { useRenameGroup } from "~/zerops/useRenameGroup";
import { useEnableRoute } from "~/zerops/useEnableRoute";
import { useMateActions } from "~/zerops/useMateActions";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { addGroupEnvironment } from "~/zerops/addGroupEnvironment";
import { registerMateInGroup } from "~/zerops/brokerGrant";
import { findAccountGitea } from "~/zerops/giteaProject";
import { giteaClientFor } from "~/zerops/giteaSession";
import { useZeropsGroupEnvironmentReconcile } from "~/zerops/useZeropsGroupEnvironmentReconcile";
import { useZeropsGroupOrganizations } from "~/zerops/useZeropsGroupOrganizations";
import { registryGroupSlug, useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { useZeropsProjectFlow } from "~/zerops/projectFlowContext";
import { readZeropsResourceOnce } from "~/zerops/useZeropsDeployedVersion";
import { deployRowTone, releaseRowTone } from "./ZeropsProjectRow.logic";
import { ZeropsGroupAnswer } from "./ZeropsGroupDetail";
import { ZeropsPullRequestRow } from "./ZeropsPullRequestRow";
import { TOOL_LABEL, ZeropsGroupTree } from "./ZeropsGroupTree";
import { environmentRoleLabel, environmentRoleTag } from "./ZeropsGroupTree.logic";
import {
  type ZeropsRowAction,
  type ZeropsRowInput,
  connectFailureLine,
  deriveZeropsRowAction,
  deriveZeropsRowPresentation,
  environmentSummaryLine,
  giteaToolLine,
  isZeropsToolCandidate,
  mateIsUp,
} from "./ZeropsProjectRow.logic";
import { ZeropsOrganizationScope, ZeropsOrganizationSwitcher } from "./ZeropsOrganizationScope";
import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";

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
    // The throwaway door, which is the only one this client presents at.
    !input.authGate.auth.bootstrapMethods.includes("zerops-throwaway")
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

/**
 * Takes a project the platform failed to create off the account. The delete
 * comes first; only once the platform has accepted it is the creation's
 * handoff forgotten (nothing will ever connect to this project) and the
 * list re-read. A refused delete leaves both as they were, so the row keeps
 * offering the verb and says why it did not work.
 */
export async function removeFailedZeropsProject(input: {
  readonly projectId: string;
  readonly deleteProject: (projectId: string) => Promise<unknown>;
  readonly forgetCreation: (projectId: string) => void;
  readonly refresh: () => void;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  try {
    await input.deleteProject(input.projectId);
  } catch (cause) {
    return { ok: false, error: zeropsErrorMessage(cause) };
  }
  input.forgetCreation(input.projectId);
  input.refresh();
  return { ok: true };
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

/**
 * Whether this account has no project to show — the state the projects screen
 * answers with an invitation rather than a list.
 *
 * A tool is not a project (`tools.ts`), so an account holding nothing but
 * Gitea has still not started. Two readers ask: the header, which drops its
 * create button so the invitation is not said twice, and the tree, which
 * carries the invitation. Both must agree, and neither may answer before the
 * first list has been read — an invitation that paints for a second and is
 * then replaced by the roster is a shift the reader has to undo. A re-read
 * is not a first read: the list already read answers while it runs.
 */
export function hasNoZeropsProject(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  /**
   * Nothing has been read for this organization yet. A re-read is not that:
   * the list already read stays up and answers, so an empty organization
   * keeps its invitation while a fresh baseline lands.
   */
  readonly unread: boolean;
  /**
   * A creation this client made and has not connected to yet. The wizard
   * navigates here the moment the project exists, before the inventory lists
   * it — painting the invitation in that gap is the flash the roster then
   * takes back.
   */
  readonly creationPending?: boolean;
}): boolean {
  if (input.creationPending === true) return false;
  if (input.unread && input.candidates.length === 0) return false;
  const view = buildZeropsGroupTree(input.candidates, { rank: rankZeropsCandidateForListing });
  return view.groups.length === 0 && view.ungrouped.length === 0;
}

function SignedOutNotice({ message }: { readonly message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

/**
 * The page's title row: the title and the reload beside it, as a glyph. No
 * creating action here — the left menu's "New project" is the entry, and a
 * filled pill beside the title was the loudest thing on a page whose loud
 * thing should be the Mate. No sentence under the title either: the
 * projects below say what the page is.
 */
export function ZeropsProjectsHeader({
  onRefresh,
  refreshing = false,
}: {
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshing?: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
      data-zerops-project-scope="true"
    >
      <h1 className="text-xl font-medium text-foreground">Projects</h1>
      <div className="flex items-center gap-2">
        {onRefresh === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Refresh"
                  className="text-muted-foreground"
                  disabled={refreshing}
                  onClick={onRefresh}
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <RotateCcwIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup>Refresh</TooltipPopup>
          </Tooltip>
        )}
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
  readonly upgradeRecovery: UpgradeRecovery | null;
  readonly serverVersion: string | undefined;
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
  const [serverVersion, setServerVersion] = useState<string | undefined>();
  const [upgradeOrigin, setUpgradeOrigin] = useState<string | null>(null);
  const [connectingOrigin, setConnectingOrigin] = useState<string | null>(null);
  // One connect per settled provisioning wait, however many renders that takes.
  const connectingRef = useRef<string | null>(null);

  const connectContainer = useCallback(
    async (containerOrigin: string) => {
      setConnectError(null);
      setUpgradeOrigin(null);
      setServerVersion(undefined);
      setConnectingOrigin(containerOrigin);
      try {
        const result = await exchangeZeropsIdentity(containerOrigin);
        if (result._tag === "Failure") {
          setConnectError(result.error);
          setServerVersion(result.serverVersion);
          setUpgradeOrigin(result.upgradeRequired ? containerOrigin : null);
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

  const upgradeRecovery = useZeropsUpgradeRestart(
    connectError ? upgradeOrigin : null,
    retryProjectConnection,
  );

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
    upgradeRecovery,
    serverVersion,
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
  const { organizationRef, projectRef, runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const inventoryRef = useRef(inventory);
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);
  const { candidates: observedCandidates, isLoading, readOnce, error } = useZeropsCandidates();
  // A project on its way up is read against the platform's verdict on its
  // creation: one whose `project.create` failed is not coming up, however
  // long the page waits, and its row says so instead.
  const creationVerdicts = useZeropsCreationVerdicts(observedCandidates);
  const candidates = useMemo(
    () =>
      observedCandidates.map((candidate) =>
        applyProjectCreationVerdict(candidate, creationVerdicts.get(candidate.project.id)),
      ),
    [creationVerdicts, observedCandidates],
  );
  const { health: candidateHealth, serverVersions } = useZeropsCandidateHealth(candidates);
  const {
    creatingIn,
    setCreatingIn,
    provisioning,
    connectError,
    upgradeRecovery,
    setConnectError,
    connectingOrigin,
    retryProjectConnection,
    connectContainer,
    resetConnectingTarget,
  } = useZeropsProjectConnection(activeOrganization?.id ?? null);
  const [enablingCandidateKey, setEnablingCandidateKey] = useState<string | null>(null);
  const [startingCandidateKey, setStartingCandidateKey] = useState<string | null>(null);
  const [restartingCandidateKey, setRestartingCandidateKey] = useState<string | null>(null);
  const [removingCandidateKey, setRemovingCandidateKey] = useState<string | null>(null);
  const navigate = useNavigate();
  // The server that served this page gets one automatic identity exchange.
  // A failed exchange stays manual so rerenders cannot hammer the door.
  const autoConnectingRef = useRef(false);
  // Entering the wait on its own happens at most once per mount: a dismissed
  // wait must never be reopened behind the user's back.
  const autoEnteredRef = useRef(false);
  // One-shot resource reads (readZeropsResourceOnce) hold their lease under
  // this signal, so a component unmounted mid-read releases immediately.
  const unmountRef = useRef<AbortController>(undefined);
  if (unmountRef.current === undefined) unmountRef.current = new AbortController();
  useEffect(() => () => unmountRef.current?.abort(), []);

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
  const groupTree = buildZeropsGroupTree(candidates, { rank: rankZeropsCandidateForListing });
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  const activity = useZeropsAgentActivity();
  // What this person may do with each Mate, from the one role function the
  // door runs too (D5). A `listed` row is shown and never opened.
  const viewer =
    activeOrganization === null
      ? null
      : {
          id: activeOrganization.id,
          membershipId: activeOrganization.membershipId,
          roleCode: activeOrganization.roleCode,
          canCreateProjects: activeOrganization.canCreateProjects,
        };
  const visibilityOf = (candidate: ZeropsCandidate): RoleMateVisibility | undefined =>
    viewer === null ? undefined : resolveMateVisibility({ project: candidate.project, viewer });
  // Guide 0.8: a verb this person cannot finish is not offered. Every one of
  // them is a platform write the platform would refuse from the wrong role.
  const verbsOf = (candidate: ZeropsCandidate): MateVerbs =>
    viewer === null
      ? { open: true, rename: true, tag: true, move: true, assign: false }
      : resolveMateVerbs({ project: candidate.project, viewer });
  // The member list is read when a row would use a name — a Mate this person
  // may see and not open — and when they may hand a Mate over and so need
  // somebody to hand it to. Never otherwise.
  const anyListed = candidates.some((candidate) => visibilityOf(candidate) === "listed");
  const anyAssignable = candidates.some((candidate) => verbsOf(candidate).assign);
  const assignableMembers = useZeropsOrganizationMembers({
    clientId: activeOrganization?.id,
    enabled: anyListed || anyAssignable,
  });
  const members = assignableMembers;

  /**
   * The container this page is waiting on: the wait a click or a creation
   * started (`provisioning.state`) and the identity exchange it ends in
   * (`connectingOrigin`). One at a time, so one row at most reads as waited on.
   */
  const waitedOn = (candidate: ZeropsCandidate): boolean => {
    const origin =
      candidate.containerOrigin === undefined ? null : normalizeOrigin(candidate.containerOrigin);
    const waited = provisioning.state;
    if (waited !== null) {
      if (waited.projectId !== null && waited.projectId === candidate.project.id) return true;
      if (
        origin !== null &&
        waited.containerOrigin !== null &&
        normalizeOrigin(waited.containerOrigin) === origin
      ) {
        return true;
      }
    }
    return (
      origin !== null && connectingOrigin !== null && normalizeOrigin(connectingOrigin) === origin
    );
  };

  /**
   * The projects this browser created and has not connected to yet
   * (`creationHandoff.ts`). A reload mid-provisioning lands here with the
   * handoff still in storage: the page reads it as its own wait — the line
   * says how long, nothing is offered to click — and picks the wait up the
   * moment the container answers ready (below).
   */
  // Read on every render rather than memoized: the store is the connect's
  // to spend, and nothing this component holds changes when it does.
  const pendingCreations = new Set(pendingCreationProjects());
  const creationPending = pendingCreations.size > 0;
  // A creation's container reaches this page through the pushed inventory,
  // and a push can be missed: the card then waits at "Almost there." on a Mate
  // that answered minutes ago, while a reload finds it at once (the owner's
  // run of 2026-09-17). While a creation is on its way, the inventory is
  // re-read on a clock as well (`creationRefresh.ts`).
  useCreationInventoryRefresh(
    creationRefreshWanted({ creationPending, waitPhase: provisioning.state?.phase ?? null }),
  );

  const rowInput = (
    candidate: ZeropsCandidate,
    role?: ZeropsEnvironmentRole | undefined,
  ): ZeropsRowInput => {
    const visibility = visibilityOf(candidate);
    const openable = visibility !== "listed";
    const ownerName =
      visibility === "listed"
        ? resolveMateOwnerName({ project: candidate.project, members })
        : undefined;
    const waiting =
      candidate.group !== "connected" &&
      (waitedOn(candidate) || pendingCreations.has(candidate.project.id));
    return {
      candidate,
      health: candidateHealth.get(candidate.key),
      waiting,
      can: {
        open: openable,
        enable: openable,
        setUpMate: openable,
        start: openable,
        restart: openable,
        remove: openable,
      },
      ...(role === undefined ? {} : { role }),
      ...(visibility === undefined ? {} : { visibility }),
      ...(ownerName === undefined ? {} : { ownerName }),
    };
  };

  const [settingUpKey, setSettingUpKey] = useState<string | null>(null);

  /**
   * Gives a project that has none a Mate container — and an agent's name, so
   * the row it earns in the left menu is somebody — then hands the wait to
   * the provisioning machinery from the project's known id.
   */
  /**
   * The agents a group's existing environments are signed in with, so a Mate
   * born into that group offers the same ones instead of the platform's whole
   * menu (`agentSelection.ts`).
   *
   * Read per environment and unioned. A read that fails is not a reason to
   * refuse a creation: the empty answer omits `ZCP_AGENTS` from the import,
   * and the container falls back to offering every agent — which is exactly
   * what it did before this existed.
   */
  const readGroupAgents = useCallback(
    async (
      environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>,
    ): Promise<ReadonlyArray<ZeropsAgentType>> =>
      unionAgents(
        await Promise.all(
          environments.flatMap(({ item }) => {
            if (item.service === undefined || activeOrganization === null) return [];
            const request: ServiceAuthorizedAgentsResourceRequest = {
              kind: "service-authorized-agents",
              account: runtime.scope,
              service: {
                kind: "service",
                project: projectRef(activeOrganization.id, item.project.id),
                serviceId: ZeropsServiceId.make(item.service.id),
              },
            };
            return [
              readZeropsResourceOnce(runtime.resources, request, unmountRef.current?.signal).then(
                (agents): ReadonlyArray<ZeropsAgentType> => agents ?? [],
              ),
            ];
          }),
        ),
      ),
    [activeOrganization, projectRef, runtime.resources, runtime.scope],
  );

  const setUpMate = useCallback(
    async (candidate: ZeropsCandidate) => {
      if (!activeOrganization || settingUpKey !== null) return;
      const isCurrent = captureAccountLifetime();
      setSettingUpKey(candidate.key);
      setConnectError(null);
      try {
        const projectId = candidate.project.id;
        const taken = candidates.flatMap((entry) => {
          const bot = readZeropsGroupTags(entry.project.tagList).bot;
          return bot === undefined ? [] : [bot];
        });
        const group = groupTree.groups.find((candidate) =>
          candidate.environments.some(({ item }) => item.project.id === projectId),
        );
        const agents = group === undefined ? [] : await readGroupAgents(group.environments);
        if (!isCurrent()) return;
        const project = projectRef(activeOrganization.id, projectId);
        await runZeropsCommand(runtime.commands.importDevelopmentContainer({ project, agents }));
        if (!isCurrent()) return;
        await runZeropsCommand(
          runtime.commands.nameProjectAgent(
            project,
            generateBotName(taken, (bytes) => crypto.getRandomValues(bytes)),
          ),
        );
        if (!isCurrent()) return;
        resetConnectingTarget();
        setCreatingIn(activeOrganization.id);
        provisioning.startForProject({ projectId });
      } catch (cause) {
        if (isCurrent()) setConnectError(zeropsErrorMessage(cause));
      } finally {
        if (isCurrent()) setSettingUpKey(null);
      }
    },
    [
      activeOrganization,
      candidates,
      groupTree.groups,
      projectRef,
      provisioning,
      readGroupAgents,
      resetConnectingTarget,
      setConnectError,
      setCreatingIn,
      settingUpKey,
      runtime.commands,
    ],
  );

  const busyKeys = useMemo(
    () =>
      new Set(
        [
          enablingCandidateKey,
          settingUpKey,
          startingCandidateKey,
          restartingCandidateKey,
          removingCandidateKey,
        ].filter((key) => key !== null),
      ),
    [
      enablingCandidateKey,
      settingUpKey,
      startingCandidateKey,
      restartingCandidateKey,
      removingCandidateKey,
    ],
  );

  // The quiet actions: rename an agent, move a project, rename a group. Each
  // runs through the account-scoped command layer; observations update the model.
  const [rowDialog, setRowDialog] = useState<
    | { readonly kind: "rename-agent"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "move"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "assign"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "rename-group"; readonly group: ZeropsGroup }
    | null
  >(null);
  // The same write the project's own page uses, so one rename means one
  // thing wherever it is offered.
  const renameGroup = useRenameGroup();
  // The same write an environment's own page uses, so one way to open a
  // service to the internet means one thing wherever it is offered.
  const route = useEnableRoute();

  /**
   * The face a Mate wears: the state of its conversation when its socket is
   * up, else asleep — a container that is not connected is the Zerops mark.
   */
  const mateFace = (candidate: ZeropsCandidatePresentation): MateMarkState =>
    mateFaceFor(
      candidate.group === "connected" && candidate.environmentId !== undefined,
      candidate.environmentId === undefined ? undefined : activity.get(candidate.environmentId),
    );

  /** Writes the group's registry entry for a Mate, as the owner. */

  /**
   * The quiet actions of a card or a row: the environment's public access,
   * the Mate's name when there is a Mate, and where the environment sits in
   * its project.
   */
  const renderEnvironmentMenu = (
    candidate: ZeropsCandidatePresentation,
    tags: ZeropsGroupTags,
    mate: boolean,
    action?: ZeropsRowAction,
    updateMenuActions?: ReadonlyArray<ZeropsMenuAction>,
  ): React.ReactNode => {
    if (isZeropsToolCandidate(candidate)) return undefined;
    return (
      <ZeropsProjectMenu
        actions={mate ? mateActions.actionsFor(candidate, tags, updateMenuActions ?? []) : []}
        enablingServiceId={route.enablingServiceId}
        label={`More for ${candidate.project.name}`}
        offers={candidate.routeOffers}
        onEnableRoute={(offer) => {
          void route.enable(candidate.project.id, offer.serviceId);
        }}
        routes={candidate.routes}
      />
    );
  };

  /**
   * The wait this page holds, as the waited-on Mate's own line: a connect
   * that failed, in the failed tone with the one verb that retries it; an
   * older server, with the restart that updates it; a wait that ran out.
   * Nothing while the wait simply runs — the face is asleep and the row
   * logic's line says how long.
   */
  const renderWaitLine = (candidate: ZeropsCandidatePresentation): React.ReactNode => {
    if (!waitedOn(candidate)) return undefined;
    const failed = (text: string) => (
      <span
        className="min-w-0 truncate text-[var(--zerops-status-failed-text)]"
        data-zerops-surface="mate-subject"
      >
        {text}
      </span>
    );
    const quiet = (text: string) => (
      <span className="min-w-0 truncate" data-zerops-surface="mate-subject">
        {text}
      </span>
    );
    const busy = provisioning.busy || connectingOrigin !== null;
    if (upgradeRecovery !== null && connectError !== null) {
      switch (upgradeRecovery.state) {
        case "confirm":
          return (
            <>
              {quiet("Restarting interrupts work running in it.")}
              <ZeropsMateVerb disabled={busy} label="Restart" onClick={upgradeRecovery.confirm} />
              <ZeropsMateVerb label="Cancel" onClick={upgradeRecovery.cancel} />
            </>
          );
        case "waiting":
          return quiet("Restarting to update.");
        case "failed":
          return (
            <>
              {failed(upgradeRecovery.error ?? "Could not restart.")}
              <ZeropsMateVerb disabled={busy} label="Try again" onClick={upgradeRecovery.request} />
            </>
          );
        case "idle":
          return (
            <>
              {failed("This Mate runs an older server. A restart updates it.")}
              <ZeropsMateVerb
                disabled={busy}
                label="Restart to update"
                onClick={upgradeRecovery.request}
              />
            </>
          );
      }
    }
    if (connectError !== null) {
      return (
        <>
          {failed(connectFailureLine(connectError))}
          <ZeropsMateVerb disabled={busy} label="Try again" onClick={retryProjectConnection} />
        </>
      );
    }
    const state = provisioning.state;
    if (state === null) return undefined;
    if (provisioning.error !== null) {
      return (
        <>
          {failed(provisioning.error)}
          <ZeropsMateVerb disabled={busy} label="Try again" onClick={provisioning.retry} />
        </>
      );
    }
    if (state.phase === "not-yet-available") {
      return quiet("This container's release does not carry Mate yet.");
    }
    if (state.phase === "timed-out") {
      return (
        <>
          {quiet("Taking longer than usual.")}
          <ZeropsMateVerb disabled={busy} label="Keep waiting" onClick={provisioning.retry} />
        </>
      );
    }
    return undefined;
  };

  /**
   * The line under a Mate's name. Connected, it is what the Mate is on, or
   * was last on (`agentActivity`) — the state itself is the face's to show,
   * never a word's. Waited on, it is the wait's own line when the wait has
   * something to say (a failure and its retry). Otherwise it is the row
   * logic's one sentence — how long until the Mate is up, or what is wrong —
   * and, after it, the one verb that is a real decision ("Set up Mate",
   * "Enable Zerops Mate"). Never a status verb: connecting is what clicking
   * the card does, and the boot is the face's to carry.
   */
  const renderMateLine = (
    candidate: ZeropsCandidatePresentation,
    presentation: ZeropsRowPresentation,
    action: ZeropsRowAction,
    live: ZeropsAgentActivity | undefined,
    busy: boolean,
  ): React.ReactNode => {
    if (candidate.group === "connected") {
      return live?.subject === undefined ? null : (
        <span className="min-w-0 truncate" data-zerops-surface="mate-subject">
          {live.subject}
        </span>
      );
    }
    const waitLine = renderWaitLine(candidate);
    if (waitLine !== undefined) return waitLine;
    const detail =
      presentation.detail === undefined ? null : (
        <span
          className={cn(
            "min-w-0 truncate",
            presentation.detailIsError && "text-[var(--zerops-status-failed-text)]",
          )}
          data-zerops-surface="mate-subject"
        >
          {presentation.detail}
        </span>
      );
    switch (action.kind) {
      // "start" is a trailing button on the card, not a verb on this line —
      // the line only says the detail (e.g. "Stopped").
      case "enable":
      case "set-up-mate":
        return (
          <>
            {detail}
            <ZeropsMateVerb
              disabled={busy}
              label={busy && action.kind === "set-up-mate" ? "Setting up…" : action.label}
              onClick={() => {
                runRowAction(candidate, action.kind);
              }}
            />
          </>
        );
      default:
        return detail;
    }
  };

  /** What an environment holds, phrased once for every row on the page. */
  const summaryOf = (candidate: ZeropsCandidatePresentation): React.ReactNode =>
    environmentSummaryLine(candidate.services, formatRelativeTimeLabel);

  /** Runs a row's one verb; the words come from `ZeropsProjectRow.logic`. */
  const runRowAction = (candidate: ZeropsCandidate, kind: ZeropsRowAction["kind"]): void => {
    switch (kind) {
      // Opening a Mate that is not connected yet connects first: the wait
      // lands in the conversation when the container answers.
      case "open":
        if (candidate.environmentId) {
          rememberZeropsEnvironment(String(candidate.environmentId));
          void navigate({ to: "/", search: { environmentId: String(candidate.environmentId) } });
          return;
        }
        startWaitFor(candidate);
        return;
      case "set-up-mate":
        void setUpMate(candidate);
        return;
      case "enable": {
        const serviceId = candidate.service?.id;
        if (!serviceId || activeOrganization === null) return;
        setConnectError(null);
        setEnablingCandidateKey(candidate.key);
        // Write the flag, then restart: the install step re-runs on boot and
        // comes back with the current zcp, which only installs Zerops Mate
        // when it finds ZCP_MATE_ENABLED set. A restart on its own returns the
        // container to the identical state.
        const project = projectRef(activeOrganization.id, candidate.project.id);
        void runZeropsCommand(
          runtime.commands.enableZeropsMate({
            kind: "service",
            project,
            serviceId: ZeropsServiceId.make(serviceId),
          }),
        )
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
      case "start": {
        if (activeOrganization === null) return;
        setConnectError(null);
        setStartingCandidateKey(candidate.key);
        const project = projectRef(activeOrganization.id, candidate.project.id);
        // A STOPPED project starts every service in it; a STOPPED zcp
        // service while the project is ACTIVE starts only that service.
        const serviceId = candidate.service?.id;
        const write =
          candidate.project.status === "STOPPED"
            ? runZeropsCommand(runtime.commands.startProject(project))
            : serviceId
              ? runZeropsCommand(
                  runtime.commands.startService({
                    kind: "service",
                    project,
                    serviceId: ZeropsServiceId.make(serviceId),
                  }),
                )
              : null;
        if (write === null) {
          setStartingCandidateKey(null);
          return;
        }
        void write
          .then(() => {
            refreshZeropsCandidates();
          })
          .catch((cause: unknown) => {
            setConnectError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setStartingCandidateKey(null);
          });
        return;
      }
      case "restart": {
        if (activeOrganization === null) return;
        const serviceId = candidate.service?.id;
        if (!serviceId) return;
        setConnectError(null);
        setRestartingCandidateKey(candidate.key);
        const project = projectRef(activeOrganization.id, candidate.project.id);
        void runZeropsCommand(
          runtime.commands.restartService({
            kind: "service",
            project,
            serviceId: ZeropsServiceId.make(serviceId),
          }),
        )
          .then(() => {
            refreshZeropsCandidates();
          })
          .catch((cause: unknown) => {
            setConnectError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setRestartingCandidateKey(null);
          });
        return;
      }
      case "remove": {
        if (activeOrganization === null) return;
        setConnectError(null);
        setRemovingCandidateKey(candidate.key);
        void removeFailedZeropsProject({
          projectId: candidate.project.id,
          deleteProject: (projectId) =>
            runZeropsCommand(
              runtime.commands.deleteProject({
                organization: organizationRef(activeOrganization.id),
                projectId,
              }),
            ),
          forgetCreation: forgetPendingCreation,
          refresh: refreshZeropsCandidates,
        })
          .then((outcome) => {
            if (!outcome.ok) setConnectError(outcome.error);
          })
          .finally(() => {
            setRemovingCandidateKey(null);
          });
        return;
      }
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
  // An agent's name must be new on the account, not just in the group: it is
  // what the left menu calls the row, and two Adas is two of nothing.
  const takenBotNames = useMemo(
    () =>
      candidates.flatMap((candidate) => {
        const bot = readZeropsGroupTags(candidate.project.tagList).bot;
        return bot === undefined ? [] : [bot];
      }),
    [candidates],
  );

  // A group is offered more once its first Mate is up — connected, or its
  // container answering ready — and not a minute before. Shared by the
  // group's foot and the rows that ask for a missing tier.
  const groupAddsOffered = useCallback(
    (group: ZeropsGroup) =>
      (
        groupTree.groups.find((entry) => entry.group.groupId === group.groupId)?.environments ?? []
      ).some(
        ({ item }) =>
          hasMate(item) && mateIsUp({ candidate: item, health: candidateHealth.get(item.key) }),
      ),
    [candidateHealth, groupTree.groups],
  );

  // "Add stage" opens the form; the form's answer is what gets created.
  const [creationRequest, setCreationRequest] = useState<{
    readonly groupId: string;
    readonly role: ZeropsEnvironmentRole;
    readonly botName: string;
  } | null>(null);
  const requestedGroup = useMemo(
    () =>
      creationRequest === null
        ? undefined
        : groupTree.groups.find((entry) => entry.group.groupId === creationRequest.groupId),
    [creationRequest, groupTree.groups],
  );
  const accountGitea = useMemo(
    () => findAccountGitea(inventory, activeOrganization?.id),
    [activeOrganization?.id, inventory],
  );
  const giteaProjectId = accountGitea?.projectId;
  // Read exactly as the account's Gitea project states it: an account on a
  // devel region or behind a custom domain is read, never guessed.
  const giteaOrigin = accountGitea?.state.url;
  // The registry — which groups exist, and what each one's Gitea org is called
  // (guide 4.1). One project read, on the one screen that sees the account.
  const registryState = useZeropsRegistry({
    giteaProjectId: giteaProjectId,
    enabled: status === "signed-in",
  });

  // Every verb a Mate has, from the one place that defines them — shared with
  // a project's own page, which listed its Mates and could do nothing to them.
  const mateActions = useMateActions({ registry: registryState, serverVersions });

  // The recipe is the group repo's, read as the person (guide 4.3) — never a
  // sibling's export, which carried service shapes without their build setup
  // and produced environments that could not build.
  const groupRecipe = useZeropsGroupRecipe({
    giteaOrigin,
    slug: registryGroupSlug(registryState.registry, creationRequest?.groupId),
    tier:
      creationRequest?.role === "prod"
        ? "production"
        : creationRequest?.role === "stage"
          ? "stage"
          : "mate",
    enabled: creationRequest !== null,
  });

  // The registry says which groups were asked for; `GET /orgs/{slug}` says
  // which the broker has actually made (guide 4.5).
  const giteaOrganizations = useZeropsGroupOrganizations({
    giteaOrigin,
    slugs: registryState.registry.groups.map((group) => group.slug),
    enabled: status === "signed-in",
  });

  // Every group's flow — its declared environments and what they run, what
  // is waiting to land, what was released — is read once for the account
  // (`ZeropsProjectFlowProvider`, D26); the page draws its share of it.
  const projectFlow = useZeropsProjectFlow();
  const groupDeploys = projectFlow.flows;

  /**
   * The environment row of one Zerops project, when some group declares it.
   * A project no `environments.yaml` names is not a group environment and
   * keeps the row it always had.
   */
  const declaredEnvironment = useCallback(
    (projectId: string) => {
      for (const state of groupDeploys.values()) {
        const found = state.environments.find((entry) => entry.projectId === projectId);
        if (found !== undefined) return found;
      }
      return undefined;
    },
    [groupDeploys],
  );

  /** Each Mate's name, for a pull request's line — the bot's, the project's when it has none. */
  const mateNames = useMemo(
    () =>
      new Map(
        groupTree.groups.flatMap(({ environments }) =>
          environments.map(({ item }) => {
            const tags = readZeropsGroupTags(item.project.tagList);
            return [
              item.project.id,
              botDisplayName({ bot: tags.bot, projectName: item.project.name }),
            ] as const;
          }),
        ),
      ),
    [groupTree.groups],
  );

  /**
   * Why *Release* is not offered, when a production is declared and it is
   * not: a verb that is missing says nothing (`release.ts`).
   */
  const releaseGateLine = (group: ZeropsGroup) => {
    const flow = groupDeploys.get(group.groupId);
    if (flow === undefined || flow.release.gate.allowed) return null;
    if (!flow.environments.some((entry) => entry.tier === "production")) return null;
    return (
      <li
        className="py-1.5 text-xs text-muted-foreground"
        data-zerops-surface="release-gate"
        key={`release-gate-${group.groupId}`}
      >
        {flow.release.gate.reason}
      </li>
    );
  };

  /**
   * What pressing *Release* would carry, under the row that offers it: one
   * line per commit `main` has that the production is not running, which with
   * squash merges is one line per task delivered (the owner, 2026-09-18 — "it
   * would be great if you could show like what is it going to release, the PRs
   * that it contains"). Nothing is drawn where a release would move nothing.
   */
  const releaseContentLines = (group: ZeropsGroup) => {
    const flow = groupDeploys.get(group.groupId);
    if (flow === undefined || !flow.release.gate.allowed) return null;
    const commits = flow.release.contents.flatMap((entry) => entry.commits);
    if (commits.length === 0) return null;
    return commits.map((commit) => (
      <li
        className="flex gap-2 py-0.5 text-xs text-muted-foreground"
        data-zerops-surface="release-content"
        key={`release-content-${group.groupId}-${commit.sha}`}
      >
        <span className="font-mono tabular-nums">{commit.sha.slice(0, 7)}</span>
        <span className="truncate">{commit.subject}</span>
      </li>
    ));
  };

  /** One pull request's row, the same on both ends of the list. */
  const pullRequestRowOf = (group: ZeropsGroup, pull: FlowPullRequest) => {
    const slug = groupDeploys.get(group.groupId)?.slug;
    // One vocabulary down the column, the same one the project's own page and
    // the left menu use: `changeState` answers a rebase and a passing check in
    // the same register. `checkDotTone` alone said nothing at all about a
    // change that no longer merges, which is the one a person needs to see.
    const state = changeState(pull);
    const merging =
      slug !== undefined &&
      projectFlow.pending.has(
        flowVerbKey({ kind: "merge", slug, repository: pull.repository, number: pull.number }),
      );
    return (
      <ZeropsPullRequestRow
        action={
          pull.mergeable && slug !== undefined ? (
            <ZeropsMateVerb
              disabled={merging}
              label={flowVerbLabel("merge", merging)}
              onClick={() => {
                void projectFlow.mergePullRequest(slug, pull);
              }}
            />
          ) : undefined
        }
        key={`pull-${group.groupId}-${pull.repository}-${pull.number}`}
        line={pullRequestLineWith(pull, mateNames.get(pull.mateProjectId ?? ""))}
        onOpen={() => {
          void navigate({
            to: "/change/$groupId/$repository/$number",
            params: {
              groupId: group.groupId,
              repository: pull.repository,
              number: String(pull.number),
            },
          });
        }}
        status={
          state === undefined ? undefined : (
            <StatusDot label={state.word} sentence tone={state.tone} />
          )
        }
        tag={pull.kind === "recipe" ? "recipe" : "pr"}
        title={pull.title}
      />
    );
  };

  /**
   * The one line a group says about itself: that the broker has not finished
   * its Gitea side yet (`groupRows.ts`). A group whose org has not been asked
   * about says nothing, so the heading never grows a line and then loses it.
   */
  const groupLines = useMemo(() => {
    const lines = new Map<string, string>();
    for (const entry of registryState.registry.groups) {
      const state = resolveGroupGitea({ organizationExists: giteaOrganizations.get(entry.slug) });
      lines.set(entry.groupId, state === "being-set-up" ? GROUP_BEING_SET_UP_LINE : "");
    }
    return lines;
  }, [giteaOrganizations, registryState.registry.groups]);

  /**
   * Publish a service on its `*.zerops.app` subdomain.
   *
   * First class rather than a recovery step: a production environment cloned
   * from dev comes up unpublished whatever its recipe said, so without this the
   * first deploy lands and the page answers 502 with nothing saying why
   * (`verified.md`, 2026-09-07).
   */
  const requestEnvironment = useCallback(
    (groupId: string, role: ZeropsEnvironmentRole) => {
      if (creationRunning) return;
      setCreationRequest({
        groupId,
        role,
        botName: generateBotName(takenBotNames, (bytes) => crypto.getRandomValues(bytes)),
      });
    },
    [creationRunning, takenBotNames],
  );

  const createEnvironment = useCallback(
    async (groupId: string, role: ZeropsEnvironmentRole, choice: EnvironmentCreationChoice) => {
      if (!activeOrganization || creationRunning) return;
      const isCurrent = captureAccountLifetime();
      const entry = groupTree.groups.find((candidate) => candidate.group.groupId === groupId);
      if (entry === undefined) return;
      const { group } = entry;
      const { name } = choice;

      const plan = planEnvironmentCreation({
        clientId: activeOrganization.id,
        groupId,
        // A group named by its id has no name to mirror.
        ...(group.nameSource === "id" ? {} : { groupName: group.name }),
        role,
        name,
        agents: await readGroupAgents(entry.environments),
        recipe: choice.recipe,
        withAgent: choice.withAgent,
        ...(choice.botName === undefined ? {} : { botName: choice.botName }),
      });
      if (!isCurrent()) return;
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
        isCurrent,
        platform: {
          createProject: ({ clientId: _clientId, ...input }) =>
            runZeropsCommand(
              runtime.commands.createProject({
                organization: organizationRef(activeOrganization.id),
                ...input,
              }),
            ),
          // A read, not a write: the platform's verdict on the project the
          // command above made, waited on by the executor.
          readProjectCreation: (input) =>
            client.readProjectCreation(input, unmountRef.current?.signal),
          importDevelopmentContainer: ({ projectId, ...input }) =>
            runZeropsCommand(
              runtime.commands.importDevelopmentContainer({
                project: projectRef(activeOrganization.id, projectId),
                ...input,
              }),
            ),
          importServices: (projectId, yaml) =>
            runZeropsCommand(
              runtime.commands.importServices(projectRef(activeOrganization.id, projectId), yaml),
            ),
          listIntegrationTokenGrants: async ({ clientId: _clientId }) =>
            integrationTokensFromGrantMetadata(
              await runZeropsCommand(
                runtime.commands.listIntegrationTokenGrants(organizationRef(activeOrganization.id)),
              ),
            ),
          setIntegrationTokenProjects: ({ clientId: _clientId, ...input }) =>
            runZeropsCommand(
              runtime.commands.setIntegrationTokenProjects({
                organization: organizationRef(activeOrganization.id),
                ...input,
              }),
            ),
          listTokenDelegations: ({ clientId: _clientId, ...input }) =>
            runZeropsCommand(
              runtime.commands.listTokenDelegations({
                organization: organizationRef(activeOrganization.id),
                ...input,
              }),
            ),
          deleteTokenDelegation: ({ clientId: _clientId, ...input }) =>
            runZeropsCommand(
              runtime.commands.deleteTokenDelegation({
                organization: organizationRef(activeOrganization.id),
                ...input,
              }),
            ),
          isolateProjectEnvironment: ({ projectId }) =>
            runZeropsCommand(
              runtime.commands.isolateProjectEnv(projectRef(activeOrganization.id, projectId)),
            ),
          importProject: ({ clientId: _clientId, yaml }) =>
            runZeropsCommand(
              runtime.commands.importProject(organizationRef(activeOrganization.id), yaml),
            ),
          readObservedServices: async (projectId) => {
            const outcome = inventoryRef.current.services.get(projectId);
            return outcome?.status === "resolved"
              ? outcome.services.map((service) => ({
                  name: service.name,
                  status: service.status,
                }))
              : [];
          },
        },
        describeError: zeropsErrorMessage,
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
          }),
        onProgress: (progress) => {
          if (!isCurrent()) return;
          setCreation((current) => (current === null ? current : { ...current, progress }));
        },
      });

      if (!isCurrent()) return;

      // What this environment is for, said once, where the Mate that has to do
      // it will read it (`creationHandoff.ts`). Written against the project
      // because that is all a creation knows; the connect moves it onto the
      // environment id. Written as soon as the project exists: a Mate whose
      // creation failed a step later still opens on its own job, not on the
      // generic opening line (Fen, 2026-09-17).
      if (outcome.projectId !== undefined) {
        rememberCreationHandoff(outcome.projectId, {
          environmentName: name,
          groupName: group.name,
          role,
          source:
            choice.recipe.kind === "tier"
              ? // Imported `startWithoutCode`: the services that build from a
                // repository exist and run nothing until their first deploy. A
                // managed service needs none, so it is not named.
                { kind: "tier", services: Object.keys(choice.recipe.sources) }
              : { kind: "none" },
        });
      }

      // A Mate an owner or an admin makes is registered as soon as its project
      // exists, the way *New project* registers the first — a creation that
      // failed past that point included (Fen, 2026-09-17: a step after the
      // project failed and the Mate ran unregistered, with no bot and no
      // token). Without the entry the broker gives it no bot, and its agent
      // cannot push to the group's repositories. A member cannot write the
      // registry; their Mate waits on the card's *Register in {group}*
      // (guide 4.2).
      if (
        role === "dev" &&
        outcome.projectId !== undefined &&
        giteaProjectId !== undefined &&
        canWriteRegistry(activeOrganization)
      ) {
        const outstanding = await registerMateInGroup({
          client,
          clientId: activeOrganization.id,
          giteaProjectId,
          registry: registryState.registry,
          groupId,
          projectId: outcome.projectId,
        });
        registryState.refresh();
        if (!isCurrent()) return;
        if (outstanding !== null) setToolError(outstanding);
      }

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
        return;
      }

      // A stage or a production is a **group environment**: it goes in the
      // registry, the broker's token has to reach it, and its sources have to
      // be declared on the group repo before the broker will deploy anything
      // (guide 5.2). A Mate is none of those things.
      if (role === "stage" || role === "prod") {
        const written = await addGroupEnvironment({
          client,
          gitea: giteaOrigin === undefined ? null : giteaClientFor(giteaOrigin),
          clientId: activeOrganization.id,
          giteaProjectId,
          registry: registryState.registry,
          groupId,
          slug: registryGroupSlug(registryState.registry, groupId),
          environment: {
            displayName: name,
            tier: role === "prod" ? "production" : "stage",
            project: outcome.projectId,
          },
        });
        registryState.refresh();
        if (!isCurrent()) return;
        // Not a failed creation: the project exists and runs, and what is
        // outstanding is named so the person knows what is waiting on whom.
        if (written.failed !== undefined) setToolError(written.failed.reason);
      }

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
        current === null
          ? current
          : { ...current, outcome: { kind: "done", undeployed: outcome.undeployed } },
      );
    },
    [
      activeOrganization,
      creationRequest?.groupId,
      creationRunning,
      groupTree.groups,
      provisioning,
      readGroupAgents,
      organizationRef,
      projectRef,
      resetConnectingTarget,
      setConnectError,
      setCreatingIn,
      runtime.commands,
      client,
      giteaOrigin,
      giteaProjectId,
      registryState,
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
      await runZeropsCommand(
        runtime.commands.createToolProject({
          organization: organizationRef(activeOrganization.id),
          toolKind: "gitea",
          name: toolProjectName("gitea"),
          appUrl: window.location.origin,
        }),
      );
    } catch (cause) {
      setToolError(zeropsErrorMessage(cause));
    }
  }, [activeOrganization, organizationRef, runtime.commands]);

  // A Mate's group is its token: every environment in the group readable,
  // its own writable. Reconciled off the list this screen already has, on
  // every read — a grant write restarts nothing, and a group that has not
  // moved is not written (`groupReach.ts`).
  useZeropsGroupReach({
    clientId: activeOrganization?.id,
    enabled: status === "signed-in" && !isLoading,
    groups: useMemo(
      () =>
        groupTree.groups.map((entry) => ({
          projectIds: entry.environments.map(({ item }) => item.project.id),
          mateProjectIds: entry.environments
            .filter(({ item }) => hasMate(item))
            .map(({ item }) => item.project.id),
        })),
      [groupTree.groups],
    ),
  });

  // A stage or a production whose creation lost its last writes — the
  // registry, the broker's grant, the declaration — is finished here, off the
  // same list, once no creation is on its way in this tab
  // (`useZeropsGroupEnvironmentReconcile`).
  const declaredByGroup = useMemo(
    () =>
      new Map(
        [...groupDeploys].map(([groupId, state]) => [
          groupId,
          new Set(state.environments.map((entry) => entry.projectId)),
        ]),
      ),
    [groupDeploys],
  );
  // An environment made before a job deployed (D27) has no deploy token on
  // the broker; a person who may mint one finishes it here like any other
  // write a creation lost.
  const declaredProjects = useMemo(
    () => [...declaredByGroup.values()].flatMap((projects) => [...projects]),
    [declaredByGroup],
  );
  const [deployTokenGeneration, setDeployTokenGeneration] = useState(0);
  const withoutDeployToken = useZeropsDeployTokenGaps({
    client,
    giteaProjectId,
    declaredProjects,
    enabled:
      status === "signed-in" &&
      (activeOrganization?.roleCode === "ADMIN" || activeOrganization?.roleCode === "OWNER"),
    generation: deployTokenGeneration,
  });
  const halfMade = useMemo(
    () =>
      halfMadeGroupEnvironments({
        projects: candidates.map((candidate) => candidate.project),
        registry: registryState.registry,
        declared: declaredByGroup,
        withoutDeployToken,
      }),
    [candidates, declaredByGroup, registryState.registry, withoutDeployToken],
  );
  useZeropsGroupEnvironmentReconcile({
    enabled: status === "signed-in" && projectFlow.signedIn && !isLoading && !creationRunning,
    client,
    clientId: activeOrganization?.id,
    giteaOrigin,
    giteaProjectId,
    registry: registryState.registry,
    refreshRegistry: registryState.refresh,
    halfMade,
    // Not a failed creation: the project runs, and what is outstanding is
    // named so the person knows what is waiting on whom.
    onOutcome: (entry, outcome) => {
      setDeployTokenGeneration((current) => current + 1);
      if (outcome.failed !== undefined) {
        setToolError(`${entry.displayName}: ${outcome.failed.reason}`);
      }
    },
  });

  // The throwaways a crashed tab left on the account. Nothing a person did
  // asks for this; it is here because this is where an account is read.
  useZeropsThrowawaySweep({
    clientId: activeOrganization?.id,
    enabled: status === "signed-in",
  });

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

  // Resumes a creation. The wizard hands its project over and comes here
  // without waiting (`rememberCreationHandoff`); a reload mid-provisioning
  // lands here too. Either way, the moment a created-and-never-connected
  // container answers ready this starts the wait that ends in the
  // conversation — once per project per mount, and never over a wait that
  // is already running.
  const resumedRef = useRef(new Set<string>());
  useEffect(() => {
    if (provisioning.state !== null || connectingOrigin !== null) return;
    const pending = pendingCreationProjects();
    if (pending.length === 0) return;
    const candidate = candidates.find(
      (entry) =>
        pending.includes(entry.project.id) &&
        !resumedRef.current.has(entry.project.id) &&
        entry.group === "ready" &&
        entry.connection === undefined &&
        entry.containerOrigin !== undefined &&
        candidateHealth.get(entry.key) === "ready",
    );
    if (candidate === undefined) return;
    resumedRef.current.add(candidate.project.id);
    startWaitFor(candidate);
  }, [candidateHealth, candidates, connectingOrigin, provisioning.state, startWaitFor]);

  // A wait on a project the platform failed to create can never end: the
  // container it waits for will not be made. The moment the verdict is in,
  // the wait stops and the row's own line takes over.
  useEffect(() => {
    const waitedProjectId = provisioning.state?.projectId ?? null;
    if (waitedProjectId === null) return;
    const failed = candidates.some(
      (candidate) =>
        candidate.project.id === waitedProjectId && candidate.creationFailed !== undefined,
    );
    if (!failed) return;
    provisioning.cancel();
    setCreatingIn(null);
  }, [candidates, provisioning, setCreatingIn]);

  // The registration flow's one dead end: no ready-made project to wait on,
  // so the only way forward is to create one.
  useEffect(() => {
    if (provisioning.state?.phase !== "pool-exhausted") return;
    provisioning.cancel();
    setCreatingIn(null);
    void navigate({ to: "/zerops/new" });
  }, [navigate, provisioning, setCreatingIn]);

  // Enters the provisioning wait without the user clicking anything, for the
  // two-hop registration flow only. A returning account never infers a new
  // setup flow from an unrelated provisioning project in the inventory.
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
  }, [clearLastRegistration, creatingIn, lastRegistration, provisioning]);

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
        organizations={organizations}
        status={organizationStatus}
        onSelect={(membershipId) => {
          void selectOrganization(membershipId);
        }}
      />
    );
  }

  // A wait is never a page of its own: the waited-on Mate's card carries it
  // — the face asleep, the line saying how long, a failure and its retry on
  // the same line — and the rest of the roster stays where it was.
  const connectErrorOnRow = connectError !== null && candidates.some(waitedOn);
  const pageError = (connectErrorOnRow ? null : connectError) ?? error;

  return (
    <div className="space-y-6">
      {!readOnce && candidates.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Spinner className="size-3.5" />
          <span>Reading your projects…</span>
        </div>
      ) : null}
      {pageError === null ? null : (
        <div
          className="rounded-md border border-[var(--zerops-status-failed)]/40 bg-[var(--zerops-status-failed-surface)] px-3 py-2 text-sm text-[var(--zerops-status-failed-text)]"
          role="alert"
        >
          {pageError}
        </div>
      )}
      <ZeropsGroupTree
        // A group is offered more once its first Mate is up — connected, or
        // its container answering ready — and not a minute before.
        addsOffered={groupAddsOffered}
        creating={creationRunning}
        getKey={(candidate: ZeropsCandidatePresentation) => candidate.key}
        groupLine={(group) => groupLines.get(group.groupId) ?? ""}
        isMate={hasMate}
        onCreateEnvironment={requestEnvironment}
        onCreateProject={
          hasNoZeropsProject({ candidates, unread: !readOnce, creationPending })
            ? () => {
                void navigate({ to: "/zerops/new" });
              }
            : undefined
        }
        onCreateTool={() => {
          void createTool();
        }}
        renderEnvironment={(candidate: ZeropsCandidatePresentation, role) => {
          const input = rowInput(candidate, role);
          const presentation = deriveZeropsRowPresentation(input);
          const action = deriveZeropsRowAction(input);
          const tags = readZeropsGroupTags(candidate.project.tagList);
          const busy = busyKeys.has(candidate.key);
          // The project itself is the row's concern. Only a project on its
          // way in, or out of reach, gets a word; one that is simply there
          // says nothing.
          const projectTrouble =
            candidate.group === "provisioning" ||
            (candidate.group === "unavailable" && candidate.missingContainer !== true);
          // A group environment says what it follows and what it runs — the
          // branch and the deployed commit, from the two parties that can
          // prove each (`groupDeploys.ts`). Anything else keeps the summary of
          // what it holds.
          const declared = declaredEnvironment(candidate.project.id);
          const deployTone = declared === undefined ? undefined : deployRowTone(declared.tone);
          const deployLabel = declared === undefined ? undefined : deployWord(declared.tone);
          // *Release* is the answer panel's, at the head of the project, on
          // the row that says how many changes are waiting — one element for
          // the fact and the verb that acts on it. A second copy on the
          // production row put the same verb on the page twice, one of them
          // with nothing beside it saying why (the owner, 2026-09-19).
          return (
            <ZeropsEnvironmentRow
              action={
                action.kind === "set-up-mate" ? (
                  <ZeropsMateVerb
                    disabled={busy}
                    label={busy ? "Setting up…" : action.label}
                    onClick={() => {
                      runRowAction(candidate, action.kind);
                    }}
                  />
                ) : action.kind === "remove" ? (
                  <ZeropsMateVerb
                    disabled={busy}
                    label={busy ? "Removing…" : action.label}
                    onClick={() => {
                      runRowAction(candidate, action.kind);
                    }}
                  />
                ) : undefined
              }
              busy={busy}
              menu={renderEnvironmentMenu(candidate, tags, false)}
              // `Links - stage` under a heading that says `Links`: the group's
              // own page calls it `stage`, and so does the left menu.
              name={environmentNameUnderGroup(tags.label, candidate.project.name)}
              status={
                projectTrouble ? (
                  <StatusDot
                    label={presentation.status.label}
                    sentence
                    tone={presentation.status.tone}
                    {...(presentation.status.pulse === undefined
                      ? {}
                      : { pulse: presentation.status.pulse })}
                  />
                ) : deployTone !== undefined && deployLabel !== undefined ? (
                  <StatusDot label={deployLabel} sentence tone={deployTone} />
                ) : undefined
              }
              // A project the platform failed to create holds nothing; its
              // line is what happened, not "No services yet".
              summary={
                candidate.creationFailed !== undefined
                  ? presentation.detail
                  : declared === undefined
                    ? summaryOf(candidate)
                    : declared.line
              }
              tag={environmentRoleTag(role)}
            />
          );
        }}
        renderWaitingRows={(group: ZeropsGroup) =>
          (groupDeploys.get(group.groupId)?.pullRequests ?? [])
            .filter((pull) => pull.kind === "code")
            .map((pull) => pullRequestRowOf(group, pull))
        }
        renderGroupRows={(group: ZeropsGroup) => (
          <>
            {releaseGateLine(group)}
            {releaseContentLines(group)}
            {/* The releases, newest first, each with the broker's word and,
                on an earlier approved one, the way back to it. */}
            {(groupDeploys.get(group.groupId)?.releases ?? []).map((release) => {
              const tone = releaseRowTone(release.verdict);
              const rollingBack = projectFlow.pending.has(
                flowVerbKey({ kind: "roll-back", groupId: group.groupId, tag: release.tag }),
              );
              return (
                <ZeropsEnvironmentRow
                  action={
                    release.rollBack ? (
                      <ZeropsMateVerb
                        disabled={rollingBack}
                        label={flowVerbLabel("roll-back", rollingBack)}
                        onClick={() => {
                          void projectFlow.rollBack(group.groupId, release.tag);
                        }}
                      />
                    ) : undefined
                  }
                  key={`release-${group.groupId}-${release.tag}`}
                  name={release.tag}
                  status={
                    tone === undefined || release.word === undefined ? undefined : (
                      <StatusDot label={release.word} sentence tone={tone} />
                    )
                  }
                  summary={release.line}
                  tag="release"
                />
              );
            })}
            {/* The recipe changes waiting on somebody: last, under the
                environments they would change. */}
            {(groupDeploys.get(group.groupId)?.pullRequests ?? [])
              .filter((pull) => pull.kind === "recipe")
              .map((pull) => pullRequestRowOf(group, pull))}
            {/* The tiers the recipe offers and the group lacks: the rows that
                ask. The verb is the same one the group's foot offered, moved
                up to where the answer will sit; it waits for the first Mate
                like the foot does. */}
            {(groupDeploys.get(group.groupId)?.missing ?? []).map((row) => {
              const role = row.tier === "stage" ? "stage" : "prod";
              return (
                <ZeropsEnvironmentRow
                  action={
                    groupAddsOffered(group) ? (
                      <ZeropsMateVerb
                        disabled={creationRunning}
                        label={`Add ${row.name.toLowerCase()}`}
                        onClick={() => {
                          requestEnvironment(group.groupId, role);
                        }}
                      />
                    ) : undefined
                  }
                  key={`missing-${group.groupId}-${row.tier}`}
                  name={row.name}
                  summary={row.line}
                  tag={environmentRoleTag(role)}
                />
              );
            })}
          </>
        )}
        roleOffered={(group: ZeropsGroup, role) =>
          !(groupDeploys.get(group.groupId)?.missing ?? []).some(
            (row) => (row.tier === "stage" ? "stage" : "prod") === role,
          )
        }
        renderGroupAnswer={(group: ZeropsGroup) => (
          <ZeropsGroupAnswer className="mb-1" groupId={group.groupId} />
        )}
        renderGroupMenu={(group: ZeropsGroup) => (
          <ZeropsProjectMenu
            actions={[
              {
                id: "rename-group",
                label: "Rename project",
                onSelect: () => {
                  setRowDialog({ kind: "rename-group", group });
                },
              },
            ]}
            label={`More for ${group.name}`}
          />
        )}
        renderMate={(candidate: ZeropsCandidatePresentation, role) => {
          const input = rowInput(candidate, role);
          const presentation = deriveZeropsRowPresentation(input);
          const action = deriveZeropsRowAction(input);
          const tags = readZeropsGroupTags(candidate.project.tagList);
          const connected = candidate.group === "connected";
          const busy = busyKeys.has(candidate.key);
          const live =
            connected && candidate.environmentId !== undefined
              ? activity.get(candidate.environmentId)
              : undefined;
          // Clicking a Mate opens it: a connected one straight away, a ready
          // one by connecting first. Coming up, it is not clickable — nothing
          // a click could do that the page is not already doing.
          const select =
            action.kind === "open" && !busy
              ? () => {
                  runRowAction(candidate, "open");
                }
              : undefined;
          // Not a hover-only verb on the line: a real, always-visible button
          // at the card's trailing edge, next to where the menu sits.
          const startAction =
            action.kind === "start" ? (
              <Button
                disabled={busy}
                onClick={() => {
                  runRowAction(candidate, "start");
                }}
                size="compact"
                variant="outline"
              >
                <PlayIcon />
                {busy ? "Starting…" : "Start"}
              </Button>
            ) : undefined;
          // The platform failed to make this project and nothing will ever
          // run in it: the one verb takes it away, at the same edge Start sits.
          const removeAction =
            action.kind === "remove" ? (
              <Button
                disabled={busy}
                onClick={() => {
                  runRowAction(candidate, "remove");
                }}
                size="compact"
                variant="outline"
              >
                {busy ? "Removing…" : "Remove"}
              </Button>
            ) : undefined;
          const name = botDisplayName({ bot: tags.bot, projectName: candidate.project.name });
          const tint = tints.get(candidate.project.id) ?? "slate";

          if (connected && candidate.environmentId !== undefined) {
            const environmentId = candidate.environmentId;
            // The update control's line ("Server x.y.z · x.y.z+1 available")
            // stays off the card: the version is in the menu, and so is the
            // update verb the control supplies.
            return (
              <ZeropsMateUpdateControl environmentId={environmentId} key={candidate.key}>
                {({ menuActions }) => (
                  <ZeropsMateCard
                    action={startAction ?? removeAction}
                    busy={busy}
                    face={mateFace(candidate)}
                    line={renderMateLine(candidate, presentation, action, live, busy)}
                    menu={renderEnvironmentMenu(candidate, tags, true, action, menuActions)}
                    name={name}
                    onSelect={select}
                    snippet={live?.subject === undefined ? undefined : live.snippet}
                    time={
                      live?.subject === undefined ? undefined : formatRelativeTimeLabel(live.at)
                    }
                    tint={tint}
                  />
                )}
              </ZeropsMateUpdateControl>
            );
          }
          return (
            <ZeropsMateCard
              action={startAction ?? removeAction}
              busy={busy}
              face={mateFace(candidate)}
              line={renderMateLine(candidate, presentation, action, live, busy)}
              menu={renderEnvironmentMenu(candidate, tags, true, action, [])}
              name={name}
              onSelect={select}
              tint={tint}
            />
          );
        }}
        renderTool={(candidate: ZeropsCandidatePresentation, kind) => {
          // A tool has no Mate and never will, so the environment classifier's
          // verdict is meaningless here. Gitea's own state (`deriveGiteaState`,
          // read once for the account) says whether it is up and where it is;
          // the platform's project status covers the minutes before its
          // services exist.
          const gitea =
            accountGitea?.projectId === candidate.project.id ? accountGitea.state : undefined;
          const line = giteaToolLine({
            projectStatus: candidate.project.status,
            phase: gitea?.phase,
            url: gitea?.url,
          });
          return (
            <ZeropsToolCard
              line={
                line.kind === "link" ? (
                  <a
                    className="min-w-0 truncate underline-offset-2 hover:text-foreground hover:underline"
                    data-zerops-surface="tool-link"
                    href={line.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {line.label}
                  </a>
                ) : line.kind === "setting-up" ? (
                  <span className="min-w-0 truncate">Setting up.</span>
                ) : line.kind === "unavailable" ? (
                  <span className="min-w-0 truncate">Not available.</span>
                ) : undefined
              }
              menu={
                <ZeropsProjectMenu
                  actions={[]}
                  enablingServiceId={route.enablingServiceId}
                  label={`More for ${TOOL_LABEL[kind]}`}
                  offers={candidate.routeOffers}
                  onEnableRoute={(offer) => {
                    void route.enable(candidate.project.id, offer.serviceId);
                  }}
                  routes={candidate.routes}
                />
              }
              name={TOOL_LABEL[kind]}
            />
          );
        }}
        view={groupTree}
      />
      {mateActions.dialogs}
      {rowDialog?.kind === "rename-group" ? (
        <ZeropsRenameDialog
          description="The name is written onto every environment in the project."
          initialValue={rowDialog.group.nameSource === "id" ? "" : rowDialog.group.name}
          key={`rename-group:${rowDialog.group.groupId}`}
          label="Project name"
          onCancel={() => {
            setRowDialog(null);
          }}
          onOpenChange={(open) => {
            if (!open) setRowDialog(null);
          }}
          onSubmit={(name) => {
            const { group } = rowDialog;
            setRowDialog(null);
            void renameGroup.rename(group, name);
          }}
          open
          submitLabel="Rename"
          title={rowDialog.group.nameSource === "id" ? "Name this project" : "Rename the project"}
          validate={(value) => (value.trim().length === 0 ? "Give the project a name." : undefined)}
        />
      ) : null}
      {creationRequest === null || requestedGroup === undefined ? null : (
        <ZeropsEnvironmentCreationDialog
          tier={groupRecipe.tier}
          tierServices={groupRecipe.services}
          tierLoading={groupRecipe.loading}
          defaultBotName={creationRequest.botName}
          defaultName={proposedEnvironmentName({
            groupName: requestedGroup.group.name,
            roleLabel:
              environmentRoleLabel(creationRequest.role)?.toLowerCase() ?? creationRequest.role,
            botName: creationRequest.role === "dev" ? creationRequest.botName : undefined,
            taken: requestedGroup.environments.map(({ item }) => item.project.name),
          })}
          proposeName={(botName) =>
            proposedEnvironmentName({
              groupName: requestedGroup.group.name,
              roleLabel:
                environmentRoleLabel(creationRequest.role)?.toLowerCase() ?? creationRequest.role,
              botName: creationRequest.role === "dev" ? botName : undefined,
              taken: requestedGroup.environments.map(({ item }) => item.project.name),
            })
          }
          defaultWithAgent={defaultAgentForRole(creationRequest.role)}
          groupName={requestedGroup.group.name}
          key={`${creationRequest.groupId}:${creationRequest.role}`}
          onCancel={() => {
            setCreationRequest(null);
          }}
          onCreate={(choice) => {
            const { groupId, role } = creationRequest;
            setCreationRequest(null);
            void createEnvironment(groupId, role, choice);
          }}
          onOpenChange={(open) => {
            if (!open) setCreationRequest(null);
          }}
          open
          role={creationRequest.role}
          takenBotNames={takenBotNames}
        />
      )}
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
      {toolError === null && renameGroup.trouble === null && route.trouble === null ? null : (
        <p className="text-sm text-[var(--zerops-status-failed-text)]">
          {toolError ?? renameGroup.trouble ?? route.trouble}
        </p>
      )}
    </div>
  );
}

export function ZeropsProjectsPage() {
  const { activeOrganization, organizations, organizationStatus, selectOrganization, status } =
    useZeropsSession();
  const { candidates, isLoading, readOnce, refresh } = useZeropsCandidates();
  const scoped =
    status === "signed-in" && organizationStatus === "selected" && activeOrganization !== null;
  // First run owns the page: an account with nothing in it gets the
  // invitation and no title row over it — a "Projects" heading with a reload
  // over nothing frames emptiness as a failed list.
  const firstRun = hasNoZeropsProject({
    candidates,
    unread: !readOnce,
    creationPending: pendingCreationProjects().length > 0,
  });

  return (
    <ZeropsHostedFrame
      width="readable"
      actions={
        <>
          {scoped ? (
            <ZeropsOrganizationSwitcher
              activeOrganization={activeOrganization}
              organizations={organizations}
              onSelect={(membershipId) => {
                void selectOrganization(membershipId);
              }}
            />
          ) : null}
          <ZeropsSessionAccountControl />
        </>
      }
    >
      {scoped && !firstRun ? (
        <ZeropsProjectsHeader onRefresh={refresh} refreshing={isLoading} />
      ) : null}
      <ZeropsProjectsContent />
    </ZeropsHostedFrame>
  );
}
