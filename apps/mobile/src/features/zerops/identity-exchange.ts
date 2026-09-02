import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { zeropsMateBaseUrl } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";

import { zeropsErrorMessage } from "./errors";

export type ZeropsIdentityExchangeResult =
  | { readonly _tag: "Success"; readonly environmentId: EnvironmentId }
  | { readonly _tag: "Failure"; readonly error: string };

export async function exchangeZeropsContainerIdentity<E>(input: {
  readonly containerOrigin: string;
  readonly zeropsToken: string | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly zeropsToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
}): Promise<ZeropsIdentityExchangeResult> {
  if (!input.zeropsToken) {
    return {
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
    };
  }

  const result = await input.connect({
    httpBaseUrl: zeropsMateBaseUrl(input.containerOrigin),
    zeropsToken: input.zeropsToken,
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
