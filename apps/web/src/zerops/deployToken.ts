/**
 * Minting an environment's deploy token and handing it to the broker (D27).
 *
 * A job deploys, with `zcli push`; the account's broker hands it the key. The
 * key is one integration token per stage and production — `BASIC_USER` on that
 * project and nothing else — and only a person can mint one (a token cannot
 * mint a token, ledger 2026-09-15). So the app mints it, as the person adding
 * the environment, and writes it where only the broker reads it: a secret
 * variable on the broker's own service in the account's Gitea project. A
 * container reads only its own service's variables, so no job can.
 *
 * The decision is `client-runtime/zerops/deployToken.ts`; this performs it and
 * answers what happened rather than throwing. The value passes through this
 * function and nowhere else in the app: it is never logged, stored or shown.
 */

import {
  BROKER_HOSTNAME,
  planDeployToken,
  type ZeropsApiClient,
} from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

export type DeployTokenOutcome =
  /** The broker holds the environment's key — written now, or already there. */
  | { readonly kind: "held" }
  /** An account whose Gitea project has no broker service has nowhere to keep one. */
  | { readonly kind: "no-broker"; readonly reason: string }
  /** A read, the mint or the write did not go through; the next attempt asks again. */
  | { readonly kind: "failed"; readonly reason: string };

export type DeployTokenClient = Pick<
  ZeropsApiClient,
  | "listProjectServices"
  | "listServiceVariableNames"
  | "mintIntegrationToken"
  | "writeServiceSecret"
  | "deleteIntegrationToken"
>;

export async function ensureDeployToken(input: {
  readonly client: DeployTokenClient;
  readonly clientId: string;
  /** The account's Gitea project, where the broker's service lives. */
  readonly giteaProjectId: string;
  readonly environment: { readonly projectId: string; readonly name: string };
  readonly signal?: AbortSignal | undefined;
}): Promise<DeployTokenOutcome> {
  try {
    const services = await input.client.listProjectServices(input.giteaProjectId, input.signal);
    const broker = services.find((service) => service.name === BROKER_HOSTNAME);
    if (broker === undefined) {
      return { kind: "no-broker", reason: "This account has no broker to keep a deploy key yet." };
    }
    const plan = planDeployToken({
      projectId: input.environment.projectId,
      environmentName: input.environment.name,
      brokerVariables: await input.client.listServiceVariableNames(broker.id, input.signal),
    });
    if (plan.kind === "held") return { kind: "held" };

    const minted = await input.client.mintIntegrationToken(
      {
        clientId: input.clientId,
        name: plan.name,
        roleCode: plan.roleCode,
        projects: plan.projects,
      },
      input.signal,
    );
    try {
      await input.client.writeServiceSecret(
        { serviceId: broker.id, key: plan.variable, content: minted.token },
        input.signal,
      );
    } catch (cause) {
      // A key the broker never got is a key nobody needs: taken back, so the
      // account's token list holds no orphan of a write that failed.
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
