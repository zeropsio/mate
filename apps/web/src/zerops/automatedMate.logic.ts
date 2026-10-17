/**
 * An automated Mate in its own conversation: it runs on the organization's API key alone, so the
 * coding agents a person signs in with a subscription (Claude, ChatGPT) are never offered there —
 * no picker panel, no sign-in. Its conversations are tasks: a task's first message is the issue
 * it brings (`ChatMessage.task`), and the conversation is named by it.
 */
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

/** What a task is called wherever it is named: "#12 Fix the checkout total". */
export function taskTitle(task: Pick<MateTaskSource, "number" | "title">): string {
  return `#${String(task.number)} ${task.title}`;
}

/** The task a conversation works: the issue its first message brought; null for any other. */
export function conversationTask(
  messages: ReadonlyArray<{ readonly role: string; readonly task?: MateTaskSource | undefined }>,
): MateTaskSource | null {
  const first = messages.find((message) => message.role === "user");
  return first?.task ?? null;
}
