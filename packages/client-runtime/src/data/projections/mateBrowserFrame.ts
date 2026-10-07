import type { ZeropsBrowserFrame } from "@t3tools/contracts";
import type { ZeropsBrowserStreamState } from "../../zerops/browserStream.ts";
import {
  mateBrowserFrameId,
  mateBrowserFrameScope,
  mateBrowserStreamId,
} from "../families/mateBrowserFrame.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface MateBrowserFrameRead {
  readonly kind: "unknown" | "known" | "absent" | "refused";
  readonly frame: ZeropsBrowserFrame | null;
  readonly freshness: "live" | "stale" | "unknown";
}
export const UNKNOWN_BROWSER_FRAME: MateBrowserFrameRead = {
  kind: "unknown",
  frame: null,
  freshness: "unknown",
};
export const mateBrowserFrame: Projection<
  {
    readonly environmentId: string;
    readonly callId: string;
    readonly threadId: string;
    readonly turnId: string;
  },
  MateBrowserFrameRead
> = {
  name: "mateBrowserFrame",
  keyOf: ({ environmentId, threadId, turnId, callId }) =>
    mateBrowserFrameId(environmentId, threadId, turnId, callId),
  derive: (read, { environmentId, threadId, turnId, callId }) => {
    const scope = mateBrowserFrameScope(environmentId);
    const stream = read.stream(scope);
    if (stream.phase === "refused") return { kind: "refused", frame: null, freshness: "unknown" };
    const id = mateBrowserFrameId(environmentId, threadId, turnId, callId);
    const fact = read.fact("mateBrowserFrame", id);
    if (fact.kind !== "known" || fact.value.kind !== "call") return UNKNOWN_BROWSER_FRAME;
    const observation = read.fact("mateBrowserFrame", mateBrowserStreamId(environmentId));
    const observed =
      observation.kind === "known" &&
      observation.value.kind === "stream" &&
      observation.value.observedCalls.get(id) === fact.value.revision;
    const frame = fact.value.frame;
    return {
      kind: frame === null ? "absent" : "known",
      frame,
      freshness: stream.phase === "live" && observed ? "live" : "stale",
    };
  },
  equals: sameValue,
};
export const mateBrowserStream: Projection<
  string,
  ZeropsBrowserStreamState | "unavailable" | undefined
> = {
  name: "mateBrowserStream",
  keyOf: (environmentId) => environmentId,
  derive: (read, environmentId) => {
    const stream = read.stream(mateBrowserFrameScope(environmentId));
    if (stream.phase === "refused" || stream.phase === "unsupported") return "unavailable";
    const fact = read.fact("mateBrowserFrame", mateBrowserStreamId(environmentId));
    if (fact.kind !== "known" || fact.value.kind !== "stream") return undefined;
    if (stream.phase !== "live")
      return {
        status: "connecting",
        ...(fact.value.state.url === undefined ? {} : { url: fact.value.state.url }),
        ...(fact.value.state.title === undefined ? {} : { title: fact.value.state.title }),
      };
    if (!fact.value.currentFrame || fact.value.state.status !== "live") {
      const { frame: _retained, ...state } = fact.value.state;
      return state;
    }
    return fact.value.state;
  },
  equals: sameValue,
};
