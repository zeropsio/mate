import type { EnvironmentId } from "@t3tools/contracts";
import type { AccountStore } from "@t3tools/client-runtime/data";

/** A live object URL and its decoded browser resource, owned by the account rather than an img. */
export interface ImagePresentation {
  readonly url: string;
  decoded: boolean;
  pixels: HTMLImageElement | undefined;
  readonly decode: () => Promise<void>;
  readonly dispose: () => void;
}

const accounts = new WeakMap<AccountStore, ReturnType<typeof makeImagePresentations>>();

export function imagePresentationsOf(store: AccountStore) {
  let presentations = accounts.get(store);
  if (presentations === undefined) {
    presentations = makeImagePresentations();
    accounts.set(store, presentations);
    store.onClose(presentations.stop);
  }
  return presentations;
}

function makeImagePresentations() {
  const environments = new Map<EnvironmentId, Map<string | Blob, ImagePresentation>>();
  const release = (environmentId: EnvironmentId) => {
    for (const presentation of environments.get(environmentId)?.values() ?? [])
      presentation.dispose();
    environments.delete(environmentId);
  };
  return {
    get: (environmentId: EnvironmentId, blob: Blob, digest?: string): ImagePresentation => {
      let entries = environments.get(environmentId);
      if (entries === undefined) {
        entries = new Map();
        environments.set(environmentId, entries);
      }
      const key = digest ?? blob;
      const held = entries.get(key);
      if (held !== undefined) return held;
      let loading: Promise<void> | undefined;
      let disposed = false;
      const presentation: ImagePresentation = {
        url: URL.createObjectURL(blob),
        decoded: false,
        pixels: undefined,
        decode: () => {
          if (presentation.decoded) return Promise.resolve();
          if (loading !== undefined) return loading;
          const image = (presentation.pixels ??= new Image());
          image.src = presentation.url;
          return (loading = image.decode().then(
            () => {
              if (!disposed) {
                // The detached resource never retains a mounted subtree.
                presentation.pixels = image;
                presentation.decoded = true;
              }
            },
            (error: unknown) => {
              loading = undefined;
              throw error;
            },
          ));
        },
        dispose: () => {
          disposed = true;
          presentation.decoded = false;
          presentation.pixels = undefined;
          URL.revokeObjectURL(presentation.url);
        },
      };
      entries.set(key, presentation);
      return presentation;
    },
    release,
    stop: () => {
      for (const environmentId of environments.keys()) release(environmentId);
    },
  };
}
