import { randomUUID } from "~/lib/utils";
import {
  ownerAtAdd,
  withProjectGrant,
  type ProjectGrant,
} from "@t3tools/client-runtime/zerops/projectAccess";
import { acquireHqPressLease } from "@t3tools/client-runtime/data";
/**
 * Stands one environment up in a group — a Mate, a stage or a production — from whatever surface
 * asked for it: the New Mate dialog over any view (`ZeropsNewMateHost`), and the projects page's
 * own adds. The plan is `planEnvironmentCreation`; this gathers the inputs — the group's agents and
 * environments, who asked — and hands them on.
 *
 * An environment with a Mate is one Create at HQ (`create-birth`): HQ runs its birth as its
 * operation — project, key, import — whether this tab stays or not, and the Mate's row follows that
 * operation on every device. The plan only refuses what HQ would never be sent. A stage or a
 * production without a Mate is pressed here (`matePress.ts`): its project and its registration in
 * the organization's HQ, which decides who may write it. An organization with no HQ takes no
 * environment (ADR 0001).
 */
import { HQ_UNFOLLOWED, useAccountOperations } from "./accountOperations";
import {
  appProjectName,
  formatMateFace,
  nameUnderApp,
  planEnvironmentCreation,
  recipeTierServices,
  servicesSettled,
  type EnvironmentCreationOutcome,
  type BirthIntent,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type RecipeRuntime,
  type ZeropsEnvironmentRole,
  type CanonicalGroup,
  type ZeropsAgentType,
  type EnvironmentRecipeChoice,
  type ZeropsCorePackage,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { MatePersona } from "@t3tools/contracts";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import { RegistryContext } from "@effect/atom-react";
import {
  creationStepId,
  projectServicesAtom,
  type ProjectServices,
} from "@t3tools/client-runtime/data";
import type { Atom, AtomRegistry } from "effect/reactivity";
import { useCallback, useContext } from "react";

import { accountHqApi, configuredHq } from "./accountHq";
import { pressStreamOf } from "./pressStreams";
import { invalidateZerops } from "./accountInvalidations";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import { beginPress, pressPlatform, pressRegistration, runPress } from "./matePress";
import { useReadGroupAgents } from "./groupAgents";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { useZeropsData } from "./zeropsDataContext";

export interface EnvironmentCreationChoice {
  /** A Mate's own name, which its project's is built from; a stage's or a production's whole project name. */
  readonly name: string;
  readonly withAgent: boolean;
  readonly recipe: EnvironmentRecipeChoice;
  /** The face its person picked: present for a Mate. */
  readonly face?: ZeropsMateFace;
  /** Who reaches its project beyond their organization role, as chosen in the form. */
  readonly userRoles?: ReadonlyArray<ProjectGrant>;
  /** The Zerops core package its project is born on; the free Lightweight one where absent. */
  readonly corePackage?: ZeropsCorePackage;
  /** A Mate made automated (*Add automated Mates*): it takes tasks on the organization's key. */
  readonly automated?: true;
  /** How a Mate works with its person from its stand-up (`NewMatePersona`). */
  readonly persona?: MatePersona;
}

/** One environment to stand up in a group, as the surface that asked for it knows it. */
interface EnvironmentCreationRequest {
  readonly group: Pick<CanonicalGroup, "groupId" | "name">;
  /** The group's environments, whose agents a new one offers the same of. */
  readonly environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>;
  readonly role: ZeropsEnvironmentRole;
  readonly choice: EnvironmentCreationChoice;
  /** The steps it will take, once planned. */
  readonly onPlanned?: (steps: ReadonlyArray<EnvironmentCreationStep>) => void;
  readonly onProgress?: (progress: ReadonlyArray<EnvironmentCreationStepProgress>) => void;
  /** The platform took the environment's project: it exists from here, while the rest goes on. */
  readonly onProjectAccepted?: (projectId: string) => void;
  /**
   * The creation an Add a Mate runs for (`creationRunId`): its Create is recorded under an id named
   * from it, where its view reads it (`creationSteps`).
   */
  readonly creationId?: string | undefined;
  /** The HQ birth identity, the same for every Create of one Add: HQ makes it once. */
  readonly birthId?: string | undefined;
}

/** How a press ended: nothing asked of the platform, or what the platform came to. */
type EnvironmentPressRun =
  /** Nothing was asked: no organization, the account closed, a plan or HQ refused. */
  | { readonly kind: "refused"; readonly reason: string | null }
  | { readonly kind: "ran"; readonly outcome: EnvironmentCreationOutcome };

/** How a creation ended, for the surface that started it. */
type EnvironmentCreationRun =
  | EnvironmentPressRun
  /** HQ took the Mate's Create: its birth's operation, on HQ, does the rest. */
  | { readonly kind: "born"; readonly birthId: string };

/**
 * A creation, by what it is asked for: a production takes no Mate and is always pressed; anything
 * else may be a Mate HQ makes.
 */
interface EnvironmentCreate {
  (request: EnvironmentCreationRequest & { readonly role: "prod" }): Promise<EnvironmentPressRun>;
  (request: EnvironmentCreationRequest): Promise<EnvironmentCreationRun>;
}

/**
 * What a press's plan brings, for the screen to name before the project lists it: the managed
 * services and the runtimes its one import makes, in the tier's order.
 */
export function pressPlanned(steps: ReadonlyArray<EnvironmentCreationStep>): {
  readonly managed?: ReadonlyArray<string>;
  readonly runtimes?: ReadonlyArray<RecipeRuntime>;
} {
  let managed: Array<string> = [];
  let runtimes: ReadonlyArray<RecipeRuntime> | undefined;
  for (const step of steps) {
    if (step.kind === "import-project") {
      managed = (recipeTierServices(step.yaml) ?? []).flatMap((service) =>
        service.role === "managed" ? [service.hostname] : [],
      );
    }
    if (step.kind === "import-container" && step.tier !== undefined) {
      managed = [...step.tier.managed];
      if (step.tier.runtimes.length > 0) runtimes = step.tier.runtimes;
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
 * What HQ places an environment added to a group as. A stage with its own Mate is a Mate that is
 * also the stage, HQ's `devstage`, which HQ places as a Mate: its key is authorized only for a
 * placed Mate or an open birth intent, so it is born as a Mate is. A stage without one is a stage
 * HQ deploys.
 */
function addedEnvironmentKind(role: ZeropsEnvironmentRole, withAgent: boolean): RoleProjectKind {
  switch (role) {
    case "prod":
      return "production";
    case "stage":
      return withAgent ? "devstage" : "stage";
    case "devstage":
      return "devstage";
    case "dev":
      return "mate";
  }
}

type PlannedTier = NonNullable<
  Extract<EnvironmentCreationStep, { readonly kind: "import-container" }>["tier"]
>;

/**
 * The Create a Mate added to a group is born from (`POST /api/births`): its application, its face,
 * the plan HQ runs — its project's name, the name it is drawn by under the application (D3), its
 * agents, the person's ask for its stand-up, who reaches it — the persona its stand-up runs with,
 * and its recipe's tier as converted for its import (the plan's `import-container`). HQ places a
 * dev Mate as a Mate and a stage with its own Mate as the stage (`devstage`).
 */
function addedMateBirth(input: {
  readonly groupId: string;
  readonly role: ZeropsEnvironmentRole;
  readonly kind: "mate" | "devstage";
  readonly choice: Pick<
    EnvironmentCreationChoice,
    "face" | "withAgent" | "recipe" | "automated" | "persona"
  >;
  readonly projectName: string;
  readonly displayName: string;
  readonly agents: ReadonlyArray<ZeropsAgentType>;
  readonly userRoles: ReadonlyArray<ProjectGrant>;
  /** The tier the plan imports beside its container (`import-container`). */
  readonly tier: PlannedTier | undefined;
}): {
  readonly appId: string;
  readonly face: string;
  readonly intent: BirthIntent;
  readonly standupPersona?: MatePersona;
  readonly tier?: {
    readonly yaml: string;
    readonly variables?: NonNullable<PlannedTier["projectVariables"]>;
  };
} {
  const { choice, tier } = input;
  const standUp = addedMateStandUp(input.role, choice);
  const recipe =
    choice.recipe.kind === "none"
      ? { kind: "none" as const }
      : {
          kind: "tier" as const,
          id: "group" as const,
          revision: choice.recipe.revision,
          tier: choice.recipe.tier,
        };
  return {
    appId: input.groupId,
    // Empty where none was picked: the Mate wears its name's tint.
    face: choice.face === undefined ? "" : formatMateFace(choice.face),
    intent: {
      projectName: input.projectName,
      recipe,
      agents: input.agents,
      standUp,
      automated: choice.automated === true,
      placement: {
        role: input.kind === "mate" ? "dev" : "stage",
        name: input.displayName,
        chief: false,
      },
      location: null,
      userRoles: input.userRoles,
    },
    // Its persona rides with its stand-up ask: the Mate takes it when its stand-up runs.
    ...(standUp && choice.persona !== undefined ? { standupPersona: choice.persona } : {}),
    ...(tier === undefined
      ? {}
      : {
          tier: {
            yaml: tier.yaml,
            ...(tier.projectVariables === undefined ? {} : { variables: tier.projectVariables }),
          },
        }),
  };
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
 * account's services listing holds them — its value now, then each Zerops push that moves it,
 * never polled and never on a clock; rejects where that listing is refused, and where the account
 * it waits in closes.
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

export function useEnvironmentCreation(): EnvironmentCreate {
  const { activeOrganization, client } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const operations = useAccountOperations();
  const registry = useContext(RegistryContext);

  const readGroupAgents = useReadGroupAgents();

  const create = useCallback(
    async (request: EnvironmentCreationRequest): Promise<EnvironmentCreationRun> => {
      if (activeOrganization === null) return { kind: "refused", reason: null };
      const hq = configuredHq();
      const organization = activeOrganization;
      const isCurrent = captureAccountLifetime();
      const { group, role, choice, creationId } = request;
      const { name, shown } = environmentProjectName(role, group.name, choice.name);
      const kind = addedEnvironmentKind(role, choice.withAgent);
      const tier = kind === "stage" || kind === "production" ? kind : null;

      // The agents a new environment offers are its group's, read before anything is sent.
      let agents: Awaited<ReturnType<typeof readGroupAgents>>;
      try {
        agents = await readGroupAgents(request.environments);
      } catch (cause) {
        return { kind: "refused", reason: zeropsErrorMessage(cause) };
      }
      if (!isCurrent()) return { kind: "refused", reason: null };
      // A new project names no owner but its creator's choice: its creator is marked it, where they
      // may (`ownerAtAdd`); Zerops marks a developer itself.
      const owner = ownerAtAdd({ userRoles: choice.userRoles, adder: organization });
      const plan = planEnvironmentCreation({
        clientId: organization.id,
        role,
        name,
        agents,
        recipe: choice.recipe,
        withAgent: choice.withAgent,
        ...(choice.userRoles === undefined ? {} : { userRoles: choice.userRoles }),
        ...(owner === null ? {} : { owner }),
        ...(choice.corePackage === undefined ? {} : { corePackage: choice.corePackage }),
      });
      if (!isCurrent()) return { kind: "refused", reason: null };
      if (!plan.ok) return { kind: "refused", reason: plan.reason };

      // A Mate: one Create, which HQ runs whether this tab stays or not. Its steps are not run here.
      const container = plan.steps.find((step) => step.kind === "import-container");
      if (container !== undefined && (kind === "mate" || kind === "devstage")) {
        const birthId = request.birthId ?? randomUUID();
        const birth = addedMateBirth({
          groupId: group.groupId,
          role,
          kind,
          choice,
          projectName: name,
          displayName: shown,
          agents,
          userRoles:
            owner === null
              ? (choice.userRoles ?? [])
              : withProjectGrant(choice.userRoles ?? [], owner, "OWNER"),
          tier: container.tier,
        });
        try {
          await operations.run(
            { kind: "create-birth", orgId: organization.id, id: birthId, ...birth },
            {
              orgId: organization.id,
              unobserved: HQ_UNFOLLOWED,
              ...(creationId === undefined
                ? {}
                : { requestId: creationStepId(creationId, "birth", 1) }),
            },
          );
        } catch (cause) {
          return { kind: "refused", reason: zeropsErrorMessage(cause) };
        }
        return { kind: "born", birthId };
      }
      // A dev environment is always a Mate (`withAgent`): what is pressed is a stage or a production.
      if (tier === null) return { kind: "refused", reason: null };

      const inputs = { client, operations, organizationId: organization.id };
      // Every press is held at HQ while it runs, so another browser never takes it for one that
      // stopped, and one cut short is read as what it was making, in its application (B5).
      const hold = acquireHqPressLease(
        accountHqApi(client, organization.id, hq),
        pressStreamOf(organization.id),
        { kind: tier, active: isCurrent, appId: group.groupId },
        randomUUID(),
      );
      const platform = pressPlatform(inputs, {
        register: pressRegistration(inputs, { hq, groupId: group.groupId, kind: tier }),
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
        onProjectAccepted: (projectId) => {
          if (!isCurrent()) return;
          request.onProjectAccepted?.(projectId);
          beginPress({
            projectId,
            organizationId: organization.id,
            startedAt: Date.now(),
            container: false,
            ...pressPlanned(plan.steps),
            placement: {
              groupId: group.groupId,
              groupName: group.name,
              kind,
              displayName: shown,
              ...(choice.face === undefined ? {} : { face: choice.face }),
            },
          });
          invalidateZerops({ topic: "inventory", organization: organizationRef(organization.id) });
        },
        onProgress: (progress) => {
          if (isCurrent()) request.onProgress?.(progress);
        },
        hold,
      });
      return { kind: "ran", outcome };
    },
    [activeOrganization, client, organizationRef, readGroupAgents, registry, operations],
  );
  // A production's plan has no container (`planEnvironmentCreation`): it is never born at HQ.
  return create as EnvironmentCreate;
}
