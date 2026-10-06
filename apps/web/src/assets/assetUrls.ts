import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AssetImageDimensions, AssetResource, EnvironmentId } from "@t3tools/contracts";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useContext, useEffect, useMemo, useState } from "react";

import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";

export { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";

export type AssetUrlState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failure"; readonly reason?: string | undefined }
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
  "AssetWorkspaceAssetNotFoundError",
  "AssetWorkspaceContextNotFoundError",
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

/** Only typed owner evidence supplies a reason; transport failures never claim deletion. */
function signingFailure(cause: Cause.Cause<unknown>): AssetUrlState {
  const error = Cause.findErrorOption(cause);
  const tag = Option.isSome(error)
    ? (error.value as { readonly _tag?: unknown } | null)?._tag
    : undefined;
  const reasons: Readonly<Record<string, string>> = {
    AssetWorkspaceAssetNotFoundError: "File no longer exists",
    AssetAttachmentNotFoundError: "Attachment no longer exists",
    AssetProjectFaviconNotFoundError: "File no longer exists",
    AssetWorkspaceContextNotFoundError: "Conversation workspace is unavailable",
    AssetWorkspacePathValidationError: "File path is not allowed",
    AssetPreviewTypeValidationError: "File type cannot be previewed",
    AssetWorkspaceResolutionError: "Workspace could not be resolved",
    EnvironmentRpcUnavailableError: "Mate is disconnected",
    RpcClientError: "Mate did not respond",
  };
  return { _tag: "Failure", reason: typeof tag === "string" ? reasons[tag] : undefined };
}

function signingCanRetry(cause: Cause.Cause<unknown>): boolean {
  if (signingSaysNotThere(cause)) return false;
  const error = Cause.findErrorOption(cause);
  const tag = Option.isSome(error)
    ? (error.value as { readonly _tag?: unknown } | null)?._tag
    : undefined;
  return tag !== "AssetWorkspacePathValidationError" && tag !== "AssetPreviewTypeValidationError";
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
    signingCanRetry(result.cause) &&
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
    return retrying ? { _tag: "Loading" } : signingFailure(result.cause);
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

/**
 * One signing's state: missing files and refused paths fail immediately; transient failures
 * keep their room while the caller's bounded retry schedule is active.
 */
export function assetUrlStateOf(
  result: AsyncResult.AsyncResult<
    {
      readonly relativeUrl: string;
      readonly sourcePath?: string | undefined;
      readonly imageDimensions?: AssetImageDimensions | undefined;
    },
    unknown
  >,
  httpBaseUrl: string | null,
  retrying = true,
): AssetUrlState {
  if (AsyncResult.isFailure(result)) {
    return retrying && signingCanRetry(result.cause)
      ? { _tag: "Loading" }
      : signingFailure(result.cause);
  }
  if (httpBaseUrl === null || !AsyncResult.isSuccess(result)) return { _tag: "Loading" };
  const url = resolveAssetUrl(httpBaseUrl, result.value.relativeUrl);
  return url === null
    ? { _tag: "Failure" }
    : {
        _tag: "Success",
        url,
        ...(result.value.imageDimensions !== undefined
          ? { imageDimensions: result.value.imageDimensions }
          : {}),
      };
}

/**
 * Each resource's state, read together (`assetUrlStateOf`). A signing that failed for a moment is
 * tried again on `SIGN_RETRY_DELAYS_MS`, as `useAssetUrlState`'s `retry` does. It stays loading
 * during those attempts, then reports unavailable; a repaired link can supply fresh evidence.
 */
export function useAssetUrlStates(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<AssetUrlState> {
  const preparedConnection = usePreparedConnection(environmentId);
  const registry = useContext(RegistryContext);
  const results = useAtomValue(assetEnvironment.createUrls({ environmentId, resources }));
  const key = JSON.stringify([environmentId, resources]);
  const [tries, setTries] = useState({ key, done: 0 });
  const done = tries.key === key ? tries.done : 0;
  // The ones that may come back: failed, and not for want of the file.
  const passing = results
    .flatMap((result, index) =>
      AsyncResult.isFailure(result) && signingCanRetry(result.cause) ? [index] : [],
    )
    .join(",");
  const retrying = passing !== "" && done < SIGN_RETRY_DELAYS_MS.length;
  useEffect(() => {
    if (!retrying) return;
    const timer = setTimeout(() => {
      setTries({ key, done: done + 1 });
      for (const index of passing.split(",")) {
        const resource = resources[Number(index)];
        if (resource !== undefined) {
          registry.refresh(assetEnvironment.createUrl({ environmentId, input: { resource } }));
        }
      }
    }, SIGN_RETRY_DELAYS_MS[done]);
    return () => clearTimeout(timer);
  }, [done, environmentId, key, passing, registry, resources, retrying]);
  const httpBaseUrl =
    preparedConnection._tag === "None" ? null : preparedConnection.value.httpBaseUrl;
  return useMemo(
    () => results.map((result) => assetUrlStateOf(result, httpBaseUrl, retrying)),
    [httpBaseUrl, results, retrying],
  );
}
