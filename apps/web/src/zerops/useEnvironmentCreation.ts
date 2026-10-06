/**
 * Stands one environment up in a group — a Mate, a stage or a production — from whatever surface
 * asked for it: the New Mate dialog over any view (`ZeropsNewMateHost`), and the projects page's
 * own adds. The plan is `planEnvironmentCreation`, the press `matePress.ts`; this only gathers the
 * inputs — the group's agents and environments, who asked — and presses.
 *
 * The press does every step that needs this person's rights before it returns: the project, a
 * Mate's key and container, its project closed off, and its registration in the organization's
 * HQ, which decides who may write it. An organization with no HQ takes no environment (ADR 0001).
 * The container does the rest whether this tab stays or not.
 */
import { HQ_UNFOLLOWED, useAccountOperations } from "./accountOperations";
import {
  appProjectName,
  formatMateFace,
  nameUnderApp,
  planEnvironmentCreation,
  recipeTierServices,
  servicesSettled,
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
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { RegistryContext } from "@effect/atom-react";
import {
  creationStepId,
  projectServicesAtom,
  type ProjectServices,
  type RunToEnd,
} from "@t3tools/client-runtime/data";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { useCallback, useContext } from "react";

import type { EnvironmentCreationChoice } from "../components/zerops/ZeropsEnvironmentCreationDialog";
import { accountHqApi, officialHq, useAccountHq } from "./accountHq";
import { invalidateZerops } from "./accountInvalidations";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import { beginPress, pressHold, pressPlatform, pressRegistration, runPress } from "./matePress";
import { readZeropsCellOnce } from "./readZeropsCell";
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
  /**
   * The creation an Add a Mate runs this press for (`creationRunId`): its birth intent and the
   * write that makes its project are recorded under ids named from it, where its view reads them
   * (`creationSteps`). None for a stage or a production.
   */
  readonly creationId?: string | undefined;
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

/** Only a dev Mate with a recipe has development to stand up after sign-in. */
function addedMateStandUp(
  role: ZeropsEnvironmentRole,
  choice: Pick<EnvironmentCreationChoice, "withAgent" | "recipe">,
): boolean {
  return role === "dev" && choice.withAgent && choice.recipe.kind === "tier";
}

/**
 * The birth intent a Mate added to a group is pressed under (F6c): recorded at HQ before its
 * project exists — its application, its face and, for a dev Mate, the person's ask for its
 * stand-up — so a press cut off between the project and its attach is finished where and as it
 * was asked for, in any browser, its attach recording the ask with the Mate (audit B3). Its name
 * is its project's (D3). None for a stage or a production, or an environment with no agent: no
 * Mate is born.
 */
export async function addedMateBirth(
  /** Records the birth intent at HQ (the `record-birth` operation): its id. */
  record: (birth: {
    readonly appId: string;
    readonly face: string;
    readonly standUp: boolean;
  }) => Promise<string>,
  input: {
    readonly groupId: string;
    readonly role: ZeropsEnvironmentRole;
    readonly choice: Pick<EnvironmentCreationChoice, "face" | "withAgent" | "recipe">;
  },
): Promise<string | undefined> {
  const { choice } = input;
  if ((input.role !== "dev" && input.role !== "devstage") || !choice.withAgent) return undefined;
  return record({
    appId: input.groupId,
    // Empty where none was picked, as its attach records it: the Mate wears its name's tint.
    face: choice.face === undefined ? "" : formatMateFace(choice.face),
    standUp: addedMateStandUp(input.role, choice),
  });
}

/**
 * What an environment's project is created as in Zerops, and what the client shows it by under its
 * application. A Mate's form asks for its own name and its project is named in full under the
 * application ("SPN - Rune"); a stage's and a production's form asks for the whole name already
 * (`proposedEnvironmentName`).
 */
export function environmentProjectName(
  role: ZeropsEnvironmentRole,
  groupName: string,
  typed: string,
): { readonly name: string; readonly shown: string } {
  const name =
    role === "dev" ? appProjectName(groupName, nameUnderApp(typed, groupName)) : typed.trim();
  return { name, shown: nameUnderApp(name, groupName) };
}

/** What an environment's services' wait says where Zerops refused to say how they stand. */
const SERVICES_REFUSED = "Zerops refused to say how the environment's services stand.";
/** What it says where the account closed while it waited: as a creation's own stop says it. */
const ACCOUNT_CLOSED = "This account session has ended.";

/**
 * Resolves with a project's services once every one has settled (`servicesSettled`), as the
 * account's services listing holds them — read as they change, never on a clock; rejects where
 * that listing is refused, and where the account it waits in closes.
 */
export function untilServicesSettled(
  registry: AtomRegistry.AtomRegistry,
  /** The project's services as the account's store holds them (`projectServicesAtom`). */
  listed: Atom.Atom<ProjectServices>,
): Promise<ReadonlyArray<{ readonly name: string; readonly status: string }>> {
  return new Promise((resolve, reject) => {
    let ended = false;
    let cancel: (() => void) | undefined;
    const finish = () => {
      ended = true;
      cancel?.();
      leave();
    };
    const leave = onAccountLifetimeClose(() => {
      if (ended) return;
      reject(new Error(ACCOUNT_CLOSED));
      finish();
    });
    cancel = registry.subscribe(
      listed,
      ({ services, unavailableReason }) => {
        if (ended) return;
        if (unavailableReason !== undefined) {
          reject(new Error(SERVICES_REFUSED));
          finish();
        } else if (servicesSettled(services)) {
          resolve(services!.map((service) => ({ name: service.name, status: service.status })));
          finish();
        }
      },
      { immediate: true },
    );
    // Its first value may have ended it before its subscription was in hand.
    if (ended) cancel();
  });
}

export function useEnvironmentCreation(): (
  request: EnvironmentCreationRequest,
) => Promise<EnvironmentCreationRun> {
  const { activeOrganization, client } = useZeropsSession();
  const { organizationRef, projectRef, runtime } = useZeropsData();
  const operations = useAccountOperations();
  const registry = useContext(RegistryContext);
  const accountHq = useAccountHq(activeOrganization?.id);

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
      const hq = officialHq(accountHq);
      const organization = activeOrganization;
      const isCurrent = captureAccountLifetime();
      const { group, role, choice, creationId } = request;
      const { name, shown } = environmentProjectName(role, group.name, choice.name);
      const tier = role === "prod" ? "production" : role === "stage" ? "stage" : null;

      // A Mate's birth intent before its project: an HQ that cannot record it takes no project.
      let intent: string | undefined;
      try {
        const record = async (birth: Parameters<Parameters<typeof addedMateBirth>[0]>[0]) =>
          (
            await operations.run(
              { kind: "record-birth", orgId: organization.id, ...birth },
              {
                orgId: organization.id,
                unobserved: HQ_UNFOLLOWED,
                ...(creationId === undefined
                  ? {}
                  : { requestId: creationStepId(creationId, "birth", 1) }),
              },
            )
          ).birthId;
        intent = await addedMateBirth(record, {
          groupId: group.groupId,
          role,
          choice,
        });
      } catch (cause) {
        return { kind: "refused", reason: zeropsErrorMessage(cause) };
      }
      const plan = planEnvironmentCreation({
        clientId: organization.id,
        role,
        name,
        agents: await readGroupAgents(request.environments),
        recipe: choice.recipe,
        withAgent: choice.withAgent,
        ...(intent === undefined ? {} : { birth: intent }),
      });
      if (!isCurrent()) return { kind: "refused", reason: null };
      if (!plan.ok) return { kind: "refused", reason: plan.reason };

      const withAgent = plan.steps.some((step) => step.kind === "import-container");
      // An Add's project, made or imported, is recorded where its creation's view reads it.
      const run: RunToEnd = (intent, options) =>
        operations.run(
          intent,
          creationId !== undefined &&
            (intent.kind === "create-project" || intent.kind === "import-project")
            ? { ...options, requestId: creationStepId(creationId, "project", 1) }
            : options,
        );
      const inputs = {
        client,
        operations: { ...operations, run },
        organizationId: organization.id,
      };
      // Every press is held at HQ while it runs, so another browser never takes it for one that
      // stopped, and one cut short is read as what it was making, in its application (B5).
      const pressKind = withAgent ? "mate" : tier;
      const hold =
        pressKind === null
          ? undefined
          : pressHold(accountHqApi(client, organization.id, hq), {
              kind: pressKind,
              appId: group.groupId,
            });
      const platform = pressPlatform(inputs, {
        register: pressRegistration(
          inputs,
          tier === null
            ? {
                hq,
                groupId: group.groupId,
                kind: "mate",
                mate: { face: choice.face },
                // The person adding a dev Mate with its agent asks for its stand-up — with its
                // birth intent, which its attach closes; the press's close-off marks it closed
                // off, after its record (`planEnvironmentCreation`).
                standUp: addedMateStandUp(role, choice),
                ...(intent === undefined ? {} : { intent }),
              }
            : { hq, groupId: group.groupId, kind: tier },
        ),
        hq,
        untilServicesSettled: (projectId) =>
          untilServicesSettled(registry, projectServicesAtom(projectId)),
      });

      request.onPlanned?.(plan.steps);
      const outcome = await runPress({
        organizationId: organization.id,
        steps: plan.steps,
        platform,
        isCurrent,
        // The project is drawn in its group from here, and the listing is read again at once so
        // the group catches up with it.
        onProjectAccepted: async (projectId) => {
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
              displayName: shown,
              ...(choice.face === undefined ? {} : { face: choice.face }),
            },
          });
          invalidateZerops({ topic: "inventory", organization: organizationRef(organization.id) });
          if (intent !== undefined)
            await operations.run(
              {
                kind: "bind-birth",
                orgId: organization.id,
                appId: group.groupId,
                birthId: intent,
                projectId,
              },
              { orgId: organization.id, unobserved: HQ_UNFOLLOWED },
            );
        },
        onProgress: (progress) => {
          if (isCurrent()) request.onProgress?.(progress);
        },
        hold,
      });
      return { kind: "ran", outcome, withAgent };
    },
    [accountHq, activeOrganization, client, organizationRef, readGroupAgents, registry, operations],
  );
}
