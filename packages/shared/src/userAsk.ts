/**
 * What a user message asks — the one reading of a message's text that a thread
 * title, the sidebar's "last ask" and the composer's recall all share, on the
 * server and in every client.
 *
 * Not every user message is an ask. A slash command (`/compact`,
 * `/model opus`) is an instruction to the agent's harness, and the
 * usage-limit resume prompt is sent by the server, not the person: neither
 * titles a thread nor becomes the last ask. A message that carries only
 * attachments asks by its attachments, whatever placeholder text the client
 * put in front of them for the agent.
 */
import { messagePreviewText } from "./messagePreview.ts";

/**
 * Text the web client sends in place of an empty prompt when a message carries
 * only attachments: the agent needs words to answer. A title or a preview
 * reads the attachments instead (see {@link userAskOf}).
 */
export const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";

/**
 * The message the server sends — never the person — when a usage limit that
 * paused a thread resets and the thread resumes by itself
 * (`OrchestrationThreadShell.usagePause.autoResume`). It is stored as a user
 * message because a provider turn starts from one; a client recognises it with
 * {@link isUsageLimitResumePrompt} and renders it as an event, not as the
 * person's bubble.
 */
export const USAGE_LIMIT_RESUME_PROMPT =
  "[The usage limit has reset. Continue the work that was paused, and answer anything that arrived while you waited.]";

/** The effort prefix `applyClaudePromptEffortPrefix` puts in front of the person's text. */
const EFFORT_PREFIX = "Ultrathink:";

/**
 * `/name`, optionally followed by arguments. Command names come from arbitrary
 * file names (`/deploy.prod`, `/plugin:skill`), so any first token without a
 * second slash is one; an absolute path (`/home/theo/app.ts`) is not.
 */
const SLASH_COMMAND = /^\/[^\s/]+(?:\s|$)/u;

export function isSlashCommand(text: string): boolean {
  return SLASH_COMMAND.test(text.trim());
}

export function isUsageLimitResumePrompt(text: string): boolean {
  return text.trim() === USAGE_LIMIT_RESUME_PROMPT;
}

export type UserAsk =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "attachments"; readonly images: number; readonly files: number };

export interface UserAskSource {
  readonly text: string;
  readonly attachments?: ReadonlyArray<{ readonly type: string }> | undefined;
}

/**
 * The ask a user message makes, or null when it asks nothing: a slash command,
 * the server's resume prompt, or no words and no attachments. Words win over
 * attachments; the effort prefix is not part of what the person typed.
 */
export function userAskOf(message: UserAskSource): UserAsk | null {
  const trimmed = message.text.trim();
  if (isSlashCommand(trimmed) || isUsageLimitResumePrompt(trimmed)) return null;
  const words = trimmed.startsWith(EFFORT_PREFIX)
    ? trimmed.slice(EFFORT_PREFIX.length).trim()
    : trimmed;
  if (words.length > 0 && words !== IMAGE_ONLY_BOOTSTRAP_PROMPT) {
    return { kind: "text", text: words };
  }
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.type === "image").length;
  return { kind: "attachments", images, files: attachments.length - images };
}

/** "1 image", "3 images", "2 files", "1 image and 2 files". */
export function attachmentsLabel(counts: {
  readonly images: number;
  readonly files: number;
}): string {
  const parts = [
    ...(counts.images > 0 ? [countLabel(counts.images, "image")] : []),
    ...(counts.files > 0 ? [countLabel(counts.files, "file")] : []),
  ];
  return parts.join(" and ");
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * A user message as a list row quotes it (`messagePreviewText`), attachments
 * as their count, or null when the message asks nothing a row could quote.
 */
export function userAskPreviewText(message: UserAskSource): string | null {
  const ask = userAskOf(message);
  if (ask === null) return null;
  return ask.kind === "text" ? messagePreviewText(ask.text) : attachmentsLabel(ask);
}
