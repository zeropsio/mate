/**
 * Stands one environment up in a group — a Mate, a stage or a production — from whatever surface
 * asked for it: the New Mate dialog over any view (`ZeropsNewMateHost`), and the projects page's
 * own adds. The plan is `planEnvironmentCreation`, the calls `runEnvironmentCreation`; this only
 * gathers the inputs — the group's agents, the account's Gitea, who asked — and makes the calls
 * through the account's command layer.
 *
 * The project is a birth from the moment the platform accepts it (`zeropsBirths.ts`, DESIGN
 * §4.5), which the account's worker finishes whatever the surface does next — a reload or a
 * closed tab included. It carries the group writes this person makes: a Mate an owner or an admin
 * makes is registered as soon as its project exists (without the entry the broker gives it no
 * bot; a member cannot write the registry, and their Mate waits on the card's *Register in
 * {group}*), and a stage or a production is a group environment the registry, the broker's token
 * and the group repo all learn about (guide 4.2, 5.2).
 */
import {
  canWriteRegistry,
  planEnvironmentCreation,
  runEnvironmentCreation,
  unionAgents,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type ZeropsAgentType,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  ZeropsServiceId,
  type ServiceAuthorizedAgentsResourceRequest,
} from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useEffect, useRef } from "react";

import type { EnvironmentCreationChoice } from "../components/zerops/ZeropsEnvironmentCreationDialog";
import { captureAccountLifetime } from "./accountLifetime";
import { useAccountGitea } from "./giteaProject";
import { integrationTokensFromGrantMetadata } from "./useZeropsGroupReach";
import { readZeropsResourceOnce } from "./useZeropsDeployedVersion";
import {
  birthWithoutContainer,
  bornOnAccept,
  creationAccepted,
  importedContainer,
} from "./zeropsBirths";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { runZeropsCommand, useZeropsData } from "./zeropsDataContext";

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
  /** The platform took the project: its birth has begun. */
  readonly onAccepted?: (projectId: string) => void;
}

/** How a creation ended, for the surface that started it. */
export type EnvironmentCreationRun =
  /** Nothing was asked of the platform: no organization, the account closed, or a plan refused. */
  | { readonly kind: "refused"; readonly reason: string | null }
  | {
      readonly kind: "ran";
      readonly outcome: EnvironmentCreationOutcome;
      /** The environment gets an agent: its container is brought up by its birth. */
      readonly withAgent: boolean;
    };

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
              readZeropsResourceOnce(runtime.resources, request).then(
                (agents): ReadonlyArray<ZeropsAgentType> => agents ?? [],
              ),
            ];
          }),
        ),
      ),
    [activeOrganization, projectRef, runtime.resources, runtime.scope],
  );

  return useCallback(
    async (request: EnvironmentCreationRequest): Promise<EnvironmentCreationRun> => {
      if (activeOrganization === null) return { kind: "refused", reason: null };
      const organization = activeOrganization;
      const isCurrent = captureAccountLifetime();
      const { group, role, choice } = request;
      const { name } = choice;
      const tier = role === "prod" ? "production" : role === "stage" ? "stage" : null;

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
        ...(choice.botName === undefined ? {} : { botName: choice.botName }),
        ...(asker ? { standUpBy: asker } : {}),
        ...(choice.face === undefined ? {} : { face: choice.face }),
      });
      if (!isCurrent()) return { kind: "refused", reason: null };
      if (!plan.ok) return { kind: "refused", reason: plan.reason };

      const registers = tier !== null || canWriteRegistry(organization);
      const withAgent = plan.steps.some((step) => step.kind === "import-container");
      // The listing is read again at once, so the group catches up with its birth.
      const accepted = (projectId: string) => {
        if (!isCurrent()) return;
        creationAccepted(
          {
            projectId,
            organizationId: organization.id,
            registration:
              registers && giteaProjectId !== undefined
                ? {
                    giteaProjectId,
                    giteaOrigin: tier === null ? null : (giteaOrigin ?? null),
                    groupId: group.groupId,
                    kind: tier ?? "mate",
                    displayName: name,
                  }
                : null,
            container: withAgent,
            placement: {
              groupId: group.groupId,
              groupName: group.name,
              kind: tier ?? "mate",
              displayName: name,
              ...(tier === null && choice.botName !== undefined ? { botName: choice.botName } : {}),
              ...(choice.face === undefined ? {} : { face: choice.face }),
            },
          },
          organizationRef(organization.id),
        );
        request.onAccepted?.(projectId);
      };

      request.onPlanned?.(plan.steps);
      const outcome = await runEnvironmentCreation({
        clientId: organization.id,
        steps: plan.steps,
        isCurrent,
        platform: bornOnAccept(
          {
            createProject: ({ clientId: _clientId, ...input }) =>
              runZeropsCommand(
                runtime.commands.createProject({
                  organization: organizationRef(organization.id),
                  ...input,
                }),
              ),
            // A read, not a write: the platform's verdict on the project the command above made,
            // waited on by the executor.
            readProjectCreation: (input) => client.readProjectCreation(input),
            importDevelopmentContainer: ({ projectId, ...input }) =>
              runZeropsCommand(
                runtime.commands.importDevelopmentContainer({
                  project: projectRef(organization.id, projectId),
                  ...input,
                }),
              ),
            importServices: (projectId, yaml) =>
              runZeropsCommand(
                runtime.commands.importServices(projectRef(organization.id, projectId), yaml),
              ),
            listIntegrationTokenGrants: async ({ clientId: _clientId }) =>
              integrationTokensFromGrantMetadata(
                await runZeropsCommand(
                  runtime.commands.listIntegrationTokenGrants(organizationRef(organization.id)),
                ),
              ),
            setIntegrationTokenProjects: ({ clientId: _clientId, ...input }) =>
              runZeropsCommand(
                runtime.commands.setIntegrationTokenProjects({
                  organization: organizationRef(organization.id),
                  ...input,
                }),
              ),
            listTokenDelegations: ({ clientId: _clientId, ...input }) =>
              runZeropsCommand(
                runtime.commands.listTokenDelegations({
                  organization: organizationRef(organization.id),
                  ...input,
                }),
              ),
            deleteTokenDelegation: ({ clientId: _clientId, ...input }) =>
              runZeropsCommand(
                runtime.commands.deleteTokenDelegation({
                  organization: organizationRef(organization.id),
                  ...input,
                }),
              ),
            importProject: ({ clientId: _clientId, yaml }) =>
              runZeropsCommand(
                runtime.commands.importProject(organizationRef(organization.id), yaml),
              ),
            readObservedServices: async (projectId) => {
              const services = inventoryRef.current.services.get(projectId);
              return services?.status === "resolved"
                ? services.services.map((service) => ({
                    name: service.name,
                    status: service.status,
                  }))
                : [];
            },
          },
          accepted,
        ),
        describeError: zeropsErrorMessage,
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
          }),
        onProgress: (progress) => {
          if (isCurrent()) request.onProgress?.(progress);
        },
      });

      // A container import that never went through leaves the birth nothing to bring up.
      if (
        isCurrent() &&
        outcome.projectId !== undefined &&
        withAgent &&
        !importedContainer(plan.steps, outcome)
      ) {
        birthWithoutContainer(outcome.projectId);
      }
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
      runtime.commands,
      asker,
    ],
  );
}
