import { HqStreamMessage } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ScenarioExtension } from "../../harness/scenario.ts";

const readMessage = Schema.decodeUnknownOption(Schema.fromJsonString(HqStreamMessage));
const readRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

/** The task an automated Mate is on, as HQ's navigation names it. */
export interface WiredTask {
  readonly number: number;
  readonly title: string;
  /** It waits for a person's answer (HQ's `task.waiting`). */
  readonly waiting?: true;
  /** It ended, the Mate free for its next (HQ's `task.ended`). */
  readonly ended?: "merged" | "closed" | "done" | "failed" | "stopped";
}

/**
 * HQ's navigation as an HQ with automated Mates sends it, over the real Core's own frames: the
 * named projects' Mates automated, on the task set now, and their application's intake with the
 * tasks waiting set now. A frame carries what is set when HQ sends it: what HQ sends next says the
 * next.
 */
export function automatedMatesWire(projectIds: ReadonlyArray<string>) {
  let task: WiredTask | null = null;
  let waiting = 0;
  const automated = new Set(projectIds);
  const mapped = (key: string, raw: unknown): unknown => {
    const value = Option.getOrUndefined(readRecord(raw));
    if (value === undefined) return raw;
    if (key.startsWith("project:") && automated.has(key.slice("project:".length))) {
      const mate = Option.getOrUndefined(readRecord(value.mate));
      if (mate === undefined) return raw;
      return {
        ...value,
        mate: {
          ...mate,
          automated: true,
          task:
            task === null
              ? null
              : {
                  id: `task-${String(task.number)}`,
                  repo: "acme/tea-shop",
                  number: task.number,
                  title: task.title,
                  url: `https://github.com/acme/tea-shop/issues/${String(task.number)}`,
                  label: `acme/tea-shop#${String(task.number)}`,
                  ...(task.waiting === true ? { waiting: true } : {}),
                  ...(task.ended === undefined ? {} : { ended: task.ended }),
                },
        },
      };
    }
    if (
      key.startsWith("app:") &&
      Array.isArray(value.projectIds) &&
      value.projectIds.some((id) => typeof id === "string" && automated.has(id))
    )
      return { ...value, intake: { repo: "acme/tea-shop", label: "mate", waiting } };
    return raw;
  };
  const map = (encoded: string): string => {
    const message = Option.getOrUndefined(readMessage(encoded));
    if (
      message === undefined ||
      (message.type !== "scope-reset" && message.type !== "scope-values") ||
      message.scope.kind !== "navigation"
    )
      return encoded;
    return JSON.stringify({
      ...message,
      values: message.values.map((entry) => ({ ...entry, value: mapped(entry.key, entry.value) })),
    });
  };
  const install: ScenarioExtension = (drivers) => {
    drivers.hq.mapFrames(map);
  };
  return {
    map,
    install,
    set: (next: { readonly task: WiredTask | null; readonly waiting: number }) => {
      task = next.task;
      waiting = next.waiting;
    },
  };
}
