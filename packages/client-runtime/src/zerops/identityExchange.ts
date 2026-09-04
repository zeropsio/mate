/**
 * The container's `/mate` identity door, shared by every client: hand the
 * account's Zerops token to `connect`, addressed at the container's mate
 * base URL. `servedApp` is passed only by a client that might itself be the
 * bundle a container is serving (the web app, same-origin) — a client with
 * no such notion (mobile) omits it and always gets the plain `/mate` prefix.
 */

import type { EnvironmentId } from "@t3tools/contracts";

import { squashAtomCommandFailure, type AtomCommandResult } from "../state/runtime.ts";
import { zeropsMateBaseUrl } from "./candidates.ts";
import { zeropsErrorMessage } from "./errors.ts";

export type ZeropsIdentityExchangeResult =
  | { readonly _tag: "Success"; readonly environmentId: EnvironmentId }
  | { readonly _tag: "Failure"; readonly error: string };

export interface ZeropsIdentityExchangeDeps<E> {
  readonly zeropsToken: string | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly zeropsToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
}

export async function exchangeZeropsContainerIdentity<E>(
  deps: ZeropsIdentityExchangeDeps<E>,
  containerOrigin: string,
  options: {
    readonly servedApp?: {
      readonly origin: string;
      readonly basePath: string;
    };
  } = {},
): Promise<ZeropsIdentityExchangeResult> {
  if (!deps.zeropsToken) {
    return {
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
    };
  }
  const result = await deps.connect({
    httpBaseUrl: zeropsMateBaseUrl(containerOrigin, options.servedApp),
    zeropsToken: deps.zeropsToken,
  });
  if (result._tag === "Failure") {
    const reason = zeropsErrorMessage(squashAtomCommandFailure(result));
    return {
      _tag: "Failure",
      error: `Could not connect to this container. ${reason}`,
    };
  }
  return { _tag: "Success", environmentId: result.value };
}
