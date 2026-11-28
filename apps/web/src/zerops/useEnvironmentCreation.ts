import { randomUUID } from "~/lib/utils";
import {
  ownerAtAdd,
  withProjectGrant,
  type ProjectGrant,
} from "@t3tools/client-runtime/zerops/projectAccess";
/**
 * Stands one environment up in a group — a Mate, a stage or a production — from whatever surface
 * asked for it: the New Mate dialog over any view (`ZeropsNewMateHost`), the projects page's own
 * adds and Put it live. This gathers the inputs — the group's agents, who asked — and makes one
 * start at HQ; nothing of the setup runs in this tab, and closing it changes nothing.
 *
 * An environment with a Mate is one Create at HQ (`create-birth`): HQ runs its birth as its
 * operation — project, key, import — and the Mate's row follows that operation on every device. A
 * stage or a production without a Mate is one `environment` start (`startEnvironment`): HQ
 * creates or imports its project, grants its access, attaches it and keys it, and the
 * application's navigation `operation` says how far it got, to every device. An organization with
 * no HQ takes no environment (ADR 0001).
 */
import { HQ_UNFOLLOWED, useAccountOperations } from "./accountOperations";
import {
  appProjectName,
  nameUnderApp,
  type ZeropsEnvironmentRole,
  type CanonicalGroup,
  type EnvironmentRecipeChoice,
  type ZeropsCorePackage,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqEnvironmentStart } from "@t3tools/client-runtime/zerops/hq";
import type { MatePersona } from "@t3tools/contracts";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import { creationStepId } from "@t3tools/client-runtime/data";
import { useCallback } from "react";

import { captureAccountLifetime } from "./accountLifetime";
import { useReadGroupAgents } from "./groupAgents";
import { addedMateBirth } from "./mateBirths.logic";
import { useEnvironmentStarts } from "./useEnvironmentOperation";
import { useZeropsSession } from "./ZeropsSessionProvider";

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
  /**
   * The creation an Add a Mate runs for (`creationRunId`): its Create is recorded under an id named
   * from it, where its view reads it (`creationSteps`).
   */
  readonly creationId?: string | undefined;
  /** The HQ birth identity, the same for every Create of one Add: HQ makes it once. */
  readonly birthId?: string | undefined;
}

/** Nothing was asked of HQ: no organization, the account closed, or the form's input refused. */
type EnvironmentCreationRefused = { readonly kind: "refused"; readonly reason: string | null };

/**
 * HQ took the stage's or the production's start: its `environment` operation, `operationId`, does
 * the rest, as the application's navigation `operation` shows it.
 */
type EnvironmentCreationStarted = { readonly kind: "started"; readonly operationId: string };

/** How a creation ended, for the surface that started it. */
type EnvironmentCreationRun =
  | EnvironmentCreationRefused
  | EnvironmentCreationStarted
  /** HQ took the Mate's Create: its birth's operation, on HQ, does the rest. */
  | { readonly kind: "born"; readonly birthId: string };

/**
 * A creation, by what it is asked for: a production takes no Mate and is always an environment
 * start; anything else may be a Mate HQ makes.
 */
interface EnvironmentCreate {
  (
    request: EnvironmentCreationRequest & { readonly role: "prod" },
  ): Promise<EnvironmentCreationRefused | EnvironmentCreationStarted>;
  (request: EnvironmentCreationRequest): Promise<EnvironmentCreationRun>;
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

export function useEnvironmentCreation(): EnvironmentCreate {
  const { activeOrganization } = useZeropsSession();
  const operations = useAccountOperations();
  const starts = useEnvironmentStarts();

  const readGroupAgents = useReadGroupAgents();

  const create = useCallback(
    async (request: EnvironmentCreationRequest): Promise<EnvironmentCreationRun> => {
      if (activeOrganization === null) return { kind: "refused", reason: null };
      const organization = activeOrganization;
      const isCurrent = captureAccountLifetime();
      const { group, role, choice, creationId } = request;
      const { name, shown } = environmentProjectName(role, group.name, choice.name);
      const kind = addedEnvironmentKind(role, choice.withAgent);
      if (name.length === 0) return { kind: "refused", reason: "An environment needs a name." };

      if (kind === "stage" || kind === "production") {
        const start: Omit<HqEnvironmentStart, "id"> = {
          tier: kind,
          create: {
            name,
            // Who reaches it beyond their organization role, as its creator chose: no environment
            // without a Mate marks its creator its owner.
            access: choice.userRoles ?? [],
            ...(choice.corePackage === undefined ? {} : { corePackage: choice.corePackage }),
          },
        };
        let operationId: string;
        try {
          operationId = await starts.startEnvironment(group.groupId, start);
        } catch (cause) {
          return { kind: "refused", reason: isCurrent() ? zeropsErrorMessage(cause) : null };
        }
        return isCurrent() ? { kind: "started", operationId } : { kind: "refused", reason: null };
      }

      // A Mate: one Create, which HQ runs whether this tab stays or not. Its steps are not run here.
      // The agents a new Mate offers are its group's, read before anything is sent.
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
      const birthId = request.birthId ?? randomUUID();
      try {
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
        });
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
    },
    [activeOrganization, readGroupAgents, operations, starts],
  );
  // A production takes no Mate (`addedEnvironmentKind`): it is never born at HQ.
  return create as EnvironmentCreate;
}
