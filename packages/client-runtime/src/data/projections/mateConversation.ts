import * as Option from "effect/Option";
import type { Projection } from "../store.ts";
import type { ScopeKey } from "../model.ts";
import type { EnvironmentShellState } from "../adapters/mateShellReplay.ts";
import { sameValue } from "./equal.ts";
export interface ConversationKey {
  readonly environmentId: string;
  readonly threadId?: string;
}
export const conversationId = (key: ConversationKey) =>
  key.threadId === undefined
    ? key.environmentId
    : JSON.stringify([key.environmentId, key.threadId]);
export const conversationScope = (key: ConversationKey): ScopeKey =>
  `mate:${encodeURIComponent(key.environmentId)}:conversation-${key.threadId === undefined ? "shell" : "thread"}:${encodeURIComponent(conversationId(key))}`;
const emptyShell: EnvironmentShellState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
};
export const mateShell: Projection<ConversationKey, EnvironmentShellState> = {
  name: "mateShell",
  keyOf: conversationId,
  equals: sameValue,
  derive: (read, key) => {
    const fact = read.fact("mateShell", conversationId(key));
    const stream = read.stream(conversationScope(key));
    if (
      fact.kind !== "known" ||
      stream.fault?.outcome === "access-unverified" ||
      stream.fault?.outcome === "authoritative-denial"
    )
      return {
        ...emptyShell,
        status: ["connecting", "baselining"].includes(stream.phase) ? "synchronizing" : "empty",
        error: stream.fault === null ? Option.none() : Option.some(stream.fault.message),
      };
    return stream.phase === "live"
      ? fact.value.state
      : {
          ...fact.value.state,
          status: Option.isSome(fact.value.state.snapshot) ? "cached" : "empty",
        };
  },
};
