/** Source-owned browser results, keyed by Mate and SPI call id; the live viewport is a separate slot. */
import type { ZeropsBrowserFrame } from "@t3tools/contracts";
import type { ZeropsBrowserStreamState } from "../../zerops/browserStream.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type MateBrowserFrameValue =
  | {
      readonly kind: "call";
      readonly callId: string;
      readonly threadId: string;
      readonly turnId: string;
      readonly revision: number;
      readonly frame: ZeropsBrowserFrame | null;
    }
  | {
      readonly kind: "stream";
      readonly state: ZeropsBrowserStreamState;
      /** A frame received in this source session, rather than retained from an earlier one. */
      readonly currentFrame: boolean;
      /** Exact call revisions observed in this source session, separately from retained values. */
      readonly observedCalls: ReadonlyMap<string, number>;
    };

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateBrowserFrame: MateBrowserFrameValue;
  }
}
export const mateBrowserFrameFamily: FamilySpec<"mateBrowserFrame"> = {
  family: "mateBrowserFrame",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "browser-frame",
    leaving: "removed",
    demand: "detail",
    mode: "realtime",
  },
};
export const mateBrowserFrameScope = (environmentId: string) =>
  scopeOf(mateBrowserFrameFamily, `browser-${environmentId}`);
export const mateBrowserFrameId = (
  environmentId: string,
  threadId: string,
  turnId: string,
  callId: string,
): string => JSON.stringify([environmentId, threadId, turnId, callId]);
export const mateBrowserStreamId = (environmentId: string): string =>
  JSON.stringify([environmentId]);
