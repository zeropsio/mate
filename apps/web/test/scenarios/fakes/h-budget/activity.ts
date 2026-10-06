// @effect-diagnostics nodeBuiltinImport:off -- wire-observation receipts and a bounded inactivity condition.
import type * as NodeEvents from "node:events";
import { deadline } from "../../harness/http.ts";

/** Resolve after a full quiet window with no pending work; activity restarts the condition. */
export async function settled(
  events: NodeEvents.EventEmitter,
  idle: () => boolean,
  label: string,
  quietMs = 1_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activity = () => {};
  try {
    await deadline(
      new Promise<void>((resolve) => {
        activity = () => {
          clearTimeout(timer);
          if (idle())
            timer = setTimeout(() => {
              if (idle()) resolve();
            }, quietMs);
        };
        events.on("activity", activity);
        activity();
      }),
      label,
      15_000,
    );
  } finally {
    clearTimeout(timer);
    events.off("activity", activity);
  }
}
