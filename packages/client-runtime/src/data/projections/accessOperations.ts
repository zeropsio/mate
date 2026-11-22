/**
 * The access changes the viewer started at HQ, as HQ's `access:<id>` navigation keys show them to
 * their maker (`hqAccessOperation`), each as a person's row reads it: running, waiting for its
 * maker's fresh sign-in, or failed, in words. A change HQ ended without failure has no key, so no
 * row; nothing here is the tab's copy.
 *
 * @module data/projections/accessOperations
 */
import type { HqAccessOperation } from "@t3tools/shared/hqAccessOperation";

import { hqAccessOperationFamily } from "../families/hqAccessOperation.ts";
import { scopeOf } from "../families/spec.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

type Operation = NonNullable<HqAccessOperation["operation"]>;
type ChangeKind = HqAccessOperation["change"]["kind"];
type Step = NonNullable<Operation["failure"]>["step"];

/** One access change of the viewer's, as a person's row says it. */
export interface AccessOperationRow {
  readonly id: string;
  readonly kind: ChangeKind;
  /** The changed person; `null` for an invitation to an address without a Zerops account. */
  readonly userId: string | null;
  readonly state: "running" | "waiting" | "failed";
  /** What it does or did, in words. */
  readonly phase: string;
  /** Why it stopped, in words; absent while it runs. */
  readonly failure?: string;
  /** The step it stopped at (`invite`: a resend's earlier invitation was withdrawn by then). */
  readonly failedAt?: Step;
  /** Waiting: whose fresh sign-in it waits for (HQ's `continueBy`). */
  readonly continueBy?: string;
  /** Waiting for the viewer: Continue is theirs. */
  readonly mine: boolean;
}

const KIND_WORDS: { readonly [K in ChangeKind]: string } = {
  invite: "Sending the invitation",
  resend: "Sending the invitation again",
  role: "Changing their role",
  projects: "Changing their project access",
  remove: "Removing them from the organization",
  app: "Changing their access to the project",
  readAccess: "Giving the read access they asked for",
};

/** Where a running change stands, in words; a phase its kind says better is left to the kind. */
const PHASE_WORDS: { readonly [P in Operation["phase"]]: string | null } = {
  accepted: null,
  grants_requested: "Giving their project access",
  role_requested: "Changing their role",
  removal_requested: null,
  invite_requested: "Sending the invitation",
};

const phaseWords = (kind: ChangeKind, operation: Operation | null): string => {
  if (operation === null) return KIND_WORDS[kind];
  if (operation.phase === "removal_requested" && kind === "resend")
    return "Withdrawing the earlier invitation";
  return PHASE_WORDS[operation.phase] ?? KIND_WORDS[kind];
};

/** HQ's own failure codes of an access change (`mate-hq spec/protocol.md` S13a), in words. */
const HQ_FAILURE_WORDS: Readonly<Record<string, string>> = {
  token_expired: "Your Zerops sign-in ran out before it finished.",
  invitation_moved:
    "Their invitation changed in Zerops after this started, so nothing was sent again.",
  not_invited: "They are no longer waiting on an invitation: they joined, or it was withdrawn.",
  already_member: "That address is already on the team or invited.",
  names_required:
    "Zerops has no account for this address any more and needs their first and last name. Invite them again.",
  not_member: "They are no longer in the organization.",
};

/** What Zerops refused at each step, for its own codes. */
const STEP_WORDS: { readonly [S in Step]: string } = {
  search: "find them",
  grants: "change their project access",
  role: "change their role",
  remove: "remove them",
  invite: "send the invitation",
};

/** A failure's code in words: HQ's own by its table, Zerops' own named with the step it refused. */
export function accessFailureWords(failure: NonNullable<Operation["failure"]>): string {
  return (
    HQ_FAILURE_WORDS[failure.code] ??
    `Zerops refused to ${STEP_WORDS[failure.step]} (${failure.code}).`
  );
}

/** The rows of the viewer's access changes, oldest first. */
export function accessOperationRows(
  values: ReadonlyArray<HqAccessOperation>,
  viewer: string | null,
): ReadonlyArray<AccessOperationRow> {
  return [...values]
    .sort((a, b) => (a.operation?.acceptedAt ?? "").localeCompare(b.operation?.acceptedAt ?? ""))
    .map(({ id, change, operation }): AccessOperationRow => {
      const base = {
        id,
        kind: change.kind,
        userId: change.userId ?? null,
        phase: phaseWords(change.kind, operation),
      };
      // A key without its operation is a change HQ holds no state of: only Delete helps.
      if (operation === null)
        return {
          ...base,
          state: "failed",
          failure: "HQ holds no state of this change.",
          mine: false,
        };
      const { failure, continueBy } = operation;
      if (failure === undefined) return { ...base, state: "running", mine: false };
      const stopped = { ...base, failure: accessFailureWords(failure), failedAt: failure.step };
      if (continueBy !== undefined)
        return { ...stopped, state: "waiting", continueBy, mine: continueBy === viewer };
      return { ...stopped, state: "failed", mine: false };
    });
}

export const NO_ACCESS_OPERATIONS: ReadonlyArray<AccessOperationRow> = [];

/** The viewer's access changes in an organization, as HQ's navigation shows them to their maker. */
export const accessOperations: Projection<
  { readonly orgId: string; readonly viewer: string | null },
  ReadonlyArray<AccessOperationRow>
> = {
  name: "accessOperations",
  keyOf: (key) => JSON.stringify(key),
  equals: sameValue,
  derive: (read, key) => {
    const values: HqAccessOperation[] = [];
    for (const id of read.members(scopeOf(hqAccessOperationFamily, key.orgId)).ids) {
      const fact = read.fact("hqAccessOperation", id);
      if (fact.kind === "known") values.push(fact.value);
    }
    return values.length === 0 ? NO_ACCESS_OPERATIONS : accessOperationRows(values, key.viewer);
  },
};
