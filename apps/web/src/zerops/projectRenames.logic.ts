/**
 * Renaming projects in Zerops after their application's name changed or they moved to another.
 *
 * Every project of an application is named in full in Zerops — `"<application> - <own name>"` —
 * so renaming an application, or moving a Mate into another, renames projects there. The targets
 * are computed once, from the names as they stand and the old application's name, before anything
 * is written: a retry sends the same targets and never computes them again from the new name,
 * which would build `"New - Old - Rune"`.
 *
 * A project without the old application's prefix has its whole name as its own name. Where the
 * old name is not read (an application HQ has not named yet) no prefix can be told from a name, so
 * nothing is renamed.
 */
import { appProjectName, nameUnderApp } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

export interface ProjectRename {
  readonly projectId: string;
  readonly from: string;
  readonly to: string;
}

export interface ProjectRenameFailure {
  readonly rename: ProjectRename;
  readonly reason: string;
}

/** Each project whose name is not already the new application's, with the name it is renamed to. */
export function planProjectRenames(
  projects: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  oldApp: string | undefined,
  newApp: string,
): ReadonlyArray<ProjectRename> {
  const old = oldApp?.trim();
  if (old === undefined || old === "" || old === newApp.trim()) return [];
  return projects.flatMap((project) => planOne(project, old, newApp));
}

/**
 * The rename of one project moved into another application: from `<old> - X`, or from its whole
 * name where it has no old prefix — a Mate in no application included — to `<new> - X`.
 */
export function planProjectMove(
  project: { readonly id: string; readonly name: string },
  oldApp: string | undefined,
  newApp: string,
): ReadonlyArray<ProjectRename> {
  return planOne(project, oldApp?.trim(), newApp);
}

function planOne(
  { id, name }: { readonly id: string; readonly name: string },
  oldApp: string | undefined,
  newApp: string,
): ReadonlyArray<ProjectRename> {
  const whole = name.trim();
  const own = nameUnderApp(whole, oldApp);
  // Already the new application's, and not the old one's: it stands.
  if (own === whole && nameUnderApp(whole, newApp) !== whole) return [];
  const to = appProjectName(newApp, own);
  return to === whole ? [] : [{ projectId: id, from: name, to }];
}

/** Renames every project through `apply`; a refusal is kept with its reason, the rest still run. */
export async function runProjectRenames(
  renames: ReadonlyArray<ProjectRename>,
  apply: (rename: ProjectRename) => Promise<void>,
): Promise<ReadonlyArray<ProjectRenameFailure>> {
  const settled = await Promise.all(
    renames.map(async (rename): Promise<ProjectRenameFailure | undefined> => {
      try {
        await apply(rename);
        return undefined;
      } catch (cause) {
        return { rename, reason: zeropsErrorMessage(cause) };
      }
    }),
  );
  return settled.filter((failure) => failure !== undefined);
}

/** What a retry sends: the failed renames, with the targets they were planned with. */
export function renamesLeft(
  failures: ReadonlyArray<ProjectRenameFailure>,
): ReadonlyArray<ProjectRename> {
  return failures.map(({ rename }) => rename);
}

/** Which projects were not renamed, and why. */
export function projectRenameTrouble(failures: ReadonlyArray<ProjectRenameFailure>): string {
  return failures
    .map(
      ({ rename, reason }) => `${rename.from} was not renamed to ${rename.to} in Zerops: ${reason}`,
    )
    .join(" ");
}
