import { useAtomValue } from "@effect/atom-react";
import { createAssetEnvironmentAtoms, resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePreparedConnection } from "./session";
import { useMateImageUri } from "../assets/MateImages";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

export const assetEnvironment = createAssetEnvironmentAtoms(connectionAtomRuntime);

const EMPTY_ASSET_URL_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("mobile-asset-url:empty"),
);

export type AssetUrlState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failure" }
  | { readonly _tag: "Success"; readonly url: string };

export function useAssetUrlState(
  environmentId: EnvironmentId | null,
  resource: AssetResource | null,
): AssetUrlState {
  const preparedConnection = usePreparedConnection(environmentId);
  const image =
    resource !== null &&
    (resource._tag === "project-favicon" ||
      (resource._tag === "attachment"
        ? resource.occurrenceId !== undefined || resource.mimeType?.startsWith("image/") === true
        : resource.path.startsWith("mate-asset:") || isWorkspaceImagePreviewPath(resource.path)));
  const modern =
    preparedConnection._tag === "Some" &&
    preparedConnection.value.contentAddressedImages === true &&
    image;
  const original = useMateImageUri(
    modern && environmentId !== null && resource !== null
      ? { environmentId, resource, rendition: "original" }
      : null,
  );
  const result = useAtomValue(
    environmentId === null || resource === null || modern || preparedConnection._tag === "None"
      ? EMPTY_ASSET_URL_ATOM
      : assetEnvironment.createUrl({ environmentId, input: { resource } }),
  );
  if (modern) {
    if (original.read.kind === "failed") return { _tag: "Failure" };
    return original.uri === null ? { _tag: "Loading" } : { _tag: "Success", url: original.uri };
  }
  if (result._tag === "Failure") {
    return { _tag: "Failure" };
  }
  if (preparedConnection._tag === "None" || result._tag !== "Success") {
    return { _tag: "Loading" };
  }
  const url = resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
  return url === null ? { _tag: "Failure" } : { _tag: "Success", url };
}

export function useAssetUrl(
  environmentId: EnvironmentId | null,
  resource: AssetResource | null,
): string | null {
  const state = useAssetUrlState(environmentId, resource);
  return state._tag === "Success" ? state.url : null;
}
