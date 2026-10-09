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
/** A run's checks read each call's own frame; another turn's picture cannot fill its slot. */
export const mateBrowserFrames: Projection<
  {
    readonly environmentId: string;
    readonly threadId: string;
    readonly calls: ReadonlyArray<{
      readonly callId: string | null;
      readonly turnId: string | null;
    }>;
  },
  ReadonlyArray<MateBrowserFrameRead>
> = {
  name: "mateBrowserFrames",
  keyOf: (input) => JSON.stringify(input),
  derive: (read, { environmentId, threadId, calls }) =>
    calls.map(({ callId, turnId }) =>
      callId === null || turnId === null
        ? UNKNOWN_BROWSER_FRAME
        : mateBrowserFrame.derive(read, { environmentId, threadId, callId, turnId }),
    ),
  equals: sameValue,
};
/**
 * The last page the agent's browser showed, and when. The agent's browser lives only for each
 * tool call (3-7 s), so between calls this is what the surface has to show: that page, marked not
 * live, rather than "hasn't opened a browser yet".
 */
export interface MateBrowserLastSeen {
  readonly frame: ZeropsBrowserFrame;
  /** When the frame arrived, on this client's clock. */
  readonly atMs: number;
}

/** The live view's state, plus the last page seen while the view is not a current frame. */
export type MateBrowserStreamRead = ZeropsBrowserStreamState & {
  readonly last?: MateBrowserLastSeen;
};

export const mateBrowserStream: Projection<
  string,
  MateBrowserStreamRead | "unavailable" | undefined
> = {
  name: "mateBrowserStream",
  keyOf: (environmentId) => environmentId,
  derive: (read, environmentId) => {
    const stream = read.stream(mateBrowserFrameScope(environmentId));
    if (stream.phase === "refused" || stream.phase === "unsupported") return "unavailable";
    const fact = read.fact("mateBrowserFrame", mateBrowserStreamId(environmentId));
    if (fact.kind !== "known" || fact.value.kind !== "stream") return undefined;
    const retained = fact.value.state.frame;
    const atMs = fact.value.frameAtMs;
    const last =
      retained === undefined || atMs === undefined ? {} : { last: { frame: retained, atMs } };
    if (stream.phase !== "live")
      return {
        status: "connecting",
        ...(fact.value.state.url === undefined ? {} : { url: fact.value.state.url }),
        ...(fact.value.state.title === undefined ? {} : { title: fact.value.state.title }),
        ...last,
      };
    if (!fact.value.currentFrame || fact.value.state.status !== "live") {
      const { frame: _retained, ...state } = fact.value.state;
      return { ...state, ...last };
    }
    return fact.value.state;
  },
  equals: sameValue,
};
