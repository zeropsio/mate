/**
 * An automated Mate in its own conversation: it runs on the organization's API key alone, so the
 * coding agents a person signs in with a subscription (Claude, ChatGPT) are never offered there —
 * no picker panel, no sign-in. Its conversations are tasks: a task's first message is the issue
 * it brings (`ChatMessage.task`), and the conversation is named by it.
 */
import type { OrgAiKeysRead } from "@t3tools/client-runtime/data";
import { agentIdForDriverKind, type MateTaskSource } from "@t3tools/contracts";
import type { HqPullRequest } from "@t3tools/shared/hqGithub";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";

/** The agents a conversation offers: on an automated Mate, none that a person signs in. */
export function automatedMateEntries<E extends { readonly driverKind: string }>(
  entries: ReadonlyArray<E>,
  automated: boolean,
): ReadonlyArray<E> {
  if (!automated) return entries;
  const kept = entries.filter((entry) => agentIdForDriverKind(entry.driverKind) === undefined);
  return kept.length === entries.length ? entries : kept;
}

/** What a task is called wherever it is named: "#12 Fix the checkout total"; else its title. */
export function taskTitle(task: {
  readonly title: string;
  readonly number?: number | undefined;
}): string {
  return task.number === undefined ? task.title : `#${String(task.number)} ${task.title}`;
}

/** The task a conversation works: the issue its first message brought; null for any other. */
export function conversationTask(
  messages: ReadonlyArray<{ readonly role: string; readonly task?: MateTaskSource | undefined }>,
): MateTaskSource | null {
  const first = messages.find((message) => message.role === "user");
  return first?.task ?? null;
}

/**
 * What a pull request on GitHub is called on every surface: "PR #14", GitHub's own name for it.
 * One place, so the word is changed in one place (design-system.md §2 says "change" for Mate's own).
 */
export function pullRequestName(pullRequest: { readonly number: number }): string {
  return `PR #${String(pullRequest.number)}`;
}

/** The link to a change's pull request: "PR #14 on GitHub · open · checks passing". */
export function pullRequestLinkWords(
  pullRequest: Pick<HqPullRequest, "number" | "state" | "checks">,
): string {
  return `${pullRequestName(pullRequest)} on GitHub · ${pullRequestStateWords(pullRequest)}`;
}

/** A pull request's state in words, its checks while it is open: "open · checks passing". */
export function pullRequestStateWords(
  pullRequest: Pick<HqPullRequest, "state" | "checks">,
): string {
  if (pullRequest.state !== "open" || pullRequest.checks === undefined) return pullRequest.state;
  const checks =
    pullRequest.checks === "pending"
      ? "running"
      : pullRequest.checks === "passing"
        ? "passing"
        : "failing";
  return `open · checks ${checks}`;
}

/**
 * Where a conversation's task stands now, from the task its Mate is on (HQ's navigation): not read
 * yet; over — its Mate is on no task, or another; its Mate at work on it; waiting for a person's
 * answer; its change waiting for review; or the pull request its change is on GitHub.
 */
export type TaskChain =
  | { readonly kind: "unknown" }
  | { readonly kind: "ended" }
  | { readonly kind: "working"; readonly pullRequest: HqPullRequest | undefined }
  | { readonly kind: "waiting" }
  | { readonly kind: "review" }
  | { readonly kind: "pull-request"; readonly pullRequest: HqPullRequest };

/** Whether the task a Mate is on is the one a conversation's first message brought. */
function isTaskOf(source: MateTaskSource, task: HqNavigationMateTask): boolean {
  if (source.kind === "github-issue")
    return task.repo === source.repo && task.number === source.number;
  const url = source.kind === "schedule" ? null : source.url;
  return url !== null && task.url !== null ? url === task.url : task.title === source.title;
}

export function taskChain(
  source: MateTaskSource,
  /** The task its Mate is on (`HqNavigationMate.task`): `undefined` while not read. */
  current: HqNavigationMateTask | null | undefined,
  /** Its Mate is at work now. */
  working: boolean,
): TaskChain {
  if (current === undefined) return { kind: "unknown" };
  if (current === null || !isTaskOf(source, current)) return { kind: "ended" };
  if (working) return { kind: "working", pullRequest: current.pullRequest };
  if (current.waiting === true) return { kind: "waiting" };
  return current.pullRequest === undefined
    ? { kind: "review" }
    : { kind: "pull-request", pullRequest: current.pullRequest };
}

/** The chain's line: its state in a word or two, then its pull request, linked; either may be none. */
export function taskChainLine(chain: TaskChain): {
  readonly status: string | null;
  readonly pullRequest: { readonly words: string; readonly url: string } | null;
} {
  const linked = (pullRequest: HqPullRequest | undefined) =>
    pullRequest === undefined
      ? null
      : {
          words: `${pullRequestName(pullRequest)} · ${pullRequestStateWords(pullRequest)}`,
          url: pullRequest.url,
        };
  switch (chain.kind) {
    case "unknown":
      return { status: null, pullRequest: null };
    case "ended":
      return { status: "Ended", pullRequest: null };
    case "working":
      return { status: "Working", pullRequest: linked(chain.pullRequest) };
    case "waiting":
      return { status: "Waiting for you", pullRequest: null };
    case "review":
      return { status: "Waiting for review", pullRequest: null };
    case "pull-request":
      return { status: null, pullRequest: linked(chain.pullRequest) };
  }
}

/** The provider whose organization key automated Mates run on (Nebius by default). */
export const AUTOMATED_KEY_PROVIDER = "nebius";

/**
 * Whether the organization holds the key its automated Mates run on, as far as it is read: `set`,
 * `missing`, `unknown` while it is not read (or its read failed) — and `unsupported` where this
 * HQ keeps no organization keys: it predates automated Mates, so nothing offers them.
 */
export type AutomatedKeyState = "set" | "missing" | "unknown" | "unsupported";

export function automatedKeyState(keys: OrgAiKeysRead["keys"]): AutomatedKeyState {
  if (keys.state === "unsupported") return "unsupported";
  if (keys.state !== "known") return "unknown";
  return keys.keys.some((key) => key.provider === AUTOMATED_KEY_PROVIDER && key.set)
    ? "set"
    : "missing";
}

/** What an automated Mate's panel says of its agents: they run on the organization's key, or wait for it. */
export function automatedAgentsLine(name: string, key: AutomatedKeyState): string {
  return key === "missing"
    ? `${name} waits for your organization's API key. Nobody signs in to it.`
    : `${name} runs on your organization's API key. Nobody signs in to it.`;
}

/**
 * What New Mate says under its Automated choice of the key it runs on: that the organization has
 * none yet — with the way to Settings for one who can set it (`canSet`: an Owner or Admin), else
 * who sets it — or, where this HQ turned out older than automated Mates, that it needs updating.
 * Nothing while the key is set or not read.
 */
export type NewMateKeyNote =
  | { readonly kind: "missing"; readonly canSet: boolean }
  | { readonly kind: "update" }
  | null;

export function newMateKeyNote(key: AutomatedKeyState, admin: boolean): NewMateKeyNote {
  if (key === "missing") return { kind: "missing", canSet: admin };
  if (key === "unsupported") return { kind: "update" };
  return null;
}
