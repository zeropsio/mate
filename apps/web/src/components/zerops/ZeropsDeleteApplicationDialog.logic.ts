/**
 * Deleting a project with its code (app-lifecycle.md, Karel 2026-10-22), in words: what its dialog
 * lists as going and as staying, the review the person confirms, and how HQ's deletion of it stands.
 *
 * A project owns its code: HQ's repositories with their history, its changes and its releases go
 * with it. HQ runs the deletion as its operation (`app_deletion`) on the person's token: the stages
 * the person reviewed go from Zerops first, and a stage that does not go stops it there. Its
 * production is never deleted: HQ lets go of it, and the person deletes it in Zerops. Nothing on
 * GitHub is touched.
 */
import {
  deriveCanonicalGroups,
  type CanonicalGroup,
  type CanonicalGroupsOptions,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import {
  asSentence,
  mateDeletionOf,
  operationFailureWords,
  type HqOperationStanding,
} from "@t3tools/client-runtime/data";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";

export interface DeleteApplicationTarget {
  readonly appId: string;
  /** Its name, as HQ holds it: the dialog asks for it typed. */
  readonly name: string;
  /** Its stages' Zerops projects, which HQ deletes before the project; its start names them. */
  readonly stages: ReadonlyArray<{ readonly projectId: string; readonly name: string }>;
  /** Its productions, which stay: a Zerops project, or a Git `branch` that has none. */
  readonly productions: ReadonlyArray<{ readonly name: string; readonly branch?: string }>;
}

/**
 * What deleting a project takes, from its group: its stages' Zerops projects to delete, its
 * productions to keep. An environment with no Zerops project (a Git `branch`) has none to delete;
 * a production on one is listed as staying.
 */
export function applicationDeletionTarget(group: {
  readonly groupId: string;
  readonly name: string;
  readonly environments: ReadonlyArray<{
    readonly role: string | undefined;
    readonly project: { readonly id: string; readonly name: string } | undefined;
    readonly branch?: string | undefined;
  }>;
}): DeleteApplicationTarget {
  const projectsOf = (role: string) =>
    group.environments.flatMap(({ project, role: own }) =>
      own === role && project !== undefined ? [{ projectId: project.id, name: project.name }] : [],
    );
  return {
    appId: group.groupId,
    name: group.name,
    stages: projectsOf("stage"),
    productions: [
      ...projectsOf("prod").map(({ name }) => ({ name })),
      ...group.environments.flatMap(({ project, role, branch }) =>
        role === "prod" && project === undefined && branch !== undefined
          ? [{ name: branch, branch }]
          : [],
      ),
    ],
  };
}

/** `applicationDeletionTarget` of a group as the menu and the projects page hold it. */
export function groupDeletionTarget(
  group: Pick<CanonicalGroup, "groupId" | "name" | "environments">,
): DeleteApplicationTarget {
  return applicationDeletionTarget({
    groupId: group.groupId,
    name: group.name,
    environments: group.environments.map((environment) => ({
      role: environment.role,
      project: environment.project,
      branch:
        environment.kind === "managed" && environment.target.kind === "git"
          ? environment.target.branch
          : undefined,
    })),
  });
}

/**
 * What deleting a Mate's project with its last Mate takes, from the Zerops projects listed in it
 * and HQ's record of it (its environments, where HQ told them): its group as the menu and the
 * projects page hold it, so a production on a Git branch is listed as staying there too.
 */
export function lastMateDeletionTarget(
  projects: ReadonlyArray<ZeropsProject>,
  app: NonNullable<CanonicalGroupsOptions["apps"]>[number],
): DeleteApplicationTarget {
  const group = deriveCanonicalGroups(projects, { order: "name", apps: [app] }).groups.find(
    ({ groupId }) => groupId === app.id,
  );
  return groupDeletionTarget(group ?? { groupId: app.id, name: app.name, environments: [] });
}

/** HQ's kinds of a project that stops its application's deletion (`app_has_mate`). */
const HOLDING_KINDS: ReadonlySet<string> = new Set(["mate", "devstage", "plain"]);

/**
 * Why the project's deletion cannot start yet, or `undefined` once it can: HQ refuses its start
 * while a Mate or plain project stands in it (`app_has_mate`), so one opened confirmed by its last
 * Mate's Delete starts only once HQ's structure (`placements`, `null` while unread) holds none. A
 * Mate's deletion HQ runs releases it there when its project is gone.
 */
export function applicationDeletionHold(
  placements: ReadonlyMap<string, HqPlacement> | null,
  appId: string,
): { readonly words: string; readonly failed: boolean } | undefined {
  if (placements === null) return { words: "Reading what HQ holds of it…", failed: false };
  const deletions = [...placements.values()].flatMap((placement) =>
    placement.appId === appId && HOLDING_KINDS.has(placement.kind)
      ? [mateDeletionOf({ operation: placement.operation, status: undefined, viewer: undefined })]
      : [],
  );
  if (deletions.length === 0) return undefined;
  const failed = deletions.find((deletion) => deletion.kind === "failed");
  if (failed?.kind === "failed")
    return {
      words: `Its Mate was not deleted · ${operationFailureWords(failed.failure)}`,
      failed: true,
    };
  if (deletions.some((deletion) => deletion.kind === "none"))
    return { words: "A Mate still works on this project. Delete it first.", failed: true };
  return { words: "Waiting for HQ to delete its Mate…", failed: false };
}

/** What HQ holds of the project: its repositories by name, and how many changes are open. */
interface ApplicationHoldings {
  readonly repos: ReadonlyArray<string>;
  readonly openChanges: number;
}

/** HQ's detail of the project, once it said both its repositories and its changes. */
export function applicationHoldings(detail: {
  readonly repos: ReadonlyArray<{ readonly name: string }> | undefined;
  readonly changes: ReadonlyArray<{ readonly state: string }> | undefined;
}): ApplicationHoldings | undefined {
  if (detail.repos === undefined || detail.changes === undefined) return undefined;
  return {
    repos: detail.repos.map((repo) => repo.name),
    openChanges: detail.changes.filter((change) => change.state === "open").length,
  };
}

export interface DeleteApplicationWords {
  /** "Delete shop?" */
  readonly title: string;
  /** Each thing that goes; `undefined` until HQ said what the project holds. */
  readonly goes: ReadonlyArray<string> | undefined;
  readonly stays: ReadonlyArray<string>;
  /** "Type shop to confirm" */
  readonly label: string;
  /** "Delete shop" */
  readonly submit: string;
  readonly pending: string;
}

function listed(names: ReadonlyArray<string>): string {
  return names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
}

export function deleteApplicationWords(
  target: DeleteApplicationTarget,
  holdings: ApplicationHoldings | undefined,
): DeleteApplicationWords {
  const code = holdings?.repos.filter((name) => name !== RECIPE_REPO) ?? [];
  const goes =
    holdings === undefined
      ? undefined
      : [
          ...(code.length === 0
            ? []
            : [
                code.length === 1
                  ? `Repository ${code[0]!}, with its history`
                  : `Repositories ${listed(code)}, with their history`,
              ]),
          ...(holdings.repos.includes(RECIPE_REPO) ? ["Its setup files"] : []),
          ...(holdings.openChanges === 0
            ? []
            : [
                holdings.openChanges === 1
                  ? "1 open change"
                  : `${String(holdings.openChanges)} open changes`,
              ]),
          ...target.stages.map((stage) => `Stage ${stage.name}, with everything in it`),
        ];
  return {
    title: `Delete ${target.name}?`,
    goes,
    stays: [
      ...target.productions.map((production) =>
        production.branch === undefined
          ? `Production ${production.name}. Delete it in Zerops if you no longer need it.`
          : `Production on Git branch ${production.branch}. Nothing to delete in Zerops.`,
      ),
      "Anything on GitHub",
    ],
    label: `Type ${target.name} to confirm`,
    submit: `Delete ${target.name}`,
    pending: "Deleting…",
  };
}

/** The reviewed stages HQ still places in the project, by name: those its deletion has to go. */
export function stagesStanding(
  target: Pick<DeleteApplicationTarget, "appId" | "stages">,
  placements: ReadonlyMap<string, HqPlacement> | null,
): ReadonlyArray<string> {
  if (placements === null) return target.stages.map((stage) => stage.name);
  return target.stages.flatMap((stage) =>
    placements.get(stage.projectId)?.appId === target.appId ? [stage.name] : [],
  );
}

/**
 * What the dialog says of HQ's deletion of the project (`hqOperationOf` its `app_deletion`) where
 * it runs or stopped failed, with the reviewed stages still standing (`stagesStanding`): HQ names
 * no stage in its operation, so the stages left are the ones the person can see. A deletion waiting
 * for its maker's Continue is said by the dialog with that person's name.
 */
export function applicationDeletionLine(
  deletion: HqOperationStanding,
  standing: ReadonlyArray<string>,
): { readonly words: string; readonly failed: boolean } | undefined {
  const left =
    standing.length === 0
      ? undefined
      : standing.length === 1
        ? `stage ${standing[0]!}`
        : `stages ${listed(standing)}`;
  switch (deletion.kind) {
    case "going":
      return {
        words: left === undefined ? "Deleting its code…" : `Deleting ${left}…`,
        failed: false,
      };
    case "failed":
      return {
        words: `It was not deleted · ${asSentence(operationFailureWords(deletion.failure))}${left === undefined ? "" : ` Still standing: ${left}.`}`,
        failed: true,
      };
    default:
      return undefined;
  }
}
