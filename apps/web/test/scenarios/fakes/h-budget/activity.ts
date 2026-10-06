// @effect-diagnostics nodeBuiltinImport:off -- event-driven pending-work drain.
import type * as NodeEvents from "node:events";
import { deadline } from "../../harness/http.ts";

export async function settled(events: NodeEvents.EventEmitter, idle: () => boolean, label: string) {
  let check = () => {};
  try {
    await deadline(
      new Promise<void>((resolve) => {
        check = () => {
          if (idle()) resolve();
        };
        events.on("activity", check);
        check();
      }),
      label,
    );
  } finally {
    events.off("activity", check);
  }
}
