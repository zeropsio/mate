import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AssetImageDimensions, AssetResource, EnvironmentId } from "@t3tools/contracts";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useState } from "react";

import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";

export { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";

export type AssetUrlState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failure" }
  | {
      readonly _tag: "Success";
      readonly url: string;
      readonly sourcePath?: string;
      /** The picture's size, read from its header by the server: its box before its bytes. */
      readonly imageDimensions?: AssetImageDimensions;
    };

/**
 * How long a failed signing is tried again before a picture is said to be
 * unavailable, with `retry`: a Mate busy building or a socket that reconnects
 * fails one for a moment, never for good (the owner, 2026-10-05: "image
 * unavailable is a lot of the times just slow loading"). Until then it is
 * still loading.
 */
export const SIGN_RETRY_DELAYS_MS: ReadonlyArray<number> = [1_000, 2_000, 4_000, 8_000, 15_000];

/** What the server says is not there: no try again finds it. */
const NOT_THERE = new Set([
  "AssetWorkspaceResolutionError",
  "AssetAttachmentNotFoundError",
  "AssetProjectFaviconNotFoundError",
]);

/** Whether a failed signing says the file is not there, rather than that its Mate did not answer. */
export function signingSaysNotThere(cause: Cause.Cause<unknown>): boolean {
  const error = Cause.findErrorOption(cause);
  if (Option.isNone(error)) return false;
  const tag = (error.value as { readonly _tag?: unknown } | null)?._tag;
  return typeof tag === "string" && NOT_THERE.has(tag);
}

export function useAssetUrlState(
  environmentId: EnvironmentId,
  resource: AssetResource,
  options?: {
    /** A failed signing is tried again (`SIGN_RETRY_DELAYS_MS`) before it fails. */
    readonly retry?: boolean;
  },
): AssetUrlState {
  const preparedConnection = usePreparedConnection(environmentId);
  const atom = assetEnvironment.createUrl({
    environmentId,
    input: { resource },
  });
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  const key = JSON.stringify([environmentId, resource]);
  const [tries, setTries] = useState({ key, done: 0 });
  const done = tries.key === key ? tries.done : 0;
  const retrying =
    options?.retry === true &&
    result._tag === "Failure" &&
    !signingSaysNotThere(result.cause) &&
    done < SIGN_RETRY_DELAYS_MS.length;
  useEffect(() => {
    if (!retrying) return;
    const timer = setTimeout(() => {
      setTries({ key, done: done + 1 });
      refresh();
    }, SIGN_RETRY_DELAYS_MS[done]);
    return () => clearTimeout(timer);
  }, [retrying, key, done, refresh]);
  if (result._tag === "Failure") {
    return retrying ? { _tag: "Loading" } : { _tag: "Failure" };
  }
  if (preparedConnection._tag === "None" || result._tag !== "Success") {
    return { _tag: "Loading" };
  }
  const url = resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
  return url === null
    ? { _tag: "Failure" }
    : {
        _tag: "Success",
        url,
        ...(result.value.sourcePath !== undefined ? { sourcePath: result.value.sourcePath } : {}),
        ...(result.value.imageDimensions !== undefined
          ? { imageDimensions: result.value.imageDimensions }
          : {}),
      };
}

export function useAssetUrls(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<string | null> {
  const preparedConnection = usePreparedConnection(environmentId);
  const results = useAtomValue(
    assetEnvironment.createUrls({
      environmentId,
      resources,
    }),
  );
  return useMemo(
    () =>
      preparedConnection._tag === "None"
        ? resources.map(() => null)
        : results.map((result) =>
            AsyncResult.isSuccess(result)
              ? resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl)
              : null,
          ),
    [preparedConnection, resources, results],
  );
}

/** Each resource's state, read together: its address once signed, a failure where it is not there. */
export function useAssetUrlStates(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<AssetUrlState> {
  const preparedConnection = usePreparedConnection(environmentId);
  const results = useAtomValue(assetEnvironment.createUrls({ environmentId, resources }));
  return useMemo(
    () =>
      results.map((result): AssetUrlState => {
        if (AsyncResult.isFailure(result)) return { _tag: "Failure" };
        if (preparedConnection._tag === "None" || !AsyncResult.isSuccess(result)) {
          return { _tag: "Loading" };
        }
        const url = resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
        return url === null
          ? { _tag: "Failure" }
          : {
              _tag: "Success",
              url,
              ...(result.value.imageDimensions !== undefined
                ? { imageDimensions: result.value.imageDimensions }
                : {}),
            };
      }),
    [preparedConnection, results],
  );
}
