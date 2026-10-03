/**
 * What web and mobile read from a broker resource: view models over its
 * `Shown` state, so no consumer outside `cr/zerops` narrows a `Known` to its
 * value (DESIGN §3.6).
 */
import type { ZeropsLocation, ZeropsOrganizationMember } from "../api.ts";
import type { Shown } from "../knowledge/index.ts";

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

const NO_MEMBERS: ReadonlyArray<ZeropsOrganizationMember> = [];

/** An organization's members once a read answered them, and whether one is still coming. */
export interface MembersRead {
  readonly status: "loading" | "ready" | "failed";
  readonly members: ReadonlyArray<ZeropsOrganizationMember>;
}

export function selectMembers(shown: Shown<ReadonlyArray<ZeropsOrganizationMember>>): MembersRead {
  switch (shown.state) {
    case "known":
      return { status: "ready", members: shown.value };
    case "failed":
    case "gone":
    case "withheld":
      return { status: "failed", members: NO_MEMBERS };
    case "unread":
    case "reading":
      return { status: "loading", members: NO_MEMBERS };
  }
}

/**
 * A one-shot reader's answer: the value the read that settled the resource
 * succeeded with. A failure, a withholding and a value whose revalidation
 * failed answer nothing.
 */
export const settledValue = <T>(shown: Shown<T>): { readonly value: T } | null =>
  shown.state === "known" && shown.freshness.kind === "settled" ? { value: shown.value } : null;
