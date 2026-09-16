/**
 * Giving every Mate its Gitea access, as a reconcile rather than a step.
 *
 * A Mate pushes with a bot's Gitea token (guide 1.5). The app asks the org's
 * broker for it **as the person**, proved by a throwaway with no rights, and
 * writes the answer onto the Mate's `zcp` service. No broker endpoint takes a
 * Zerops key, and the Mate's own key never leaves its container.
 *
 * It runs here, on the projects screen, for the same reason the group-reach
 * repair does: this is the one place that can see the whole account, and the
 * decision is a read of what each Mate holds rather than a memory of what was
 * done. So a Mate created before the account had a Gitea, one taken from the
 * pool, and one whose write was interrupted between the broker's answer and
 * the service-env write are all picked up — including the one a creation hands
 * off when it reaches `fetch-gitea-credential` with the container still coming
 * up.
 *
 * **An account with no Gitea makes no call at all.** The env read costs one
 * request per Mate, so it is gated on there being a broker to ask and run once
 * per account per session.
 *
 * The decision is `giteaCredential.ts`; this is the shell that reads the
 * account and performs the writes. Failures are swallowed: this is background
 * repair of something the person did not ask for, and a Mate without a Gitea
 * token is a working Mate that cannot push yet. The next read tries again.
 *
 * **The token exists as an argument and nothing else.** It goes from the
 * broker's answer into `writeMateGiteaCredential` and is never returned,
 * stored, logged or put on a plan a UI renders.
 */

import { requestMateCredential } from "@t3tools/client-runtime/authorization";
import {
  planGiteaCredential,
  planGiteaCredentialReconcile,
  type GiteaCredentialOutcome,
  type GiteaEndpoints,
  type MateGiteaAccess,
  type ZeropsApiClient,
} from "@t3tools/client-runtime/zerops";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useRef } from "react";

import { randomUUID } from "~/lib/utils";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A Mate on the account, before anything of its environment has been read. */
export interface MateGiteaTarget {
  readonly projectId: string;
  /** Its `zcp` service. A Mate without one has nothing to write onto. */
  readonly serviceId: string | undefined;
}

/**
 * Asks the broker for one Mate's Gitea access and writes it, as the person.
 *
 * Answers what happened rather than throwing: the creation checklist and the
 * reconcile both treat every outcome as something the next read can improve
 * on, and neither is a reason to fail a Mate that exists and runs.
 */
export async function fetchMateGiteaCredential(input: {
  readonly client: ZeropsApiClient;
  readonly clientId: string;
  readonly endpoints: GiteaEndpoints | undefined;
  readonly mate: MateGiteaAccess;
  readonly nonce: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<GiteaCredentialOutcome> {
  const plan = planGiteaCredentialReconcile({ endpoints: input.endpoints, mates: [input.mate] });
  if (plan.kind === "wait-for-gitea") return { kind: "waiting-for-gitea" };
  if (plan.kind === "up-to-date") return { kind: "up-to-date" };
  const [target] = plan.mates;
  if (target === undefined) return { kind: "up-to-date" };

  try {
    const answer = await requestMateCredential({
      brokerUrl: plan.endpoints.brokerOrigin,
      giteaUrl: plan.endpoints.giteaOrigin,
      clientId: input.clientId,
      projectId: target.projectId,
      mode: target.mode,
      nonce: input.nonce,
      platform: zeropsThrowawayPlatform(input.client),
      fetch: globalThis.fetch.bind(globalThis),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const write = planGiteaCredential({
      brokerOrigin: plan.endpoints.brokerOrigin,
      credential: answer,
      current: input.mate.current,
    });
    if (write.upToDate) return { kind: "up-to-date" };
    await input.client.writeMateGiteaCredential(
      {
        serviceId: target.serviceId,
        plan: write,
        ...(answer.token === undefined ? {} : { token: answer.token }),
      },
      input.signal,
    );
    return { kind: "written" };
  } catch (cause) {
    return { kind: "unavailable", reason: zeropsErrorMessage(cause) };
  }
}

/** Serialises the decision's inputs, so an unchanged account is not re-read. */
function reconcileKey(
  endpoints: GiteaEndpoints | undefined,
  mates: ReadonlyArray<MateGiteaTarget>,
): string {
  const endpointKey =
    endpoints === undefined ? "none" : `${endpoints.giteaOrigin}|${endpoints.brokerOrigin}`;
  const mateKeys = mates
    .map((mate) => `${mate.projectId}:${mate.serviceId ?? "-"}`)
    .toSorted()
    .join(";");
  return `${endpointKey}#${mateKeys}`;
}

export function useZeropsGiteaCredential(input: {
  readonly clientId: string | undefined;
  /** Undefined until the account's Gitea and its broker are both up. */
  readonly endpoints: GiteaEndpoints | undefined;
  readonly mates: ReadonlyArray<MateGiteaTarget>;
  readonly enabled: boolean;
}): void {
  const { client } = useZeropsSession();
  const lastKey = useRef<string | null>(null);
  const { clientId, endpoints, enabled, mates } = input;
  const key = reconcileKey(endpoints, mates);

  useEffect(() => {
    // Nothing to ask, so nothing is read: an account whose Gitea is still
    // building must not cost a request per Mate on every visit.
    if (!enabled || clientId === undefined || endpoints === undefined) return;
    if (lastKey.current === `${clientId}:${key}`) return;
    lastKey.current = `${clientId}:${key}`;

    const controller = new AbortController();
    void (async () => {
      for (const mate of mates) {
        if (controller.signal.aborted) return;
        if (mate.serviceId === undefined) continue;
        let current: Readonly<Record<string, string>>;
        try {
          current = await client.readMateGiteaEnv(mate.serviceId, controller.signal);
        } catch {
          lastKey.current = null;
          return;
        }
        if (controller.signal.aborted) return;
        const outcome = await fetchMateGiteaCredential({
          client,
          clientId,
          endpoints,
          mate: { projectId: mate.projectId, serviceId: mate.serviceId, current },
          nonce: randomUUID(),
          signal: controller.signal,
        });
        // A refusal or an outage is not a screen's business; the next read
        // asks again.
        if (outcome.kind === "unavailable") lastKey.current = null;
      }
    })();

    return () => {
      controller.abort();
    };
  }, [client, clientId, enabled, endpoints, key, mates]);
}
