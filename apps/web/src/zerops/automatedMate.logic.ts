/**
 * An automated Mate in its own conversation: it runs on the organization's API key alone, so the
 * coding agents a person signs in with a subscription (Claude, ChatGPT) are never offered there —
 * no picker panel, no sign-in. It works every task in its one conversation, a turn each: a task's
 * first message is the issue it brings (`ChatMessage.task`), and the header names the latest.
 */
import type { OrgAiKeysRead } from "@t3tools/client-runtime/data";
import { agentIdForDriverKind, type MateTaskSource } from "@t3tools/contracts";
import type { HqPullRequest } from "@t3tools/shared/hqGithub";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";
import {
  OPENCODE_KEY_PROVIDERS,
  automatedOpenCodeModel,
  openCodeKeyProviderOfModel,
} from "@t3tools/shared/openCodeKeyProviders";

/** The agents a conversation offers: on an automated Mate, none that a person signs in. */
export function automatedMateEntries<E extends { readonly driverKind: string }>(
  entries: ReadonlyArray<E>,
  automated: boolean,
): ReadonlyArray<E> {
  if (!automated) return entries;
  const kept = entries.filter((entry) => agentIdForDriverKind(entry.driverKind) === undefined);
  return kept.length === entries.length ? entries : kept;
}

/**
 * What an automated Mate's composer says in place of the model picker: the organization's key's
 * provider and the model the conversation runs, "Runs on Nebius · GLM-5.3" — its automated model
 * while the conversation names none.
 */
export function automatedRunsOnLine(model: string | null | undefined): string {
  const provider = openCodeKeyProviderOfModel(model);
  const fallback = OPENCODE_KEY_PROVIDERS[0];
  const slug =
    provider !== undefined || (model ?? "").trim() !== ""
      ? (model ?? "").trim()
      : fallback === undefined
        ? ""
        : automatedOpenCodeModel(fallback);
  const named = provider ?? openCodeKeyProviderOfModel(slug);
  const modelName = slug.split("/").at(-1) ?? slug;
  return named === undefined
    ? `Runs on ${modelName}`
    : `Runs on ${named.name.split(" ")[0]} · ${modelName}`;
}

/** What a task is called wherever it is named: "#12 Fix the checkout total"; else its title. */
export function taskTitle(task: {
  readonly title: string;
  readonly number?: number | undefined;
}): string {
  return task.number === undefined ? task.title : `#${String(task.number)} ${task.title}`;
}

/** A task a conversation works: the source its brief brought, and HQ's id of it where it says one. */
export interface ConversationTask {
  readonly source: MateTaskSource;
  readonly taskId: string | null;
}

/**
 * The task a conversation works now: the one its latest brief brought, with HQ's id of it where the
 * brief carries one (an automated Mate's one conversation, a turn per task; an older server's
 * conversation was one task's, named by its id); null for any other conversation.
 */
export function conversationTask(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly task?: MateTaskSource | undefined;
    readonly taskId?: string | undefined;
  }>,
): ConversationTask | null {
  const brief = messages.findLast(
    (message) => message.role === "user" && message.task !== undefined,
  );
  return brief?.task === undefined ? null : { source: brief.task, taskId: brief.taskId ?? null };
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

/** How a task ended (`HqNavigationMateTask.ended`). */
export type TaskEnding = NonNullable<HqNavigationMateTask["ended"]>;

/**
 * Where a conversation's task stands now, from the task its Mate is on or last worked (HQ's
 * navigation): not read yet; a task before its Mate's most recent one, which HQ no longer names;
 * ended, how, and the pull request it left; its Mate at work on it; waiting for a person's answer;
 * a person's stop taken, its Mate not stopped yet; live with its Mate at rest and no pull request
 * (between runs, or done with its change open: the task's record says which); or the pull request
 * its change is on GitHub.
 */
export type TaskChain =
  | { readonly kind: "unknown" }
  | { readonly kind: "earlier" }
  | {
      readonly kind: "ended";
      readonly ended: TaskEnding;
      readonly pullRequest: HqPullRequest | undefined;
    }
  | { readonly kind: "working"; readonly pullRequest: HqPullRequest | undefined }
  | { readonly kind: "waiting" }
  | { readonly kind: "stopping" }
  | { readonly kind: "done"; readonly pullRequest: HqPullRequest | undefined }
  | { readonly kind: "at-rest" }
  | { readonly kind: "pull-request"; readonly pullRequest: HqPullRequest };

/**
 * Whether the task a Mate is on is the one a conversation is worked for: by HQ's id, which the
 * conversation's id carries (a schedule's runs share their title); where it carries none, by the
 * source its first message brought.
 */
function isTaskOf(
  source: MateTaskSource,
  task: HqNavigationMateTask,
  taskId: string | null,
): boolean {
  if (taskId !== null) return task.id === taskId;
  if (source.kind === "github-issue")
    return task.repo === source.repo && task.number === source.number;
  const url = source.kind === "schedule" ? null : source.url;
  return url !== null && task.url !== null ? url === task.url : task.title === source.title;
}

export function taskChain(
  source: MateTaskSource,
  /** The task its Mate is on or last worked (`HqNavigationMate.task`): `undefined` while not read. */
  current: HqNavigationMateTask | null | undefined,
  /** Its Mate is at work now. */
  working: boolean,
  /** HQ's id of the conversation's task (`mateTaskIdOfConversation`); `null` where it names none. */
  taskId: string | null = null,
): TaskChain {
  if (current === undefined) return { kind: "unknown" };
  if (current === null || !isTaskOf(source, current, taskId)) return { kind: "earlier" };
  if (current.ended !== undefined)
    return { kind: "ended", ended: current.ended, pullRequest: current.pullRequest };
  if (current.stopping === true) return { kind: "stopping" };
  // HQ says its Mate finished it: up for review, whatever the Mate does meanwhile.
  if (current.done === true) return { kind: "done", pullRequest: current.pullRequest };
  if (working) return { kind: "working", pullRequest: current.pullRequest };
  if (current.waiting === true) return { kind: "waiting" };
  return current.pullRequest === undefined
    ? { kind: "at-rest" }
    : { kind: "pull-request", pullRequest: current.pullRequest };
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
