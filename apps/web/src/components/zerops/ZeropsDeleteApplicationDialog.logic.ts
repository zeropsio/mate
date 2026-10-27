/**
 * Deleting a project with its code (app-lifecycle.md, Karel 2026-10-22), in words and order: what
 * its dialog lists as going and as staying, and the order the deletion runs in.
 *
 * A project owns its code: HQ's repositories with their history, its changes and its releases go
 * with it. Its stage goes from Zerops, with the person's own access, before HQ deletes anything; a
 * stage that does not go stops the deletion there. Its production is never deleted: HQ lets go of
 * it, and the person deletes it in Zerops. Nothing on GitHub is touched.
 */
import type { CanonicalGroup } from "@t3tools/client-runtime/zerops";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";

export interface DeleteApplicationTarget {
  readonly appId: string;
  /** Its name, as HQ holds it: the dialog asks for it typed. */
  readonly name: string;
  /** Its stages' Zerops projects, deleted before HQ deletes the project. */
  readonly stages: ReadonlyArray<{ readonly projectId: string; readonly name: string }>;
  /** Its productions, which stay: a Zerops project, or a Git `branch` that has none. */
  readonly productions: ReadonlyArray<{ readonly name: string; readonly branch?: string }>;
}

/**
 * Whether a project's *Delete* is offered, on the menu and the projects page alike: a project with
 * no Mate in it (its Mates deleted, or a stage or a production alone), to whoever writes the
 * structure (`delete_app`).
 */
export function projectDeleteOffered(input: {
  readonly withoutMate: boolean;
  readonly mayDelete: boolean;
}): boolean {
  return input.withoutMate && input.mayDelete;
}

/** Whether a group holds no Mate, listed or coming: a dev place is a Mate's. */
export function groupWithoutMate(group: {
  readonly environments: ReadonlyArray<{ readonly role: string | undefined }>;
  readonly pending: ReadonlyArray<{ readonly kind: string }>;
}): boolean {
  return (
    !group.environments.some(({ role }) => role === "dev" || role === "devstage") &&
    !group.pending.some(({ kind }) => kind === "mate")
  );
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

/** What HQ holds of the project: its repositories by name, and how many changes are open. */
export interface ApplicationHoldings {
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

/**
 * Deletes each stage from Zerops, then the project with its code in HQ. A stage that does not go
 * stops it before HQ deletes anything, with the reason Zerops gave.
 */
export async function deleteApplication(
  target: DeleteApplicationTarget,
  steps: {
    readonly deleteProject: (projectId: string) => Promise<void>;
    readonly deleteInHq: (appId: string) => Promise<void>;
  },
): Promise<void> {
  for (const stage of target.stages) {
    try {
      await steps.deleteProject(stage.projectId);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Stage ${stage.name} was not deleted, so HQ kept ${target.name}. ${reason}`, {
        cause,
      });
    }
  }
  await steps.deleteInHq(target.appId);
}
