/**
 * The workspace chip of a conversation bound to a lease: when the workspace was last active, what
 * a release would lose there, and whether it is idle — from what zcp last read of the lease
 * (`leases[].activity`, `unsaved`; zcp `docs/spec-mate.md` §2.8a.3) and the conversation's own last
 * turn. Idle is a label and nothing else: nothing acts on it (zcp `docs/spec-mate.md` §0 rule 4).
 *
 * And its Release: the question Mate asks before a workspace is released, and the request a yes
 * sends. Mate releases nothing and runs no zcp: the bound conversation's agent releases the lease
 * with `zerops_lease`, whose guard refuses unsaved work, and the unbind fan-out does the rest (zcp
 * `docs/spec-mate.md` §6.3).
 */
import {
  type CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  isZeropsLeaseHeld,
  type MessageId,
  type ModelSelection,
  type OrchestrationLatestTurn,
  type ProviderInteractionMode,
  type RuntimeMode,
  sameZeropsLeaseGroup,
  type ThreadId,
  type ZeropsLease,
  type ZeropsLifecycle,
} from "@t3tools/contracts";

import type { StartThreadTurnInput } from "../operations/commands.ts";
import type { AtomCommandResult } from "../state/runtime.ts";
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

interface WorkspaceRead {
  /** What is known of the workspace: `idle`, `last active 26 h ago`, `2 unpushed`, … */
  readonly facts: ReadonlyArray<string>;
  readonly idle: boolean;
}

/** What the chip and the release question say of a workspace; none while nothing says anything. */
function workspaceRead(input: {
  readonly lease: LeaseRead | undefined;
  readonly lastTurn: LastTurn | null | undefined;
  readonly now: number;
}): WorkspaceRead | undefined {
  const { lease, now } = input;
  const turn = turnActivityMs(input.lastTurn, now);
  const last = newest([lease === undefined ? undefined : leaseActivityMs(lease), turn]);
  if (last === undefined) return undefined;
  const idle =
    lease !== undefined &&
    zeropsLeaseIdle(lease, now) &&
    (turn === undefined || now - turn >= ZEROPS_LEASE_IDLE_AFTER_MS);
  return {
    facts: [
      ...(idle ? ["idle"] : []),
      `last active ${activeAgo(last, now)}`,
      ...unsavedWords(lease?.unsaved),
    ],
    idle,
  };
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
  const read = workspaceRead(input);
  if (read === undefined) return undefined;
  return { words: ["workspace", ...read.facts].join(" · "), idle: read.idle };
}

/**
 * zcp's last read of the lease a conversation is bound to, from the conversation's last read of
 * zcp's leases: the lease of its alias, repository and branch while zcp holds it; none before a
 * read, and none for a lease that ended or another repository's or branch's under the same alias.
 */
export function boundLeaseRead(
  binding: CheckoutLease | null | undefined,
  leases: ReadonlyArray<ZeropsLease> | undefined,
): ZeropsLease | undefined {
  if (binding === null || binding === undefined) return undefined;
  return leases?.find(
    (lease) =>
      lease.alias === binding.alias &&
      sameZeropsLeaseGroup(binding, lease) &&
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
    lease: boundLeaseRead(input.binding, knownLeases(input.lifecycle)),
    lastTurn: input.lastTurn,
    now: input.now,
  });

/** zcp's leases as the conversation last read them; none while the lifecycle is not known. */
const knownLeases = (
  lifecycle: Known<ZeropsLifecycle> | undefined,
): ReadonlyArray<ZeropsLease> | undefined =>
  lifecycle?.state === "known" ? lifecycle.value.envelope?.leases : undefined;

/**
 * The question Mate asks before a workspace is released: on the archive of the conversation bound
 * to it, and from its chip's Release. The owner approves its words.
 */
export const ZEROPS_RELEASE_QUESTION = (alias: string): string =>
  `Release workspace ${alias}? Its agent will be asked to release it.`;

/**
 * The message a yes sends into the bound conversation: its agent releases the lease with zcp's own
 * tool, whose guard refuses unpushed work; it is never asked to force. The owner approves its words.
 */
