/**
 * Stands one environment up in a group — a Mate, a stage or a production — from whatever surface
 * asked for it: the New Mate dialog over any view (`ZeropsNewMateHost`), and the projects page's
 * own adds. The plan is `planEnvironmentCreation`, the press `matePress.ts`; this only gathers the
 * inputs — the group's agents and environments, the account's Gitea, who asked — and presses.
 *
 * The press does every step that needs this person's rights before it returns: the project, a
 * Mate's key and container, its project closed off, and the group registration an owner or an
 * admin — or anyone adding a stage or a production — writes. A member's Mate waits for one of
 * them to *Finish setup*. The container does the rest whether this tab stays or not.
 */
import {
  canWriteRegistry,
  planEnvironmentCreation,
  recipeTierServices,
  unionAgents,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type RecipeRuntime,
  type ZeropsAgentType,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { ZeropsServiceId, type AgentsCellRequest } from "@t3tools/client-runtime/zerops/data";
import { useCallback, useEffect, useRef } from "react";

import type { EnvironmentCreationChoice } from "../components/zerops/ZeropsEnvironmentCreationDialog";
import { invalidateZerops } from "./accountInvalidations";
import { captureAccountLifetime } from "./accountLifetime";
import { useAccountGitea } from "./giteaProject";
import { beginPress, pressPlatform, pressRegistration, pressViewer, runPress } from "./matePress";
import { readZeropsCellOnce } from "./useZeropsDeployedVersion";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { useZeropsData } from "./zeropsDataContext";

/** One environment to stand up in a group, as the surface that asked for it knows it. */
export interface EnvironmentCreationRequest {
  readonly group: ZeropsGroup;
  /** The group's environments, whose agents a new one offers the same of. */
  readonly environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>;
  readonly role: ZeropsEnvironmentRole;
  readonly choice: EnvironmentCreationChoice;
  /** The steps it will take, once planned. */
  readonly onPlanned?: (steps: ReadonlyArray<EnvironmentCreationStep>) => void;
  readonly onProgress?: (progress: ReadonlyArray<EnvironmentCreationStepProgress>) => void;
  /** The platform took the project: the rest of the press acts on it. */
  readonly onAccepted?: (projectId: string) => void;
}

/** How a creation ended, for the surface that started it. */
export type EnvironmentCreationRun =
  /** Nothing was asked of the platform: no organization, the account closed, or a plan refused. */
  | { readonly kind: "refused"; readonly reason: string | null }
  | {
      readonly kind: "ran";
      readonly outcome: EnvironmentCreationOutcome;
      /** The environment gets an agent: its container sets itself up after the press. */
      readonly withAgent: boolean;
    };

/**
 * What a press's plan brings, for the screen to name before the project lists it: the managed
 * services its first import makes, in the tier's order, and the runtimes zcp imports on boot.
 */
export function pressPlanned(steps: ReadonlyArray<EnvironmentCreationStep>): {
  readonly managed?: ReadonlyArray<string>;
  readonly runtimes?: ReadonlyArray<RecipeRuntime>;
} {
  let managed: Array<string> = [];
  let runtimes: ReadonlyArray<RecipeRuntime> | undefined;
  for (const step of steps) {
    if (step.kind === "import-managed" || step.kind === "import-project") {
      managed = (recipeTierServices(step.yaml) ?? []).flatMap((service) =>
        service.role === "managed" ? [service.hostname] : [],
      );
    }
    if (step.kind === "import-container" && step.runtimes !== undefined) {
      runtimes = step.runtimes.services;
    }
  }
  return {
    ...(managed.length === 0 ? {} : { managed }),
    ...(runtimes === undefined ? {} : { runtimes }),
  };
}

export function useEnvironmentCreation(): (
  request: EnvironmentCreationRequest,
) => Promise<EnvironmentCreationRun> {
  const { activeOrganization, client, user } = useZeropsSession();
  // Who asks for the stand-up of a Mate they add (`mate:standup:`).
  const asker = user?.id;
  const { organizationRef, projectRef, runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const inventoryRef = useRef(inventory);
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);
  const accountGitea = useAccountGitea(activeOrganization?.id);
  const giteaProjectId = accountGitea?.projectId;
  // Read exactly as the account's Gitea project states it: an account on a devel region or behind
  // a custom domain is read, never guessed.
  const giteaOrigin = accountGitea?.state.url;

  /**
   * The agents a group's existing environments are signed in with, so a Mate born into that group
   * offers the same ones instead of the platform's whole menu (`agentSelection.ts`). A read that
   * fails is no reason to refuse a creation: the empty answer leaves `ZCP_AGENTS` out, and the
   * container offers every agent.
   */
  const readGroupAgents = useCallback(
    async (
      environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>,
    ): Promise<ReadonlyArray<ZeropsAgentType>> =>
      unionAgents(
        await Promise.all(
          environments.flatMap(({ item }) => {
            if (item.service === undefined || activeOrganization === null) return [];
            const request: AgentsCellRequest = {
              kind: "agents",
              account: runtime.scope,
              service: {
                kind: "service",
                project: projectRef(activeOrganization.id, item.project.id),
                serviceId: ZeropsServiceId.make(item.service.id),
              },
            };
            return [
              readZeropsCellOnce(runtime.cells, request).then(
                (agents): ReadonlyArray<ZeropsAgentType> => agents ?? [],
              ),
            ];
          }),
        ),
      ),
    [activeOrganization, projectRef, runtime.cells, runtime.scope],
  );

  return useCallback(
    async (request: EnvironmentCreationRequest): Promise<EnvironmentCreationRun> => {
      if (activeOrganization === null) return { kind: "refused", reason: null };
      const organization = activeOrganization;
      const isCurrent = captureAccountLifetime();
      const { group, role, choice } = request;
      const { name } = choice;
      const tier = role === "prod" ? "production" : role === "stage" ? "stage" : null;
      // A Mate's registration is an owner's or an admin's to write; a stage or a production's is
      // anyone's who adds one. Without the account's Gitea there is no registry to write it in.
      const registers =
        giteaProjectId !== undefined && (tier !== null || canWriteRegistry(organization));

      const plan = planEnvironmentCreation({
        clientId: organization.id,
        groupId: group.groupId,
        // A group named by its id has no name to mirror.
        ...(group.nameSource === "id" ? {} : { groupName: group.name }),
        role,
        name,
        agents: await readGroupAgents(request.environments),
        recipe: choice.recipe,
        withAgent: choice.withAgent,
        register: registers,
        ...(choice.botName === undefined ? {} : { botName: choice.botName }),
        ...(asker ? { standUpBy: asker, madeBy: asker } : {}),
        ...(choice.face === undefined ? {} : { face: choice.face }),
      });
      if (!isCurrent()) return { kind: "refused", reason: null };
      if (!plan.ok) return { kind: "refused", reason: plan.reason };

      const withAgent = plan.steps.some((step) => step.kind === "import-container");
      const inputs = {
        client,
        data: { runtime, organizationRef, projectRef },
        organizationId: organization.id,
      };
      const platform = pressPlatform(inputs, {
        groupProjectIds: request.environments.map(({ item }) => item.project.id),
        viewer: pressViewer(user, organization),
        register:
          registers && giteaProjectId !== undefined
            ? pressRegistration(inputs, {
                giteaProjectId,
                giteaOrigin: tier === null ? null : (giteaOrigin ?? null),
                groupId: group.groupId,
                kind: tier ?? "mate",
                displayName: name,
              })
            : null,
        // Reads the latest shared-model projection; no platform request.
        readObservedServices: async (projectId) => {
          const services = inventoryRef.current.services.get(projectId);
          return services?.status === "resolved"
            ? services.services.map((service) => ({ name: service.name, status: service.status }))
            : [];
        },
      });

      request.onPlanned?.(plan.steps);
      const outcome = await runPress({
        organizationId: organization.id,
        steps: plan.steps,
        platform,
        isCurrent,
        // The project is drawn in its group from here, and the listing is read again at once so
        // the group catches up with it.
        onProjectAccepted: (projectId) => {
          if (!isCurrent()) return;
          beginPress({
            projectId,
            organizationId: organization.id,
            startedAt: Date.now(),
            container: withAgent,
            ...pressPlanned(plan.steps),
            placement: {
              groupId: group.groupId,
              groupName: group.name,
              kind: tier ?? "mate",
              displayName: name,
              ...(tier === null && choice.botName !== undefined ? { botName: choice.botName } : {}),
              ...(choice.face === undefined ? {} : { face: choice.face }),
            },
          });
          invalidateZerops({ topic: "inventory", organization: organizationRef(organization.id) });
          request.onAccepted?.(projectId);
        },
        onProgress: (progress) => {
          if (isCurrent()) request.onProgress?.(progress);
        },
      });
      return { kind: "ran", outcome, withAgent };
    },
    [
      activeOrganization,
      client,
      giteaOrigin,
      giteaProjectId,
      organizationRef,
      projectRef,
      readGroupAgents,
      runtime,
      asker,
      user,
    ],
  );
}
