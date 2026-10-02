/**
 * Minting an environment's deploy token and handing it to HQ (SPEC §3.2b, main D27/E03).
 *
 * HQ deploys a stage and a production with the environment's own key, and only a person can mint
 * one (a token cannot mint a token, ledger 2026-09-15): so the app mints it, as the person adding
 * the environment or finishing its key, and hands it to HQ, which keeps it and never answers it
 * back (`PUT …/environments/:name/deploy-token`).
 *
 * The decision is `client-runtime/zerops/deployToken.ts`; this performs it and answers what
 * happened rather than throwing. The value passes through this function and nowhere else in the
 * app: it is never logged, stored or shown.
 */

import { deployTokenMint, type ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";

export type DeployTokenOutcome =
  /** HQ holds the environment's key, minted now. */
  | { readonly kind: "held" }
  /** The mint or HQ's write did not go through; the next attempt asks again. */
  | { readonly kind: "failed"; readonly reason: string };

export type DeployTokenClient = Pick<
  ZeropsApiClient,
  "mintIntegrationToken" | "deleteIntegrationToken"
>;

export async function keepDeployToken(input: {
  readonly client: DeployTokenClient;
  readonly hq: Pick<HqApi, "keepDeployToken">;
  readonly clientId: string;
  /** The application whose environment it is. */
  readonly appId: string;
  readonly environment: { readonly projectId: string; readonly name: string };
  readonly signal?: AbortSignal | undefined;
}): Promise<DeployTokenOutcome> {
  try {
    const mint = deployTokenMint({
      projectId: input.environment.projectId,
      environmentName: input.environment.name,
    });
    const minted = await input.client.mintIntegrationToken(
      { clientId: input.clientId, ...mint },
      input.signal,
    );
    try {
      await input.hq.keepDeployToken(input.appId, input.environment.name, minted.token);
    } catch (cause) {
      // A key HQ never got is a key nobody needs: taken back, so the account's token list holds no
      // orphan of a write that failed (main E06).
      await input.client
        .deleteIntegrationToken({ clientId: input.clientId, tokenId: minted.id }, input.signal)
        .catch(() => undefined);
      return { kind: "failed", reason: zeropsErrorMessage(cause) };
    }
    return { kind: "held" };
  } catch (cause) {
    return { kind: "failed", reason: zeropsErrorMessage(cause) };
  }
}
