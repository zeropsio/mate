/**
 * A stand-up call opened: a row per service it builds — its state, the step
 * a running build is on, and how long each build took or has taken.
 */
import type { StandupReading } from "@t3tools/client-runtime/zerops/activity/standupReading";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { EnvironmentId } from "@t3tools/contracts";

import { useStandupReading } from "../../zerops/activity/useStandupReading";
import { DetailRow, spanOf } from "./DetailRow";
import { standupRow } from "./standupBar.logic";

export function StandupRows({ reading }: { readonly reading: StandupReading | null }) {
  if (reading === null) return null;
  return (
    <ul className="grid gap-px">
      {reading.rows.map((row) => {
        const { tone, word } = standupRow(row);
        return (
          <DetailRow
            key={row.hostname}
            long={row.state === "failed" ? "word" : "title"}
            time={row.startedAt === undefined ? null : spanOf(row.startedAt, row.endedAt ?? null)}
            title={row.hostname}
            tone={tone}
            word={word}
          />
        );
      })}
    </ul>
  );
}

export function StandupDetail({
  operation,
  environmentId,
  turnRuns,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  /** Its turn runs: builds it ran on with are read as they stand. */
  readonly turnRuns: boolean;
}) {
  const reading = useStandupReading(operation, environmentId, turnRuns);
  return <StandupRows reading={reading} />;
}
