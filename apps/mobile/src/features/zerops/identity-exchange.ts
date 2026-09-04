import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  exchangeZeropsContainerIdentity as exchangeZeropsContainerIdentityShared,
  type ZeropsIdentityExchangeResult,
} from "@t3tools/client-runtime/zerops/identityExchange";
import type { EnvironmentId } from "@t3tools/contracts";

export type { ZeropsIdentityExchangeResult };

export async function exchangeZeropsContainerIdentity<E>(input: {
  readonly containerOrigin: string;
  readonly zeropsToken: string | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly zeropsToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
}): Promise<ZeropsIdentityExchangeResult> {
  return exchangeZeropsContainerIdentityShared(
    { zeropsToken: input.zeropsToken, connect: input.connect },
    input.containerOrigin,
  );
}
