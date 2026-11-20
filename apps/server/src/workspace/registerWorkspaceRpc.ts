import {
  FilesystemBrowseError,
  type FilesystemBrowseFailure,
  type ProjectEntriesFailure,
  type ProjectFileFailure,
  type ProjectFileOperation,
  ProjectListEntriesError,
  ProjectReadFileError,
  ProjectSearchContentsError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  ThreadFileWritesError,
  WS_METHODS,
  type WsRpcGroup,
} from "@t3tools/contracts";
import type { Digest } from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import type { FileSystem } from "effect/FileSystem";
import type { Path } from "effect/Path";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import type { Scope } from "effect/Scope";

import type { AssetSigningKey } from "../assets/AssetSigningKey.ts";
import { createAssetUrl } from "../assets/assetUrl.ts";
import { deletePendingAttachment, issueAttachmentUploadUrl } from "../assets/AttachmentUpload.ts";
import type { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import type { ServerConfig } from "../config.ts";
import type { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProjectFaviconResolver } from "../project/ProjectFaviconResolver.ts";
import type { RpcAdmit } from "../RpcUpdateAdmission.ts";
import type { ThreadFileWrites } from "../zerops/ThreadFileWrites.ts";
import type * as WorkspaceEntries from "./WorkspaceEntries.ts";
import type * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import type * as WorkspacePaths from "./WorkspacePaths.ts";

type WorkspaceRpcTag =
  | typeof WS_METHODS.projectsSearchEntries
  | typeof WS_METHODS.projectsSearchContents
  | typeof WS_METHODS.projectsListEntries
  | typeof WS_METHODS.projectsReadFile
  | typeof WS_METHODS.threadsFileWrites
  | typeof WS_METHODS.threadsWrittenFile
  | typeof WS_METHODS.projectsWriteFile
  | typeof WS_METHODS.filesystemBrowse
  | typeof WS_METHODS.attachmentsCreateUploadUrl
  | typeof WS_METHODS.attachmentsDelete
  | typeof WS_METHODS.assetsCreateUrl;

type WorkspaceRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: WorkspaceRpcTag }>;

type WorkspaceRpcHandlers = {
  readonly [Current in WorkspaceRpc as Rpc.Tag<Current>]: Rpc.ToHandlerFn<
    Current,
    | AssetSigningKey
    | Digest
    | FileSystem
    | Path
    | ProjectFaviconResolver
    | Scope
    | ServerConfig
    | ServerSecretStore
    | WorkspacePaths.WorkspacePaths
  >;
};

interface RegisterWorkspaceRpcDeps {
  readonly workspaceEntries: WorkspaceEntries.WorkspaceEntries["Service"];
  readonly workspaceFileSystem: WorkspaceFileSystem.WorkspaceFileSystem["Service"];
  readonly threadFileWrites: ThreadFileWrites["Service"] | undefined;
  readonly projectionSnapshotQuery: ProjectionSnapshotQuery["Service"];
  readonly admit: RpcAdmit;
}

function unexpectedCompatibilityError(error: never): never {
  throw new Error(`Unhandled compatibility error: ${String(error)}`);
}

