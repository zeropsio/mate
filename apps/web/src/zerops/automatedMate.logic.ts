/**
 * An automated Mate in its own conversation: it runs on the organization's API key alone, so the
 * coding agents a person signs in with a subscription (Claude, ChatGPT) are never offered there —
 * no picker panel, no sign-in. Its conversations are tasks: a task's first message is the issue
 * it brings (`ChatMessage.task`), and the conversation is named by it.
 */
import type { OrgAiKeysRead } from "@t3tools/client-runtime/data";
import { agentIdForDriverKind, type MateTaskSource } from "@t3tools/contracts";

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
