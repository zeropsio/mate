/**
 * A member's take-over as their page reads it: the tokens the member minted, as HQ last listed them,
 * and where this account's last replace of one stands, with HQ's answer to it.
 */
import type { HqTakeOverList, HqTakeOverReplaced } from "@t3tools/shared/hqTakeOver";
import { SETTING_UNSUPPORTED } from "../families/hqAutomation.ts";
import {
  takeOverId,
  takeOverLink,
  takeOverScope,
  type TakeOverKey,
} from "../families/hqTakeOver.ts";
import { operationResult } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { actionOf, type AutomationAction } from "./hqAutomation.ts";

export interface MemberTakeOverRead {
  readonly list:
    /** `unsupported`: this HQ cannot take over a member's tokens. */
    | { readonly state: "unread" | "reading" | "withheld" | "unsupported" }
    | {
        readonly state: "known";
        readonly list: HqTakeOverList;
        /** Its last read failed: what is shown is what HQ said before. */
        readonly stale: boolean;
      }
    | { readonly state: "failed"; readonly words: string };
  readonly action: AutomationAction<"replace">;
  /** The token this account's last replace was for, and HQ's answer once given. */
  readonly last: {
    readonly tokenId: string;
    readonly answer: HqTakeOverReplaced | undefined;
  } | null;
}

export const memberTakeOver: Projection<TakeOverKey, MemberTakeOverRead> = {
  name: "memberTakeOver",
  keyOf: takeOverId,
  derive: (read, key) => {
    const fact = read.fact("hqTakeOver", takeOverId(key));
    const stream = read.stream(takeOverScope(key));
    const list: MemberTakeOverRead["list"] =
      fact.kind === "known"
        ? { state: "known", list: fact.value, stale: stream.fault !== null }
        : fact.kind === "withheld"
          ? { state: "withheld" }
          : read.stream(takeOverLink(key)).fault?.code === SETTING_UNSUPPORTED
            ? { state: "unsupported" }
            : stream.fault !== null
              ? { state: "failed", words: stream.fault.message }
              : {
                  state:
                    stream.phase === "baselining" || stream.phase === "connecting"
                      ? "reading"
                      : "unread",
                };
    const request = read.fact("hqTakeOverRequest", takeOverId(key));
    if (request.kind !== "known") return { list, action: { kind: "idle" }, last: null };
    const record = read.operation(request.value.requestId);
    return {
      list,
      action: actionOf(
        record,
        () => "replace",
        "HQ may have replaced this token. The list shows what is left once it is read again.",
      ),
      last: {
        tokenId: request.value.tokenId,
        answer: record === undefined ? undefined : operationResult(record, "take-over-token"),
      },
    };
  },
  equals: sameValue,
};
