/**
 * What the rename dialog says of HQ's rename of a project (`hqOperationOf` its `app_rename`, S13d)
 * — the decision without React. HQ shows the rename on the application while it runs, and once it
 * ended with projects left (`renames_left`), until the next start; one that ended done shows
 * nothing.
 */
import { operationFailureWords, type HqOperationStanding } from "@t3tools/client-runtime/data";
import type { HqOperation } from "@t3tools/client-runtime/zerops/hq";

/** HQ's kind of an application's rename. */
export const APP_RENAME = "app_rename";

/** HQ's failure code of a rename that ended with projects not renamed in Zerops. */
const RENAMES_LEFT = "renames_left";

/** HQ's result of a project Zerops refused to rename, before Zerops' own code. */
const REFUSED = "refused:";

export interface AppRenameProject {
  readonly projectId: string;
  readonly words: string;
  readonly failed: boolean;
}

export interface AppRenameView {
  /** How the rename runs or ended, under the field; absent where HQ shows none running or failed. */
  readonly line: { readonly words: string; readonly failed: boolean } | undefined;
  /** Each project of the rename the person sees, with its result. */
  readonly projects: ReadonlyArray<AppRenameProject>;
  /** A different name is safe when no project is known to have refused the last rename. */
  readonly mayRename: boolean;
}

/** A lost answer can be asked again by id; a new failure starts a new attempt. */
export function renameAttemptFor(
  held: { readonly name: string; readonly after: string | undefined; readonly id: string } | null,
  name: string,
  after: string | undefined,
  newId: () => string,
) {
  return held?.name === name && held.after === after ? held : { name, after, id: newId() };
}

/**
 * Each project's result in words; `nameOf` is its name in the person's Zerops listing (the name
 * Zerops keeps where someone renamed it since).
 */
function projectWords(
  project: { readonly projectId: string; readonly result?: string | undefined },
  nameOf: (projectId: string) => string | undefined,
): AppRenameProject {
  const name = nameOf(project.projectId) ?? "A project";
  const result = project.result;
  if (result === undefined)
    return { projectId: project.projectId, words: `${name}: renaming…`, failed: false };
  if (result === "renamed")
    return { projectId: project.projectId, words: `${name}: renamed`, failed: false };
  if (result === "renamed_since")
    return {
      projectId: project.projectId,
      words: `${name}: renamed since in Zerops, so it keeps that name`,
      failed: true,
    };
  if (result === "moved")
    return {
      projectId: project.projectId,
      words: `${name}: moved to another project, not renamed`,
      failed: false,
    };
  if (result === "gone")
    return { projectId: project.projectId, words: `${name}: gone from Zerops`, failed: false };
  return {
    projectId: project.projectId,
    words: `${name}: keeps its old name, Zerops did not rename it (${result.startsWith(REFUSED) ? result.slice(REFUSED.length) : result})`,
    failed: true,
  };
}

/**
 * The dialog's words for HQ's rename standing as `rename`, of the operation HQ shows on the
 * application (`operation`): running, waiting for its maker's Continue (whose name the dialog
 * reads, so it is said there), or ended with projects left, with each project's result.
 */
export function appRenameView(
  rename: HqOperationStanding,
  operation: HqOperation | undefined,
  nameOf: (projectId: string) => string | undefined,
): AppRenameView {
  const projects =
    rename.kind === "none" ? [] : (operation?.projects ?? []).map((p) => projectWords(p, nameOf));
  const results = operation?.projects ?? [];
  const mayRename =
    rename.kind !== "failed" ||
    (results.length > 0 && results.every((project) => !project.result?.startsWith(REFUSED)));
  switch (rename.kind) {
    case "going":
      return {
        line: { words: "Renaming its projects in Zerops…", failed: false },
        projects,
        mayRename,
      };
    case "failed":
      return {
        line: {
          words:
            rename.failure.code === RENAMES_LEFT
              ? "Not every project was renamed in Zerops."
              : `Its projects were not renamed in Zerops · ${operationFailureWords(rename.failure)}`,
          failed: true,
        },
        projects,
        mayRename,
      };
    default:
      return { line: undefined, projects, mayRename };
  }
}