/** Preserve the setup runner's broader pre-refactor message normalization. */
function projectEntriesFailureContext(error: WorkspaceEntries.WorkspaceEntriesError): {
  readonly failure: ProjectEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
} {
  switch (error._tag) {
    case "WorkspaceRootNotExistsError":
      return {
        failure: "workspace_root_not_found",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootCreateFailedError":
      return {
        failure: "workspace_root_create_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootStatFailedError":
      return {
        failure: "workspace_root_stat_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
        detail: error.phase,
      };
    case "WorkspaceRootNotDirectoryError":
      return {
        failure: "workspace_root_not_directory",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceEntriesReadDirectoryError":
      return {
        failure: "directory_list_failed",
        ...(error.cwd !== undefined ? { normalizedCwd: error.cwd } : {}),
        detail: error.message,
      };
    case "WorkspaceSearchIndexCreateFailed":
      return {
        failure: "search_index_create_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    case "WorkspaceSearchIndexScanTimedOut":
      return {
        failure: "search_index_scan_timed_out",
        normalizedCwd: error.cwd,
        timeout: error.timeout,
      };
    case "WorkspaceSearchIndexSearchFailed":
      return {
        failure: "search_index_search_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function filesystemBrowseFailureContext(error: WorkspaceEntries.WorkspaceEntriesBrowseError): {
  readonly failure: FilesystemBrowseFailure;
  readonly parentPath?: string;
  readonly platform?: string;
} {
  switch (error._tag) {
    case "WorkspaceEntriesWindowsPathUnsupportedError":
      return { failure: "windows_path_unsupported", platform: error.platform };
    case "WorkspaceEntriesCurrentProjectRequiredError":
      return { failure: "current_project_required" };
    case "WorkspaceEntriesReadDirectoryError":
      return { failure: "read_directory_failed", parentPath: error.parentPath };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function projectFileFailureContext(
  error:
    | WorkspaceFileSystem.WorkspaceFileSystemError
    | WorkspacePaths.WorkspacePathOutsideRootError,
): {
  readonly failure: ProjectFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: ProjectFileOperation;
  readonly operationPath?: string;
} {
  switch (error._tag) {
    case "WorkspacePathOutsideRootError":
      return { failure: "workspace_path_outside_root" };
    case "WorkspaceFileSystemOperationError":
      return {
        failure: "operation_failed",
        resolvedPath: error.resolvedPath,
        operation: error.operation,
        operationPath: error.operationPath,
      };
    case "WorkspaceFilePathEscapeError":
      return {
        failure: "resolved_path_outside_root",
        resolvedPath: error.resolvedPath,
        resolvedWorkspaceRoot: error.resolvedWorkspaceRoot,
      };
    case "WorkspaceFileNotFoundError":
      return { failure: "not_found", resolvedPath: error.resolvedPath };
    case "WorkspacePathNotFileError":
      return { failure: "path_not_file", resolvedPath: error.resolvedPath };
    case "WorkspaceBinaryFileError":
      return { failure: "binary_file", resolvedPath: error.resolvedPath };
    default:
      return unexpectedCompatibilityError(error);
  }
}

export const registerWorkspaceRpc = ({
  workspaceEntries,
  workspaceFileSystem,
  threadFileWrites,
  projectionSnapshotQuery,
  admit,
}: RegisterWorkspaceRpcDeps) => {
  const assetUrl = createAssetUrl({ projectionSnapshotQuery });
  const withThreadFileWrites = <A>(
    run: (service: ThreadFileWrites["Service"]) => Effect.Effect<A, ThreadFileWritesError>,
  ) =>
    threadFileWrites === undefined
      ? Effect.fail(new ThreadFileWritesError({ reason: "unavailable" }))
      : run(threadFileWrites);

  return {
    [WS_METHODS.projectsSearchEntries]: (input) =>
      workspaceEntries.search(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSearchEntriesError({
              cwd: input.cwd,
              queryLength: input.query.length,
              limit: input.limit,
              ...projectEntriesFailureContext(cause),
              cause,
            }),
        ),
      ),
    [WS_METHODS.projectsSearchContents]: (input) =>
      workspaceEntries.searchContents(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSearchContentsError({
              cwd: input.cwd,
              queryLength: input.query.length,
              limit: input.limit,
              ...projectEntriesFailureContext(cause),
              cause,
            }),
        ),
      ),
    [WS_METHODS.projectsListEntries]: (input) =>
      workspaceEntries.list(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectListEntriesError({
              ...input,
              ...projectEntriesFailureContext(cause),
              cause,
            }),
        ),
      ),
    [WS_METHODS.projectsReadFile]: (input) =>
      workspaceFileSystem.readFile(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectReadFileError({
              ...input,
              ...projectFileFailureContext(cause),
              cause,
            }),
        ),
      ),
    [WS_METHODS.threadsFileWrites]: (input) =>
      withThreadFileWrites((service) => service.fileWrites(input)),
    [WS_METHODS.threadsWrittenFile]: (input) =>
      withThreadFileWrites((service) => service.writtenFile(input)),
    [WS_METHODS.projectsWriteFile]: (input) =>
      admit(
        WS_METHODS.projectsWriteFile,
        workspaceFileSystem.writeFile(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectWriteFileError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                ...projectFileFailureContext(cause),
                cause,
              }),
          ),
        ),
      ),
    [WS_METHODS.filesystemBrowse]: (input) =>
      workspaceEntries.browse(input).pipe(
        Effect.mapError(
          (cause) =>
            new FilesystemBrowseError({
              ...input,
              ...filesystemBrowseFailureContext(cause),
              cause,
            }),
        ),
      ),
    [WS_METHODS.attachmentsCreateUploadUrl]: (input) =>
      admit(WS_METHODS.attachmentsCreateUploadUrl, issueAttachmentUploadUrl(input)),
    [WS_METHODS.attachmentsDelete]: (input) =>
      admit(WS_METHODS.attachmentsDelete, deletePendingAttachment(input.attachmentId)),
    [WS_METHODS.assetsCreateUrl]: (input) => assetUrl(input),
  } satisfies WorkspaceRpcHandlers;
};
