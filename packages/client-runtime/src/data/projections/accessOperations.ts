/**
 * The access changes HQ's `access:<id>` navigation keys show the viewer (`hqAccessOperation`): their
 * own, and for an Owner or Admin another maker's while it waits, each as a person's row reads it:
 * running, waiting for its maker's fresh sign-in, or failed, in words. A change HQ ended without
 * failure has no key, so no row; nothing here is the tab's copy.
 *
 * @module data/projections/accessOperations
 */
import type { HqAccessOperation } from "@t3tools/shared/hqAccessOperation";

import { hqAccessOperationFamily } from "../families/hqAccessOperation.ts";
import { scopeOf } from "../families/spec.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import {
  operationFailureDetails,
  operationFailureWords,
  outcomeUnknownLine,
  waitingWords,
  type WaitingPress,
} from "./operationFailure.ts";

type Operation = NonNullable<HqAccessOperation["operation"]>;
type ChangeKind = HqAccessOperation["change"]["kind"];

/** One access change of the viewer's, as a person's row says it. */
export interface AccessOperationRow {
  readonly id: string;
  readonly kind: ChangeKind;
  /** The changed person; `null` for an invitation to an address without a Zerops account. */
  readonly userId: string | null;
  /** The projects it names, as HQ's key does: its grants', or a read access request's project. */
  readonly projectIds?: ReadonlyArray<string>;
  /** The app it concerns: an app's access change. */
  readonly appId?: string;
  readonly state: "running" | "waiting" | "failed";
  /** What it does or did, in words. */
  readonly phase: string;
  /** Why it stopped, in words; absent while it runs. */
  readonly failure?: string;
  /** Zerops' whole answer for a refusal by Zerops, otherwise null; absent while it runs. */
  readonly details?: string | null;
  /**
   * A Send again that stopped after withdrawing the earlier invitation and before Zerops sent it
   * again: HQ moves a resend to `invite_requested` only once its removal is done, and on to
   * `grants_requested` once the invitation landed, whichever step its failure names.
   */
  readonly invitationLost?: true;
  /** Waiting: whose fresh sign-in it waits for (HQ's `continueBy`). */
  readonly continueBy?: string;
  /** Waiting: the word on its Continue's button, by what it waits on. */
  readonly press?: WaitingPress;
  /** Waiting for the viewer: Continue is theirs. */
  readonly mine: boolean;
  /** Waiting for another maker: HQ shows it to this reader only as an Owner or Admin who may end it. */
  readonly endable?: true;
}

/** How the reader may withdraw a change: its maker's Delete, an Owner's or Admin's End, or not. */
export function accessOperationWithdrawal(
  row: Pick<AccessOperationRow, "state" | "mine" | "endable">,
): "delete" | "end" | null {
  if (row.state === "running") return null;
  if (row.state === "waiting" && !row.mine) return row.endable === true ? "end" : null;
  return "delete";
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
        ...(change.projectIds === undefined ? {} : { projectIds: change.projectIds }),
        ...(change.appId === undefined ? {} : { appId: change.appId }),
        phase: phaseWords(change.kind, operation),
      };
      // A key without its operation is a change HQ holds no state of: only Delete helps.
      if (operation === null)
        return {
          ...base,
          state: "failed",
          failure: "HQ holds no state of this change.",
          details: null,
          mine: false,
        };
      const { failure, continueBy } = operation;
      if (failure === undefined) return { ...base, state: "running", mine: false };
      const stopped = {
        ...base,
        failure: operationFailureWords(failure),
        details: operationFailureDetails(failure),
        ...(change.kind === "resend" && operation.phase === "invite_requested"
          ? { invitationLost: true as const }
          : {}),
      };
      if (continueBy !== undefined)
        return {
          ...stopped,
          state: "waiting",
          continueBy,
          failure:
            (continueBy === viewer ? outcomeUnknownLine(failure, true) : null) ??
            operationFailureWords(failure),
          press: waitingWords(failure.code).press,
          mine: continueBy === viewer,
          ...(viewer !== null && continueBy !== viewer ? { endable: true as const } : {}),
        };
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
