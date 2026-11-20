import {
  type AssetCreateUrlInput,
  AssetImageAccessError,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspaceContextResolutionError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { resolveAssetContext } from "../engineSessionDirectory.ts";
import type { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { issueAssetUrl } from "./AssetAccess.ts";
import { resolveImageAsset } from "./ImageAsset.ts";

interface CreateAssetUrlDeps {
  readonly projectionSnapshotQuery: ProjectionSnapshotQuery["Service"];
}

export const createAssetUrl =
  ({ projectionSnapshotQuery }: CreateAssetUrlDeps) =>
  (input: AssetCreateUrlInput) =>
    Effect.gen(function* () {
      if (input.resource._tag === "attachment") {
        const image =
          input.imageMode === "reference"
            ? yield* resolveImageAsset(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new AssetImageAccessError({
                      code:
                        "code" in cause &&
                        typeof cause.code === "string" &&
                        [
                          "source-missing",
                          "source-changed",
                          "storage-full",
                          "object-missing",
                          "unsupported",
                          "persistence-failed",
                          "preview-unavailable",
                        ].includes(cause.code)
                          ? (cause.code as AssetImageAccessError["code"])
                          : "persistence-failed",
                      status:
                        "code" in cause && cause.code === "storage-full"
                          ? 507
                          : "code" in cause && cause.code === "object-missing"
                            ? 404
                            : 422,
                    }),
                ),
              )
            : null;
        return image ?? (yield* issueAssetUrl({ resource: input.resource }));
      }
      if (input.resource._tag === "project-favicon") {
        const project = yield* projectionSnapshotQuery
          .getActiveProjectByWorkspaceRoot(input.resource.cwd)
          .pipe(
            Effect.mapError(
              (cause) =>
                new AssetWorkspaceContextResolutionError({
                  resource: input.resource,
                  cause,
                }),
            ),
          );
        if (Option.isNone(project)) {
          return yield* new AssetWorkspaceContextNotFoundError({
            resource: input.resource,
          });
        }
        const image =
          input.imageMode === "reference"
            ? yield* resolveImageAsset({
                ...input,
                projectId: project.value.id,
                ...(project.value.faviconPath
                  ? { projectFaviconPath: project.value.faviconPath }
                  : {}),
              }).pipe(
                Effect.mapError(
                  (cause) =>
                    new AssetImageAccessError({
                      code:
                        "code" in cause &&
                        typeof cause.code === "string" &&
                        [
                          "source-missing",
                          "source-changed",
                          "storage-full",
                          "object-missing",
                          "unsupported",
                          "persistence-failed",
                          "preview-unavailable",
                        ].includes(cause.code)
                          ? (cause.code as AssetImageAccessError["code"])
                          : "persistence-failed",
                      status:
                        "code" in cause && cause.code === "storage-full"
                          ? 507
                          : "code" in cause && cause.code === "object-missing"
                            ? 404
                            : 422,
                    }),
                ),
              )
            : null;
        if (image !== null) return image;
        return yield* issueAssetUrl({
          resource: input.resource,
          ...(project.value.faviconPath ? { projectFaviconPath: project.value.faviconPath } : {}),
        });
      }
      const context = yield* resolveAssetContext(input.resource.threadId).pipe(
        Effect.mapError(
          (cause) => new AssetWorkspaceContextResolutionError({ resource: input.resource, cause }),
        ),
      );
      if (context === undefined) {
        return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
      }
      const image =
        input.imageMode === "reference"
          ? yield* resolveImageAsset({
              ...input,
              ...context,
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new AssetImageAccessError({
                    code:
                      "code" in cause &&
                      typeof cause.code === "string" &&
                      [
                        "source-missing",
                        "source-changed",
                        "storage-full",
                        "object-missing",
                        "unsupported",
                        "persistence-failed",
                        "preview-unavailable",
                      ].includes(cause.code)
                        ? (cause.code as AssetImageAccessError["code"])
                        : "persistence-failed",
                    status:
                      "code" in cause && cause.code === "storage-full"
                        ? 507
                        : "code" in cause && cause.code === "object-missing"
                          ? 404
                          : 422,
                  }),
              ),
            )
          : null;
      if (image !== null) return image;
      return yield* issueAssetUrl({
        resource: input.resource,
        workspaceRoot: context.workspaceRoot,
      });
    });
