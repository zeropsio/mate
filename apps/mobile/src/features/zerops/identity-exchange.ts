import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  exchangeZeropsContainerIdentity as exchangeZeropsContainerIdentityShared,
  type ZeropsDoorThrowaway,
  type ZeropsIdentityExchangeResult,
} from "@t3tools/client-runtime/zerops/identityExchange";
import type { EnvironmentId } from "@t3tools/contracts";

export type { ZeropsDoorThrowaway, ZeropsIdentityExchangeResult };

export async function exchangeZeropsContainerIdentity<E>(input: {
  readonly containerOrigin: string;
  /** Null when nobody is signed in — there is nothing to mint with. */
  readonly throwaway: ZeropsDoorThrowaway | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly doorToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
}): Promise<ZeropsIdentityExchangeResult> {
  return exchangeZeropsContainerIdentityShared(
    { throwaway: input.throwaway, connect: input.connect },
    input.containerOrigin,
    // Mobile's one exchange is the connect screen's tap.
    { reason: "user" },
  );
}
