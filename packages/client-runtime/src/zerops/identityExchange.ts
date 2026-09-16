import * as Schema from "effect/Schema";
import { ConnectionBlockedError } from "../connection/model.ts";
/**
 * The container's `/mate` door, shared by every client.
 *
 * A throwaway is minted for this one Mate, handed to `connect`, and deleted
 * whatever the door answered (`doorThrowaway.ts`). The account's own Zerops
 * token stays in the app and reaches the Zerops API only.
 *
 * `servedApp` is passed only by a client that might itself be the bundle a
 * container is serving (the web app, same-origin) — a client with no such
 * notion (mobile) omits it and always gets the plain `/mate` prefix.
 */

import type { EnvironmentId } from "@t3tools/contracts";

import type { ZeropsThrowawayPlatform } from "../authorization/zeropsThrowaway.ts";
import { squashAtomCommandFailure, type AtomCommandResult } from "../state/runtime.ts";
import { zeropsMateBaseUrl } from "./candidates.ts";
import { connectThroughThrowaway } from "./doorThrowaway.ts";
import { zeropsErrorMessage } from "./errors.ts";

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);

export type ZeropsIdentityExchangeResult =
  | { readonly _tag: "Success"; readonly environmentId: EnvironmentId }
  | {
      readonly _tag: "Failure";
      readonly error: string;
      readonly upgradeRequired?: boolean;
      readonly serverVersion?: string;
    };

/**
 * What it takes to mint one throwaway: the two platform calls, the org that
 * holds the token and the project it is named for. `null` when nobody is
 * signed in, which is the one case where there is nothing to mint with.
 */
export interface ZeropsDoorThrowaway {
  readonly platform: ZeropsThrowawayPlatform;
  readonly clientId: string;
  readonly projectId: string;
  /** Tells this throwaway apart from another minted in the same second. */
  readonly nonce: string;
}

export interface ZeropsIdentityExchangeDeps<E> {
  readonly throwaway: ZeropsDoorThrowaway | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly doorToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
  /** Told when a throwaway could not be taken back; never fails the connect. */
  readonly onOrphanedThrowaway?: ((cause: unknown) => void) | undefined;
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
  const throwaway = deps.throwaway;
  if (!throwaway) {
    return {
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
    };
  }
  const httpBaseUrl = zeropsMateBaseUrl(containerOrigin, options.servedApp);
  let result: AtomCommandResult<EnvironmentId, E>;
  try {
    result = await connectThroughThrowaway({
      platform: throwaway.platform,
      clientId: throwaway.clientId,
      projectId: throwaway.projectId,
      nonce: throwaway.nonce,
      ...(deps.onOrphanedThrowaway === undefined ? {} : { onOrphaned: deps.onOrphanedThrowaway }),
      connect: (doorToken) => deps.connect({ httpBaseUrl, doorToken }),
    });
  } catch (cause) {
    // The mint itself failed — the account is signed out, the platform is
    // down, or the org refused. The door was never reached, so there is
    // nothing to report about it.
    return {
      _tag: "Failure",
      error: `Could not connect to this container. ${zeropsErrorMessage(cause)}`,
    };
  }
  if (result._tag === "Failure") {
    const failure = squashAtomCommandFailure(result);
    const reason = zeropsErrorMessage(failure);
    return {
      _tag: "Failure",
      error: `Could not connect to this container. ${reason}`,
      ...(isConnectionBlockedError(failure) && failure.reason === "unsupported"
        ? {
            upgradeRequired: true,
            ...(failure.serverVersion ? { serverVersion: failure.serverVersion } : {}),
          }
        : {}),
    };
  }
  return { _tag: "Success", environmentId: result.value };
}
