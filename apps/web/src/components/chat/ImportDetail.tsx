/**
 * An import opened under its bar: a plain line per service it creates — its
 * state's mark, its name, its state or, failed, why — never a tile, and never
 * "Failed." alone (`operationBar.logic`). A failed service the tool's result
 * gave no reason for takes the platform's, off the project's processes, read
 * only while one is wanted.
 */
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useProjectActivity } from "../../zerops/activity/useProjectActivity";
import { useZeropsTopology } from "../../zerops/useZeropsFeeds";
import { DetailRow } from "./DetailRow";
import { importLines, operationLineWord, processReasons } from "./operationBar.logic";

export function ImportDetail({
  operation,
  environmentId,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
}) {
  const told = useMemo(() => importLines(operation), [operation]);
  const wanting = told.some((line) => line.state === "failed" && line.reason === undefined);
  const topology = useZeropsTopology(wanting ? environmentId : null);
  const { processes } = useProjectActivity(wanting ? (topology?.project.id ?? null) : null);
  const lines = useMemo(() => {
    if (!wanting || topology === undefined || processes === undefined) return told;
    const serviceIds = new Map(
      topology.services.map((service) => [service.hostname, service.serviceId] as const),
    );
    return importLines(operation, processReasons(processes, serviceIds, operation.processIds));
  }, [operation, processes, told, topology, wanting]);
  return (
    <ul className="grid gap-px" data-operation-lines>
      {lines.map((line) => {
        const { tone, word } = operationLineWord(line);
        return (
          <DetailRow
            key={line.host}
            long="word"
            time={null}
            title={line.host}
            tone={tone}
            word={word}
          />
        );
      })}
    </ul>
  );
}
