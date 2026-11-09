/**
 * A service's state as its row says it: a code service by HQ's words for what it runs ("Deployed ·
 * 7d ago") with its dot, anything else by the platform's word only where it is not simply running
 * (`statusNeedsWord`). Pure: no React.
 */
import type { GroupRowTone } from "@t3tools/client-runtime/zerops";

import type { PlaceServiceRow } from "../place/place.logic";

/** A row's tone as a `Badge` dot's; none where its words are only that its answer is not in. */
const DOT: Record<GroupRowTone, "success" | "info" | "danger" | undefined> = {
  good: "success",
  pending: "info",
  bad: "danger",
  neutral: undefined,
};

export interface ServiceRowState {
  /** "Deployed", "Stopped". */
  readonly word: string;
  /** What follows it: "7d ago". */
  readonly age: string | undefined;
  /** Its dot, where it has one. */
  readonly tone: "success" | "info" | "danger" | undefined;
}

/** What a service's state cell says; `undefined` where it says nothing. */
export function serviceRowState(
  row: Pick<PlaceServiceRow, "code" | "platform">,
): ServiceRowState | undefined {
  const code = row.code;
  if (code === undefined)
    return row.platform === undefined || !row.platform.statusNeedsWord
      ? undefined
      : { word: row.platform.statusLabel, age: undefined, tone: undefined };
  if (code.status === undefined) return undefined;
  const [word = code.status, ...rest] = code.status.split(" · ");
  return { word, age: rest.length === 0 ? undefined : rest.join(" · "), tone: DOT[code.tone] };
}
