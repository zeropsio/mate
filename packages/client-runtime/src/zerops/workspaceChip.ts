/**
 * The workspace chip of a conversation bound to a lease: when the workspace was last active, what
 * a release would lose there, and whether it is idle — from what zcp last read of the lease
 * (`leases[].activity`, `unsaved`; zcp `docs/spec-mate.md` §2.8a.3) and the conversation's own last
 * turn. Idle is a label and nothing else: nothing acts on it (zcp `docs/spec-mate.md` §0 rule 4).
 */
import {
  isZeropsLeaseHeld,
  type OrchestrationLatestTurn,
  type ZeropsLease,
  zeropsLeaseGroupBranch,
  type ZeropsLifecycle,
} from "@t3tools/contracts";

import type { CheckoutLease } from "./gitTab.ts";
import type { Known } from "./knowledge/index.ts";

/** How long a workspace goes with nothing happening in it before it is idle: the owner's 24 h. */
export const ZEROPS_LEASE_IDLE_AFTER_MS = 24 * 60 * 60 * 1000;

/** What zcp last read of a lease, as the chip reads it. */
export type LeaseRead = Pick<ZeropsLease, "acquiredAt" | "activity" | "unsaved">;
/** A conversation's last turn, as the chip reads it. */
export type LastTurn = Pick<
  OrchestrationLatestTurn,
  "state" | "requestedAt" | "startedAt" | "completedAt"
>;

const ms = (at: string | null | undefined): number | undefined => {
  if (at === null || at === undefined) return undefined;
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const newest = (times: ReadonlyArray<number | undefined>): number | undefined =>
  times.reduce<number | undefined>(
    (best, at) => (at === undefined || (best !== undefined && best >= at) ? best : at),
    undefined,
  );

/**
 * The newest activity zcp read on a lease: its checkout's last change, its preview's last
 * connection, its acquire — and the read itself, when a preview connection was open then.
 */
const leaseActivityMs = (lease: LeaseRead): number | undefined => {
  const activity = lease.activity;
  return newest([
    ms(activity?.lastChangeAt),
    ms(activity?.previewLastConnAt),
    ms(activity?.acquiredAt),
    ms(lease.acquiredAt),
    (activity?.previewOpenConns ?? 0) > 0 ? ms(activity?.readAt) : undefined,
  ]);
};

/** When the conversation last worked: now while its turn runs. */
const turnActivityMs = (turn: LastTurn | null | undefined, now: number): number | undefined => {
  if (turn === null || turn === undefined) return undefined;
  if (turn.state === "running") return now;
  return ms(turn.completedAt) ?? ms(turn.startedAt) ?? ms(turn.requestedAt);
};

/**
 * Whether what zcp read of a lease makes it idle at `now`, by zcp's own rule (zcp
 * `docs/spec-workflows.md` §8 DP-25): its checkout's last change, its unsaved work and its preview
 * were all read; no preview connection was open; and its newest activity is 24 h or more before
 * `now`. A fact that was not read is never taken for no activity.
 */
export function zeropsLeaseIdle(lease: LeaseRead, now: number): boolean {
  const activity = lease.activity;
  const last = leaseActivityMs(lease);
  return (
    ms(activity?.lastChangeAt) !== undefined &&
    lease.unsaved !== undefined &&
    activity?.previewOpenConns === 0 &&
    last !== undefined &&
    now - last >= ZEROPS_LEASE_IDLE_AFTER_MS
  );
}

/** `just now`, `5 min ago`, `26 h ago`, `3 d ago`. */
const activeAgo = (at: number, now: number): string => {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} h ago`;
  return `${String(Math.floor(hours / 24))} d ago`;
};

/** What a release would lose, as the chip says it; nothing while it was not read. */
const unsavedWords = (unsaved: LeaseRead["unsaved"]): ReadonlyArray<string> => {
  if (unsaved === undefined) return [];
  if (unsaved.fileCount === 0 && unsaved.unpushedCommits === 0) return ["all pushed"];
  return [
    ...(unsaved.unpushedCommits > 0 ? [`${String(unsaved.unpushedCommits)} unpushed`] : []),
    ...(unsaved.fileCount > 0 ? [`${String(unsaved.fileCount)} uncommitted`] : []),
  ];
};

export interface WorkspaceChip {
  /** `workspace · idle · last active 26 h ago · 2 unpushed · 2 uncommitted`. */
  readonly words: string;
  readonly idle: boolean;
}

/**
 * The chip of a conversation bound to a lease: its workspace's last activity — the conversation's
 * own last turn or what zcp read of the lease, whichever is newer — what a release would lose
 * there when zcp read it, and the idle label once both say nothing happened for 24 h. None while
 * neither says anything.
 */
export function workspaceChip(input: {
  /** zcp's last read of the lease (`boundLeaseRead`); none before one. */
  readonly lease: LeaseRead | undefined;
  readonly lastTurn: LastTurn | null | undefined;
  readonly now: number;
}): WorkspaceChip | undefined {
  const { lease, now } = input;
  const turn = turnActivityMs(input.lastTurn, now);
  const last = newest([lease === undefined ? undefined : leaseActivityMs(lease), turn]);
  if (last === undefined) return undefined;
  const idle =
    lease !== undefined &&
    zeropsLeaseIdle(lease, now) &&
    (turn === undefined || now - turn >= ZEROPS_LEASE_IDLE_AFTER_MS);
  return {
    words: [
      "workspace",
      ...(idle ? ["idle"] : []),
      `last active ${activeAgo(last, now)}`,
      ...unsavedWords(lease?.unsaved),
    ].join(" · "),
    idle,
  };
}

/**
 * zcp's last read of the lease a conversation is bound to, from the conversation's last read of
 * zcp's leases: the lease of its alias and branch while zcp holds it; none before a read, and none
 * for a lease that ended or another branch's under the same alias.
 */
export function boundLeaseRead(
  binding: CheckoutLease | null | undefined,
  leases: ReadonlyArray<ZeropsLease> | undefined,
): ZeropsLease | undefined {
  if (binding === null || binding === undefined) return undefined;
  const branch = zeropsLeaseGroupBranch(binding.branch);
  return leases?.find(
    (lease) =>
      lease.alias === binding.alias &&
      zeropsLeaseGroupBranch(lease.branch) === branch &&
      isZeropsLeaseHeld(lease.state),
  );
}

/**
 * The chip of a conversation bound to `binding`, from the conversation's lifecycle: zcp's last
 * read of the lease while the lifecycle is known; while it is not, the conversation's own last
 * turn alone — what zcp read of the lease is left out, never said to be none, and never idle.
 */
export const workspaceChipOf = (input: {
  readonly binding: CheckoutLease | null | undefined;
  readonly lifecycle: Known<ZeropsLifecycle> | undefined;
  readonly lastTurn: LastTurn | null | undefined;
  readonly now: number;
}): WorkspaceChip | undefined =>
  workspaceChip({
    lease: boundLeaseRead(
      input.binding,
      input.lifecycle?.state === "known" ? input.lifecycle.value.envelope?.leases : undefined,
    ),
    lastTurn: input.lastTurn,
    now: input.now,
  });
