import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ProjectListEntriesResult,
  ProjectReadFileError,
  type ProjectReadFileResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";
import { useProjectPathSearch } from "~/state/queries";

const EMPTY_PROJECT_FILE_PATH = "";
const EMPTY_PROJECT_FILE_QUERY_ATOM = Atom.make(
  AsyncResult.initial<ProjectReadFileResult, never>(false),
).pipe(Atom.withLabel("project-file-query:empty"));
const drafts = Atom.family((key: string) =>
  Atom.make<string | null>(null).pipe(Atom.keepAlive, Atom.withLabel(`file-draft:${key}`)),
);
function fileDraftAtom(environmentId: EnvironmentId, cwd: string, relativePath: string) {
  return drafts(JSON.stringify([environmentId, cwd, relativePath]));
}
function draftFile(relativePath: string, contents: string): ProjectReadFileResult {
  return {
    relativePath,
    contents,
    byteLength: new TextEncoder().encode(contents).byteLength,
    truncated: false,
  };
}

interface ProjectQueryState<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

function getProjectEntriesQueryAtom(environmentId: EnvironmentId, cwd: string) {
  return projectEnvironment.listEntries({ environmentId, input: { cwd } });
}

export function getWorkspaceFileAtom(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string | null,
) {
  return projectEnvironment.readFile({
    environmentId,
    input: { cwd, relativePath: relativePath ?? EMPTY_PROJECT_FILE_PATH },
  });
}

/** Only text typed in this client: the owner fact is never overwritten. */
export function setProjectFileDraft(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
  contents: string,
): void {
  appAtomRegistry.set(fileDraftAtom(environmentId, cwd, relativePath), contents);
}
export function getProjectFileDraft(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
): ProjectReadFileResult | null {
  const text = appAtomRegistry.get(fileDraftAtom(environmentId, cwd, relativePath));
  return text === null ? null : draftFile(relativePath, text);
}
/** Called only once mate-write-file has verified its later owner read-back. */
export function confirmProjectFileQueryData(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
  contents: string,
): boolean {
  const atom = fileDraftAtom(environmentId, cwd, relativePath);
  if (appAtomRegistry.get(atom) !== contents) return false;
  appAtomRegistry.set(atom, null);
  return true;
}
export function resolveProjectFileQueryData(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string | null,
  data: ProjectReadFileResult | null,
): ProjectReadFileResult | null {
  return relativePath === null
    ? data
    : (getProjectFileDraft(environmentId, cwd, relativePath) ?? data);
}
export function clearProjectFileQueryData(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
): void {
  appAtomRegistry.set(fileDraftAtom(environmentId, cwd, relativePath), null);
}

function failureCause<A>(result: AsyncResult.AsyncResult<A, unknown>): unknown {
  return result._tag === "Failure" ? Cause.squash(result.cause) : null;
}

function errorMessage(cause: unknown): string | null {
  if (cause === null) return null;
  return cause instanceof Error ? cause.message : "Workspace query failed.";
}

const isProjectReadFileError = Schema.is(ProjectReadFileError);

interface ProjectFileQueryState extends ProjectQueryState<ProjectReadFileResult> {
  /** The path exists but is not a regular file, typically a directory. */
  readonly isNotFile: boolean;
}

export function useProjectEntriesQuery(
  environmentId: EnvironmentId,
  cwd: string,
): ProjectQueryState<ProjectListEntriesResult> {
  const atom = getProjectEntriesQueryAtom(environmentId, cwd);
  const result = useAtomValue(atom);
  const refreshAtom = useAtomRefresh(atom);
  const refresh = useCallback(() => refreshAtom(), [refreshAtom]);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: errorMessage(failureCause(result)),
    isPending: result.waiting,
    refresh,
  };
}

/**
 * Backing query for the project file picker: a debounced, bounded, file-only
 * server search. An empty query is a valid request — the index answers it
 * with frecency-ordered files, so the picker's initial view is recent files
 * without transferring the full workspace listing. `matchedQuery` is the
 * query the returned entries were computed for, so the caller can highlight
 * against results instead of half-typed input.
 */
export function useProjectFilePickerQuery(
  environmentId: EnvironmentId,
  cwd: string,
  query: string,
  limit: number,
  options?: { readonly imageOnly?: boolean },
) {
  const search = useProjectPathSearch(
    {
      environmentId,
      cwd,
      query,
      kind: "file",
      ...(options?.imageOnly ? { imageOnly: true } : {}),
    },
    limit,
    { allowEmptyQuery: true },
  );

  return {
    entries: search.isPending ? [] : search.entries,
    error: search.error,
    isPending: search.isPending,
    matchedQuery: search.searchedQuery,
  };
}

export function useProjectFileQuery(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string | null,
  enabled = true,
): ProjectFileQueryState {
  const atom = enabled
    ? getWorkspaceFileAtom(environmentId, cwd, relativePath)
    : EMPTY_PROJECT_FILE_QUERY_ATOM;
  const result = useAtomValue(atom);
  const refreshAtom = useAtomRefresh(atom);
  const refresh = useCallback(() => refreshAtom(), [refreshAtom]);
  const data = Option.getOrNull(AsyncResult.value(result));
  const draft = useAtomValue(
    fileDraftAtom(environmentId, cwd, relativePath ?? EMPTY_PROJECT_FILE_PATH),
  );
  const drafted = relativePath === null || draft === null ? null : draftFile(relativePath, draft);
  const cause = failureCause(result);

  return {
    data: drafted ?? data,
    error: errorMessage(cause),
    isNotFile:
      (isProjectReadFileError(cause) && cause.failure === "path_not_file") ||
      (typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "ProjectReadFileError:path_not_file"),
    isPending: result.waiting,
    refresh,
  };
}
