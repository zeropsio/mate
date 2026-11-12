/** The organization's open read access requests as a screen reads them. */
import type { ReadAccessRequest } from "../../zerops/hq/readAccess.ts";
import { SETTING_UNSUPPORTED } from "../families/hqAutomation.ts";
import {
  readAccessId,
  readAccessLink,
  readAccessScope,
  type ReadAccessKey,
} from "../families/hqReadAccess.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export type ReadAccessRead =
  /** `unsupported`: this HQ keeps no read access requests. */
  | { readonly state: "unread" | "reading" | "withheld" | "unsupported" }
  | { readonly state: "known"; readonly requests: ReadonlyArray<ReadAccessRequest> }
  | { readonly state: "failed"; readonly words: string };

export const orgReadAccessRequests: Projection<ReadAccessKey, ReadAccessRead> = {
  name: "orgReadAccessRequests",
  keyOf: readAccessId,
  derive: (read, key) => {
    const fact = read.fact("hqReadAccessRequests", readAccessId(key));
    const stream = read.stream(readAccessScope(key));
    if (fact.kind === "known") return { state: "known", requests: fact.value };
    if (fact.kind === "withheld") return { state: "withheld" };
    if (read.stream(readAccessLink(key)).fault?.code === SETTING_UNSUPPORTED)
      return { state: "unsupported" };
    if (stream.fault !== null) return { state: "failed", words: stream.fault.message };
    return {
      state: stream.phase === "baselining" || stream.phase === "connecting" ? "reading" : "unread",
    };
  },
  equals: sameValue,
};
