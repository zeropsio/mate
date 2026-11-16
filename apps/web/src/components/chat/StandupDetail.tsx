/**
 * A stand-up call opened: a row per service it builds — its state, the step
 * a running build is on, and how long each build took or has taken.
 */
import type { StandupReading } from "@t3tools/client-runtime/zerops/activity/standupReading";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { EnvironmentId, StandUpRow, StandUpVerdict } from "@t3tools/contracts";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import { useStandupReading } from "../../zerops/activity/useStandupReading";
import { DetailRow, spanOf } from "./DetailRow";
import { standupRow } from "./standupBar.logic";

function StandupRows({ reading }: { readonly reading: StandupReading | null }) {
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

const VERDICT_ROW: Record<
  StandUpRow["state"],
  { readonly tone: ServiceStatusToneId; readonly word: string }
> = {
  building: { tone: "busy", word: "Building" },
  done: { tone: "ok", word: "Done" },
  failed: { tone: "failed", word: "Failed" },
};

/**
 * zcp's stand-up verdict, a row per pooled service in the stand-up's row look: its state, its
 * cause where zcp gives one, and its next step where zcp gives one — zcp's own words, verbatim.
 */
export function StandupVerdictRows({ verdict }: { readonly verdict: StandUpVerdict }) {
  const next = verdict.rows.filter((row) => row.next !== "");
  return (
    <>
      <ul className="grid gap-px">
        {verdict.rows.map((row) => {
          const { tone, word } = VERDICT_ROW[row.state];
          return (
            <DetailRow
              key={row.hostname}
              long={row.cause !== "" ? "word" : "title"}
              time={null}
              title={row.hostname}
              tone={tone}
              word={row.cause !== "" ? row.cause : word}
            />
          );
        })}
      </ul>
      {next.map((row) => (
        <p className="text-muted-foreground" key={row.hostname}>
          {row.hostname}: {row.next}
        </p>
      ))}
    </>
  );
}
