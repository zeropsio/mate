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
 *
 * A key is taken back only where HQ refused it. Any other failure of the handoff — an answer lost,
 * an HQ that did not answer — may have left the key with HQ, which finishes a write its client left
 * (F22): HQ is read back, and a key it holds is held; one it does not hold yet is left, for a write
 * that may still land must not lose its key (audit K4).
 */

import { deployTokenMint, type ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { environmentsOf, HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";

export type DeployTokenOutcome =
  /** HQ holds the environment's key, minted now. */
  | { readonly kind: "held" }
  /** The mint or HQ's write did not go through; the next attempt asks again. */
  | { readonly kind: "failed"; readonly reason: string };

export type DeployTokenClient = Pick<
  ZeropsApiClient,
  "mintIntegrationToken" | "deleteIntegrationToken"
>;

/** Whether HQ holds a deploy key for the environment `name` of the application `appId`. */
async function heldByHq(
  hq: Pick<HqApi, "structure">,
  appId: string,
  name: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    const { apps } = await hq.structure(signal);
    const environments = environmentsOf(apps.find((app) => app.id === appId)?.environments) ?? [];
    return environments.some((environment) => environment.name === name && environment.keyHeld);
  } catch {
    // HQ not answering the read back either: nothing to say it holds the key.
    return false;
  }
}

export async function keepDeployToken(input: {
  readonly client: DeployTokenClient;
  readonly hq: Pick<HqApi, "keepDeployToken" | "structure">;
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
      if (!(cause instanceof HqError && cause.kind === "refused")) {
        return (await heldByHq(input.hq, input.appId, input.environment.name, input.signal))
          ? { kind: "held" }
          : { kind: "failed", reason: zeropsErrorMessage(cause) };
      }
      // A key HQ refused is a key nobody needs: taken back, so the account's token list holds no
      // orphan of a write that failed (main E06) — on its own deadline, never the caller's: one
      // that left leaves no orphan either.
      await input.client
        .deleteIntegrationToken({ clientId: input.clientId, tokenId: minted.id })
        .catch(() => undefined);
      return { kind: "failed", reason: zeropsErrorMessage(cause) };
    }
    return { kind: "held" };
  } catch (cause) {
    return { kind: "failed", reason: zeropsErrorMessage(cause) };
  }
}
