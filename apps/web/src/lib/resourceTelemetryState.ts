import type {
  EnvironmentId,
  ResourceTelemetryHistoryInput,
  ResourceTelemetrySnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useCallback } from "react";

import { useEnvironmentQuery, type EnvironmentQueryView } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

interface ResourceTelemetryState extends EnvironmentQueryView<ResourceTelemetrySnapshot> {
  readonly retry: () => Promise<ResourceTelemetrySnapshot>;
}

export function useResourceTelemetry(environmentId: EnvironmentId): ResourceTelemetryState {
  const query = useEnvironmentQuery(
    serverEnvironment.resourceTelemetry({ environmentId, input: {} }),
  );
  const retryCommand = useAtomCommand(serverEnvironment.retryResourceTelemetry, {
    reportFailure: false,
  });
  const retry = useCallback(async () => {
    const result = await retryCommand({ environmentId, input: {} });
    if (result._tag === "Failure") {
      throw Cause.squash(result.cause);
    }
    return result.value.snapshot;
  }, [environmentId, retryCommand]);

  return { ...query, retry };
}

export function useResourceTelemetryHistory(
  environmentId: EnvironmentId,
  input: ResourceTelemetryHistoryInput,
) {
  return useEnvironmentQuery(serverEnvironment.resourceTelemetryHistory({ environmentId, input }));
}
