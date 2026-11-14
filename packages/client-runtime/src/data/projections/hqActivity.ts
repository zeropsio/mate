/**
 * One page of an organization's activity as a screen reads it: its entries, or why there are none
 * to show yet — not read, being read, HQ's refusal (only Owners and Admins read it), or a failed read.
 */
import type { HqActivityPage } from "@t3tools/shared/hqActivity";
import { SETTING_UNSUPPORTED } from "../families/hqAutomation.ts";
import {
  activityId,
  activityLink,
  activityScope,
  type ActivityKey,
} from "../families/hqActivity.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export type ActivityPageRead =
  | { readonly state: "unread" }
  | { readonly state: "reading" }
  | { readonly state: "withheld" }
  | { readonly state: "unsupported"; readonly words: string }
  | { readonly state: "failed"; readonly words: string }
  | {
      readonly state: "known";
      readonly page: HqActivityPage;
      /** Its last read failed: what is shown is what HQ said before. */
      readonly stale: boolean;
    };

export const activityPage: Projection<ActivityKey, ActivityPageRead> = {
  name: "activityPage",
  keyOf: activityId,
  derive: (read, key) => {
    const fact = read.fact("hqActivity", activityId(key));
    const stream = read.stream(activityScope(key));
    if (fact.kind === "known")
      return { state: "known", page: fact.value, stale: stream.fault !== null };
    if (fact.kind === "withheld") return { state: "withheld" };
    const linkFault = read.stream(activityLink(key)).fault;
    if (linkFault?.code === SETTING_UNSUPPORTED)
      return { state: "unsupported", words: linkFault.message };
    if (stream.fault !== null) return { state: "failed", words: stream.fault.message };
    return {
      state: stream.phase === "baselining" || stream.phase === "connecting" ? "reading" : "unread",
    };
  },
  equals: sameValue,
};