export const ZEROPS_RELEASE_REQUEST = (alias: string): string =>
  `Please release this conversation's Zerops workspace \`${alias}\` with zerops_lease action=release lease=${alias}. If it has unpushed work, stop and tell me instead of forcing.`;

/** Whether to release a bound conversation's workspace, as the person is asked it. */
export interface ZeropsReleaseAsk {
  readonly alias: string;
  /** `ZEROPS_RELEASE_QUESTION`. */
  readonly question: string;
  /** What is known of the workspace — `idle · last active 26 h ago · all pushed` — none while nothing is. */
  readonly facts: string | undefined;
  /** Nothing happened there for 24 h: the question may stand out, and nothing acts on it. */
  readonly idle: boolean;
}

/**
 * The release question of a conversation bound to a lease zcp still holds — held, unmounted or
 * parked — with what is known of its workspace (`workspaceChip`'s facts). None for a conversation
 * bound to no lease, or once the conversation's last read of zcp's leases no longer holds the bound
 * one. Before any read, the binding alone asks: it is Mate's record of a lease the conversation's
 * agent acquired, unbound when the lease ends.
 */
export function zeropsReleaseAsk(input: {
  readonly binding: CheckoutLease | null | undefined;
  readonly lifecycle: Known<ZeropsLifecycle> | undefined;
  readonly lastTurn: LastTurn | null | undefined;
  readonly now: number;
}): ZeropsReleaseAsk | undefined {
  const { binding } = input;
  if (binding === null || binding === undefined) return undefined;
  const leases = knownLeases(input.lifecycle);
  const lease = boundLeaseRead(binding, leases);
  if (leases !== undefined && lease === undefined) return undefined;
  const read = workspaceRead({ lease, lastTurn: input.lastTurn, now: input.now });
  return {
    alias: binding.alias,
    question: ZEROPS_RELEASE_QUESTION(binding.alias),
    facts: read === undefined ? undefined : read.facts.join(" · "),
    idle: read?.idle ?? false,
  };
}

/** The conversation a release request goes to: what its turn is sent with. */
export interface ZeropsReleaseConversation {
  readonly id: ThreadId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

/**
 * The turn a yes sends: `ZEROPS_RELEASE_REQUEST` as the person's own visible message, a normal turn
 * in the conversation's own model and runtime mode. It runs in the default interaction mode even in
 * a conversation set to plan: the person asked for the release, and a plan turn would only plan it.
 * The mode rides this one message (the engine keeps no conversation-wide mode), so the
 * conversation's next message is planned as before. Mate's words, not theirs, so it never names
 * the conversation (`fromPanel`).
 */
export const zeropsReleaseTurn = (input: {
  readonly conversation: ZeropsReleaseConversation;
  readonly alias: string;
  readonly ids: { readonly commandId: CommandId; readonly messageId: MessageId };
  readonly createdAt: string;
}): StartThreadTurnInput => ({
  commandId: input.ids.commandId,
  threadId: input.conversation.id,
  message: {
    messageId: input.ids.messageId,
    role: "user",
    text: ZEROPS_RELEASE_REQUEST(input.alias),
    attachments: [],
  },
  modelSelection: input.conversation.modelSelection,
  runtimeMode: input.conversation.runtimeMode,
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  fromPanel: true,
  createdAt: input.createdAt,
});

/**
 * Sends a yes's request into the bound conversation, once. An archived conversation takes no
 * message (the engine refuses it), so it is brought back first, and nothing is sent when it cannot
 * be. Sending is all Mate does: the agent releases the lease.
 */
export async function sendZeropsReleaseRequest(input: {
  readonly turn: StartThreadTurnInput;
  readonly archived: boolean;
  readonly unarchive: () => Promise<AtomCommandResult<unknown, unknown>>;
  readonly startTurn: (turn: StartThreadTurnInput) => Promise<AtomCommandResult<unknown, unknown>>;
}): Promise<AtomCommandResult<unknown, unknown>> {
  if (input.archived) {
    const back = await input.unarchive();
    if (back._tag === "Failure") return back;
  }
  return input.startTurn(input.turn);
}
