/**
 * The declared environments whose deploy token the broker does not hold (D27),
 * for the projects page to mint on its next read.
 *
 * One read of the broker's variable *names* — never a value — per account, and
 * again after the page finished something. Asked only for a person who may
 * mint a token (an org owner or admin): for anybody else a missing key is not
 * theirs to fix, and the page says nothing about it.
 */
import {
  BROKER_HOSTNAME,
  environmentsWithoutDeployToken,
  type ZeropsApiClient,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

export function useZeropsDeployTokenGaps(input: {
  readonly client: Pick<ZeropsApiClient, "listProjectServices" | "listServiceVariableNames">;
  readonly giteaProjectId: string | undefined;
  /** Every project some group's `environments.yaml` declares. */
  readonly declaredProjects: ReadonlyArray<string>;
  readonly enabled: boolean;
  /** Bumped by the caller after it finished an environment, to read again. */
  readonly generation: number;
}): ReadonlySet<string> | undefined {
  const { client, enabled, generation, giteaProjectId } = input;
  const key =
    enabled && giteaProjectId !== undefined && input.declaredProjects.length > 0
      ? JSON.stringify([giteaProjectId, input.declaredProjects.toSorted()])
      : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly gaps: ReadonlySet<string>;
  } | null>(null);

  useEffect(() => {
    if (key === "" || giteaProjectId === undefined) return;
    const controller = new AbortController();
    const declaredProjects = (JSON.parse(key) as [string, ReadonlyArray<string>])[1];
    void (async () => {
      try {
        const services = await client.listProjectServices(giteaProjectId, controller.signal);
        const broker = services.find((service) => service.name === BROKER_HOSTNAME);
        if (broker === undefined) return;
        const brokerVariables = await client.listServiceVariableNames(broker.id, controller.signal);
        if (controller.signal.aborted) return;
        setAnswer({
          key,
          gaps: new Set(environmentsWithoutDeployToken({ declaredProjects, brokerVariables })),
        });
      } catch {
        // A read that failed says nothing; the next one asks again.
      }
    })();
    return () => {
      controller.abort();
    };
  }, [client, generation, giteaProjectId, key]);

  return answer?.key === key ? answer.gaps : undefined;
}
