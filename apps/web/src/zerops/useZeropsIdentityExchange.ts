import type { EnvironmentId } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  exchangeZeropsContainerIdentity as exchangeZeropsContainerIdentityShared,
  type ZeropsIdentityExchangeResult,
} from "@t3tools/client-runtime/zerops/identityExchange";
import { useCallback } from "react";

import { appBasePath } from "~/basePath";
import { connectZeropsIdentity } from "~/connection/onboarding";
import { useAtomCommand } from "~/state/use-atom-command";

import { rememberZeropsEnvironment } from "./firstPromptStorage";
import { useZeropsSession } from "./ZeropsSessionProvider";

export type { ZeropsIdentityExchangeResult };

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
  return exchangeZeropsContainerIdentityShared(
    { zeropsToken: input.zeropsToken, connect: input.connect },
    input.containerOrigin,
    { servedApp: { origin: input.appOrigin, basePath: input.basePath } },
  );
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
