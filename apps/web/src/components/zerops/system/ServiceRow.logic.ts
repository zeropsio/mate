/**
 * A service's card as words: its state where it is not calm (a code service by HQ's words for what
 * it runs, anything else by the platform's word only where it is not simply running), the quiet line
 * under its name, and each meter's reading and fill. Pure: no React.
 */
import type { GroupRowTone } from "@t3tools/client-runtime/zerops";
import type { ZeropsServiceMetric } from "@t3tools/client-runtime/zerops/serviceMap";

import type { PlaceServiceRow } from "../place/place.logic";

/** A row's tone as a `Badge`'s; none where its words are only that its answer is not in. */
const TONE: Record<GroupRowTone, "success" | "info" | "danger" | undefined> = {
  good: "success",
  pending: "info",
  bad: "danger",
  neutral: undefined,
};

export interface ServiceRowState {
  /** "Building", "Stopped". */
  readonly word: string;
  /** What follows it: "7d ago". */
  readonly age: string | undefined;
  /** Its pill's tone, where it has one. */
  readonly tone: "success" | "info" | "danger" | undefined;
}

/**
 * What a service's card says beside its name; `undefined` where it is calm — a code service running
 * what HQ deployed, anything else simply running — and says nothing.
 */
export function serviceRowState(
  row: Pick<PlaceServiceRow, "code" | "platform">,
): ServiceRowState | undefined {
  const code = row.code;
  if (code === undefined)
    return row.platform === undefined || !row.platform.statusNeedsWord
      ? undefined
      : { word: row.platform.statusLabel, age: undefined, tone: undefined };
  if (code.status === undefined || code.tone === "good") return undefined;
  const [word = code.status, ...rest] = code.status.split(" · ");
  return { word, age: rest.length === 0 ? undefined : rest.join(" · "), tone: TONE[code.tone] };
}

/**
 * The quiet line under a code service's name: its commit, then when it was deployed and with which
 * version — `c3a91e4 · deployed 8d ago with v0.1.3`. `undefined` where nothing is known to run.
 */
export function serviceRunsLine(
  code: Pick<NonNullable<PlaceServiceRow["code"]>, "commit" | "status" | "line" | "tone">,
): { readonly commit: string; readonly rest: string | undefined } | undefined {
  if (code.commit === undefined) return undefined;
  const [, ...age] = code.status?.split(" · ") ?? [];
  const when = code.tone === "good" && age.length > 0 ? `deployed ${age.join(" · ")}` : undefined;
  const how = code.line?.startsWith("deployed ") === true ? code.line.slice(9) : code.line;
  const said = how === undefined || how === "" ? undefined : how;
  const rest =
    when === undefined || said === undefined
      ? (when ?? said)
      : `${when}${said.startsWith("with ") ? " " : " · "}${said}`;
  return { commit: code.commit, rest };
}

/** A meter's figures: `0.19` over `2 GB`; a dash where the service holds none. */
export function meterReading(metric: ZeropsServiceMetric | undefined): {
  readonly used: string;
  readonly of: string | undefined;
} {
  if (metric?.value === undefined) return { used: "—", of: undefined };
  const of = metric.unit === undefined ? metric.value : `${metric.value} ${metric.unit}`;
  return metric.used === undefined ? { used: of, of: undefined } : { used: metric.used, of };
}

/** Where a meter's bar turns amber: nearly all of what the service holds is in use. */
export const METER_HIGH = 0.85;

/** How full a meter's bar is, 0–1, and whether it is nearly full; none where use is not known. */
export function meterFill(
  metric: ZeropsServiceMetric | undefined,
): { readonly fraction: number; readonly high: boolean } | undefined {
  const fraction =
    metric?.fraction ??
    (metric?.used === undefined || metric.value === undefined
      ? undefined
      : Number(metric.used) / Number(metric.value));
  if (fraction === undefined || !Number.isFinite(fraction)) return undefined;
  const clamped = Math.min(1, Math.max(0, fraction));
  return { fraction: clamped, high: clamped >= METER_HIGH };
}
