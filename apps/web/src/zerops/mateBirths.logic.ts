/**
 * The bodies of a Mate's Create (`POST /api/births`) that a press sends: one added to a group
 * (`useEnvironmentCreation`) and *Set up Mate* or *Enable* on a project that exists
 * (`useCreateMateBirth`). Each is decided here from what the press knows; the hooks only send it.
 */
import {
  formatMateFace,
  newMateTint,
  projectNameInApp,
  type BirthAgent,
  type BirthIntent,
  type mateBirthTier,
  type ZeropsEnvironmentRole,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import type { MatePersona } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";

import type { EnvironmentCreationChoice } from "./useEnvironmentCreation";

/**
 * The one Create of a Mate on a project that exists — *Set up Mate* and *Enable* (`POST /api/births`
 * with `projectId`): HQ's operation grants `owner` the project first, records the Mate, mints its
 * key, and imports its container or turns on and restarts the one it holds; the tab writes none of
 * it. Its face is the one HQ records for the Mate already, else the tint its name gets among the
 * account's (`newMateTint`) and that tint's shape; its name is its project's in Zerops (D3).
 */
export function mateSetUpBirth(input: {
  readonly id: string;
  readonly project: ZeropsCandidate["project"];
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  /** The application it is adopted into; HQ places it otherwise. */
  readonly appId?: string | undefined;
  readonly agents: BirthIntent["agents"];
  /** Whom its operation grants `OWNER` on the project (`ownerAtAdd`); none where nobody. */
  readonly owner: string | null;
}) {
  const recorded = input.project.hq?.mate?.face;
  const tint = newMateTint(input.candidates, input.project.name);
  return {
    id: input.id,
    projectId: input.project.id,
    ...(input.appId === undefined ? {} : { appId: input.appId }),
    face:
      recorded === undefined || recorded === ""
        ? formatMateFace({ tint, shape: MATE_SHAPE_OF_TINT[tint] })
        : recorded,
    intent: {
      projectName: input.project.name,
      recipe: { kind: "none" },
      agents: input.agents,
      standUp: false,
      automated: false,
      placement: { role: "dev", name: projectNameInApp(input.project), chief: false },
      location: null,
      userRoles: [],
    } satisfies BirthIntent,
    ...(input.owner === null ? {} : { owner: input.owner }),
  };
}

/** Only a dev Mate with a recipe has development to stand up after sign-in. */
function addedMateStandUp(
  role: ZeropsEnvironmentRole,
  choice: Pick<EnvironmentCreationChoice, "withAgent" | "recipe">,
): boolean {
  return role === "dev" && choice.withAgent && choice.recipe.kind === "tier";
}

type PlannedTier = NonNullable<Extract<ReturnType<typeof mateBirthTier>, { ok: true }>["tier"]>;

/**
 * The Create a Mate added to a group is born from (`POST /api/births`): its application, its face,
 * the plan HQ runs — its project's name, the name it is drawn by under the application (D3), its
 * agents, the person's ask for its stand-up, who reaches it — the persona its stand-up runs with,
 * and its recipe's tier as converted for its import (`mateBirthTier`). HQ places a
 * dev Mate as a Mate and a stage with its own Mate as the stage (`devstage`).
 */
export function addedMateBirth(input: {
  readonly groupId: string;
  readonly role: ZeropsEnvironmentRole;
  readonly kind: "mate" | "devstage";
  readonly choice: Pick<
    EnvironmentCreationChoice,
    "face" | "withAgent" | "recipe" | "automated" | "persona"
  >;
  readonly projectName: string;
  readonly displayName: string;
  readonly agents: ReadonlyArray<BirthAgent>;
  readonly userRoles: ReadonlyArray<ProjectGrant>;
  /** The tier its import brings beside its container (`mateBirthTier`). */
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
