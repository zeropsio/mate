import type { EnvironmentId } from "@t3tools/contracts";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { zeropsMateBaseUrl } from "@t3tools/client-runtime/zerops/candidates";
import { useCallback } from "react";

import { appBasePath } from "~/basePath";
import { connectZeropsIdentity } from "~/connection/onboarding";
import { useAtomCommand } from "~/state/use-atom-command";

import { rememberZeropsEnvironment } from "./firstPromptStorage";
import { useZeropsSession, zeropsErrorMessage } from "./ZeropsSessionProvider";

export type ZeropsIdentityExchangeResult =
  | { readonly _tag: "Success"; readonly environmentId: EnvironmentId }
  | { readonly _tag: "Failure"; readonly error: string };

export async function exchangeZeropsContainerIdentity<E>(input: {
  readonly containerOrigin: string;
  readonly appOrigin: string;
  readonly basePath: string;
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
    httpBaseUrl: zeropsMateBaseUrl(input.containerOrigin, {
      origin: input.appOrigin,
      basePath: input.basePath,
    }),
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

export function useZeropsIdentityExchange() {
  const { client } = useZeropsSession();
  const connect = useAtomCommand(connectZeropsIdentity, { reportFailure: false });

  return useCallback(
    async (containerOrigin: string): Promise<ZeropsIdentityExchangeResult> => {
      const result = await exchangeZeropsContainerIdentity({
        containerOrigin,
        appOrigin: window.location.origin,
        basePath: appBasePath(),
        zeropsToken: client.session?.accessToken ?? null,
        connect,
      });
      if (result._tag === "Success") {
        rememberZeropsEnvironment(String(result.environmentId));
      }
      return result;
    },
    [client, connect],
  );
}
