import { Atom } from "effect/reactivity";
import { parseAssetCollectionKey } from "@t3tools/client-runtime/state/assets";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { workspaceQuery } from "./workspace";
const createUrl = workspaceQuery("assetUrl");
const collections = Atom.family((key: string) => {
  const [environmentId, resources] = parseAssetCollectionKey(key);
  return Atom.make((get) =>
    resources.map((resource) => get(createUrl({ environmentId, input: { resource } }))),
  );
});
export const assetEnvironment = {
  createUrl,
  createUrls: (target: {
    readonly environmentId: EnvironmentId;
    readonly resources: ReadonlyArray<AssetResource>;
  }) => collections(JSON.stringify([target.environmentId, target.resources])),
};
