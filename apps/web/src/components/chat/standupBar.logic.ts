/**
 * A stand-up call's docked bar, from where its environment stands
 * (`@t3tools/client-runtime/zerops/activity/standupReading`): a segment per
 * service — the data, the utilities, the runtimes — in its own state, the
 * build that runs in the Zerops GUI's words — or how many run, when several
 * do — and how many are up, of how many. The run's clock is the now line's
 * (K3): the bar counts services, not time.
 */
import type {
  StandupReading,
  StandupServiceRow,
} from "@t3tools/client-runtime/zerops/activity/standupReading";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { BarTone } from "./StatusBar";

const SEGMENT: Record<StandupServiceRow["state"], BarTone> = {
  waits: "waiting",
  building: "running",
  up: "done",
  failed: "failed",
};

export interface StandupBarModel {
  readonly words: string;
  /** "4 of 6 up": up, of the environment's services; null before any is known. */
  readonly figure: string | null;
  readonly segments: ReadonlyArray<{ readonly key: string; readonly tone: BarTone }>;
  readonly failed: boolean;
}

function words(reading: StandupReading): string {
  const building = reading.rows.filter((row) => row.state === "building");
  const [only] = building;
  if (building.length === 1 && only !== undefined) {
    return `${only.hostname}: ${only.sentence ?? "Building"}`;
  }
  if (building.length > 1) return `${building.length} building`;
  const failed = reading.rows.filter((row) => row.state === "failed");
  const [first] = failed;
  if (failed.length === 1 && first !== undefined) return `${first.hostname} failed`;
  if (failed.length > 1) return `${failed.length} failed`;
  if (reading.rows.length > 0 && reading.up === reading.rows.length) return "All up";
  return "Getting ready";
}

/** `null`: nothing read yet — one running segment, no count. */
export function standupBar(reading: StandupReading | null): StandupBarModel {
  if (reading === null) {
    return {
      words: "Getting ready",
      figure: null,
      segments: [{ key: "whole", tone: "running" }],
      failed: false,
    };
  }
  const total = reading.rows.length;
  return {
    words: words(reading),
    figure: total === 0 ? null : `${reading.up} of ${total} up`,
    segments:
      total === 0
        ? [{ key: "whole", tone: "running" }]
        : reading.rows.map((row) => ({ key: row.hostname, tone: SEGMENT[row.state] })),
    failed: reading.failed > 0,
  };
}

const ROW: Record<
  StandupServiceRow["state"],
  { readonly tone: ServiceStatusToneId; readonly word: string }
> = {
  waits: { tone: "off", word: "Queued" },
  building: { tone: "busy", word: "Building" },
  up: { tone: "ok", word: "Up" },
  failed: { tone: "failed", word: "Failed" },
};

/**
 * A service under the opened bar: its state's dot and word — a build that
 * runs, its step; one held back, what it waits on; one that failed, why —
 * the platform's reason — else that its build failed.
 */
export function standupRow(row: StandupServiceRow): {
  readonly tone: ServiceStatusToneId;
  readonly word: string;
} {
  const { tone, word } = ROW[row.state];
  if (row.state === "building") return { tone, word: row.sentence ?? word };
  if (row.state === "waits" && row.note !== undefined) return { tone, word: `Waits: ${row.note}` };
  if (row.state === "failed") {
    return { tone, word: row.reason ?? (row.startedAt === undefined ? word : "Build failed") };
  }
  return { tone, word };
}
