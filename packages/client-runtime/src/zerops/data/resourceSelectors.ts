/**
 * What web and mobile read from a broker resource: view models over its
 * `Shown` state, so no consumer outside `cr/zerops` narrows a `Known` to its
 * value (DESIGN §3.6).
 */
import type { ZeropsLocation } from "../api.ts";
import type { Shown } from "../knowledge/index.ts";
import type { ZeropsIntegrationTokenGrantMetadata } from "./resources.ts";

const NO_LOCATIONS: ReadonlyArray<ZeropsLocation> = [];

/** The locations a new project may be placed in; there are none to offer until a read answered. */
export interface LocationChoice {
  readonly status: "loading" | "ready" | "failed";
  readonly locations: ReadonlyArray<ZeropsLocation>;
}

export function selectLocationChoice(shown: Shown<ReadonlyArray<ZeropsLocation>>): LocationChoice {
  switch (shown.state) {
    case "known":
      return { status: "ready", locations: shown.value };
    case "failed":
      return { status: "failed", locations: NO_LOCATIONS };
    case "unread":
    case "reading":
    case "gone":
    case "withheld":
      return { status: "loading", locations: NO_LOCATIONS };
  }
}

/** What the group-reach reconcile acts on: the tokens' grants once a read answered them. */
export type TokenGrantsRead =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | {
      readonly status: "known";
      readonly grants: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>;
    };

export function selectTokenGrants(
  shown: Shown<ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>>,
): TokenGrantsRead {
  switch (shown.state) {
    case "known":
      return { status: "known", grants: shown.value };
    case "failed":
      return { status: "failed" };
    case "unread":
    case "reading":
    case "gone":
    case "withheld":
      return { status: "pending" };
  }
}

/**
 * A one-shot reader's answer: the value the read that settled the resource
 * succeeded with. A failure, a withholding and a value whose revalidation
 * failed answer nothing.
 */
export const settledValue = <T>(shown: Shown<T>): { readonly value: T } | null =>
  shown.state === "known" && shown.freshness.kind === "settled" ? { value: shown.value } : null;
