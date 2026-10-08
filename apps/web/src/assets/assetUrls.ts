import { mateImageSource } from "@t3tools/client-runtime/data";
import type { AssetImageDimensions, AssetResource, EnvironmentId } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
export { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";

export type AssetUrlState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failure"; readonly reason?: string | undefined }
  | {
      readonly _tag: "Success";
      readonly url: string;
      readonly sourcePath?: string;
      readonly imageDimensions?: AssetImageDimensions;
    };

function stillImage(resource: AssetResource) {
  return (
    resource._tag === "project-favicon" ||
    (resource._tag === "attachment"
      ? resource.mimeType === undefined || resource.mimeType.startsWith("image/")
      : resource.path.startsWith("mate-asset:") || isWorkspaceImagePreviewPath(resource.path))
  );
}

/** Still images are identities. Their near-viewport presentation demands one rendition. */
export function useAssetUrlState(
  environmentId: EnvironmentId,
  resource: AssetResource,
): AssetUrlState {
  const images = useAssetUrlStates(environmentId, [resource]);
  return images[0]!;
}
export function useAssetUrlStates(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<AssetUrlState> {
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  const identity = JSON.stringify(resources);
  const targets = useMemo(() => JSON.parse(identity) as ReadonlyArray<AssetResource>, [identity]);
  const legacy = targets.filter((resource) => !stillImage(resource));
  const results = useAtomValue(assetEnvironment.createUrls({ environmentId, resources: legacy }));
  return useMemo(() => {
    let index = 0;
    return targets.map((resource): AssetUrlState => {
      if (stillImage(resource))
        return { _tag: "Success", url: mateImageSource({ environmentId, resource }) };
      const result = results[index++];
      if (result === undefined || httpBaseUrl === null || !AsyncResult.isSuccess(result))
        return result?._tag === "Failure" ? { _tag: "Failure" } : { _tag: "Loading" };
      const url = resolveAssetUrl(httpBaseUrl, result.value.relativeUrl);
      return url === null
        ? { _tag: "Failure" }
        : {
            _tag: "Success",
            url,
            ...(result.value.sourcePath === undefined
              ? {}
              : { sourcePath: result.value.sourcePath }),
          };
    });
  }, [environmentId, httpBaseUrl, results, targets]);
}
export function useAssetUrls(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
) {
  return useAssetUrlStates(environmentId, resources).map((read) =>
    read._tag === "Success" ? read.url : null,
  );
}
