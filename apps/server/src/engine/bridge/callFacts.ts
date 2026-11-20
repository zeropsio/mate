/**
 * What a call's row shows, read the way V1 reads it: each tool item's event goes through V1's
 * own activity projection (`projectActivityPayload`), so an engine call carries the line, the
 * shown facts and the Zerops result a V1 row of the same call carries, for every driver. Pure.
 *
 * @module engine/bridge/callFacts
 */
import {
  CALL_INPUT_MAX,
  CALL_SHOWS_STRING_MAX,
  type OrchestrationThreadActivity,
  type SpiEvent,
} from "@t3tools/contracts";

import { projectActivityPayload } from "../../activity/ActivityPayloadProjection.ts";
import type { ZeropsActivityResult } from "../../activity/zeropsActivityResult.ts";

type ToolEvent = Extract<
  SpiEvent,
  { readonly type: "item.started" | "item.updated" | "item.completed" }
>;

/** A call's facts as its row shows them; each kept from an earlier event when a later omits it. */
export interface CallFacts {
  /** What it was given, as one line (V1's activity detail, cut as V1 cuts it). */
  readonly line?: string;
  /** V1's projected activity data, but its result and the driver's own id. */
  readonly shows?: Readonly<Record<string, unknown>>;
  /** A `zerops_*` call's result, its pictures still as the driver gave them. */
  readonly result?: ZeropsActivityResult;
}

const ACTIVITY_KIND = {
  "item.started": "tool.started",
  "item.updated": "tool.updated",
  "item.completed": "tool.completed",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The start of `text`, then `...`, when it is longer than `max` (V1's `truncateDetail`). */
const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 3)}...` : text;

const cutLine = (detail: string): string => cut(detail, CALL_INPUT_MAX);

/**
 * `record` with every string at any depth (a nested object, an array) cut to
 * `CALL_SHOWS_STRING_MAX`; its keys, its shape and every other value kept.
 */
function cutRecord(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, cutValue(value)]));
}

function cutValue(value: unknown): unknown {
  if (typeof value === "string") return cut(value, CALL_SHOWS_STRING_MAX);
  if (Array.isArray(value)) return value.map(cutValue);
  return isRecord(value) ? cutRecord(value) : value;
}

/** The summary V1 gives each lifecycle activity: the projection names an untitled call by it. */
const summaryOf = (event: ToolEvent): string => {
  const title = event.payload.title;
  switch (event.type) {
    case "item.started":
      return `${title ?? "Tool"} started`;
    case "item.updated":
      return title ?? "Tool updated";
    case "item.completed":
      return title ?? "Tool";
  }
};

/** One event's facts, over the facts the call's earlier events gave. */
export function callFacts(event: ToolEvent, previous: CallFacts = {}): CallFacts {
  const payload = event.payload;
  const line = payload.detail ? cutLine(payload.detail) : undefined;
  const activity = {
    id: event.eventId,
    createdAt: event.createdAt,
    tone: "tool",
    kind: ACTIVITY_KIND[event.type],
    summary: summaryOf(event),
    turnId: null,
    payload: {
      itemType: payload.itemType,
      ...(payload.status === undefined ? {} : { status: payload.status }),
      ...(line === undefined ? {} : { detail: line }),
      ...(payload.data === undefined ? {} : { data: payload.data }),
    },
  } as unknown as OrchestrationThreadActivity;
  const projected = (projectActivityPayload(activity).payload as { readonly data?: unknown }).data;
  const data = isRecord(projected) ? projected : {};
  const { zerops, toolCallId: _native, ...shown } = data;
  const shows = cutRecord({ ...previous.shows, ...shown });
  const result = (zerops as ZeropsActivityResult | undefined) ?? previous.result;
  const kept = line ?? previous.line;
  return {
    ...(kept === undefined ? {} : { line: kept }),
    ...(Object.keys(shows).length === 0 ? {} : { shows }),
    ...(result === undefined ? {} : { result }),
  };
}
